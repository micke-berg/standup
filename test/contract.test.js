// The lane contract: the neutral vocabulary and the promise that a lane which can't report
// surfaces an honest error and NEVER fabricates data.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { NotImplemented, COMPLETED_STATES, ACTIVE_STATES } = require("../contract.js");
const core = require("../standup.js");

test("NotImplemented is tagged so the core can tell a stub from a real failure", () => {
  const e = new NotImplemented("not implemented yet — built on the work machine");
  assert.equal(e.notImplemented, true);
  assert.ok(e instanceof Error);
});

test("state sets cover the tokens the lanes emit", () => {
  ["merged", "committed", "done", "reviewed"].forEach((s) => assert.ok(COMPLETED_STATES.has(s)));
  ["open", "draft", "in-progress", "wip"].forEach((s) => assert.ok(ACTIVE_STATES.has(s)));
});

test("gather: a switched-off lane is absent; an unknown lane is an honest error, not fake data", async () => {
  const cfg = { lookbackHours: 48, provider: "none", board: "none", repoRoots: [], me: "" };
  const g = await core.gather(cfg, "2026-07-09T09:00:00.000Z");
  // provider/board "none" => only the git lane is present
  assert.deepEqual(g.lanes.map((l) => l.id), ["git"]);
  assert.equal(g.lanes[0].ok, true);
  assert.equal(g.items.length, 0); // no repoRoots => the git lane honestly finds nothing
});

test("gather: an unknown provider/board reports ok:false and adds zero items", async () => {
  const cfg = { lookbackHours: 48, provider: "bogus", board: "bogus", repoRoots: [], me: "" };
  const g = await core.gather(cfg, "2026-07-09T09:00:00.000Z");
  const host = g.lanes.find((l) => l.id === "bogus" && l.label === "bogus");
  assert.ok(host);
  assert.equal(host.ok, false);
  assert.ok(/unknown/.test(host.error));
  assert.equal(g.items.length, 0); // still nothing invented
});
