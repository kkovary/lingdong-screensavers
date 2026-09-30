// Injected into shan-shui-inf at document end by ShanShuiView.
// Hides the page UI, scales the 3000x800 canvas to cover the viewport,
// and drives a smooth time-based drift instead of the page's step buttons.
(function () {
  "use strict";
  var W = 3000, H = 800;           // MEM.windx / MEM.windy in upstream
  var SPEED = 24;                  // svg units per second
  var RERENDER_EVERY = 200;        // px of travel between full update() calls
  var raf = null, last = null, sinceRender = 0;

  function hide(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = "none";
  }

  function fit() {
    var bg = document.getElementById("BG");
    if (!bg) return;
    var s = Math.max(window.innerWidth / W, window.innerHeight / H);
    var x = (window.innerWidth - W * s) / 2;
    var y = (window.innerHeight - H * s) / 2;
    bg.style.cssText =
      "position:fixed;left:0;top:0;width:" + W + "px;height:" + H + "px;" +
      "transform-origin:0 0;transform:translate(" + x + "px," + y + "px) scale(" + s + ");" +
      "background:#fff;";
  }

  function tick(now) {
    if (last !== null) {
      var dt = Math.min((now - last) / 1000, 0.1);
      var dx = SPEED * dt;
      MEM.cursx += dx;
      sinceRender += dx;
      if (sinceRender >= RERENDER_EVERY) { sinceRender = 0; update(); }
      else { viewupdate(); }
    }
    last = now;
    raf = requestAnimationFrame(tick);
  }

  window.__saver = {
    start: function () { if (raf === null) { last = null; raf = requestAnimationFrame(tick); } },
    stop: function () { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } },
    running: function () { return raf !== null; }
  };

  try {
    ["SETTING", "MENU", "SOURCE_BTN", "L", "R"].forEach(hide);
    document.documentElement.style.overflow = "hidden";
    document.body.style.cssText = "margin:0;overflow:hidden;background:#fff;";
    fit();
    window.addEventListener("resize", fit);
    window.__saver.start();
  } catch (e) {
    console.log("saver.js init failed: " + e);
  }
})();
