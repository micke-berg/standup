// The neutral core: how a NeutralItem lands in a column, how flags are raised, how commits
// group, and how the board + paste text come out. All pure — no git, gh, or network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../standup.js");

const CFG = { lookbackHours: 48, flagReviewHours: 24, flagStuckDays: 3, me: "me" };

// Minimal neutral item with sensible defaults; override per test.
const item = (over) => Object.assign({
  lane: "host", kind: "pr", id: "x", title: "t", url: "", context: "repo",
  author: "me", state: "open", activity: "open", ts: "2026-07-08T10:00:00.000Z", meta: {},
}, over);

test("columnFor: completed states are yesterday, active states are today", () => {
  assert.equal(core.columnFor(item({ lane: "git", kind: "commit", state: "committed" }), CFG), "yesterday");
  assert.equal(core.columnFor(item({ state: "merged", activity: "merged" }), CFG), "yesterday");
  assert.equal(core.columnFor(item({ state: "reviewed", activity: "reviewed" }), CFG), "yesterday");
  assert.equal(core.columnFor(item({ lane: "board", kind: "ticket", state: "done" }), CFG), "yesterday");
  assert.equal(core.columnFor(item({ state: "open" }), CFG), "today");
  assert.equal(core.columnFor(item({ state: "draft" }), CFG), "today");
  assert.equal(core.columnFor(item({ lane: "git", kind: "wip", state: "wip" }), CFG), "today");
  assert.equal(core.columnFor(item({ lane: "board", kind: "ticket", state: "in-progress" }), CFG), "today");
});

test("flagFor: an open PR waiting past the threshold flags with the hours", () => {
  assert.equal(core.flagFor(item({ state: "open", meta: { reviewWaitHours: 30 } }), CFG), "waited 30h for review");
  assert.equal(core.flagFor(item({ state: "open", meta: { reviewWaitHours: 5 } }), CFG), "");
  // a draft isn't awaiting review, so the review-wait rule doesn't apply
  assert.equal(core.flagFor(item({ state: "draft", meta: { reviewWaitHours: 99 } }), CFG), "");
});

test("flagFor: red CI flags an open or draft PR", () => {
  assert.equal(core.flagFor(item({ state: "open", meta: { ci: "failed" } }), CFG), "CI red");
  assert.equal(core.flagFor(item({ state: "draft", meta: { ci: "failed" } }), CFG), "CI red");
  assert.equal(core.flagFor(item({ state: "open", meta: { ci: "passed" } }), CFG), "");
});

test("flagFor: a stuck in-progress ticket flags with the days; a fresh one doesn't", () => {
  assert.equal(core.flagFor(item({ lane: "board", kind: "ticket", state: "in-progress", meta: { staleDays: 5 } }), CFG), "no movement 5d");
  assert.equal(core.flagFor(item({ lane: "board", kind: "ticket", state: "in-progress", meta: { staleDays: 1 } }), CFG), "");
});

test("flagFor: git commits and WIP never flag", () => {
  assert.equal(core.flagFor(item({ lane: "git", kind: "commit", state: "committed", meta: { ci: "failed" } }), CFG), "");
  assert.equal(core.flagFor(item({ lane: "git", kind: "wip", state: "wip" }), CFG), "");
});

test("columnFor: a flag beats an otherwise-today item", () => {
  assert.equal(core.columnFor(item({ state: "open", meta: { ci: "failed" } }), CFG), "flags");
});

