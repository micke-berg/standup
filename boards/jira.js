// boards/jira.js — the Jira BOARD lane for standup.
//
// STATUS: documented stub. This machine has no Jira access, so collect() throws NotImplemented
// instead of inventing data. It is built on the work machine, which has the access — and this
// file documents the exact neutral contract it must satisfy so that session can implement it
// without touching the core, the UI, or any other lane.
//
// ── What collect(ctx) must return when implemented ───────────────────────────
// ctx = { cfg, me, sinceIso, now }. Return NeutralItem[] (see contract.js) for the tickets you
// worked, mapped to the neutral shape the core buckets the same as any lane:
//
//   Tickets you moved to a done/closed status since sinceIso
//     → { lane:"board", kind:"ticket", state:"done", activity:"moved", ts: <transition date>,
//         meta: { movedTo: "<status>" } }                                                    (→ Yesterday)
//   Tickets currently In Progress assigned to you
//     → { lane:"board", kind:"ticket", state:"in-progress", activity:"in-progress",
//         ts: <last update>, meta: { staleDays } }                                           (→ Today / Flags)
//
// For every item set: id (the issue key, e.g. "ABC-123"), title (the summary), url (browse URL),
// context (the project key or board name).
// meta drives the Flags column:
//   meta.staleDays  days since the ticket last moved/updated. The core flags an in-progress
//                   ticket when staleDays >= cfg.flagStuckDays (a ticket stuck with no movement).
//   meta.movedTo    (optional) the status a done ticket landed in, shown on the card.
//
// ── How to implement ─────────────────────────────────────────────────────────
// - Jira has no ubiquitous CLI, so use the REST API with an API token:
//   GET {jiraBaseUrl}/rest/api/3/search?jql=... with Basic auth (jiraEmail + API token base64).
//   All three config keys — jiraBaseUrl, jiraEmail, jiraProject — are already in config.js.
// - JQL for your in-progress: `assignee = currentUser() AND statusCategory = "In Progress"`.
//   For recently-moved-to-done: `assignee = currentUser() AND statusCategory = Done AND
//   status changed to (Done, Closed) after "<sinceIso as JQL date>"`.
// - staleDays: from the `updated` field (or the last transition in the changelog) vs ctx.now.
// - Read-only: never transition, comment on, or edit an issue. standup only reads.
// - The token is a secret: read it from an env var or a gitignored file, NEVER config.example.
// - Azure Boards is a sibling board adapter (boards/azure-boards.js) with the same contract.

const { NotImplemented } = require("../contract.js");
const config = require("../config.js");

async function collect() {
  throw new NotImplemented("Jira board lane not implemented yet — built on the work machine");
}

module.exports = { id: "jira", label: "Jira", me: config.me || "", collect };
