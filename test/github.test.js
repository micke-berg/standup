// The GitHub host lane's pure helpers: CI-rollup derivation, the review-wait / approvals read,
// and the ISO hour math. No network — the collect() plumbing is exercised against the real gh
// CLI, but the decisions the columns and flags hang on are tested here over fixtures.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const gh = require("../providers/github.js");

test("deriveCi: empty/absent rollup -> none", () => {
  assert.equal(gh.deriveCi([]), "none");
  assert.equal(gh.deriveCi(null), "none");
});

test("deriveCi: all success -> passed", () => {
  assert.equal(gh.deriveCi([{ status: "COMPLETED", conclusion: "SUCCESS" }]), "passed");
});

test("deriveCi: any failure wins, even mixed with a pending check", () => {
  assert.equal(gh.deriveCi([
    { status: "COMPLETED", conclusion: "FAILURE" },
    { status: "IN_PROGRESS", conclusion: null },
  ]), "failed");
});

test("deriveCi: pending with no failure -> running", () => {
  assert.equal(gh.deriveCi([{ status: "IN_PROGRESS", conclusion: null }]), "running");
  assert.equal(gh.deriveCi([{ status: "QUEUED", conclusion: null }]), "running");
});

test("deriveCi: StatusContext .state is read too (not just CheckRun .status)", () => {
  assert.equal(gh.deriveCi([{ __typename: "StatusContext", state: "FAILURE" }]), "failed");
  assert.equal(gh.deriveCi([{ __typename: "StatusContext", state: "SUCCESS" }]), "passed");
});

test("hoursBetween: floors at zero and computes forward spans", () => {
  assert.equal(gh.hoursBetween("2026-07-09T00:00:00Z", "2026-07-09T06:00:00Z"), 6);
  assert.equal(gh.hoursBetween("2026-07-09T06:00:00Z", "2026-07-09T00:00:00Z"), 0);
});

test("reviewState: an unreviewed, non-draft PR accrues review-wait from its creation time", () => {
  const view = { createdAt: "2026-07-08T09:00:00Z", isDraft: false, latestReviews: [] };
  const rs = gh.reviewState(view, "me", "2026-07-09T09:00:00Z");
  assert.equal(Math.round(rs.reviewWaitHours), 24);
  assert.equal(rs.approvals, 0);
});

test("reviewState: once someone else has reviewed, the wait resets and approvals count (excluding me)", () => {
  const view = {
    createdAt: "2026-07-08T09:00:00Z", isDraft: false,
    latestReviews: [
      { author: { login: "her" }, state: "APPROVED" },
      { author: { login: "me" }, state: "APPROVED" }, // my own review never counts
    ],
  };
  const rs = gh.reviewState(view, "me", "2026-07-09T09:00:00Z");
  assert.equal(rs.reviewWaitHours, 0);
  assert.equal(rs.approvals, 1);
});

test("reviewState: a draft never accrues review-wait", () => {
  const view = { createdAt: "2026-07-01T09:00:00Z", isDraft: true, latestReviews: [] };
  assert.equal(gh.reviewState(view, "me", "2026-07-09T09:00:00Z").reviewWaitHours, 0);
});
