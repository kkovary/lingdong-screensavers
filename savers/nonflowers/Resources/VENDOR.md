# Vendored upstream

- Source: https://github.com/LingDong-/nonflowers
- File: main.js (verbatim, unmodified)
- Commit: 03b653d220f16c6bed7ea9c7edc852f7e91846cb
- License: MIT, Copyright (c) 2018 Lingdong Huang

Everything else is ours. `gallery.html`/`gallery.js` lay out a wall of paintings that grow, rest and are replaced. Paintings are made off the main thread by workers built from `src/worker-shim.js` + `main.js` + `src/paint-worker.js`, bundled by `prebuild.sh` into the generated `worker.src.js`.
