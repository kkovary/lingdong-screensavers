// Fish worker: runs upstream fishdraw.js (unmodified) off the main thread.
// Bundled with it by prebuild.sh into Resources/worker.src.js and started
// from a Blob URL (WKWebView blocks workers loaded from file:// URLs).
// Each request returns one new fish: a random binomial name and its
// polylines inside fishdraw's 500x300 frame.
self.onmessage = function (e) {
  var t0 = performance.now();
  var polys = main();
  self.postMessage({ id: e.data.id, polys: polys, genMs: Math.round(performance.now() - t0) });
};
