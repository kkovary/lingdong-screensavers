# Lingdong screensavers

Native macOS screensavers made from [Lingdong Huang](https://github.com/LingDong-)'s generative art. Each one is a small `.saver` bundle that hosts the original JavaScript in a WKWebView, with behaviour added around it rather than inside it.

| Saver | Upstream | What it does |
|---|---|---|
| Shan Shui | [shan-shui-inf](https://github.com/LingDong-/shan-shui-inf) | An endless Chinese landscape scroll that pans smoothly across the screen. |
| Fish Draw | [fishdraw](https://github.com/LingDong-/fishdraw) | Plots one invented fish at a time, stroke by stroke like a pen plotter, with its Latin name. |
| Nonflowers | [nonflowers](https://github.com/LingDong-/nonflowers) | A wall of Gongbi-style flower paintings that grow from the stem, rest, and are replaced. |

Apple silicon, macOS 14 or later. Needs only the Command Line Tools, not Xcode.

## Use

```
make install              # build, ad-hoc sign and install every saver
make install-fishdraw     # just one
make preview-nonflowers   # run one in a window, no screensaver engine
make uninstall
```

Then pick one in System Settings > Wallpaper > Screen Saver. The bundles are ad-hoc signed and built locally, so Gatekeeper normally leaves them alone.

## Layout

```
shell/WebSaverView.swift   generic ScreenSaverView hosting a WKWebView
shell/main.swift           preview host used by make preview-<id>
shell/Info.plist.in        bundle template
scripts/build-saver.sh     builds one saver from savers/<id>
savers/<id>/saver.conf     name, class, bundle id, background, page, cycle
savers/<id>/Resources/     shipped into the bundle; upstream files verbatim
savers/<id>/prebuild.sh    optional generated-resource step
savers/<id>/VENDOR.md      upstream commit and what we changed around it
```

Each saver gets a generated subclass with its own `@objc` class name. macOS can load several third-party savers into one host process, and identical class names would collide.

## Things worth knowing

- **WebKit thinks the page is hidden.** Inside Apple's `legacyScreenSaver` host, WebKit reports the page as hidden even though it is on screen, so `requestAnimationFrame` never fires and animations freeze after one frame. The shell turns off WKWebView's window-occlusion detection, a private setter, guarded so a future WebKit that drops it degrades to a still image instead of crashing.
- **Smoothness comes from the compositor, not redraws.** Shan Shui pans pre-rendered segments with Web Animations and swaps double buffers with phase-locked start times. Nonflowers reveals paintings in a WebGL shader from a precomputed growth-time map. In both, the expensive generation happens off the critical path.
- **Workers must be Blob workers.** WKWebView blocks workers loaded from `file://` URLs. Nonflowers bundles its worker source into `worker.src.js` at build time and starts it from a Blob URL.
- **Debugging.** Every saver logs its page state every 10 seconds under its bundle id. Use the full path, because in zsh `log` is a shell builtin:

  ```
  /usr/bin/log show --last 5m --predicate 'subsystem == "io.kylekovary.Nonflowers"' --style compact
  ```

## Credits

All art and generation code is by Lingdong Huang, MIT licensed. Each saver keeps the upstream license as `UPSTREAM-LICENSE` and records the vendored commit in `Resources/VENDOR.md`. Shan Shui's easter-egg roof sign reads "Octant" here instead of "Pizza Hut".
