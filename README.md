# Shan Shui screensaver

[shan-shui-inf](https://github.com/LingDong-/shan-shui-inf) by Lingdong Huang as a native macOS screensaver. A fresh procedurally generated landscape drifts across each screen every time the saver starts.

Requires only the Command Line Tools (no Xcode). Apple silicon only.

```
make install     # build, ad-hoc sign, copy to ~/Library/Screen Savers
make preview     # open the view in a window for iteration
make uninstall
```

Then System Settings > Wallpaper > Screen Saver > Shan Shui. Gatekeeper may ask you to allow the unsigned bundle the first time.

`Resources/index.html` is upstream, unmodified (see `Resources/VENDOR.md`). All behavior changes are in `Resources/saver.js`, injected at load.

## Why the occlusion hack

Inside Apple's `legacyScreenSaver` host, WebKit reports the page as `hidden` even though the window is visible, so `requestAnimationFrame` never fires and the landscape freezes after the first paint. `ShanShuiView` turns off WKWebView's private window-occlusion detection, which makes the page visible again. Verified on macOS 27.0.1. If a future WebKit drops that setter the saver logs an error and will render a static image.

Debug a frozen saver with:

```
/usr/bin/log show --last 5m --predicate 'subsystem == "io.kylekovary.ShanShui"' --style compact
```

(`log` is also a zsh builtin, hence the full path.)
