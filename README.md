# standup — your 10:40 board

[![CI](https://github.com/micke-berg/standup/actions/workflows/ci.yml/badge.svg)](https://github.com/micke-berg/standup/actions/workflows/ci.yml)

Open it at 10:39, read from it at your 10:40 standup. It reconstructs your last day or two of
work into three big, presenter-friendly columns — **Yesterday / Today / Flags** — so you never
blank when it's your turn. It runs entirely on your machine, fetches only when you open it, and
has a one-click **Copy as text** for pasting into Teams or Slack.

It is **read-only**: it reads your local git, and (optionally) your PR host and issue tracker.
It never commits, pushes, comments, or moves a ticket. Nothing leaves your machine unless you
turn on the optional AI write-up.

Zero runtime dependencies: pure Node plus the CLIs you already have. Part of the **watch-\***
family (sibling to [watch-pr](https://github.com/micke-berg/watch-pr)) — same look, same
conventions, same zero-install footprint.

## What you get

- A board at `http://localhost:7880` with three columns:
  - **Yesterday** — what you finished: merged PRs, your commits (grouped by repo), tickets that moved.
  - **Today** — what's in flight: your open PRs, work-in-progress branches, in-progress tickets.
  - **Flags** — what needs attention: a PR waiting too long for review, red CI, a stuck ticket.
- **Big presenter-friendly type** — readable at a glance, one screen.
- **Copy as text** — a clean plain-text version of the whole board, ready to paste.
- **Light and dark theme** — follows your OS, with a ☀/☾ toggle that remembers your choice.
- **On-demand** — it fetches when you open or hit Refresh. No background poller, nothing resident.
- **Opt-in AI write-up** (off by default) — one button compresses the raw events into a few
  spoken-style bullets. The board is fully useful without it.

## The three lanes

standup pulls from up to three lanes, each behind its own adapter. Each produces the same
neutral shape (see [The adapter seam](#the-adapter-seam)); the core buckets that shape into the
three columns without ever learning which system it came from.

| lane | what it shows | status |
| --- | --- | --- |
| **Local git** (`lanes/git.js`) | your commits in the last 48h across configured repos + work-in-progress | **built** |
| **Host / PR** (`providers/<host>.js`) | PRs you opened / merged / reviewed | GitHub and Azure DevOps plug in here |
| **Board / ticket** (`boards/<tracker>.js`) | tickets that moved / are in progress | Jira and Azure Boards plug in here |

The local git lane needs no account and works offline, so standup is useful the moment you
point it at your repos. The other lanes are opt-in.

## Quickstart

Needs [Node.js 18+](https://nodejs.org). The only setup is telling it where your repos live:

```sh
git clone https://github.com/micke-berg/standup
cd standup
cp config.example.json config.json      # then set "repoRoots" to where your repos live
npm start                               # board → http://localhost:7880
```

Set `repoRoots` to one or more directories that hold your git repos, e.g.
`["/Users/you/Developer"]`. A root that is itself a repo is used directly; otherwise its
immediate subdirectories are scanned one level deep. Commits are matched to you by each repo's
`git config user.email` (override with `gitAuthor`).

> Using an AI coding agent? This README reads top-to-bottom for one — point it at the repo and
> the steps above are all it needs.

## Setup

Copy `config.example.json` → `config.json` (it is gitignored) and set what you need. Everything
has a sensible default; the only thing you must set is `repoRoots`.

| key | what |
| --- | --- |
| `repoRoots` | **(the one you must set)** directories scanned for your git repos |
| `gitAuthor` | commit-author match (name or email substring); empty = each repo's `git config user.email` |
| `lookbackHours` | how far back "since your last standup" reaches (default 48 — covers a Monday) |
| `provider` | host/PR lane: `"none"` (default) · `"github"` · `"azure"` |
| `board` | ticket lane: `"none"` (default) · `"jira"` |
| `me` | your identity across lanes; each lane resolves its own if empty |
| `flagReviewHours` | an open PR waiting this long for a review is flagged (default 24) |
| `flagStuckDays` | an in-progress ticket unmoved this long is flagged (default 3) |
| `claudeExe` | path to the `claude` CLI to enable the AI write-up; empty = off |
| `port` | dashboard port (default 7880; `STANDUP_PORT` env overrides) |
| `builtBy` / `builtByUrl` | footer attribution |

Then `npm start` and open `http://localhost:7880` (or run `standup.sh` / `standup.cmd`).

You can also run it in the terminal without the browser:

```sh
npm run standup            # prints the plain-text standup
node standup.js --json     # prints the full board object
```

## The AI write-up (opt-in)

Set `claudeExe` to your `claude` CLI path and a **✎ Write it up** button appears. It compresses
the board into a few first-person, spoken-style bullets (Yesterday / Today / Blockers). The
model is run headless with **no tools** and only ever sees the text already on your board — it
is told not to invent anything. Leave `claudeExe` empty and the feature is simply absent; the
board loses nothing.

## The adapter seam

Every lane speaks one neutral contract, documented in `contract.js`. An adapter is one file that
exports:

```text
id            // stable lane id, e.g. "github"
label         // human name for the UI, e.g. "GitHub"
collect(ctx)  // async → NeutralItem[]   (ctx = { cfg, me, sinceIso, now })
```

A `NeutralItem` is one thing that happened or is happening:

```text
{ lane, kind, id, title, url, context, author, state, activity, ts, meta }
```

The core picks a column from the neutral `state` (a completed state → Yesterday, an active state
→ Today) unless a flag fires (→ Flags). Adding a host or tracker is one new file under
`providers/` or `boards/` plus one line in the whitelist in `standup.js` — nothing else. See
`contract.js` for the full shape and the exact fields the flags and grouping read.

An adapter that isn't built on this machine yet is a documented **stub**: its `collect()` throws
`NotImplemented`, and the core surfaces an honest lane notice instead of data. standup keeps
"nothing happened" and "not built here yet" as different states and never fabricates a card.

### Honest stubs (Azure DevOps, Jira)

`providers/azure.js` (host lane) and `boards/jira.js` (board lane) ship as **documented stubs**:
their `collect()` throws `not implemented yet — built on the work machine`, and the board shows
a quiet notice for that lane rather than any data. They exist so the contract is real from day
one and so the machine that *does* have `az` / Jira access can implement them without touching
anything else.

### Implementing an adapter

Each stub's file header documents the exact neutral items it must return (which `state`/`activity`
maps to which column, and which `meta` fields the flags read), so implementing one is a
self-contained job:

1. Fill in `collect(ctx)` to return `NeutralItem[]` per the header — nothing else in the file, and
   nothing outside it, needs to change.
2. The lane is already wired: `provider`/`board` in config selects it through the whitelist in
   `standup.js`. A brand-new host or tracker is one new file plus one whitelist line.
3. Keep it read-only, keep secrets out of `config.example.json`, and add fixture tests for the
   pure decoding helpers (the way `providers/github.js` tests `deriveCi` / `reviewState`).

## Files

| file | role |
| --- | --- |
| `index.html` / `app.css` / `app.js` | the dashboard (pure presentation; reads the endpoints) |
| `standup.js` | the neutral core: gather the lanes, bucket into columns, build the board + paste text |
| `contract.js` | the neutral lane/adapter contract every lane speaks |
| `lanes/git.js` | the local git lane (commits + work-in-progress) |
| `providers/<host>.js` | host/PR adapters (the only host-specific code) |
| `boards/<tracker>.js` | board/ticket adapters |
| `server.js` | static server + the on-demand endpoints |
| `config.js` / `config.json` | settings (copy from `config.example.json`) |
| `standup.sh` / `standup.cmd` | launchers |

Endpoints (all local): `GET /status`, `GET /config`, `POST /standup`, `POST /writeup`.

## Safety

- **Read-only** — it reads git (and, when configured, your PR host/tracker). It never writes to
  any of them. The only thing it can change is your local `config.json`, which you edit yourself.
- **Local only** — the server binds to `127.0.0.1`, rejects requests whose `Host` isn't a
  localhost name (blocks DNS-rebinding), and rejects cross-origin requests to the endpoints that
  spawn a subprocess (blocks a random web page from making your machine run `git`).
- **No secrets stored** — the git lane needs none; host/board adapters delegate auth to their own
  CLI/token. `config.json` is gitignored and never served.
- **The AI write-up is opt-in and toolless** — disabled unless `claudeExe` is set, and when on it
  runs headless with no tools, seeing only the board text.

## Tests

```sh
npm test        # = node --test  (Node's built-in runner, no dependencies)
```

Covers the column bucketing and flag rules, commit grouping, the paste-text builder, the git-log
parsers, the lane contract (including the never-fabricate-data promise), and the server's
security guards. CI runs the suite on Windows, macOS, and Linux across Node 18 / 20 / 22.

## Credits

Built by [Micke Berg](https://mickeberg.com).

## License

MIT.
