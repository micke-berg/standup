// The local git lane's pure parsers — the log decoder and the porcelain counter — tested over
// fixture strings so no real repo is needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const git = require("../lanes/git.js");

const US = "\x1f"; // the unit-separator delimiter the pretty-format uses

test("parseLog: decodes hash / author / date / subject and keeps the short hash intact", () => {
  const out = [
    ["c05e716e2cf6a6f865958bc045f639c188fb0200", "Micke Berg", "2026-07-09T22:54:59+02:00", "refactor: split the dashboard"].join(US),
    ["b68905fd8f40753d47b5b5d323d017951b609fac", "Micke Berg", "2026-07-09T19:37:36+02:00", "ci: add all-green gate"].join(US),
  ].join("\n");
  const rows = git.parseLog(out);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].hash.slice(0, 7), "c05e716");
  assert.equal(rows[0].author, "Micke Berg");
  assert.equal(rows[0].date, "2026-07-09T22:54:59+02:00");
  assert.equal(rows[0].subject, "refactor: split the dashboard");
});

test("parseLog: empty / blank input is an empty list, not a crash", () => {
  assert.deepEqual(git.parseLog(""), []);
  assert.deepEqual(git.parseLog("\n\n"), []);
});

test("parseLog: a subject that itself contains a separator is preserved whole", () => {
  const line = ["abcdef1", "Me", "2026-07-09T10:00:00+02:00", "weird" + US + "subject"].join(US);
  const rows = git.parseLog(line);
  assert.equal(rows[0].subject, "weird" + US + "subject");
});

test("parseStatus: counts one line per changed entry, ignores blanks", () => {
  assert.equal(git.parseStatus(" M app.js\n?? new.txt\nA  added.js\n"), 3);
  assert.equal(git.parseStatus(""), 0);
  assert.equal(git.parseStatus("\n\n"), 0);
});

test("isRepo: a directory without a .git entry is not a repo", () => {
  assert.equal(git.isRepo("/definitely/not/a/repo/anywhere"), false);
});
