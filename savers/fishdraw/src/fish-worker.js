// Fish worker: runs upstream fishdraw.js (unmodified) off the main thread.
// Bundled with it by prebuild.sh into Resources/worker.src.js and started
// from a Blob URL (WKWebView blocks workers loaded from file:// URLs).
// Each request returns one new fish: a random binomial name and its
// polylines inside fishdraw's 500x300 frame.
//
// Upstream's polygon tracing (trace_from) recurses once per vertex, so a
// rare, very complex fish overflows a worker's smaller stack. When that
// happens we simply draw a different fish, and we always reply so the
// worker never drops out of the pool.
self.onmessage = function (e) {
  var t0 = performance.now(), polys = null, failures = 0, lastErr = null;
  while (polys === null && failures < 8) {
    try { polys = main(); }
    catch (err) { failures++; lastErr = String(err); }
  }
  self.postMessage({ id: e.data.id, polys: polys, failures: failures, error: polys ? null : lastErr,
                     genMs: Math.round(performance.now() - t0) });
};
