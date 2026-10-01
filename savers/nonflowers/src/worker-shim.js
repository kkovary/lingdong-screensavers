// Runs before upstream main.js inside a Web Worker, so main.js can load
// unmodified: it creates canvases via document.createElement and reads the
// page URL for a ?seed= argument. Everything else it touches lives in
// functions we never call from the worker (UI, download, page background).
self.window = self;
self.document = {
  createElement: function (tag) {
    if (tag === "canvas") return new OffscreenCanvas(300, 150);
    return { style: {}, appendChild: function () {} };
  },
  getElementById: function () { return null; },
  body: { style: {}, appendChild: function () {} }
};
