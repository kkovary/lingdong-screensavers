import ScreenSaver
import WebKit
import os.log

/// Generic screensaver that shows a bundled web page in a WKWebView.
///
/// Each saver subclasses this with a unique @objc name (macOS can load several
/// savers into one host process, so class names must not collide) and
/// configures it through its own Info.plist:
///
///   WSIndex          page to load, relative to Resources (default index.html)
///   WSScript         script injected at document end (default saver.js; optional)
///   WSBackground     hex colour shown before the page paints (default FFFFFF)
///   WSCycleSeconds   0 = one page forever. N > 0 = every N seconds load a fresh
///                    copy of the page in a hidden second view, wait until it sets
///                    window.__saverReady = true, then crossfade to it.
///
/// Pages may expose window.__saver = { start(), stop(), stats() }.
open class WebSaverView: ScreenSaverView, WKNavigationDelegate {
    private var views: [WKWebView] = []
    private var front = 0
    private var cycleTimer: Timer?
    private var readyPoll: Timer?
    private lazy var bundle: Bundle = {
        // The preview host has no bundle of its own; it points at a built .saver.
        if let p = ProcessInfo.processInfo.environment["WEBSAVER_BUNDLE"], let b = Bundle(path: p) { return b }
        return Bundle(for: type(of: self))
    }()
    private lazy var log = OSLog(subsystem: bundle.bundleIdentifier ?? "io.kylekovary.WebSaver", category: "saver")

    private func info(_ key: String) -> String? { bundle.object(forInfoDictionaryKey: key) as? String }
    private var cycleSeconds: Double { Double(info("WSCycleSeconds") ?? "0") ?? 0 }

