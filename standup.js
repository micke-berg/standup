// standup.js — the neutral core.
//
// It asks each configured lane for its NeutralItem[] (see contract.js), buckets every item
// into one of the three standup columns, groups the noisy stuff (commits by repo), and emits
// a board object the dashboard renders and a plain-text version you can paste into Teams/Slack.
// It never learns which system an item came from — that's the whole point of the lane seam.
//
// CLI:
//   node standup.js          print the plain-text standup
//   node standup.js --json   print the full board object
//
// Exports the pure pieces (columnFor, flagFor, groupCommits, boardToText, buildBoard) so the
// bucketing rules are unit-tested over fixtures with no git/gh/network in sight.

const config = require("./config.js");
const { COMPLETED_STATES } = require("./contract.js");

// The lane whitelists. config can only ever name a lane that's listed here — it can't point
// the loader at an arbitrary file. A lane whose module isn't present yet (a feature that
// lands in a later PR, or a stub not copied in) degrades to an honest error, never a crash.
const HOST_PROVIDERS = { github: "./providers/github.js", azure: "./providers/azure.js" };
const BOARD_ADAPTERS = { jira: "./boards/jira.js" };

// Resolve a host/board lane module from config, or a small { missing } marker the gather turns
// into an honest lane error. Returns null when the lane is switched off ("none").
function loadLane(kind, name, whitelist) {
  if (!name || name === "none") return null;
  const modPath = whitelist[name];
  if (!modPath) return { id: name, label: name, missing: `unknown ${kind} "${name}"` };
  try { return require(modPath); }
  catch (e) { return { id: name, label: name, missing: `${kind} adapter not available: ${e.message}` }; }
}

// Ask every enabled lane for its items. Returns { items, lanes, sinceIso, nowIso, me }.
// A lane that throws NotImplemented (a documented stub) or fails for real is recorded in
// `lanes` with ok:false and its message — its items are simply absent. No lane failure is
// ever papered over with fabricated data.
async function gather(cfg, now) {
  const nowIso = now || new Date().toISOString();
  const sinceIso = new Date(Date.parse(nowIso) - cfg.lookbackHours * 3600 * 1000).toISOString();
  const me = cfg.me || "";

  const lanes = [{ id: "git", label: "Local git", mod: require("./lanes/git.js") }];
  const host = loadLane("host provider", cfg.provider, HOST_PROVIDERS);
  if (host) lanes.push({ id: host.id || cfg.provider, label: host.label || cfg.provider, mod: host });
  const board = loadLane("board", cfg.board, BOARD_ADAPTERS);
  if (board) lanes.push({ id: board.id || cfg.board, label: board.label || cfg.board, mod: board });

  const items = [];
  const laneStatus = await Promise.all(lanes.map(async (lane) => {
    if (lane.mod.missing) return { id: lane.id, label: lane.label, ok: false, error: lane.mod.missing };
    try {
      const got = await lane.mod.collect({ cfg, me, sinceIso, now: nowIso });
      const arr = Array.isArray(got) ? got : [];
      items.push(...arr);
      return { id: lane.id, label: lane.label, ok: true, count: arr.length };
    } catch (e) {
      return { id: lane.id, label: lane.label, ok: false, notImplemented: !!e.notImplemented, error: e.message };
    }
  }));

  return { items, lanes: laneStatus, sinceIso, nowIso, me };
}

// Does this item raise a flag (→ the Flags column)? Pure, and every threshold comes from
// config so the rule is one testable place. Returns the reason string, or "" for no flag.
function flagFor(item, cfg) {
  const m = item.meta || {};
  if (item.lane === "host") {
    if (m.ci === "failed" && (item.state === "open" || item.state === "draft")) return "CI red";
    if (item.state === "open" && typeof m.reviewWaitHours === "number" && m.reviewWaitHours >= cfg.flagReviewHours)
      return `waited ${Math.round(m.reviewWaitHours)}h for review`;
  }
  if (item.lane === "board" && item.state === "in-progress") {
    if (typeof m.staleDays === "number" && m.staleDays >= cfg.flagStuckDays)
      return `no movement ${Math.round(m.staleDays)}d`;
  }
  return "";
}

// The one rule that turns a neutral item into a column: a flag wins, else a completed state
// is yesterday's work, else it's in flight today.
function columnFor(item, cfg) {
  if (flagFor(item, cfg)) return "flags";
  return COMPLETED_STATES.has(item.state) ? "yesterday" : "today";
}

// Turn a column's flat items into render nodes: git commits collapse into one node per repo
// (a standup says "3 commits in standup", not three lines), everything else passes through as
// an item node. Order is preserved by first appearance. Pure.
function groupCommits(items) {
  const nodes = [];
  const byRepo = new Map();
  for (const it of items) {
    if (it.lane === "git" && it.kind === "commit") {
      let node = byRepo.get(it.context);
      if (!node) {
        node = { node: "commits", lane: "git", context: it.context, count: 0, commits: [], ts: it.ts };
        byRepo.set(it.context, node);
        nodes.push(node);
      }
      node.commits.push({ title: it.title, shortHash: (it.meta && it.meta.shortHash) || "", ts: it.ts, url: it.url || "" });
      node.count++;
      if ((it.ts || "") > node.ts) node.ts = it.ts;
    } else {
      nodes.push(Object.assign({ node: "item" }, it));
    }
  }
  return nodes;
}

