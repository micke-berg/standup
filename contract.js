// contract.js — the neutral vocabulary every lane and adapter speaks.
//
// standup has three data lanes, each behind its own adapter:
//   - the LOCAL GIT lane   (lanes/git.js)        — your commits + work-in-progress
//   - the HOST lane        (providers/<host>.js) — pull requests you opened/merged/reviewed
//   - the BOARD lane       (boards/<tracker>.js) — tickets that moved / are in progress
//
// Every adapter produces the SAME neutral shape defined here, and the core (standup.js)
// buckets that shape into the three standup columns without ever learning which system it
// came from. That seam is the whole design: adding or implementing an adapter is one file,
// and this contract is the only thing its author needs to read.
//
// ── The adapter interface ────────────────────────────────────────────────────
// Each adapter module exports:
//
//   id            string   — stable lane/adapter id, e.g. "git", "github", "azure", "jira"
//   label         string   — human name for the UI, e.g. "GitHub", "Azure DevOps"
//   collect(ctx)  async    — returns NeutralItem[] (see below). ctx = { cfg, me, sinceIso, now }
//                            where sinceIso is the ISO cutoff (now - cfg.lookbackHours).
//
// An adapter that is a documented STUB (not yet implemented on this machine) throws a
// NotImplemented from collect(). The core catches it and surfaces an honest lane error —
// it NEVER invents placeholder data. "No data yet" and "not built yet" are different states
// and standup keeps them different.
//
// ── NeutralItem ──────────────────────────────────────────────────────────────
// One thing that happened, or is happening, in your work.
//
//   {
//     lane:     "git" | "host" | "board",   // which lane produced it
//     kind:     string,                      // "commit" | "wip" | "pr" | "ticket"
//     id:       string,                      // unique within the lane (used for de-dup)
//     title:    string,                      // one-line human summary
//     url:      string,                      // link to the thing, or "" if none
//     context:  string,                      // repo / project / board it belongs to
//     author:   string,                      // who did it (may be "")
//     state:    string,                      // NEUTRAL lifecycle token — drives the column
//     activity: string,                      // what happened: "committed" | "opened" | "merged"
//                                            //   | "reviewed" | "wip" | "moved" | "in-progress"
//     ts:       string,                      // ISO 8601 of the activity (ordering + window)
//     meta:     object,                      // lane extras the UI/flags read (see below)
//   }
//
// meta carries whatever a lane knows that the columns or flags need. The fields the CORE
// reads (so an adapter that wants flags/grouping must set them) are:
//   meta.ci               "passed" | "failed" | "running" | "none"   — host lane, for the red-CI flag
//   meta.reviewWaitHours  number                                     — host lane, for the stale-review flag
//   meta.staleDays        number                                     — board lane, for the stuck-ticket flag
//   meta.approvals        number                                     — host lane, shown on the card
//   meta.branch           string                                     — git lane, shown / grouped
//   meta.shortHash        string                                     — git lane commit, shown
// Anything else in meta is passed through untouched for the UI to use.
//
// ── How state maps to a column ───────────────────────────────────────────────
// The core assigns each item to exactly one column (see standup.js columnFor):
//   1. If the item raises a flag (see standup.js flagFor) → FLAGS.
//   2. Else if its state is a COMPLETED state              → YESTERDAY (work you did).
//   3. Else (an ACTIVE state)                              → TODAY (work in flight).
// So a lane picks a column implicitly by choosing the right neutral state token below.

// Completed states → Yesterday. "I did this."
const COMPLETED_STATES = new Set(["merged", "committed", "done", "reviewed", "closed"]);
// Active states → Today. "I'm on this."
const ACTIVE_STATES = new Set(["open", "draft", "in-progress", "wip", "review"]);

// Thrown by a documented stub adapter. The core catches it and shows an honest lane error
// instead of data — never a fabricated card. `.notImplemented` lets the core tell this apart
// from a genuine failure (a broken CLI, a network error) so the two are reported differently.
class NotImplemented extends Error {
  constructor(message) {
    super(message);
    this.name = "NotImplemented";
    this.notImplemented = true;
  }
}

module.exports = { COMPLETED_STATES, ACTIVE_STATES, NotImplemented };
