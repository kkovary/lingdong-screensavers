# Shan Shui screensaver for macOS — design

Date: 2026-09-30

## Goal

Turn LingDong-'s `shan-shui-inf` (an infinitely scrolling, procedurally
generated Chinese landscape rendered as SVG in the browser) into a native
macOS screensaver. On activation each screen shows a freshly seeded landscape
that drifts slowly to the right, with none of the page's UI visible.

## Constraints

- Machine: macOS 27.0.1, arm64, Swift 6.4 from Command Line Tools. No Xcode,
  no Developer ID. The build must work with `swiftc` alone and ad-hoc signing.
- Third-party savers are `.saver` bundles loaded by Apple's
  `legacyScreenSaver` host. This is the only public API; Apple's own savers
  are private `.appex` extensions.
- Upstream is a single self-contained `index.html` (MIT). We vendor it
  verbatim and never edit it.

## Non-goals

- No configure sheet or user preferences.
- No dark-mode inversion; the art stays black ink on paper.
- No port of the generator to Swift.
- No Intel build.

## Architecture

```
shan-shui-saver/
  Sources/ShanShuiView.swift   ScreenSaverView subclass hosting a WKWebView
  Sources/Preview.swift        tiny AppKit host for iteration (not shipped)
  Resources/index.html         upstream, verbatim
  Resources/VENDOR.md          upstream URL, commit hash, license note
  Resources/saver.js           injected: hide UI, smooth scroll, start/stop hooks
  Info.plist                   bundle metadata; NSPrincipalClass = ShanShuiView
  Makefile                     build, sign, install, preview, test
  README.md
  build/ShanShui.saver         output (gitignored)
```

### ShanShuiView (Swift)

- `@objc(ShanShuiView) final class ShanShuiView: ScreenSaverView`.
- `init(frame:isPreview:)` creates a `WKWebView` filling the bounds with
  autoresizing, configured with:
  - a `WKUserScript` containing `saver.js`, injected at document end, main
    frame only;
  - `loadFileURL(index.html, allowingReadAccessTo: Resources/)`.
- Background of both the view and the web view is white so there is no
  black flash before the page paints.
- `startAnimation()` calls `super` and evaluates `window.__saver.start()`.
  `stopAnimation()` evaluates `window.__saver.stop()` then calls `super`.
  If the page has not finished loading when `startAnimation` runs, the
  script's own `DOMContentLoaded` path starts scrolling; the Swift hook is
  idempotent.
- `hasConfigureSheet` returns false. `animationTimeInterval` is irrelevant
  since the web view drives its own frames; `animateOneFrame` is a no-op.
- Preview mode (`isPreview == true`) uses the same content. Nothing differs.
- Resources are located via `Bundle(for: ShanShuiView.self).resourceURL`,
  never `Bundle.main`, because the host process is not ours. If
  `index.html` is not found there (the case in the Preview executable, where
  the class is compiled into the binary), fall back to the directory named
  by the `SHAN_SHUI_RESOURCES` environment variable.

### saver.js

Runs after the page's own scripts (document end).

1. Hide elements with ids `SETTING`, `MENU`, `L`, `R` and set
   `document.body.style.overflow = "hidden"` so no scrollbars appear.
2. Define `window.__saver = { start, stop }`:
   - `start()` is idempotent; it sets a `setInterval` at 30 ms that calls
     `xcroll(STEP)` with `STEP = 1` px. `xcroll` already triggers
     generation of new chunks and pruning of old ones.
   - `stop()` clears the interval.
3. Call `start()` immediately so the saver animates even if the Swift hook
   fires before load.

The page seeds its PRNG from `Date.now()` on load, so each activation and
each screen gets a distinct landscape without further work.

### Info.plist

`CFBundlePackageType = BNDL`, `CFBundleIdentifier =
io.kylekovary.ShanShui`, `CFBundleName = Shan Shui`, `NSPrincipalClass =
ShanShuiView`, `CFBundleExecutable = ShanShui`, `LSMinimumSystemVersion =
14.0`, `NSHumanReadableCopyright` crediting Lingdong Huang (MIT).

### Makefile

- `make` (default `build`): `swiftc -emit-library -module-name ShanShui
  -target arm64-apple-macos14.0 -framework ScreenSaver -framework WebKit
  -o build/ShanShui.saver/Contents/MacOS/ShanShui Sources/ShanShuiView.swift`,
  copy `Info.plist` and `Resources/`, then `codesign --force --sign -
  build/ShanShui.saver`.
- `make install`: build, `rm -rf` the old copy in `~/Library/Screen Savers`,
  copy the new one, `killall legacyScreenSaver` (ignore failure) so the
  host reloads the bundle, and print a reminder to open the Screen Saver
  pane.
- `make preview`: compile `Preview.swift` + `ShanShuiView.swift` into an
  executable that opens a 1280x800 window containing the view and calls
  `startAnimation()`. Run with `SHAN_SHUI_RESOURCES=Resources` so the view
  finds the page.
- `make test`: run `Tests/smoke.swift` (see Testing).
- `make clean`.

## Error handling

- Missing resource: `ShanShuiView` logs to `os_log` and shows a white view.
  Never crash the host; a crash takes down every screensaver.
- Web view navigation failure: logged via `WKNavigationDelegate`
  `didFail`; view stays white.
- JS errors in `saver.js` are wrapped in a `try/catch` that logs to console
  so a missing element id in a future upstream version degrades to
  "UI visible" rather than "no scrolling".

## Testing

1. `make test` (smoke): loads `build/ShanShui.saver` with `Bundle(url:)`,
   asserts `principalClass` resolves and is a `ScreenSaverView` subclass,
   and that `index.html` and `saver.js` exist in the bundle. Also asserts
   `saver.js` parses (`node --check` if available, otherwise skipped).
2. `make preview`: visual check that the landscape appears, drifts, UI is
   hidden, no scrollbars. Screenshot via `screencapture` for the record.
3. `make install`, then open System Settings > Wallpaper/Screen Saver,
   select Shan Shui, confirm the preview thumbnail renders and the
   full-screen saver runs (Preview button). This is the only way to prove
   WKWebView works inside `legacyScreenSaver` on macOS 27.

## Known risk and fallback

If WKWebView draws nothing inside the legacy host (sandbox or layer-hosting
issue), the fallback is to keep the same web view off-screen and blit
`takeSnapshot` results into the view on a timer. The public surface
(`ShanShuiView`, `saver.js`, Makefile) does not change.

## Decisions

- Native Swift `.saver` over WebViewScreenSaver: no third-party binary,
  rebuild in seconds, own the whole stack.
- Smooth 1 px / 30 ms drift instead of upstream's 200 px / 2 s step: a
  screensaver should glide, and `xcroll` handles arbitrary step sizes.
- Vendor upstream verbatim and inject behavior via `WKUserScript` rather
  than patching the HTML: re-vendoring is a file copy.