test("groupCommits: git commits collapse per repo, other items pass through in order", () => {
  const nodes = core.groupCommits([
    item({ lane: "git", kind: "commit", context: "a", title: "c1", ts: "2026-07-08T09:00:00Z", meta: { shortHash: "aaa1111" } }),
    item({ lane: "git", kind: "commit", context: "a", title: "c2", ts: "2026-07-08T10:00:00Z", meta: { shortHash: "aaa2222" } }),
    item({ lane: "git", kind: "commit", context: "b", title: "c3", ts: "2026-07-08T08:00:00Z", meta: { shortHash: "bbb3333" } }),
    item({ kind: "pr", title: "a PR" }),
  ]);
  assert.equal(nodes.length, 3); // group-a, group-b, the PR
  assert.equal(nodes[0].node, "commits");
  assert.equal(nodes[0].context, "a");
  assert.equal(nodes[0].count, 2);
  assert.equal(nodes[0].ts, "2026-07-08T10:00:00Z"); // group's ts is its newest commit
  assert.equal(nodes[1].context, "b");
  assert.equal(nodes[1].count, 1);
  assert.equal(nodes[2].node, "item");
  assert.equal(nodes[2].kind, "pr");
});

test("buildBoard: buckets, sorts newest-first, and preserves lane status", () => {
  const gathered = {
    nowIso: "2026-07-09T09:00:00.000Z",
    me: "me",
    items: [
      item({ lane: "git", kind: "commit", state: "committed", context: "repo", title: "did a thing", ts: "2026-07-08T12:00:00Z", meta: { shortHash: "abc1234" } }),
      item({ state: "merged", activity: "merged", title: "shipped PR", ts: "2026-07-08T15:00:00Z" }),
      item({ state: "open", activity: "open", title: "wip PR", ts: "2026-07-09T08:00:00Z", meta: { ci: "passed", approvals: 1, reviewWaitHours: 2 } }),
      item({ state: "open", activity: "open", title: "stuck PR", ts: "2026-07-07T08:00:00Z", meta: { ci: "failed" } }),
    ],
    lanes: [
      { id: "git", label: "Local git", ok: true, count: 1 },
      { id: "azure", label: "Azure DevOps", ok: false, notImplemented: true, error: "not implemented yet — built on the work machine" },
    ],
  };
  const board = core.buildBoard(gathered, CFG, "2026-07-09T09:00:00.000Z");
  const cols = board.columns;
  // yesterday holds the commit group + the merged PR
  assert.equal(cols.yesterday.length, 2);
  // today holds the healthy open PR only (the red-CI one is flagged out)
  assert.equal(cols.today.length, 1);
  assert.equal(cols.today[0].title, "wip PR");
  // flags holds the red-CI PR
  assert.equal(cols.flags.length, 1);
  assert.equal(cols.flags[0].flag, "CI red");
  // lane status is carried through untouched (honest, never fabricated)
  assert.equal(board.lanes[1].ok, false);
  assert.equal(board.lanes[1].notImplemented, true);
  assert.ok(board.text.includes("Standup — 2026-07-09"));
});

test("boardToText: sections, commit-group line, and the honest lane note", () => {
  const board = core.buildBoard({
    nowIso: "2026-07-09T09:00:00Z", me: "me",
    items: [
      item({ lane: "git", kind: "commit", state: "committed", context: "repo", title: "first", ts: "2026-07-08T09:00:00Z", meta: { shortHash: "aaa" } }),
      item({ lane: "git", kind: "commit", state: "committed", context: "repo", title: "second", ts: "2026-07-08T10:00:00Z", meta: { shortHash: "bbb" } }),
    ],
    lanes: [{ id: "jira", label: "Jira", ok: false, error: "not implemented yet — built on the work machine" }],
  }, CFG, "2026-07-09T09:00:00Z");
  assert.match(board.text, /Yesterday/);
  assert.match(board.text, /Today/);
  assert.match(board.text, /Flags/);
  assert.match(board.text, /repo: 2 commits — /);
  assert.match(board.text, /Lanes not reporting/);
  assert.match(board.text, /Jira: not implemented yet/);
});

test("writeupPrompt: carries the board text and forbids invention", () => {
  const board = core.buildBoard({ nowIso: "2026-07-09T09:00:00Z", items: [], lanes: [] }, CFG, "2026-07-09T09:00:00Z");
  const p = core.writeupPrompt(board);
  assert.ok(p.includes(board.text));
  assert.match(p, /Yesterday, Today, Blockers/);
  assert.match(p, /Never invent/);
});
