// providers/azure.js — the Azure DevOps HOST lane for standup.
//
// STATUS: documented stub. This machine has no `az`/Azure DevOps access, so collect() throws
// NotImplemented instead of inventing data. It is built on the work machine, which has the
// access — and this file documents the exact neutral contract it must satisfy so that session
// can implement it without touching the core, the UI, or any other lane.
//
// ── What collect(ctx) must return when implemented ───────────────────────────
// ctx = { cfg, me, sinceIso, now }. Return NeutralItem[] (see contract.js) covering the PRs you
// touched in the window, mapped to the SAME neutral shape the GitHub lane produces — the core
// then buckets them identically and never learns this came from Azure:
//
//   PRs you completed (merged) since sinceIso
//     → { lane:"host", kind:"pr", state:"merged",   activity:"merged",   ts: <completion date> }   (→ Yesterday)
//   PRs you voted on (reviewed) since sinceIso
//     → { lane:"host", kind:"pr", state:"reviewed", activity:"reviewed", ts: <last vote/update> }   (→ Yesterday)
//   Your active (open) PRs
//     → { lane:"host", kind:"pr", state:"open"|"draft", activity:"opened", ts: <creation date>,
//         meta: { ci, approvals, reviewWaitHours } }                                                (→ Today / Flags)
//
// For every item set: id (a stable "repo#id"), title, url (prUrl below), context (the repo name).
// meta drives the Flags column exactly as in providers/github.js:
//   meta.ci              "passed" | "failed" | "running" | "none"  — from the PR's Build policy
//                        (Azure: policy status approved→passed, rejected→failed, queued/running→running)
//   meta.approvals       count of reviewer votes >= 5, excluding your own
//   meta.reviewWaitHours hours the PR has waited with no non-you vote yet (0 once someone voted / if draft)
//
// ── How to implement (reference: watch-pr's providers/azure.js) ──────────────
// - Use the `az` CLI (config.azCliPath), with config.organization + config.project as the
//   org/project. Auth is `az login` — no tokens in config.
// - `az` is a .cmd on Windows and runs through a shell, so id/repo/identity interpolated into a
//   command MUST be validated first (numeric id, whitelisted repo chars, shell-safe identity) —
//   see the assertSafe* guards in watch-pr's adapter. This is the injection trust boundary.
// - Listing your PRs: `az repos pr list --creator "<me>" --status active|completed ...`;
//   reviewed: `--reviewer "<me>"`. Decode votes/build policy per watch-pr's decodePr.
// - Azure Boards (work items) is a SEPARATE lane — implement it under boards/, not here.

const { NotImplemented } = require("../contract.js");
const config = require("../config.js");

// The web URL for a PR — same format the implemented lane should use for item.url.
function prUrl(repo, id) {
  return `${config.organization}/${config.project}/_git/${repo}/pullrequest/${id}`;
}

async function collect() {
  throw new NotImplemented("Azure DevOps PR lane not implemented yet — built on the work machine");
}

module.exports = { id: "azure", label: "Azure DevOps", me: config.me || "", collect, prUrl };
