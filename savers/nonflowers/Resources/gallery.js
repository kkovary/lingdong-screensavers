// A wall of Nonflowers paintings that grow, rest, and are replaced.
//
// Paintings are generated off the main thread by a small pool of workers
// (see src/paint-worker.js), which also compute a per-pixel growth-time map.
// Each card uploads three textures once (bare paper, finished painting, time
// map) and one WebGL canvas draws the whole wall: a shader shows the finished
// painting wherever time <= progress, feathering the edge. Per frame the CPU
// only sets a few uniforms per card. Finished cards drop the paper and time
// textures. All timing runs on our own clock that advances only while the
// saver is running, so stop/start pauses cleanly.
(function () {
  "use strict";
  var GROW_S = [16, 34];      // random growth duration per painting
  var HOLD_S = [35, 80];      // how long a finished painting rests: most of the wall is still
  var BUSY_SHARE = 0.2;       // at most this share of cards growing or changing at once (calmer than the fish)
  var START_DONE = 0.6;       // share of cards that open already in bloom, mid-rest
  var PREFETCH_S = 15;        // ask for the next painting this long before a rest ends
  var FADE_S = 2.5;           // card fade in/out
  var FEATHER = 0.006;        // width of the soft growth edge, as a fraction of growth time

  var dpr = window.devicePixelRatio || 1;
  var W = innerWidth, H = innerHeight;
  var rows = H >= 1100 ? 3 : 2;
  var card = Math.floor(H * 0.86 / rows);
  var gap = Math.round(card * 0.12);
  var cols = Math.max(1, Math.floor((W - gap) / (card + gap)));
  var K = Math.max(1, Math.min(3, Math.ceil(card * dpr / 600)));
  var x0 = (W - (cols * card + (cols - 1) * gap)) / 2;
  var y0 = (H - (rows * card + (rows - 1) * gap)) / 2;

  function rand(r) { return r[0] + Math.random() * (r[1] - r[0]); }
  function seed() { return Date.now() + "-" + Math.random().toString(36).slice(2); }

  // --- worker pool ---------------------------------------------------------
  var src = URL.createObjectURL(new Blob([self.NF_WORKER_SRC], { type: "text/javascript" }));
  var POOL = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
  var workers = [], idle = [], queue = [], waiting = {}, nextId = 1, errors = [];
  var stats = { made: 0, genMs: 0, frames: 0, maxGap: 0, worstMs: 0, since: null };

  function dispatch() {
    while (idle.length && queue.length) {
      var w = idle.pop(), job = queue.shift();
      w.postMessage(job.msg);
    }
  }
  function request(msg, cb) {
    msg.id = nextId++;
    waiting[msg.id] = cb;
    queue.push({ msg: msg });
    dispatch();
  }
  for (var wi = 0; wi < POOL; wi++) {
    var w = new Worker(src);
    w.onmessage = function (e) {
      var m = e.data;
      idle.push(this);
      if (m.cmd === "paper") { setPaper(m); }
      else if (waiting[m.id]) { var cb = waiting[m.id]; delete waiting[m.id]; cb(m); }
      dispatch();
    };
    w.onerror = function (e) { errors.push((e.message || "?") + " @" + e.lineno + ":" + e.colno); };
    workers.push(w); idle.push(w);
  }

  function setPaper(m) {
    var c = document.createElement("canvas");
    c.width = m.w; c.height = m.h;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(m.buf), m.w, m.h), 0, 0);
    document.body.style.backgroundImage = "url(" + c.toDataURL("image/png") + ")";
  }
  idle.pop().postMessage({ cmd: "paper", seed: seed() });

  // --- WebGL wall ----------------------------------------------------------
  var canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;";
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  document.getElementById("wall").appendChild(canvas);
  var gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) { errors.push("no webgl2"); return; }

  function shader(type, src) {
    var sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) errors.push(gl.getShaderInfoLog(sh));
    return sh;
  }
  var prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER,
    "#version 300 es\n" +
    "in vec2 aPos; uniform vec4 uRect; uniform vec2 uView; out vec2 vUV;\n" +
    "void main(){ vUV = aPos; vec2 px = uRect.xy + aPos * uRect.zw;\n" +
    "  gl_Position = vec4(px / uView * 2.0 - 1.0, 0.0, 1.0); gl_Position.y = -gl_Position.y; }"));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER,
    "#version 300 es\nprecision highp float;\n" +
    "uniform sampler2D uF, uP, uT; uniform float uProg, uAlpha, uFeather; uniform int uDone;\n" +
    "in vec2 vUV; out vec4 o;\n" +
    "void main(){ vec4 f = texture(uF, vUV);\n" +
    "  if (uDone == 1) { o = f * uAlpha; return; }\n" +
    "  vec4 p = texture(uP, vUV); vec2 tt = texture(uT, vUV).rg * 255.0;\n" +
    "  float t = (tt.r * 256.0 + tt.g) / 65535.0;\n" +
    "  float m = t == 0.0 ? 1.0 : clamp((uProg - t) / uFeather, 0.0, 1.0);\n" +
    "  o = mix(p, f, m) * uAlpha; }"));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) errors.push(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  var U = {};
  ["uRect", "uView", "uF", "uP", "uT", "uProg", "uAlpha", "uFeather", "uDone"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
  var vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(U.uF, 0); gl.uniform1i(U.uP, 1); gl.uniform1i(U.uT, 2);
  gl.uniform2f(U.uView, canvas.width, canvas.height);
  gl.uniform1f(U.uFeather, FEATHER);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied

  function texture(w, h, data, rgba) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (rgba) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } else {                                   // time map: exact bytes, no filtering
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  var cards = [];
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
    cards.push({ x: (x0 + c * (card + gap)) * dpr, y: (y0 + r * (card + gap)) * dpr, s: card * dpr,
                 state: "waiting", at: 0, fadeFrom: 0, fadeTo: 0, fadeAt: 0, tex: null, grow: null, next: null });
  }

  function askFor(cd) {
    cd.next = "pending";
    request({ cmd: "paint", K: K, seed: seed() }, function (m) {
      if (m.failed) { cd.next = null; if (m.error) errors.push(m.error); return; }
      stats.made++; stats.genMs = m.genMs;
      cd.next = m;
    });
  }

  function freeTex(cd) {
    if (!cd.tex) return;
    [cd.tex.F, cd.tex.P, cd.tex.T].forEach(function (t) { if (t) gl.deleteTexture(t); });
    cd.tex = null;
  }

  function install(cd, m) {
    freeTex(cd);
    cd.tex = { F: texture(m.W, m.H, new Uint8Array(m.F), true),
               P: texture(m.W, m.H, new Uint8Array(m.P), true),
               T: texture(m.W, m.H, new Uint8Array(m.T), false) };
    cd.grow = { prog: 0, dur: rand(GROW_S), start: 0 };
    cd.next = null;
  }

  function fade(cd, to) { cd.fadeFrom = alpha(cd); cd.fadeTo = to; cd.fadeAt = clock; }
  function alpha(cd) {
    var k = Math.min(1, (clock - cd.fadeAt) / FADE_S);
    k = k * k * (3 - 2 * k);
    return cd.fadeFrom + (cd.fadeTo - cd.fadeFrom) * k;
  }

  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    for (var i = 0; i < cards.length; i++) {
      var cd = cards[i], a = alpha(cd);
      if (!cd.tex || a <= 0.001) continue;
      var done = !cd.grow;
      gl.uniform4f(U.uRect, cd.x, cd.y, cd.s, cd.s);
      gl.uniform1f(U.uAlpha, a);
      gl.uniform1i(U.uDone, done ? 1 : 0);
      gl.uniform1f(U.uProg, done ? 2 : cd.grow.prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cd.tex.F);
      if (!done) {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cd.tex.P);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, cd.tex.T);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  // State machine per card, on our own clock (seconds).
  var MAX_BUSY = Math.max(1, Math.round(cards.length * BUSY_SHARE));
  function busy() {
    var n = 0;
    for (var i = 0; i < cards.length; i++) { var st = cards[i].state; if (st === "pregrow" || st === "grow" || st === "fadeout") n++; }
    return n;
  }
  function finishGrowth(cd) {                     // drop the textures only growth needs
    gl.deleteTexture(cd.tex.P); gl.deleteTexture(cd.tex.T); cd.tex.P = cd.tex.T = null;
    cd.grow = null;
  }

  var clock = 0, last = null, raf = null;
  function tick(nowMs) {
    raf = requestAnimationFrame(tick);
    var w0 = performance.now();
    if (last !== null) {
      var gapMs = nowMs - last;
      stats.frames++; if (gapMs > stats.maxGap) stats.maxGap = gapMs;
      clock += Math.min(gapMs / 1000, 0.1);
    }
    if (stats.since === null) stats.since = nowMs;
    last = nowMs;

    for (var i = 0; i < cards.length; i++) {
      var cd = cards[i];
      switch (cd.state) {
        case "waiting":                                   // first painting for this card
          if (cd.next === null) askFor(cd);
          else if (cd.next !== "pending") {
            install(cd, cd.next); fade(cd, 1);
            // Open at a random point in the cycle: most cards already in bloom and
            // partway through resting, the rest growing as slots allow.
            if (Math.random() < START_DONE || busy() >= MAX_BUSY) {
              finishGrowth(cd); cd.state = "hold"; cd.at = clock + Math.random() * rand(HOLD_S);
            } else {
              cd.state = "pregrow"; cd.at = clock + FADE_S + Math.random() * 6;
            }
          }
          break;
        case "pregrow":
          if (clock >= cd.at) { cd.state = "grow"; cd.grow.start = clock; }
          break;
        case "grow":
          // Slight ease-out so growth settles rather than stopping dead.
          var lin = Math.min(1, (clock - cd.grow.start) / cd.grow.dur);
          cd.grow.prog = (1 - Math.pow(1 - lin, 1.6)) * (1 + 2 * FEATHER);
          if (lin >= 1) { finishGrowth(cd); cd.state = "hold"; cd.at = clock + rand(HOLD_S); }
          break;
        case "hold":
          // Fetch the next painting shortly before the rest ends (also retries a failed one),
          // then change only when a growth slot is free.
          if (cd.next === null && clock >= cd.at - PREFETCH_S) askFor(cd);
          if (clock >= cd.at && cd.next && cd.next !== "pending" && busy() < MAX_BUSY) {
            fade(cd, 0); cd.state = "fadeout"; cd.at = clock + FADE_S;
          }
          break;
        case "fadeout":
          if (clock >= cd.at) {
            install(cd, cd.next); fade(cd, 1);
            cd.state = "pregrow"; cd.at = clock + FADE_S + Math.random() * 2;
          }
          break;
      }
    }
    draw();
    stats.worstMs = Math.max(stats.worstMs, performance.now() - w0);
  }

  window.__saver = {
    start: function () { if (raf === null) { last = null; raf = requestAnimationFrame(tick); } },
    stop: function () { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } },
    stats: function () {
      var secs = stats.since === null ? 0 : (performance.now() - stats.since) / 1000;
      var by = {};
      cards.forEach(function (c) { by[c.state] = (by[c.state] || 0) + 1; });
      var out = { grid: cols + "x" + rows, maxBusy: MAX_BUSY, card: card, K: K, pool: POOL, made: stats.made, lastGenMs: stats.genMs,
                  fps: Math.round(stats.frames / Math.max(secs, 0.001)), maxGapMs: Math.round(stats.maxGap),
                  worstFrameMs: Math.round(stats.worstMs), states: by, queued: queue.length,
                  errors: errors.slice(-3) };
      stats.frames = 0; stats.maxGap = 0; stats.worstMs = 0; stats.since = null;
      return out;
    }
  };
  window.__saverReady = true;
  window.__saver.start();
})();
