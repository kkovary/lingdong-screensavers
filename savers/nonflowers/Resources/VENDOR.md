# Vendored upstream

- Source: https://github.com/LingDong-/nonflowers
- Files: index.html, main.js, style.css, fonts/MaterialIcons-Regular.ttf (verbatim, unmodified)
- Commit: 03b653d220f16c6bed7ea9c7edc852f7e91846cb
- License: MIT, Copyright (c) 2018 Lingdong Huang

saver.js is ours, injected at document end. It hides the UI, centres the painting, and renders it at high resolution by wrapping upstream's `Layer` helpers (see the comments there). The shell's cycle mode loads a fresh copy of the page every 120 s and crossfades to it once `window.__saverReady` is set.
