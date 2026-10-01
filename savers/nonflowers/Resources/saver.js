// Injected into nonflowers at document end, after main.js has run but before
// body onload kicks off generation.
//
// Upstream paints every plant onto a fixed 600x600 canvas, which looks soft
// once scaled up to fill a screen. All of its raw-pixel work goes through the
// small `Layer` helper, so we wrap that: canvases are created K times larger
// with a K-scaled context, so every vector drawing call lands at full
// resolution unchanged, and the four pixel-level helpers are adjusted to
// match. Filters receive logical (600-space) coordinates so the brush-texture
// noise keeps upstream's look, and bounds come back in logical units.
// The pixel loops are rewritten without per-pixel array allocation because
// they now touch up to K*K as many pixels; their results are identical.
//
// Growth animation: upstream paints the plant on scratch layers, filters
// them, and blits the result in one go, so there is no stroke order to
// replay. Instead we snapshot the bare paper just before the plant is drawn,
// diff it against the finished painting to find plant pixels, and measure
// each one's distance from the stem base *along the plant* (BFS on a coarse
// grid). The painting is then revealed in that order, so it grows up the
// stems and out into leaves and flowers. Each frame copies only the newly
// grown pixels and uploads only the 64px tiles they touched.
(function () {
  "use strict";
  var FILL = 0.88;                                   // painting height as a fraction of the screen
  var dpr = window.devicePixelRatio || 1;
  var K = Math.max(1, Math.min(4, Math.ceil(Math.min(innerWidth, innerHeight) * dpr * FILL / 600)));
  var genStart = null, genMs = null;
  var GROW_S = 25;            // seconds for the plant to grow
  var GROW_DELAY_S = 3.5;     // let the card fade or crossfade in first
  var rootGuess = null, dbg = null, paperSnap = null, grow = null, started = true, raf = null;   // self-start; the shell's start() may arrive before load

  function k(ctx) { return ctx.canvas.__k || 1; }

  Layer.empty = function (w, h) {
    w = (w != undefined) ? w : 600;
    h = (h != undefined) ? h : w;
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(w * K);
    canvas.height = Math.round(h * K);
    canvas.__k = K;
    var ctx = canvas.getContext("2d");
    ctx.scale(K, K);
    window.context = ctx;                            // upstream leaks this global; keep it
    return ctx;
  };

  Layer.blit = function (ctx0, ctx1, args) {
    args = (args != undefined) ? args : {};
    var ble = (args.ble != undefined) ? args.ble : "normal";
    var xof = (args.xof != undefined) ? args.xof : 0;
    var yof = (args.yof != undefined) ? args.yof : 0;
    ctx0.globalCompositeOperation = ble;
    var c = ctx1.canvas, s = k(ctx1);
    // woody() and herbal() grow every plant from (0.5, 0.7) of their scratch
    // layer, so the paste offset tells us where the plant's root lands.
    if (ctx0 === window.CTX) rootGuess = { x: xof + (c.width / s) * 0.5, y: yof + (c.height / s) * 0.7 };
    ctx0.drawImage(c, xof, yof, c.width / s, c.height / s);
  };

  Layer.filter = function (ctx, f) {
    var W = ctx.canvas.width, H = ctx.canvas.height, s = k(ctx);
    var imgd = ctx.getImageData(0, 0, W, H), pix = imgd.data;
    for (var y = 0, i = 0; y < H; y++) {
      for (var x = 0; x < W; x++, i += 4) {
        var o = f(x / s, y / s, pix[i], pix[i + 1], pix[i + 2], pix[i + 3]);
        pix[i] = o[0]; pix[i + 1] = o[1]; pix[i + 2] = o[2]; pix[i + 3] = o[3];
      }
    }
    ctx.putImageData(imgd, 0, 0);
  };

  Layer.border = function (ctx, f) {
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var imgd = ctx.getImageData(0, 0, W, H), pix = imgd.data;
    for (var y = 0, i = 0; y < H; y++) {
      var ny = (y / H - 0.5) * 2;
      for (var x = 0; x < W; x++, i += 4) {
        var nx = (x / W - 0.5) * 2;
        if (Math.hypot(nx, ny) > f(Math.atan2(ny, nx))) { pix[i] = pix[i + 1] = pix[i + 2] = pix[i + 3] = 0; }
      }
    }
    ctx.putImageData(imgd, 0, 0);
  };

  Layer.bound = function (ctx) {
    var W = ctx.canvas.width, H = ctx.canvas.height, s = k(ctx);
    var xmin = W, xmax = 0, ymin = H, ymax = 0;
    var pix = ctx.getImageData(0, 0, W, H).data;
    for (var y = 0, i = 3; y < H; y++) {
      for (var x = 0; x < W; x++, i += 4) {
        if (pix[i] > 0.001) {
          if (x < xmin) xmin = x; if (x > xmax) xmax = x;
          if (y < ymin) ymin = y; if (y > ymax) ymax = y;
        }
      }
    }
    return { xmin: xmin / s, xmax: xmax / s, ymin: ymin / s, ymax: ymax / s };
  };

  // --- growth animation --------------------------------------------------
  ["woody", "herbal"].forEach(function (name) {
    var orig = window[name];
    window[name] = function (args) {
      if (args && args.ctx === window.CTX) {
        var c = args.ctx.canvas;
        paperSnap = args.ctx.getImageData(0, 0, c.width, c.height);
      }
      return orig.apply(this, arguments);
    };
  });

  function prepareGrowth(ctx) {
    var c = ctx.canvas, W = c.width, H = c.height;
    var Fimg = ctx.getImageData(0, 0, W, H), F = Fimg.data, P = paperSnap.data;
    var gw = Math.ceil(W / K), gh = Math.ceil(H / K), cells = gw * gh;
    var mask = new Uint8Array(cells), diff = new Uint8Array(W * H);
    for (var y = 0, i = 0, p = 0; y < H; y++) {
      var row = ((y / K) | 0) * gw;
      for (var x = 0; x < W; x++, i += 4, p++) {
        if (F[i + 3] === 0) { P[i] = P[i + 1] = P[i + 2] = P[i + 3] = 0; continue; }   // outside the border
        var d = Math.abs(F[i] - P[i]) + Math.abs(F[i + 1] - P[i + 1]) + Math.abs(F[i + 2] - P[i + 2]);
        if (d > 0) diff[p] = 1;
        if (d > 18) mask[row + ((x / K) | 0)] = 1;
      }
    }
    // Bridge hairline gaps between petals, leaves and stems.
    var dil = new Uint8Array(cells);
    for (var gy = 0; gy < gh; gy++) for (var gx = 0; gx < gw; gx++) {
      if (!mask[gy * gw + gx]) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
        var yy = gy + dy, xx = gx + dx;
        if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) dil[yy * gw + xx] = 1;
      }
    }
    // Geodesic distance from the stem base through the plant: Dijkstra on the
    // grid with true Euclidean step lengths over a 16-neighbourhood, so fronts
    // spread as rounded curves instead of squares. Any component still
    // unreached afterwards grows from its own lowest cell.
    var INF = 1e9, dist = new Float64Array(cells).fill(INF), maxD = 0;
    var NB16 = [];
    [[1,0],[0,1],[1,1],[1,-1],[2,1],[1,2],[2,-1],[1,-2]].forEach(function (v) {
      NB16.push([v[0], v[1]], [-v[0], -v[1]]);
    });
    NB16.forEach(function (v) { v.push(Math.hypot(v[0], v[1])); });
    var cap = cells * 4, heapK = new Float64Array(cap), heapV = new Int32Array(cap), hn = 0;
    function push(key, val) {
      if (hn >= cap) {                                   // grow (rare)
        var k2 = new Float64Array(cap * 2), v2 = new Int32Array(cap * 2);
        k2.set(heapK); v2.set(heapV); heapK = k2; heapV = v2; cap *= 2;
      }
      var i = hn++;
      while (i > 0) { var pa = (i - 1) >> 1; if (heapK[pa] <= key) break;
        heapK[i] = heapK[pa]; heapV[i] = heapV[pa]; i = pa; }
      heapK[i] = key; heapV[i] = val;
    }
    function pop() {
      var topV = heapV[0]; hn--;
      var lastK = heapK[hn], lastV = heapV[hn], n = hn;
      if (n > 0) {
        var i = 0;
        for (;;) { var l = 2 * i + 1, r = l + 1, m = i, mk = lastK;
          if (l < n && heapK[l] < mk) { m = l; mk = heapK[l]; }
          if (r < n && heapK[r] < mk) { m = r; }
          if (m === i) break;
          heapK[i] = heapK[m]; heapV[i] = heapV[m]; i = m; }
        heapK[i] = lastK; heapV[i] = lastV;
      }
      return topV;
    }
    function dijkstra(sources, base) {
      sources.forEach(function (s0) { if (dist[s0] > base) { dist[s0] = base; push(base, s0); } });
      while (hn > 0) {
        var dk = heapK[0], cur = pop();
        if (dk > dist[cur]) continue;
        var cx = cur % gw, cy = (cur / gw) | 0;
        for (var e = 0; e < NB16.length; e++) {
          var nx = cx + NB16[e][0], ny = cy + NB16[e][1];
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          var n = ny * gw + nx;
          if (!dil[n]) continue;
          var nd = dk + NB16[e][2];
          if (nd < dist[n]) { dist[n] = nd; if (nd > maxD) maxD = nd; push(nd, n); }
        }
      }
    }
    var lowest = -1;
    for (var q = cells - 1; q >= 0; q--) if (mask[q]) { lowest = (q / gw) | 0; break; }
    if (lowest < 0) return null;
    // Start at the plant pixel nearest the true root (the stem base, or where
    // the stem enters the frame if the root is outside it); fall back to the
    // lowest row of the plant.
    var base = [];
    if (rootGuess) {
      var best = -1, bestD = INF;
      for (var m2 = 0; m2 < cells; m2++) {
        if (!mask[m2]) continue;
        var ddx2 = (m2 % gw) + 0.5 - rootGuess.x, ddy2 = ((m2 / gw) | 0) + 0.5 - rootGuess.y, dd = ddx2 * ddx2 + ddy2 * ddy2;
        if (dd < bestD) { bestD = dd; best = m2; }
      }
      if (best >= 0) base.push(best);
    }
    if (!base.length) for (var bx = 0; bx < gw; bx++) if (mask[lowest * gw + bx]) base.push(lowest * gw + bx);
    dijkstra(base, 0);
    var comps = 1, mainMax = maxD;
    for (var r = cells - 1; r >= 0; r--) if (dil[r] && dist[r] >= INF) { comps++; dijkstra([r], maxD * 0.5); }
    dbg = { root: rootGuess ? [Math.round(rootGuess.x), Math.round(rootGuess.y)] : null,
            start: base.length ? [base[0] % gw, (base[0] / gw) | 0] : null, comps: comps, baseCells: base.length, lowestRow: lowest, gh: gh, mainMax: Math.round(mainMax), maxD: Math.round(maxD) };

    // Per-pixel growth time: bilinear blend of the four surrounding cell
    // centres (skipping cells outside the plant), plus slow noise so the
    // advancing edge wobbles like spreading ink, plus a touch of grain.
    function cellD(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return INF;
      return dist[gy * gw + gx];
    }
    var WOBBLE = 7, GRAIN = 1.2;
    var NB = 1500, span = maxD + WOBBLE + GRAIN + 1, counts = new Int32Array(NB + 1), when = new Uint16Array(W * H);
    for (var pp = 0, n2 = W * H; pp < n2; pp++) {
      if (!diff[pp]) continue;
      var lx = (pp % W) / K - 0.5, ly = ((pp / W) | 0) / K - 0.5;
      var x0 = Math.floor(lx), y0 = Math.floor(ly), fx = lx - x0, fy = ly - y0;
      var acc = 0, wsum = 0, dv, wt;
      dv = cellD(x0, y0);         wt = (1 - fx) * (1 - fy); if (dv < INF) { acc += dv * wt; wsum += wt; }
      dv = cellD(x0 + 1, y0);     wt = fx * (1 - fy);       if (dv < INF) { acc += dv * wt; wsum += wt; }
      dv = cellD(x0, y0 + 1);     wt = (1 - fx) * fy;       if (dv < INF) { acc += dv * wt; wsum += wt; }
      dv = cellD(x0 + 1, y0 + 1); wt = fx * fy;             if (dv < INF) { acc += dv * wt; wsum += wt; }
      var t = wsum > 0 ? acc / wsum : maxD;
      t += WOBBLE * Noise.noise(lx * 0.07, ly * 0.07, 7.3) + GRAIN * Math.random();
      var bkt = Math.max(0, Math.min(NB - 1, Math.floor(t / span * NB)));
      when[pp] = bkt; counts[bkt + 1]++;
    }
    for (var cb = 0; cb < NB; cb++) counts[cb + 1] += counts[cb];
    var order = new Int32Array(counts[NB]), fillAt = counts.slice(0, NB);
    var tot = counts[NB], pct = [10, 25, 50, 75, 90, 99].map(function (q) {
      var want = tot * q / 100, lo = 0; while (lo < NB && counts[lo + 1] < want) lo++; return Math.round(100 * lo / NB);
    });
    dbg.pixels = tot; dbg.bucketPctAtPixelPct_10_25_50_75_90_99 = pct.join("/");
    for (var p3 = 0, n3 = W * H; p3 < n3; p3++) if (diff[p3]) order[fillAt[when[p3]]++] = p3;
    return { ctx: ctx, W: W, H: H, Fimg: Fimg, F: F, D: paperSnap, order: order, starts: counts,
             NB: NB, next: 0, t0: null, done: false };
  }

  var TILE = 64, fr = { n: 0, maxGap: 0, last: null, worstMs: 0 };
  function growFrame(now) {
    raf = null;
    var g = grow, w0 = performance.now();
    if (g && g.t0 !== null && now >= g.t0) {
      if (fr.last !== null) { fr.n++; fr.maxGap = Math.max(fr.maxGap, now - fr.last); }
      fr.last = now;
    }
    if (!g || g.done || !started) return;
    if (g.t0 === null) g.t0 = now + GROW_DELAY_S * 1000;
    var prog = Math.max(0, (now - g.t0) / (GROW_S * 1000));
    var target = Math.min(g.NB, Math.floor(prog * g.NB));
    if (target > g.next) {
      var tw = Math.ceil(g.W / TILE), dirty = {}, F = g.F, D = g.D.data;
      for (var k2 = g.starts[g.next], end = g.starts[target]; k2 < end; k2++) {
        var p4 = g.order[k2], i4 = p4 * 4;
        D[i4] = F[i4]; D[i4 + 1] = F[i4 + 1]; D[i4 + 2] = F[i4 + 2]; D[i4 + 3] = F[i4 + 3];
        dirty[((((p4 / g.W) | 0) / TILE) | 0) * tw + (((p4 % g.W) / TILE) | 0)] = 1;
      }
      for (var key in dirty) {
        var tx = (key % tw) * TILE, ty = ((key / tw) | 0) * TILE;
        g.ctx.putImageData(g.D, 0, 0, tx, ty, TILE, TILE);
      }
      g.next = target;
      fr.worstMs = Math.max(fr.worstMs, performance.now() - w0);
    }
    if (g.next >= g.NB) { g.ctx.putImageData(g.Fimg, 0, 0); g.done = true; g.D = g.order = null; return; }
    raf = requestAnimationFrame(growFrame);
  }

  // Time generation, set up growth, and flag readiness for the shell's crossfade.
  var origGenerate = window.generate;
  window.generate = function () {
    genStart = performance.now();
    var r = origGenerate.apply(this, arguments);
    if (paperSnap) {
      grow = prepareGrowth(window.CTX);
      if (grow) window.CTX.putImageData(grow.D, 0, 0);   // start from bare paper
    }
    genMs = Math.round(performance.now() - genStart);
    return r;
  };

  var css = document.createElement("style");
  css.textContent =
    "#loader, #options, #summary, #settings, #share, #content > div:not(#canvas-container), #content table { display: none !important; }" +
    "html, body { margin: 0; height: 100%; overflow: hidden; }" +
    "#canvas-container { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }" +
    "#canvas-container canvas { width: " + (FILL * 100) + "vmin; height: " + (FILL * 100) + "vmin; opacity: 0; transition: opacity 3s ease; }" +
    "#canvas-container canvas.shown { opacity: 1; }";
  document.head.appendChild(css);

  new MutationObserver(function (_, obs) {
    var c = document.querySelector("#canvas-container canvas");
    if (!c) return;
    obs.disconnect();
    requestAnimationFrame(function () {
      c.classList.add("shown");
      window.__saverReady = true;
      if (started && raf === null) raf = requestAnimationFrame(growFrame);
    });
  }).observe(document.getElementById("canvas-container"), { childList: true });

  window.__saver = {
    start: function () { started = true; if (raf === null) raf = requestAnimationFrame(growFrame); },
    stop: function () { started = false; if (raf !== null) { cancelAnimationFrame(raf); raf = null; } },
    stats: function () {
      return { K: K, genMs: genMs, ready: window.__saverReady === true,
               grown: grow ? Math.round(100 * grow.next / grow.NB) : null,
               dbg: dbg, growFrames: fr.n, maxGapMs: Math.round(fr.maxGap), worstFrameMs: Math.round(fr.worstMs),
               w: innerWidth, h: innerHeight };
    }
  };
})();
