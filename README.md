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
