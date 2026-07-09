// config.js — machine/user-specific settings for standup, loaded by the core (standup.js)
// and the server (server.js). Real values live in config.json (copy config.example.json →
// config.json and fill it in). Anything absent falls back to the DEFAULTS below, so the
// out-of-the-box experience only needs the git lane's repoRoots — the host and board lanes
// are opt-in.
const fs = require("fs");
const path = require("path");

// Defaults are generic and host-neutral — nothing organization-specific ships here.
const DEFAULTS = {
  // --- which lanes are on ---
  provider: "none",            // HOST/PR lane: "none" | "github" | "azure"
  board: "none",               // BOARD/ticket lane: "none" | "jira"

  // --- shared ---
  lookbackHours: 48,           // how far back "since your last standup" reaches
  me: "",                      // your identity across lanes; each lane resolves its own if empty

  // --- local git lane (always on when repoRoots is non-empty) ---
  repoRoots: [],               // dirs to scan for git repos, e.g. ["/Users/you/Developer"].
                               //   A root that is itself a repo is included; otherwise its
                               //   immediate subdirectories are scanned one level deep.
  gitAuthor: "",               // commit-author match (name or email substring);
                               //   empty = each repo's `git config user.email`

  // --- GitHub host lane (provider: "github") ---
  ghCliPath: "",               // path to gh CLI; empty = "gh" (or "gh.exe" on Windows) on PATH

  // --- Azure DevOps host lane (provider: "azure") — documented stub for now ---
  azCliPath: process.platform === "win32"
    ? "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd"
    : "az",
  organization: "",            // az default org, e.g. https://dev.azure.com/your-org
  project: "",                 // az default project

  // --- Jira board lane (board: "jira") — documented stub for now ---
  jiraBaseUrl: "",             // e.g. https://your-org.atlassian.net
  jiraEmail: "",               // the account email the API token belongs to
  jiraProject: "",             // project key to scope the board to, e.g. "ABC"

  // --- flags (the third column's thresholds) ---
  flagReviewHours: 24,         // an open PR waiting this long for a review is a flag
  flagStuckDays: 3,            // an in-progress ticket unmoved this long is a flag

  // --- AI write-up seam (opt-in, exactly like watch-pr's conflict explainer) ---
  claudeExe: "",               // full path to the claude CLI; empty disables the write-up entirely

  // --- server / presentation ---
  port: 7880,                  // dashboard/server port (STANDUP_PORT env overrides)
  builtBy: "",                 // footer attribution name (empty = hidden)
  builtByUrl: "",              // optional link for the attribution
};

let file = {};
try {
  file = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e; // a present-but-broken config.json is a real error
  console.error("standup: config.json not found — using defaults. Copy config.example.json → config.json to customise.");
}

module.exports = Object.assign({}, DEFAULTS, file);