// Assemble the board: bucket, sort newest-first, group commits, and attach the paste-ready
// text. `gathered` is the output of gather(); `now` keeps it deterministic in tests. Pure.
function buildBoard(gathered, cfg, now) {
  const nowIso = now || gathered.nowIso || new Date().toISOString();
  const cols = { yesterday: [], today: [], flags: [] };
  for (const raw of gathered.items || []) {
    const flag = flagFor(raw, cfg);
    const item = flag ? Object.assign({}, raw, { flag }) : raw;
    cols[flag ? "flags" : (COMPLETED_STATES.has(raw.state) ? "yesterday" : "today")].push(item);
  }
  for (const k of Object.keys(cols)) cols[k].sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

  const board = {
    generatedAt: nowIso,
    lookbackHours: cfg.lookbackHours,
    me: gathered.me || "",
    columns: {
      yesterday: groupCommits(cols.yesterday),
      today: groupCommits(cols.today),
      flags: groupCommits(cols.flags),
    },
    lanes: gathered.lanes || [],
    writeupEnabled: !!cfg.claudeExe,
  };
  board.text = boardToText(board);
  return board;
}

// One plain-text line for a non-commit render node, for the paste-ready standup and the CLI.
function textForItem(n) {
  const m = n.meta || {};
  const ctx = n.context ? ` (${n.context})` : "";
  const flag = n.flag ? ` — ${n.flag}` : "";
  if (n.kind === "wip") return `WIP: ${n.title}${m.branch ? ` on ${m.branch}` : ""}${ctx}`;
  if (n.kind === "pr") {
    const bits = [];
    if (m.ci && m.ci !== "none") bits.push(`CI ${m.ci}`);
    if (typeof m.approvals === "number") bits.push(`${m.approvals} approval${m.approvals === 1 ? "" : "s"}`);
    const tail = bits.length ? ` — ${bits.join(", ")}` : "";
    return `${n.activity} PR: ${n.title}${ctx}${tail}${flag}`;
  }
  if (n.kind === "ticket") return `${n.state} ticket: ${n.title}${ctx}${flag}`;
  return `${n.title}${ctx}${flag}`;
}

// The paste-ready standup — the "Copy as text" button and the CLI both emit exactly this.
function boardToText(board) {
  const lines = [`Standup — ${(board.generatedAt || "").slice(0, 10)}`];
  const section = (label, nodes) => {
    lines.push("", label);
    if (!nodes.length) { lines.push("- (nothing)"); return; }
    for (const n of nodes) {
      if (n.node === "commits") {
        lines.push(`- ${n.context}: ${n.count} commit${n.count === 1 ? "" : "s"} — ${n.commits.map((c) => c.title).join("; ")}`);
      } else {
        lines.push(`- ${textForItem(n)}`);
      }
    }
  };
  section("Yesterday", board.columns.yesterday);
  section("Today", board.columns.today);
  section("Flags", board.columns.flags);
  const down = (board.lanes || []).filter((l) => !l.ok);
  if (down.length) {
    lines.push("", "Lanes not reporting");
    for (const l of down) lines.push(`- ${l.label}: ${l.error}`);
  }
  return lines.join("\n");
}

// A pure prompt builder for the opt-in AI write-up (server.js spawns claude with it). Kept
// here so it's testable and so the model only ever sees the already-collected board text —
// never a live tool. The prompt forbids inventing anything beyond that data.
function writeupPrompt(board) {
  return [
    "You are helping a developer get ready for their daily standup.",
    `Below is their already-collected activity from the last ${board.lookbackHours} hours.`,
    "Compress it into a short spoken update they can say out loud in well under a minute.",
    "",
    "Rules:",
    "- Three labelled groups: Yesterday, Today, Blockers. Skip a group only if it is truly empty.",
    "- 1 to 3 short bullets per group, first person, plain spoken language.",
    "- Cluster related work into one bullet; do not just relist every line.",
    "- Use ONLY what is in the data below. Never invent a PR, ticket, or status.",
    "- No preamble and no sign-off. No markdown beyond the three group labels.",
    "",
    "--- activity ---",
    board.text,
    "--- end ---",
  ].join("\n");
}

// gather + buildBoard in one call — what the server and CLI run.
async function runStandup(cfg, now) {
  const c = cfg || config;
  const nowIso = now || new Date().toISOString();
  return buildBoard(await gather(c, nowIso), c, nowIso);
}

module.exports = {
  gather, buildBoard, runStandup,
  columnFor, flagFor, groupCommits, boardToText, textForItem, writeupPrompt,
  loadLane, HOST_PROVIDERS, BOARD_ADAPTERS,
};

// CLI
if (require.main === module) {
  const asJson = process.argv.includes("--json");
  runStandup(config)
    .then((board) => console.log(asJson ? JSON.stringify(board, null, 2) : board.text))
    .catch((e) => { console.error("standup failed: " + e.message); process.exit(1); });
}
