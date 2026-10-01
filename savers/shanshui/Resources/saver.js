// Injected into shan-shui-inf at document end by ShanShuiView.
//
// Hides the page UI, scales the 3000x800 canvas to cover the viewport, and
// pans it with compositor-driven Web Animations instead of re-rendering the
// SVG every frame. Each SEGMENT units of travel is one static SVG, double
// buffered and phase-locked (see the segment loop), so neither the expensive
// rebuild nor timer jitter can stall visible motion.
(function () {
  "use strict";
  var W = 3000, H = 800;            // MEM.windx / MEM.windy in upstream
  var ZOOM = 1.142;                 // upstream calcViewBox zoom: 1 viewBox unit = ZOOM px
  var SPEED = 24;                   // viewBox units per second
  var SEGMENT = 200;                // units per static render
  // Upstream easter egg: some one-story pavilions get a "Pizza Hut" roof sign.
  var SIGN_FROM = ">Pizza Hut</text>", SIGN_TO = ">Octant</text>";
  var DURATION = SEGMENT / SPEED;   // seconds per segment
  var running = false, timer = null;
  var bufs = [], front = 0;
  var stats = { segments: 0, maxPrepMs: 0, maxLateMs: 0, frames: 0, maxGap: 0, since: null, last: null, raf: null };

  function hide(id) { var el = document.getElementById(id); if (el) el.style.display = "none"; }

  // --- stage + double buffer -------------------------------------------------
  function buildStage() {
    var bg = document.getElementById("BG");
    var stage = document.createElement("div");
    stage.id = "saverStage";
    document.body.appendChild(stage);
    bg.parentNode.removeChild(bg);
    var b2 = document.createElement("div");
    [bg, b2].forEach(function (d) {
      // Opaque white so the buffer on top fully covers the one underneath.
      d.style.cssText = "position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px;" +
                        "background:#fff;will-change:transform;display:none;";
      stage.appendChild(d);
    });
    bufs = [bg, b2];
    fit();
    window.addEventListener("resize", fit);
  }

  function fit() {
    var stage = document.getElementById("saverStage");
    var s = Math.max(window.innerWidth / W, window.innerHeight / H);
    var x = (window.innerWidth - W * s) / 2, y = (window.innerHeight - H * s) / 2;
    stage.style.cssText = "position:fixed;left:0;top:0;width:" + W + "px;height:" + H + "px;" +
      "transform-origin:0 0;transform:translate(" + x + "px," + y + "px) scale(" + s + ");background:#fff;";
  }

  // Render the landscape at camera x into buffer el (mirrors upstream update()).
  function render(el, x) {
    MEM.cursx = x;
    chunkloader(x, x + W);
    chunkrender(x, x + W);
    // Prune chunks well behind the camera; upstream never frees them.
    MEM.chunks = MEM.chunks.filter(function (c) { return c.x > x - 3 * MEM.cwid; });
    el.innerHTML =
      "<svg xmlns='http://www.w3.org/2000/svg' width='" + W + "' height='" + H + "' " +
      "viewBox='" + x + " 0 " + (W / ZOOM) + " " + (H / ZOOM) + "'>" +
      "<g>" + MEM.canv.split(SIGN_FROM).join(SIGN_TO) + "</g></svg>";
  }

  // --- segment loop ----------------------------------------------------------
  // Each buffer pans with a compositor-driven Web Animation. The next buffer is
  // rendered mid-segment into the layer underneath, and its animation start is
  // pinned to exactly when the top one reaches the segment boundary, so both
  // show identical pixels from then on. The top animation deliberately keeps
  // going past the boundary (OVERSHOOT), so a late swap timer is invisible:
  // nothing ever freezes waiting on the main thread.
  var OVERSHOOT = 2;
  var SEG_MS = DURATION * 1000;
  var KEYFRAMES = [{ transform: "translateX(0px)" },
                   { transform: "translateX(" + (-SEGMENT * ZOOM * OVERSHOOT) + "px)" }];
  var frontAnim = null, backAnim = null, boundary = null;

  function now() { return document.timeline.currentTime; }

  function animate(el, startTime) {
    var a = el.animate(KEYFRAMES, { duration: SEG_MS * OVERSHOOT, easing: "linear", fill: "both" });
    if (startTime !== null) a.startTime = startTime;
    return a;
  }

  function schedule(fn, at) {
    clearTimeout(timer);
    timer = setTimeout(fn, Math.max(0, at - now()));
  }

  function prepareNext() {
    if (!running) return;
    var t0 = performance.now();
    var back = bufs[1 - front];
    render(back, MEM.cursx + SEGMENT);
    stats.maxPrepMs = Math.max(stats.maxPrepMs, performance.now() - t0);
    back.style.zIndex = 1;
    back.style.display = "block";
    backAnim = animate(back, boundary);
    schedule(swap, boundary + 250);
  }

  function swap() {
    if (!running) return;
    stats.maxLateMs = Math.max(stats.maxLateMs, now() - boundary);
    stats.segments++;
    var old = bufs[front], oldAnim = frontAnim;
    front = 1 - front;
    bufs[front].style.zIndex = 2;
    old.style.display = "none";
    oldAnim.cancel();
    frontAnim = backAnim; backAnim = null;
    boundary = frontAnim.startTime + SEG_MS;
    schedule(prepareNext, boundary - SEG_MS / 2);
  }

  function reset() {
    clearTimeout(timer);
    [frontAnim, backAnim].forEach(function (a) { if (a) a.cancel(); });
    frontAnim = backAnim = null;
    bufs.forEach(function (b) { b.style.display = "none"; });
  }

  function begin() {
    reset();
    var el = bufs[front];
    render(el, MEM.cursx);
    el.style.zIndex = 2;
    el.style.display = "block";
    var t = now() + 100;          // explicit start so boundary is known up front
    frontAnim = animate(el, t);
    boundary = t + SEG_MS;
    schedule(prepareNext, boundary - SEG_MS / 2);
  }

  // Main-thread health meter only; motion no longer depends on rAF.
  function meter(now) {
    if (stats.last !== null) { var g = now - stats.last; stats.frames++; if (g > stats.maxGap) stats.maxGap = g; }
    if (stats.since === null) stats.since = now;
    stats.last = now;
    stats.raf = requestAnimationFrame(meter);
  }

  window.__saver = {
    start: function () {
      if (running) return;
      running = true;
      begin();
      stats.raf = requestAnimationFrame(meter);
    },
    stop: function () {
      running = false;
      clearTimeout(timer);
      if (frontAnim) frontAnim.pause();
      if (backAnim) backAnim.pause();
      if (stats.raf) cancelAnimationFrame(stats.raf);
      stats.raf = null; stats.last = null;
    },
    running: function () { return running; },
    stats: function () {
      var secs = stats.since === null ? 0 : (performance.now() - stats.since) / 1000;
      var out = { jsFps: Math.round(stats.frames / Math.max(secs, 0.001)), maxGapMs: Math.round(stats.maxGap),
                  segments: stats.segments, maxPrepMs: Math.round(stats.maxPrepMs), maxLateMs: Math.round(stats.maxLateMs),
                  chunks: MEM.chunks.length, w: innerWidth, h: innerHeight, dpr: devicePixelRatio };
      stats.frames = 0; stats.maxGap = 0; stats.segments = 0; stats.maxPrepMs = 0; stats.maxLateMs = 0; stats.since = null;
      return out;
    }
  };

  try {
    ["SETTING", "MENU", "SOURCE_BTN", "L", "R"].forEach(hide);
    document.documentElement.style.overflow = "hidden";
    document.body.style.cssText = "margin:0;overflow:hidden;background:#fff;";
    buildStage();
    window.__saver.start();
    window.__saverReady = true;
  } catch (e) {
    console.log("saver.js init failed: " + e);
  }
})();
