// The honest-stub adapters: they must error with the work-machine message, and the core must
// surface that as a lane notice with zero fabricated items.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const azure = require("../providers/azure.js");
const jira = require("../boards/jira.js");
const core = require("../standup.js");

test("azure stub: collect() throws NotImplemented with the work-machine message", async () => {
  await assert.rejects(() => azure.collect({}), (e) => {
    assert.equal(e.notImplemented, true);
    assert.match(e.message, /not implemented yet — built on the work machine/);
    return true;
  });
});

test("jira stub: collect() throws NotImplemented with the work-machine message", async () => {
  await assert.rejects(() => jira.collect({}), (e) => {
    assert.equal(e.notImplemented, true);
    assert.match(e.message, /not implemented yet — built on the work machine/);
    return true;
  });
});

test("gather: a stub lane is an honest ok:false / notImplemented notice, never fabricated data", async () => {
  const cfg = { lookbackHours: 48, provider: "azure", board: "jira", repoRoots: [], me: "" };
  const g = await core.gather(cfg, "2026-07-09T09:00:00.000Z");
  const az = g.lanes.find((l) => l.id === "azure");
  const jr = g.lanes.find((l) => l.id === "jira");
  assert.ok(az && jr);
  assert.equal(az.ok, false);
  assert.equal(az.notImplemented, true);
  assert.match(az.error, /work machine/);
  assert.equal(jr.ok, false);
  assert.equal(jr.notImplemented, true);
  assert.equal(g.items.length, 0); // nothing invented for either stub
});
