# Lingdong screensavers

Native macOS screensavers made from [Lingdong Huang](https://github.com/LingDong-)'s generative art. Each one is a small `.saver` bundle that hosts the original JavaScript in a WKWebView, with behaviour added around it rather than inside it.

| Saver | Upstream | What it does |
|---|---|---|
| Shan Shui | [shan-shui-inf](https://github.com/LingDong-/shan-shui-inf) | An endless Chinese landscape scroll that pans smoothly across the screen. |
| Fish Draw | [fishdraw](https://github.com/LingDong-/fishdraw) | A wall of invented fish, each plotted stroke by stroke like a pen plotter with its Latin name, staggered so most are finished at any moment. |
| Nonflowers | [nonflowers](https://github.com/LingDong-/nonflowers) | A wall of Gongbi-style flower paintings that grow from the stem, rest, and are replaced. |
| Hermit | [Hermit](https://github.com/LingDong-/Hermit) | The 2015 pygame game on autopilot: a rider walks forever through a procedural forest as day turns to night, with random terrain, time of day and wildlife. |
| Lingdong Shuffle | all of the above | Starts on a random one of the four and every 5 minutes picks again at random; picking the current one leaves it running. |

## Setup

**You need:**

- A Mac with Apple silicon (M1 or later) running macOS 14 Sonoma or later. Tested on macOS 27.
- Apple's Command Line Tools. Xcode itself is not needed. Install them with:

  ```
  xcode-select --install
  ```

  This also provides `git`, `make`, `swiftc` and `python3`, which the build uses.
- An internet connection for the first build only. Hermit downloads a pinned Pyodide runtime (about 20 MB) from jsDelivr and checks every file against a SHA-256 checksum.

**Build and install:**

```
git clone https://github.com/kkovary/lingdong-screensavers.git
cd lingdong-screensavers
make install
```

This builds all five savers, signs them locally (ad-hoc), and copies them to `~/Library/Screen Savers`. Nothing is installed system-wide and no password is needed.

**Turn one on:** open System Settings, go to Wallpaper, scroll to Screen Saver, and pick one from the Other section. Hover the thumbnail and click Preview to see it full screen. To start it on demand, set a hot corner under Desktop & Dock > Hot Corners.

**Other commands:**

```
make install-fishdraw     # build and install just one (ids are the folder names in savers/)
make preview-nonflowers   # run one in a normal window, no screensaver engine
make uninstall            # remove all of them from ~/Library/Screen Savers
make clean                # delete build output
```

**Updating:** `git pull && make install`. The install step restarts the screensaver host so the new build loads.

### Troubleshooting

- **A saver doesn't appear in the list.** Quit and reopen System Settings; it only scans `~/Library/Screen Savers` when it opens.
- **"Cannot be opened" or "blocked" warning.** This happens if you copy a built `.saver` from another Mac, because it arrives with a quarantine flag. Build it on the Mac that uses it, or clear the flag: `xattr -dr com.apple.quarantine ~/Library/Screen\ Savers/<Name>.saver`.
- **The picture is frozen or blank.** Every saver logs its state every 10 seconds. Read the log with the full path, since `log` is a zsh builtin:

  ```
  /usr/bin/log show --last 5m --predicate 'subsystem BEGINSWITH "io.kylekovary."' --style compact
  ```

- **Memory.** Hermit runs Python in WebAssembly and uses about 330 MB per screen. The others are much lighter.

### Tuning

The pacing lives near the top of each saver's script: rest and growth times plus how many flowers grow at once in `savers/nonflowers/Resources/gallery.js`, drawing and rest times plus how many fish draw at once in `savers/fishdraw/Resources/plotter.js`, pan speed in `savers/shanshui/Resources/saver.js`, and spawn timing in `savers/hermit/Resources/hermit/main.py`. The shuffle interval is `SWITCH` (seconds) in `savers/shuffle/saver.conf`. Run `make install` after changing anything.

## Layout

```
shell/WebSaverView.swift   generic ScreenSaverView hosting a WKWebView
shell/main.swift           preview host used by make preview-<id>
shell/Info.plist.in        bundle template
scripts/build-saver.sh     builds one saver from savers/<id>
savers/<id>/saver.conf     name, class, bundle id, background, page, file access, playlist
savers/<id>/Resources/     shipped into the bundle; upstream files verbatim
savers/<id>/prebuild.sh    optional generated-resource step
savers/<id>/VENDOR.md      upstream commit and what we changed around it
```

Each saver gets a generated subclass with its own `@objc` class name. macOS can load several third-party savers into one host process, and identical class names would collide.

## Things worth knowing

- **WebKit thinks the page is hidden.** Inside Apple's `legacyScreenSaver` host, WebKit reports the page as hidden even though it is on screen, so `requestAnimationFrame` never fires and animations freeze after one frame. The shell turns off WKWebView's window-occlusion detection, a private setter, guarded so a future WebKit that drops it degrades to a still image instead of crashing.
- **Smoothness comes from the compositor, not redraws.** Shan Shui pans pre-rendered segments with Web Animations and swaps double buffers with phase-locked start times. Nonflowers reveals paintings in a WebGL shader from a precomputed growth-time map. In both, the expensive generation happens off the critical path.
- **Hermit runs Python in the browser.** The original Python 2 game is ported minimally to Python 3 and runs under [Pyodide](https://pyodide.org) with pygame-ce, drawing to a canvas at 30 fps. It needs `fetch()` of sibling files, so it opts in to file access with `FILE_ACCESS=1`; the other savers don't. Expect about 330 MB of memory per screen.
- **Shuffle is a playlist.** `savers/shuffle/prebuild.sh` copies every other saver's Resources into its bundle and writes `playlist.json` from their `saver.conf` files, so new savers join automatically. The shell loads an incoming page fully opaque underneath the current one, waits for `window.__saverReady`, fades the old page out on top and tears it down, so only one page's memory is held between switches.
- **Workers must be Blob workers.** WKWebView blocks workers loaded from `file://` URLs. Nonflowers bundles its worker source into `worker.src.js` at build time and starts it from a Blob URL.
- **Debugging.** Every saver logs its page state every 10 seconds under its bundle id. Use the full path, because in zsh `log` is a shell builtin:

  ```
  /usr/bin/log show --last 5m --predicate 'subsystem == "io.kylekovary.Nonflowers"' --style compact
  ```

## Credits

All art and generation code is by Lingdong Huang, MIT licensed. Each saver keeps the upstream license as `UPSTREAM-LICENSE` and records the vendored commit in `Resources/VENDOR.md`. Shan Shui's easter-egg roof sign reads "Octant" here instead of "Pizza Hut".