    public override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        setUp()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setUp()
    }

    private func setUp() {
        animationTimeInterval = 10.0
        wantsLayer = true
        layer?.backgroundColor = Self.color(info("WSBackground") ?? "FFFFFF").cgColor
        guard let res = bundle.resourceURL else {
            os_log(.error, log: log, "no resource URL")
            return
        }
        let count = cycleSeconds > 0 ? 2 : 1
        for i in 0..<count {
            guard let wv = makeWebView(res) else { return }
            wv.alphaValue = i == 0 ? 1 : 0
            addSubview(wv)
            views.append(wv)
        }
        load(views[0])
    }

    private func makeWebView(_ res: URL) -> WKWebView? {
        let config = WKWebViewConfiguration()
        // Savers that bundle WASM runtimes (e.g. Pyodide) need JavaScript on
        // the file:// page to fetch sibling file:// resources.  Without this,
        // WebKit's CORS policy blocks WASM loading even though loadFileURL
        // grants read access to the Resources directory.
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        let scriptURL = res.appendingPathComponent(info("WSScript") ?? "saver.js")
        if let js = try? String(contentsOf: scriptURL, encoding: .utf8) {
            config.userContentController.addUserScript(
                WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        let wv = WKWebView(frame: bounds, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.navigationDelegate = self
        wv.setValue(false, forKey: "drawsBackground")
        // Inside legacyScreenSaver WebKit decides the page is hidden even though the
        // window is visible and unoccluded, so requestAnimationFrame never fires and
        // the art freezes after the first paint. Turning off WebKit's own window
        // occlusion tracking makes the page visible again. Private setter, so guarded.
        if wv.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")) {
            wv.setValue(false, forKey: "windowOcclusionDetectionEnabled")
        } else {
            os_log(.error, log: log, "occlusion setter unavailable; page may report hidden")
        }
        return wv
    }

    private func load(_ wv: WKWebView) {
        guard let res = bundle.resourceURL else { return }
        wv.loadFileURL(res.appendingPathComponent(info("WSIndex") ?? "index.html"), allowingReadAccessTo: res)
    }

    // MARK: cycling

    private func scheduleCycle() {
        guard cycleSeconds > 0, views.count == 2 else { return }
        cycleTimer?.invalidate()
        cycleTimer = Timer.scheduledTimer(withTimeInterval: cycleSeconds, repeats: false) { [weak self] _ in
            self?.prepareNext()
        }
    }

    private func prepareNext() {
        let back = views[1 - front]
        load(back)
        let started = Date()
        readyPoll?.invalidate()
        readyPoll = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] t in
            guard let self else { return t.invalidate() }
            back.evaluateJavaScript("window.__saverReady === true") { r, _ in
                if (r as? Bool) == true {
                    t.invalidate()
                    os_log(.default, log: self.log, "next page ready after %.1fs", Date().timeIntervalSince(started))
                    self.crossfade()
                } else if Date().timeIntervalSince(started) > 120 {
                    t.invalidate()
                    os_log(.error, log: self.log, "next page never became ready; keeping current")
                    self.scheduleCycle()
                }
            }
        }
    }

    private func crossfade() {
        let old = views[front], new = views[1 - front]
        front = 1 - front
        addSubview(new, positioned: .above, relativeTo: old)
        new.evaluateJavaScript("window.__saver && window.__saver.start && window.__saver.start()")
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 3
            new.animator().alphaValue = 1
        }, completionHandler: {
            old.alphaValue = 0
            old.evaluateJavaScript("window.__saver && window.__saver.stop && window.__saver.stop()")
            old.loadHTMLString("", baseURL: nil)   // free the old page's memory
            self.scheduleCycle()
        })
    }

    // MARK: ScreenSaverView

    open override func startAnimation() {
        super.startAnimation()
        os_log(.default, log: log, "startAnimation preview=%{public}d frame=%{public}@",
               isPreview ? 1 : 0, window.map { "\($0.frame)" } ?? "nil")
        views.first?.evaluateJavaScript("window.__saver && window.__saver.start && window.__saver.start()")
        scheduleCycle()
    }

    open override func stopAnimation() {
        os_log(.default, log: log, "stopAnimation preview=%{public}d", isPreview ? 1 : 0)
        cycleTimer?.invalidate(); readyPoll?.invalidate()
        views.forEach { $0.evaluateJavaScript("window.__saver && window.__saver.stop && window.__saver.stop()") }
        super.stopAnimation()
    }

    /// Every 10 s, log the page's state so a frozen saver can be diagnosed with
    /// `/usr/bin/log show --predicate 'subsystem == "<bundle id>"'`.
    open override func animateOneFrame() {
        guard !views.isEmpty else { return }
        let probe = "JSON.stringify({vis: document.visibilityState, ready: window.__saverReady === true, stats: window.__saver && window.__saver.stats ? window.__saver.stats() : null})"
        views[front].evaluateJavaScript(probe) { result, error in
            os_log(.default, log: self.log, "probe preview=%{public}d %{public}@ %{public}@",
                   self.isPreview ? 1 : 0, String(describing: result ?? "nil"), error.map { "err=\($0)" } ?? "")
        }
    }

    open override var hasConfigureSheet: Bool { false }

    /// Used by the preview host to capture what WebKit actually painted.
    public func snapshot(_ completion: @escaping (NSImage?) -> Void) {
        guard !views.isEmpty else { return completion(nil) }
        views[front].takeSnapshot(with: nil) { image, _ in completion(image) }
    }

    /// Used by the preview host to exercise cycling without waiting.
    public func cycleNow() { prepareNext() }

    // MARK: WKNavigationDelegate

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        os_log(.error, log: log, "web content process terminated; reloading")
        load(webView)
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        os_log(.error, log: log, "navigation failed: %{public}@", error.localizedDescription)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        os_log(.error, log: log, "provisional navigation failed: %{public}@", error.localizedDescription)
    }

    private static func color(_ hex: String) -> NSColor {
        let v = UInt32(hex, radix: 16) ?? 0xFFFFFF
        return NSColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                       blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}
