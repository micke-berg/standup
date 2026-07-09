// providers/github.js — the GitHub HOST lane for standup.
//
// Collects the pull requests you touched in the lookback window and hands them to the core as
// neutral items (see contract.js): the ones you MERGED and the ones you REVIEWED become
// yesterday's work, and your currently-OPEN PRs become today's — carrying enough CI/review
// state that the core can flag a red build or a PR that has waited too long for a review.
//
// Read-only against GitHub. Auth is owned by the CLI (run `gh auth login` once) — no tokens in
// config. Every `gh` call is execFile with an argument array (no shell), so a repo name can
// never be interpreted as a command. Identity ("me") is your gh login, resolved once at load.

const { execFile, execFileSync } = require("child_process");
const config = require("../config.js");

const GH = config.ghCliPath || (process.platform === "win32" ? "gh.exe" : "gh");

// Resolve identity once. Prefer config.me; else ask gh. Never throw at load time.
let ME = config.me || "";
if (!ME) {
  try { ME = execFileSync(GH, ["api", "user", "-q", ".login"], { windowsHide: true }).toString().trim(); }
  catch (e) { ME = ""; }
}

function gh(args) {
  return new Promise((resolve, reject) => {
    execFile(GH, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || "").trim() || err.message));
      try { resolve(JSON.parse(stdout || "null")); }
      catch (e) { reject(new Error("bad JSON from gh: " + e.message)); }
    });
  });
}

// statusCheckRollup[] -> normalized ci token. Entries are CheckRun (status + conclusion) or
// StatusContext (state). Any failing conclusion/state -> failed; else anything still pending ->
// running; else all good -> passed; empty -> none. Same derivation as watch-pr, pure + tested.
const FAIL = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR"]);
const PENDING = new Set(["QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED", "EXPECTED"]);
function deriveCi(rollup) {
  const checks = rollup || [];
  if (!checks.length) return "none";
  const concl = checks.map((c) => (c.conclusion || "").toUpperCase());
  const states = checks.map((c) => (c.status || c.state || "").toUpperCase());
  if (concl.some((c) => FAIL.has(c)) || states.some((s) => FAIL.has(s))) return "failed";
  if (states.some((s) => PENDING.has(s))) return "running";
  return "passed";
}

// Hours between two ISO timestamps, floored at 0. Pure.
function hoursBetween(fromIso, toIso) {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return isNaN(ms) ? 0 : Math.max(0, ms / 3600000);
}

// From a `gh pr view` payload (+ now), derive the review-facing numbers the core's flags read:
// how many non-you approvals there are, and — if nobody has reviewed a ready (non-draft) PR yet
// — how long it's been sitting. Pure, so it's tested without gh.
function reviewState(view, me, nowIso) {
  const reviews = ((view && view.latestReviews) || []).filter((r) => {
    const login = (r.author && r.author.login) || "";
    return login && login !== me;
  });
  const approvals = reviews.filter((r) => (r.state || "").toUpperCase() === "APPROVED").length;
  const reviewed = reviews.length > 0;
  const isDraft = !!(view && view.isDraft);
  const reviewWaitHours = (!reviewed && !isDraft) ? hoursBetween((view && view.createdAt) || nowIso, nowIso) : 0;
  return { approvals, reviewWaitHours };
}

// GitHub search wants a plain date; the window cutoff is a full ISO timestamp.
function dateOf(iso) { return String(iso || "").slice(0, 10); }
function repoName(r) { return (r && (r.nameWithOwner || r.name)) || ""; }
function itemId(repo, number) { return `${repo}#${number}`; }

// The collect() the core calls. Three searches (merged / reviewed / open), de-duplicated by
// repo#number, with a per-open-PR detail read for CI + review state.
async function collect(ctx) {
  const me = (ctx && ctx.me) || ME || "@me";
  const nowIso = (ctx && ctx.now) || new Date().toISOString();
  const since = dateOf(ctx && ctx.sinceIso);
  const byKey = new Map(); // repo#number -> neutral item (first writer wins: merged > reviewed > open)

  // 1. PRs I merged in the window → Yesterday.
  const merged = await gh([
    "search", "prs", "--author", "@me", "--merged", "--merged-at", ">=" + since,
    "--limit", "50", "--json", "number,title,url,repository,closedAt,createdAt",
  ]);
  for (const p of merged || []) {
    const repo = repoName(p.repository), key = itemId(repo, p.number);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      lane: "host", kind: "pr", id: key, title: p.title || "", url: p.url || "",
      context: repo, author: me, state: "merged", activity: "merged",
      ts: p.closedAt || p.createdAt || nowIso, meta: {},
    });
  }

  // 2. PRs I reviewed in the window → Yesterday.
  const reviewed = await gh([
    "search", "prs", "--reviewed-by", "@me", "--updated", ">=" + since,
    "--limit", "50", "--json", "number,title,url,repository,updatedAt",
  ]);
  for (const p of reviewed || []) {
    const repo = repoName(p.repository), key = itemId(repo, p.number);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      lane: "host", kind: "pr", id: key, title: p.title || "", url: p.url || "",
      context: repo, author: "", state: "reviewed", activity: "reviewed",
      ts: p.updatedAt || nowIso, meta: {},
    });
  }

  // 3. My open PRs → Today (and, if red CI or a long review wait, Flags). Each gets one detail
  //    read for CI + review state; a failed detail read degrades that PR gracefully (no CI info)
  //    rather than sinking the lane.
  const open = await gh([
    "search", "prs", "--author", "@me", "--state", "open",
    "--limit", "50", "--json", "number,title,url,repository,isDraft,createdAt",
  ]);
  await Promise.all((open || []).map(async (p) => {
    const repo = repoName(p.repository), key = itemId(repo, p.number);
    if (byKey.has(key)) return;
    let ci = "none", approvals = 0, reviewWaitHours = 0, isDraft = !!p.isDraft;
    try {
      const view = await gh(["pr", "view", String(p.number), "-R", repo, "--json",
        "statusCheckRollup,latestReviews,createdAt,isDraft"]);
      ci = deriveCi(view && view.statusCheckRollup);
      isDraft = !!(view && view.isDraft);
      const rs = reviewState(view, me, nowIso);
      approvals = rs.approvals; reviewWaitHours = rs.reviewWaitHours;
    } catch (e) { /* keep the card, just without CI/review detail */ }
    byKey.set(key, {
      lane: "host", kind: "pr", id: key, title: p.title || "", url: p.url || "",
      context: repo, author: me, state: isDraft ? "draft" : "open", activity: "opened",
      ts: p.createdAt || nowIso, meta: { ci, approvals, reviewWaitHours },
    });
  }));

  return Array.from(byKey.values());
}

module.exports = { id: "github", label: "GitHub", me: ME, collect, deriveCi, reviewState, hoursBetween };
