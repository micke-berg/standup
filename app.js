// app.js — the standup dashboard behavior. Pure presentation: it POSTs /standup, renders the
// three columns from the board, and wires the theme toggle, copy-as-text, and the opt-in
// write-up. No framework, no build step. Colour comes entirely from the CSS custom properties
// in app.css; the raw status tones are read back here so chips can add per-call alpha.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // ── theme ──────────────────────────────────────────────────────────────────
  function currentTheme() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("standup-theme", t); } catch (e) {}
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "light" ? "#f4f5f7" : "#131118");
    var b = $("themeBtn");
    if (b) { b.textContent = t === "light" ? "☾" : "☀"; b.title = "Switch to " + (t === "light" ? "dark" : "light") + " mode"; }
    if (lastBoard) render(lastBoard); // re-tint chips for the new palette
  }

  // Read a raw "L C H" tone from the stylesheet and build an oklch() colour, optionally with alpha.
  function tone(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function col(name, a) { var t = tone(name); return a == null ? "oklch(" + t + ")" : "oklch(" + t + " / " + a + ")"; }

  // ── relative time ──────────────────────────────────────────────────────────
  function ago(iso) {
    if (!iso) return "";
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (isNaN(s)) return "";
    if (s < 90) return "just now";
    var m = s / 60; if (m < 60) return Math.round(m) + "m ago";
    var h = m / 60; if (h < 36) return Math.round(h) + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  // ── chips ──────────────────────────────────────────────────────────────────
  // Which tone a neutral state/ci token paints with.
  var STATE_TONE = {
    merged: "--purple", reviewed: "--neutral", committed: "--go", done: "--go", closed: "--dim",
    open: "--active", draft: "--dim", "in-progress": "--active", wip: "--warn", review: "--active",
  };
  var CI_TONE = { passed: "--go", failed: "--crit", running: "--warn", none: "--dim" };
  function chip(label, toneName) {
    var t = toneName || "--neutral";
    return '<span class="chip" style="background:' + col(t, 0.14) + ";color:" + col(t) + ";border:1px solid " + col(t, 0.28) + '">' + esc(label) + "</span>";
  }

  // ── card renderers ─────────────────────────────────────────────────────────
  // A standup card stays glanceable: show the most recent few commits, then a quiet "+N more"
  // (the full list is still in the Copy-as-text output).
  var COMMIT_CAP = 6;
  function commitCard(n) {
    var shown = n.commits.slice(0, COMMIT_CAP);
    var rows = shown.map(function (c) {
      return '<div class="commit"><span class="sha">' + esc(c.shortHash) + '</span><span class="msg">' + esc(c.title) + "</span></div>";
    }).join("");
    var more = n.commits.length > COMMIT_CAP
      ? '<div class="commit-more">+' + (n.commits.length - COMMIT_CAP) + " more</div>"
      : "";
    return '<article class="card">'
      + '<div class="card-top"><span class="card-title">' + n.count + " commit" + (n.count === 1 ? "" : "s") + '</span>'
      + '<span class="card-ctx">' + esc(n.context) + '</span>'
      + '<span class="ago">' + ago(n.ts) + "</span></div>"
      + '<div class="commits">' + rows + more + "</div></article>";
  }

  function itemCard(n) {
    var title = n.url
      ? '<a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.title) + "</a>"
      : esc(n.title);
    var chips = [];
    var m = n.meta || {};
    if (n.kind === "pr") {
      chips.push(chip(n.activity, STATE_TONE[n.state] || "--neutral"));
      if (m.ci && m.ci !== "none") chips.push(chip("CI " + m.ci, CI_TONE[m.ci] || "--dim"));
      if (typeof m.approvals === "number" && m.approvals > 0) chips.push(chip(m.approvals + "✓", "--go"));
    } else if (n.kind === "ticket") {
      chips.push(chip(n.state, STATE_TONE[n.state] || "--neutral"));
      if (m.movedTo) chips.push(chip("→ " + m.movedTo, "--neutral"));
    } else if (n.kind === "wip") {
      chips.push(chip("WIP", "--warn"));
    }
    var flagBanner = n.flag
      ? '<div class="flag-reason" style="color:' + col("--crit") + '">⚠ ' + esc(n.flag) + "</div>"
      : "";
    var meta = [];
    if (n.kind === "wip" && m.branch) meta.push('<span class="meta">on ' + esc(m.branch) + "</span>");
    var ctx = n.context ? '<span class="card-ctx">' + esc(n.context) + "</span>" : "";
    return '<article class="card">'
      + flagBanner
      + '<div class="card-top">' + chips.join("") + ctx + '<span class="ago">' + ago(n.ts) + "</span></div>"
      + '<div class="card-title">' + title + "</div>"
      + (meta.length ? '<div class="meta-row">' + meta.join("") + "</div>" : "")
      + "</article>";
  }

  function nodeCard(n) { return n.node === "commits" ? commitCard(n) : itemCard(n); }

  // ── board render ───────────────────────────────────────────────────────────
  var COLS = [
    { key: "yesterday", title: "Yesterday", tone: "--go" },
    { key: "today", title: "Today", tone: "--active" },
    { key: "flags", title: "Flags", tone: "--crit" },
  ];
  var lastBoard = null;

  function render(board) {
    lastBoard = board;
    var d = new Date(board.generatedAt || Date.now());
    var dateStr = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    $("subtitle").textContent = "LAST " + board.lookbackHours + "H · " + dateStr.toUpperCase();

    $("board").innerHTML = COLS.map(function (c) {
      var nodes = (board.columns && board.columns[c.key]) || [];
      var body = nodes.length
        ? nodes.map(nodeCard).join("")
        : '<div class="empty">Nothing ' + (c.key === "flags" ? "flagged" : "yet") + "</div>";
      return '<section class="col">'
        + '<div class="col-head"><span class="col-accent" style="background:' + col(c.tone) + '"></span>'
        + '<span class="col-title">' + c.title + '</span>'
        + '<span class="col-count">' + nodes.length + "</span></div>"
        + body + "</section>";
    }).join("");

    renderLanes(board.lanes || []);

    // write-up button appears only when the seam is configured
    $("writeupBtn").style.display = board.writeupEnabled ? "" : "none";

    // footer status
    var down = (board.lanes || []).filter(function (l) { return !l.ok; });
    $("footDot").style.background = col(down.length ? "--warn" : "--go");
    $("footLabel").textContent = (board.lanes || []).map(function (l) {
      return l.label + (l.ok ? " ✓" : " —");
    }).join("   ·   ");
  }

  // Honest lane notices: only lanes that aren't reporting show up (a stub, a missing account,
  // a real error). A lane that's working stays quiet. Never a fabricated card.
  function renderLanes(lanes) {
    var down = lanes.filter(function (l) { return !l.ok; });
    $("lanes").innerHTML = down.map(function (l) {
      var t = l.notImplemented ? "--dim" : "--warn";
      return '<div class="lane-note"><span class="lane-dot" style="background:' + col(t) + '"></span>'
        + '<span class="lane-label">' + esc(l.label) + '</span>'
        + '<span class="lane-msg">' + esc(l.error || "not reporting") + "</span></div>";
    }).join("");
  }

  // ── toast ──────────────────────────────────────────────────────────────────
  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  // ── data + actions ─────────────────────────────────────────────────────────
  function post(path) {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" } });
  }

  var loading = false;
  function refresh() {
    if (loading) return;
    loading = true;
    var btn = $("refreshBtn");
    btn.disabled = true; btn.innerHTML = '<span class="dotspin"></span> Refreshing';
    post("/standup")
      .then(function (r) { return r.json(); })
      .then(function (board) {
        if (board && board.error) throw new Error(board.error);
        render(board);
      })
      .catch(function (e) {
        $("board").innerHTML = '<div class="empty" style="grid-column:1/-1">Could not build the board — ' + esc(e.message) + "</div>";
      })
      .finally(function () {
        loading = false; btn.disabled = false; btn.innerHTML = "↻ Refresh";
      });
  }

  function copyText() {
    if (!lastBoard) return;
    var text = lastBoard.text || "";
    var done = function () { toast("Copied — paste into Teams / Slack"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  var writingUp = false;
  function writeup() {
    if (writingUp) return;
    writingUp = true;
    var panel = $("writeup"), state = $("writeupState"), body = $("writeupBody"), btn = $("writeupBtn");
    panel.classList.add("show"); body.textContent = ""; state.textContent = "thinking…";
    btn.disabled = true;
    post("/writeup")
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || "write-up failed");
        state.textContent = ""; body.textContent = res.markdown;
      })
      .catch(function (e) { state.textContent = ""; body.textContent = "⚠ " + e.message; })
      .finally(function () { writingUp = false; btn.disabled = false; });
  }

  // ── wire up ────────────────────────────────────────────────────────────────
  function boot() {
    applyTheme(currentTheme());
    $("themeBtn").addEventListener("click", function () { applyTheme(currentTheme() === "light" ? "dark" : "light"); });
    $("refreshBtn").addEventListener("click", refresh);
    $("copyBtn").addEventListener("click", copyText);
    $("writeupBtn").addEventListener("click", writeup);

    // footer attribution from /config (portable — no name hardcoded in the page)
    fetch("/config").then(function (r) { return r.json(); }).then(function (c) {
      if (c && c.builtBy) {
        $("footBuilt").innerHTML = c.builtByUrl
          ? 'Built by <a href="' + esc(c.builtByUrl) + '" target="_blank" rel="noopener">' + esc(c.builtBy) + "</a>"
          : "Built by " + esc(c.builtBy);
      }
    }).catch(function () {});

    refresh();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
