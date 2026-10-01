// A wall of fishdraw fish, each plotted stroke by stroke like a pen plotter.
//
// fishdraw's main() returns polylines inside a 500x300 frame, offset by 10
// (its own SVG is a 520x320 card with a border rectangle). Fish are made by
// workers (see src/fish-worker.js) so a card starting a new fish never stalls
// the others. Each card is its own canvas; every animation frame strokes only
// the new piece of path since the previous frame, so the per-frame cost stays
// tiny however many cards are drawing. Timing runs on our own clock that only
// advances while the saver runs, so stop/start pauses cleanly.
(function () {
  "use strict";
  var CARD_W = 520, CARD_H = 320;
  var DRAW_S = [22, 40];    // seconds to plot one fish (random per fish)
  var HOLD_S = 4;           // seconds a finished fish stays before the next
  var FADE_S = 1.5;         // must match the CSS transition
  var INK = "#1a1a1a";

  var dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  var rows = H >= 1100 ? 3 : 2;
  var ch = Math.floor(H * 0.86 / rows), cw = Math.floor(ch * CARD_W / CARD_H);
  if (cw > W * 0.9) { cw = Math.floor(W * 0.9); ch = Math.floor(cw * CARD_H / CARD_W); }
  var gap = Math.round(ch * 0.12);
  var cols = Math.max(1, Math.floor((W - gap) / (cw + gap)));
  var x0 = (W - (cols * cw + (cols - 1) * gap)) / 2, y0 = (H - (rows * ch + (rows - 1) * gap)) / 2;
  var scale = cw / CARD_W;                               // card units -> CSS px
  var LINE_PT = Math.max(0.6, Math.min(1.15, 0.5 * scale));

  function rand(r) { return r[0] + Math.random() * (r[1] - r[0]); }

  // --- worker pool ---------------------------------------------------------
  var src = URL.createObjectURL(new Blob([self.FISH_WORKER_SRC], { type: "text/javascript" }));
  var idle = [], queue = [], waiting = {}, nextId = 1, errors = [];
  var stats = { made: 0, genMs: 0, frames: 0, since: null, maxGap: 0 };
  function dispatch() { while (idle.length && queue.length) idle.pop().postMessage(queue.shift()); }
  for (var wi = 0; wi < 2; wi++) {
    var w = new Worker(src);
    w.onmessage = function (e) {
      idle.push(this);
      var cb = waiting[e.data.id]; delete waiting[e.data.id];
      stats.made++; stats.genMs = e.data.genMs;
      if (cb) cb(e.data.polys);
      dispatch();
    };
    w.onerror = function (e) { errors.push((e.message || "?") + " @" + e.lineno); };
    idle.push(w);
  }
  function requestFish(cb) { var id = nextId++; waiting[id] = cb; queue.push({ id: id }); dispatch(); }

  // --- cards ---------------------------------------------------------------
  function prepare(polys) {
    var len = 0, segs = [];
    for (var i = 0; i < polys.length; i++) {
      var p = polys[i], s = [];
      for (var j = 1; j < p.length; j++) { var d = Math.hypot(p[j][0] - p[j - 1][0], p[j][1] - p[j - 1][1]); s.push(d); len += d; }
      segs.push(s);
    }
    return { polys: polys, segs: segs, len: len };
  }

  var cards = [];
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
    var el = document.createElement("canvas");
    el.className = "card";
    el.style.left = (x0 + c * (cw + gap)) + "px"; el.style.top = (y0 + r * (ch + gap)) + "px";
    el.style.width = cw + "px"; el.style.height = ch + "px";
    el.width = Math.round(cw * dpr); el.height = Math.round(ch * dpr);
    document.body.appendChild(el);
    cards.push({ el: el, ctx: el.getContext("2d"), f: null, next: null, phase: "waiting", at: 0,
                 cur: null, drawn: 0, speed: 0 });
  }

  function ask(cd) { cd.next = "pending"; requestFish(function (polys) { cd.next = prepare(polys); }); }

  function begin(cd, f, delay) {
    var x = cd.ctx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, cd.el.width, cd.el.height);
    x.lineWidth = LINE_PT * dpr;
    // Flat caps: round ones double up where consecutive frames meet and show as ticks.
    x.lineCap = "butt"; x.lineJoin = "round"; x.strokeStyle = INK;
    // fishdraw's card border, drawn whole: plotting it frame by frame leaves
    // faint seams along the long straight edges.
    var k = scale * dpr;
    x.strokeRect(10 * k, 10 * k, 500 * k, 300 * k);
    cd.f = f; cd.next = null; cd.drawn = 0; cd.cur = { i: 0, j: 0, t: 0 };
    cd.speed = f.len / rand(DRAW_S);
    cd.el.classList.add("on");
    cd.phase = "pre"; cd.at = clock + delay;
  }

  // Advance a card's pen by dist card units, stroking what it covers.
  function plot(cd, dist) {
    var P = cd.f.polys, S = cd.f.segs, cur = cd.cur, x = cd.ctx, k = scale * dpr;
    x.beginPath();
    var penDown = false;
    while (dist > 0 && cur.i < P.length) {
      var p = P[cur.i], s = S[cur.i];
      if (cur.j >= s.length) { cur.i++; cur.j = 0; cur.t = 0; penDown = false; continue; }
      var a = p[cur.j], b = p[cur.j + 1], segLen = s[cur.j];
      if (!penDown) {
        x.moveTo((a[0] + (b[0] - a[0]) * cur.t + 10) * k, (a[1] + (b[1] - a[1]) * cur.t + 10) * k);
        penDown = true;
      }
      var left = segLen * (1 - cur.t);
      if (left <= dist || segLen === 0) {
        x.lineTo((b[0] + 10) * k, (b[1] + 10) * k);
        dist -= left; cd.drawn += left; cur.j++; cur.t = 0;
      } else {
        cur.t += dist / segLen;
        x.lineTo((a[0] + (b[0] - a[0]) * cur.t + 10) * k, (a[1] + (b[1] - a[1]) * cur.t + 10) * k);
        cd.drawn += dist; dist = 0;
      }
    }
    x.stroke();
    return cur.i >= P.length;
  }

  var clock = 0, last = null, raf = null;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    var dt = 0;
    if (last !== null) {
      var g = now - last; stats.frames++; if (g > stats.maxGap) stats.maxGap = g;
      dt = Math.min(g / 1000, 0.1); clock += dt;
    }
    if (stats.since === null) stats.since = now;
    last = now;
    for (var i = 0; i < cards.length; i++) {
      var cd = cards[i];
      switch (cd.phase) {
        case "waiting":                                     // first fish for this card, staggered
          if (cd.next === null) ask(cd);
          else if (cd.next !== "pending") begin(cd, cd.next, Math.random() * 6);
          break;
        case "pre":
          if (clock >= cd.at) { cd.phase = "draw"; ask(cd); }   // fetch the next fish now; it is ready long before needed
          break;
        case "draw":
          if (plot(cd, cd.speed * dt)) { cd.phase = "hold"; cd.at = clock + HOLD_S; }
          break;
        case "hold":
          if (clock >= cd.at && cd.next && cd.next !== "pending") {
            cd.el.classList.remove("on"); cd.phase = "fade"; cd.at = clock + FADE_S;
          }
          break;
        case "fade":
          if (clock >= cd.at) begin(cd, cd.next, 0.3);
          break;
      }
    }
  }

  window.__saver = {
    start: function () { if (raf === null) { last = null; raf = requestAnimationFrame(tick); } },
    stop: function () { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } },
    stats: function () {
      var secs = stats.since === null ? 0 : (performance.now() - stats.since) / 1000, by = {};
      cards.forEach(function (c) { by[c.phase] = (by[c.phase] || 0) + 1; });
      var out = { grid: cols + "x" + rows, made: stats.made, lastGenMs: stats.genMs,
                  fps: Math.round(stats.frames / Math.max(secs, 0.001)), maxGapMs: Math.round(stats.maxGap),
                  phases: by, errors: errors.slice(-3) };
      stats.frames = 0; stats.since = null; stats.maxGap = 0;
      return out;
    }
  };
  window.__saverReady = true;
  window.__saver.start();
})();
