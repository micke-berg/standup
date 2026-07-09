// lanes/git.js — the LOCAL GIT lane.
//
// Reconstructs what you did from the machine you're on, no account required and fully
// offline-capable: the commits you authored in the lookback window across every configured
// repo, plus your work-in-progress (uncommitted changes on the current branch). This lane
// catches the work that never became a PR, which is exactly the stuff you blank on at
// standup.
//
// Read-only: it only ever runs read-only git (log, status, config, rev-parse). Every git
// call is execFile with an argument array — no shell — so a repo name or branch can never be
// interpreted as a command. Produces the neutral NeutralItem shape (see contract.js); the
// core never learns these came from git.

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

// One read-only git call in a repo. Best-effort by design: a call that fails (not a repo,
// detached weirdness, a permission error) resolves to "" so one bad repo never sinks the lane.
function git(repo, args) {
  return new Promise((resolve) => {
    execFile("git", ["-C", repo, ...args], { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      resolve(err ? "" : stdout);
    });
  });
}
// First trimmed line of a git call (for the single-value reads: config, rev-parse).
async function gitLine(repo, args) {
  return (await git(repo, args)).split("\n")[0].trim();
}

// A directory is a git repo if it has a .git entry (a dir for a normal repo, a file for a
// worktree/submodule).
function isRepo(dir) {
  try { return fs.existsSync(path.join(dir, ".git")); } catch (e) { return false; }
}

// Resolve the configured roots to a de-duplicated list of repo directories. A root that is
// itself a repo is taken as-is; otherwise its immediate children are scanned one level deep
// (the common "~/Developer holds N repos" layout). Non-existent roots are skipped quietly.
function discoverRepos(roots) {
  const found = [];
  const seen = new Set();
  const add = (d) => { if (!seen.has(d)) { seen.add(d); found.push(d); } };
  for (const root of roots || []) {
    let r;
    try { r = fs.realpathSync(root); } catch (e) { continue; }
    if (isRepo(r)) { add(r); continue; }
    let entries;
    try { entries = fs.readdirSync(r, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const child = path.join(r, e.name);
      if (isRepo(child)) add(child);
    }
  }
  return found;
}

// Parse the NUL-ish delimited `git log` output (see the pretty-format below) into commit
// objects. Pure, so it's unit-tested without a repo. The \x1f (unit separator) can't appear
// in a commit subject, so splitting is unambiguous; a stray one is folded back in defensively.
function parseLog(stdout) {
  if (!stdout) return [];
  return stdout.split("\n").map((line) => {
    if (!line) return null;
    const parts = line.split("\x1f");
    const hash = parts[0];
    if (!hash) return null;
    return { hash, author: parts[1] || "", date: parts[2] || "", subject: parts.slice(3).join("\x1f") };
  }).filter(Boolean);
}

// Count changed working-tree entries from `git status --porcelain` (staged + unstaged +
// untracked all count as one line each). Pure.
function parseStatus(stdout) {
  if (!stdout) return 0;
  return stdout.split("\n").filter((l) => l.trim().length > 0).length;
}

// The collect() the core calls. Returns NeutralItem[] for every configured repo.
async function collect(ctx) {
  const cfg = ctx.cfg || {};
  const sinceIso = ctx.sinceIso;
  const nowIso = ctx.now || new Date().toISOString();
  const repos = discoverRepos(cfg.repoRoots);
  const items = [];

  await Promise.all(repos.map(async (repo) => {
    const name = path.basename(repo);
    // Author match: explicit config wins; else this repo's own git identity (work repos may
    // use a different email than personal ones); else the shared `me`. Without any of these
    // we skip commits rather than show everyone's — standup is about YOUR work.
    const author = cfg.gitAuthor || (await gitLine(repo, ["config", "user.email"])) || cfg.me || "";

    if (author) {
      const logOut = await git(repo, [
        "log", "--all", "--no-merges",
        "--since", sinceIso,
        `--author=${author}`,
        "--date=iso-strict",
        "--pretty=format:%H%x1f%an%x1f%aI%x1f%s",
      ]);
      for (const c of parseLog(logOut)) {
        items.push({
          lane: "git", kind: "commit", id: `${name}@${c.hash}`,
          title: c.subject || "(no message)", url: "",
          context: name, author: c.author,
          state: "committed", activity: "committed", ts: c.date,
          meta: { shortHash: c.hash.slice(0, 7) },
        });
      }
    }

    // Work-in-progress: uncommitted changes on the current branch.
    const changed = parseStatus(await git(repo, ["status", "--porcelain"]));
    if (changed > 0) {
      const branch = await gitLine(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
      items.push({
        lane: "git", kind: "wip", id: `${name}@wip`,
        title: `${changed} uncommitted change${changed === 1 ? "" : "s"}`, url: "",
        context: name, author,
        state: "wip", activity: "wip", ts: nowIso,
        meta: { changed, branch: branch || "" },
      });
    }
  }));

  return items;
}

module.exports = { id: "git", label: "Local git", collect, parseLog, parseStatus, discoverRepos, isRepo };
