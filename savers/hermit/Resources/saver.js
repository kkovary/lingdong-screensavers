// Hermit screensaver — Pyodide + pygame-ce bridge
(async function () {
  "use strict";

  const CANVAS_W = 640, CANVAS_H = 370;
  const startTime = performance.now();
  let pyodide = null;
  let running = false;

  // Stats exposed to the shell probe
  const stats = { fps: 0, frames: 0, startupMs: 0, phase: "init", error: null };

  window.__saver = {
    start()  { running = true; },
    stop()   { running = false; },
    stats()  { return stats; },
  };
  window.__saverReady = false;

  // Scale canvas to fill the viewport, preserving aspect ratio
  function fitCanvas() {
    const c = document.getElementById("canvas");
    if (!c) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const aspect = CANVAS_W / CANVAS_H;
    let w, h;
    if (vw / vh > aspect) {
      h = vh; w = h * aspect;
    } else {
      w = vw; h = w / aspect;
    }
    c.style.width  = Math.round(w) + "px";
    c.style.height = Math.round(h) + "px";
  }
  fitCanvas();
  window.addEventListener("resize", fitCanvas);

  try {
    // Phase 1: Load Pyodide core
    // Pre-fetch python_stdlib.zip as a blob URL (belt-and-suspenders
    // alongside the global fetch patch in index.html).
    stats.phase = "prefetch_stdlib";
    const stdlibResp = await fetch("pyodide/python_stdlib.zip");
    const stdlibBlob = await stdlibResp.blob();
    const stdlibBlobUrl = URL.createObjectURL(stdlibBlob);

    stats.phase = "loading_pyodide";
    pyodide = await loadPyodide({
      indexURL: "pyodide/",
      stdLibURL: stdlibBlobUrl,
      stdout: () => {},
      stderr: () => {},
    });
    stats.phase = "pyodide_loaded_" + ((performance.now() - startTime) | 0) + "ms";

    // Phase 2: Load packages (the global fetch() patch makes this work on file://)
    stats.phase = "loading_packages";
    await pyodide.loadPackage(["numpy", "pygame-ce"]);
    stats.phase = "packages_loaded_" + ((performance.now() - startTime) | 0) + "ms";

    // Phase 3: Load Python source files into Pyodide VFS
    stats.phase = "loading_sources";
    const files = [
      "hermit/main.py",
      "hermit/lib/__init__.py",
      "hermit/lib/settings.py",
      "hermit/lib/noise.py",
      "hermit/lib/parse.py",
      "hermit/lib/utilities.py",
      "hermit/lib/filter.py",
      "hermit/lib/font.py",
      "hermit/lib/pattern.py",
      "hermit/lib/particle.py",
      "hermit/lib/projectile.py",
      "hermit/lib/tree.py",
      "hermit/lib/creature.py",
    ];

    const FS = pyodide.FS;
    try { FS.mkdir("/hermit"); } catch(e) {}
    try { FS.mkdir("/hermit/lib"); } catch(e) {}

    for (const f of files) {
      const resp = await fetch(f);
      const text = await resp.text();
      FS.writeFile("/" + f, text);
    }
    stats.phase = "sources_loaded_" + ((performance.now() - startTime) | 0) + "ms";

    // Phase 4: Set up canvas for pygame-ce / SDL2
    stats.phase = "setting_canvas";
    const canvas = document.getElementById("canvas");
    if (pyodide.canvas && pyodide.canvas.setCanvas2D) {
      pyodide.canvas.setCanvas2D(canvas);
    } else {
      throw new Error("pyodide.canvas.setCanvas2D not available");
    }

    // Capture stdout/stderr for diagnostics
    let stderrBuf = [];
    pyodide.setStdout({ batched: () => {} });
    pyodide.setStderr({ batched: (line) => {
      stderrBuf.push(line);
      if (stderrBuf.length > 20) stderrBuf.shift();
      stats.stderr = stderrBuf.join(" | ").substring(0, 400);
    }});

    // Phase 5: Run the game
    stats.phase = "running_game";
    stats.startupMs = performance.now() - startTime;
    window.__saverReady = true;
    running = true;

    // Poll stats from Python every second
    const statsPoll = setInterval(() => {
      try {
        const s = pyodide.runPython("import json; json.dumps(_stats)");
        const d = JSON.parse(s);
        stats.fps = d.fps;
        stats.frames = d.frames;
      } catch (e) {}
    }, 1000);

    // Execute main.py (it starts its own async loop via asyncio.ensure_future)
    await pyodide.runPythonAsync(`
import sys, os
sys.path.insert(0, "/hermit")
os.chdir("/hermit")
exec(open("/hermit/main.py").read())
`);
    stats.phase = "running";

  } catch (err) {
    const failedAt = stats.phase;
    stats.phase = "error@" + failedAt;
    let errMsg = "";
    if (err instanceof Error) {
      errMsg = err.message + " | " + (err.stack || "").split("\n").slice(0, 3).join(" / ");
    } else if (typeof err === "string") {
      errMsg = err;
    } else {
      try { errMsg = JSON.stringify(err); } catch(e2) { errMsg = String(err); }
    }
    stats.error = errMsg.substring(0, 500);
    // Draw error on canvas as fallback
    try {
      const c = document.getElementById("canvas");
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#F0F0F0"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#999"; ctx.font = "12px monospace";
      const lines = (failedAt + ": " + errMsg).match(/.{1,76}/g) || [errMsg];
      for (let i = 0; i < Math.min(lines.length, 20); i++) {
        ctx.fillText(lines[i], 10, 20 + i * 16);
      }
    } catch (e2) {}
  }
})();
