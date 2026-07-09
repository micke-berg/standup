// server.js — the tiny zero-dependency static server behind the standup dashboard.
//
// It serves index.html + the front-end files on localhost and exposes:
//   POST /standup   run every lane on demand and return the board (read-only against git/gh)
//   POST /writeup   the opt-in AI write-up (spawns config.claudeExe; disabled unless set)
//   GET  /status    liveness + when the board was last built + per-lane state
//   GET  /config    the presentation-safe slice of config the page needs
//
// There is NO resident poller: standup fetches only when you open or refresh it. The board is
// reconstructed from scratch each time and cached in memory only so /status can report it.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("./config.js");
const { runStandup, writeupPrompt } = require("./standup.js");

const PORT = process.env.STANDUP_PORT || config.port;
const ROOT = __dirname;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

// The opt-in AI write-up spawns a fresh, read-only headless Claude to compress the board into
// spoken bullets. Configured via config.json (claudeExe); empty disables it — the board is
// fully useful without it. Same shape as watch-pr's conflict explainer.
const CLAUDE = config.claudeExe;
const WRITEUP_TIMEOUT_MS = 2 * 60 * 1000;
let writingUp = false;      // one write-up at a time
let lastBoard = null;       // most recent board, for /status and the write-up
let lastBuiltAt = null;

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

// On-demand board build. Read-only against git and the PR host; the only thing it "writes" is
// the in-memory cache below.
async function handleStandup(res) {
  try {
    const board = await runStandup(config);
    lastBoard = board;
    lastBuiltAt = board.generatedAt;
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(board));
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message });
  }
}

// The AI write-up. Rebuilds the board (so the bullets match what's on screen right now), then
// pipes its plain text to a headless Claude with NO tools — it only ever sees already-collected
// text and is told not to invent anything. Disabled unless claudeExe is set.
async function handleWriteup(res) {
  if (!CLAUDE) return sendJson(res, 501, { ok: false, error: "AI write-up not configured (set claudeExe in config.json)" });
  if (writingUp) return sendJson(res, 409, { ok: false, error: "a write-up is already running" });
  let board;
  try { board = await runStandup(config); lastBoard = board; lastBuiltAt = board.generatedAt; }
  catch (e) { return sendJson(res, 500, { ok: false, error: "couldn't build the board: " + e.message }); }

  writingUp = true;
  // shell:false + args array + prompt over stdin => nothing to escape. No tools are allowed:
  // the model compresses the text it's given and cannot reach git, the network, or the disk.
  const child = spawn(CLAUDE, ["-p", "--allowedTools", "", "--output-format", "text"], {
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "", err = "";
  const timer = setTimeout(() => child.kill(), WRITEUP_TIMEOUT_MS);
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("error", (e) => {
    clearTimeout(timer); writingUp = false;
    if (!res.writableEnded) sendJson(res, 500, { ok: false, error: "failed to launch claude: " + e.message });
  });
  child.on("close", (code) => {
    clearTimeout(timer); writingUp = false;
    if (res.writableEnded) return;
    if (code === 0 && out.trim()) sendJson(res, 200, { ok: true, markdown: out.trim() });
    else sendJson(res, 500, { ok: false, error: (err.trim() || `claude exited with code ${code}`).slice(0, 2000) });
  });
  child.stdin.write(writeupPrompt(board));
  child.stdin.end();
}

function handleStatus(res) {
  sendJson(res, 200, {
    alive: true,
    lastBuiltAt,
    lookbackHours: config.lookbackHours,
    lanes: (lastBoard && lastBoard.lanes) || [],
    writeupEnabled: !!CLAUDE,
  });
}

// Presentation-relevant config only, so the page stays config-driven and portable rather than
// hardcoding one person's values. Never exposes tokens, paths, or org internals.
function handleConfig(res) {
  sendJson(res, 200, {
    builtBy: config.builtBy || "",
    builtByUrl: config.builtByUrl || "",
    lookbackHours: config.lookbackHours,
    writeupEnabled: !!CLAUDE,
  });
}

// The server binds to 127.0.0.1, but a browser on this machine can still reach it — so these
// guards keep a malicious web page from driving it (identical to watch-pr's):
//   hostAllowed — the Host header must be a localhost name (blocks DNS-rebinding).
//   csrfSafe    — state-changing/subprocess-spawning endpoints must be POST and not a
//                 cross-site browser request. Local CLI/curl (no Origin, no Sec-Fetch) passes.
function hostAllowed(req) {
  const host = (req.headers.host || "").toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(host);
}
function csrfSafe(req) {
  if (req.method !== "POST") return false; // spawning git/gh is POST-only; blocks <img>/GET CSRF
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false; // cross-site browser req
  const origin = req.headers.origin;
  if (origin) {
    try {
      const h = new URL(origin).hostname;
      if (!(h === "localhost" || h === "127.0.0.1" || h === "::1")) return false;
    } catch (e) { return false; } // malformed Origin => hostile
  }
  return true;
}
// /standup and /writeup both spawn subprocesses, so they are POST-only and CSRF-guarded — a
// random web page must not be able to make this machine run git or gh.
const MUTATING = new Set(["/standup", "/writeup"]);
// config.json holds local paths/org names; never serve it even though it lives in ROOT.
const BLOCKED_FILES = new Set(["config.json"]);

// Resolve a request URL to a servable file under ROOT, or an error status. Pure and exported
// so the path-traversal / blocked-file rules are unit-testable without a socket.
function staticFileFor(rawUrl) {
  const urlPath = String(rawUrl || "").split("?")[0];
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch (e) { return { status: 400 }; }
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return { status: 403 };
  if (BLOCKED_FILES.has(path.basename(file).toLowerCase())) return { status: 404 };
  return { status: 200, file };
}

function requestHandler(req, res) {
  if (!hostAllowed(req)) { res.writeHead(403); return res.end("forbidden host"); }
  const url = req.url.split("?")[0];
  if (MUTATING.has(url) && !csrfSafe(req)) { res.writeHead(403); return res.end("blocked"); }
  if (url === "/status") return handleStatus(res);
  if (url === "/config") return handleConfig(res);
  if (url === "/standup") return handleStandup(res);
  if (url === "/writeup") return handleWriteup(res);

  const resolved = staticFileFor(req.url);
  if (resolved.status !== 200) {
    res.writeHead(resolved.status);
    return res.end(resolved.status === 400 ? "bad request" : resolved.status === 403 ? "forbidden" : "not found");
  }
  fs.readFile(resolved.file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(resolved.file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

// Only start the server when run directly (node server.js). When required by a test, the
// module just exposes its pure guards with no side effects.
if (require.main === module) {
  const server = http.createServer(requestHandler);
  // The port is the singleton lock: a second start (a stray launcher, or opening it while an
  // always-on instance runs) exits cleanly here instead of crashing on EADDRINUSE.
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.log(`standup: already running on http://localhost:${PORT} — nothing to do.`);
      process.exit(0);
    }
    throw e;
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`standup board → http://localhost:${PORT}`);
  });
}

module.exports = { hostAllowed, csrfSafe, staticFileFor, requestHandler };
