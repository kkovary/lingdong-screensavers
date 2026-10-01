// Plots fishdraw drawings one after another, like a pen plotter.
//
// fishdraw's main() returns polylines inside a 500x300 frame, offset by 10
// (its own SVG is 520x320 with a border rectangle). We fit that card to the
// screen and draw the strokes at a constant pen speed: each animation frame
// strokes only the new piece of path since the previous frame, so the cost
// per frame is tiny no matter how complex the fish is.
(function () {
  "use strict";
  var CARD_W = 520, CARD_H = 320;
  var DRAW_S = 35;        // seconds to plot one fish
  var HOLD_S = 20;        // seconds to admire it
  var FADE_S = 2.5;       // must match the CSS transition
  var LINE_PT = 1.15;     // pen width in screen points, independent of zoom
  var INK = "#1a1a1a";

  var canvas = document.getElementById("paper");
  var ctx = canvas.getContext("2d");
  var dpr = 1, scale = 1, offX = 0, offY = 0;

  var strokes = null, total = 0, drawn = 0, speed = 0;
  var cur = { i: 0, j: 0, t: 0 };    // pen position: polyline i, segment j, fraction t
  var phase = "idle", phaseEnd = 0, next = null;
  var raf = null, last = null;
  var stats = { frames: 0, since: null, fish: 0 };

  function layout() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    scale = Math.min(innerWidth * 0.86 / CARD_W, innerHeight * 0.86 / CARD_H);
    offX = (innerWidth - CARD_W * scale) / 2;
    offY = (innerHeight - CARD_H * scale) / 2;
  }

  // Map card units to device pixels.
  function X(x) { return (offX + (x + 10) * scale) * dpr; }
  function Y(y) { return (offY + (y + 10) * scale) * dpr; }

  function makeFish() {
    var polys = main();                       // fishdraw: random binomial name + fish
    // The border fishdraw draws in its own SVG output, as a first stroke.
    polys.unshift([[0, 0], [500, 0], [500, 300], [0, 300], [0, 0]]);
    var len = 0, segs = [];
    for (var i = 0; i < polys.length; i++) {
      var p = polys[i], s = [];
      for (var j = 1; j < p.length; j++) {
        var d = Math.hypot(p[j][0] - p[j - 1][0], p[j][1] - p[j - 1][1]);
        s.push(d); len += d;
      }
      segs.push(s);
    }
    return { polys: polys, segs: segs, len: len };
  }

  function beginFish(f) {
    strokes = f; total = f.len; drawn = 0; speed = total / DRAW_S;
    cur = { i: 0, j: 0, t: 0 };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = LINE_PT * dpr;
    // Flat caps: round ones double up where consecutive frames meet and show as ticks.
    ctx.lineCap = "butt"; ctx.lineJoin = "round"; ctx.strokeStyle = INK;
    canvas.style.opacity = 1;
    phase = "draw";
    stats.fish++;
  }

  // Advance the pen by dist card units, stroking what it covers.
  function plot(dist) {
    var P = strokes.polys, S = strokes.segs;
    ctx.beginPath();
    var penDown = false;
    while (dist > 0 && cur.i < P.length) {
      var p = P[cur.i], s = S[cur.i];
      if (cur.j >= s.length) { cur.i++; cur.j = 0; cur.t = 0; penDown = false; continue; }
      var a = p[cur.j], b = p[cur.j + 1], segLen = s[cur.j];
      var x0 = a[0] + (b[0] - a[0]) * cur.t, y0 = a[1] + (b[1] - a[1]) * cur.t;
      if (!penDown) { ctx.moveTo(X(x0), Y(y0)); penDown = true; }
      var left = segLen * (1 - cur.t);
      if (left <= dist || segLen === 0) {
        ctx.lineTo(X(b[0]), Y(b[1]));
        dist -= left; drawn += left; cur.j++; cur.t = 0;
      } else {
        cur.t += dist / segLen;
        ctx.lineTo(X(a[0] + (b[0] - a[0]) * cur.t), Y(a[1] + (b[1] - a[1]) * cur.t));
        drawn += dist; dist = 0;
      }
    }
    ctx.stroke();
    return cur.i >= P.length;
  }

  function redrawAll() {                     // after a resize, repaint what was drawn
    if (!strokes) return;
    var keep = drawn, save = cur;
    beginFish(strokes); stats.fish--;
    plot(keep);
    if (save.i >= strokes.polys.length) phase = "hold";
  }

  function tick(now) {
    if (last !== null) {
      var dt = Math.min((now - last) / 1000, 0.1);
      stats.frames++;
      if (phase === "draw") {
        if (plot(speed * dt)) { phase = "hold"; phaseEnd = now + HOLD_S * 1000; next = null; }
      } else if (phase === "hold") {
        // Generate the next fish while the screen is static, so its ~0.4 s cost is invisible.
        if (next === null && now > phaseEnd - HOLD_S * 500) next = makeFish();
        if (now >= phaseEnd) { canvas.style.opacity = 0; phase = "fade"; phaseEnd = now + FADE_S * 1000; }
      } else if (phase === "fade" && now >= phaseEnd) {
        beginFish(next || makeFish()); next = null;
      }
    }
    if (stats.since === null) stats.since = now;
    last = now;
    raf = requestAnimationFrame(tick);
  }

  window.__saver = {
    start: function () { if (raf === null) { last = null; raf = requestAnimationFrame(tick); } },
    stop: function () { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } },
    stats: function () {
      var secs = stats.since === null ? 0 : (performance.now() - stats.since) / 1000;
      var out = { fps: Math.round(stats.frames / Math.max(secs, 0.001)), fish: stats.fish, phase: phase,
                  progress: total ? Math.round(100 * drawn / total) : 0, w: innerWidth, h: innerHeight };
      stats.frames = 0; stats.since = null;
      return out;
    }
  };

  layout();
  window.addEventListener("resize", function () { layout(); redrawAll(); });
  beginFish(makeFish());
  window.__saverReady = true;
  window.__saver.start();
})();
