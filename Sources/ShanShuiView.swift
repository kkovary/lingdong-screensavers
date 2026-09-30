import ScreenSaver
import WebKit
import os.log

private let log = OSLog(subsystem: "io.kylekovary.ShanShui", category: "saver")

@objc(ShanShuiView)
public final class ShanShuiView: ScreenSaverView, WKNavigationDelegate {
    private var webView: WKWebView?

    public override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        setUp()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setUp()
    }

    /// Resources live next to the class in the .saver bundle. The Preview
    /// host compiles the class into its own binary, so it points here via env.
    private static func resourcesURL() -> URL? {
        let fm = FileManager.default
        if let url = Bundle(for: ShanShuiView.self).resourceURL,
           fm.fileExists(atPath: url.appendingPathComponent("index.html").path) {
            return url
        }
        if let env = ProcessInfo.processInfo.environment["SHAN_SHUI_RESOURCES"] {
            return URL(fileURLWithPath: env, isDirectory: true)
        }
        return nil
    }

    private func setUp() {
        animationTimeInterval = 10.0
        wantsLayer = true
        layer?.backgroundColor = NSColor.white.cgColor

        guard let res = Self.resourcesURL() else {
            os_log(.error, log: log, "resources not found")
            return
        }
        let index = res.appendingPathComponent("index.html")
        guard let js = try? String(contentsOf: res.appendingPathComponent("saver.js"), encoding: .utf8) else {
            os_log(.error, log: log, "saver.js missing at %{public}@", res.path)
            return
        }

        let config = WKWebViewConfiguration()
        config.userContentController.addUserScript(
            WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

        let wv = WKWebView(frame: bounds, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.navigationDelegate = self
        // Inside legacyScreenSaver WebKit decides the page is hidden even though the
        // window is visible and unoccluded, so requestAnimationFrame never fires and
        // the art freezes after the first paint. Turning off WebKit's own window
        // occlusion tracking makes the page visible again. Private setter, so guarded.
        if wv.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")) {
            wv.setValue(false, forKey: "windowOcclusionDetectionEnabled")
        } else {
            os_log(.error, log: log, "occlusion setter unavailable; page may report hidden")
        }
        wv.loadFileURL(index, allowingReadAccessTo: res)
        addSubview(wv)
        webView = wv
    }

    public override func startAnimation() {
        super.startAnimation()
        os_log(.default, log: log, "startAnimation preview=%{public}d window=%{public}@ occl=%{public}ld",
               isPreview ? 1 : 0, window.map { "\($0.frame)" } ?? "nil", window?.occlusionState.rawValue ?? -1)
        webView?.evaluateJavaScript("window.__saver && window.__saver.start()")
    }

    public override func stopAnimation() {
        os_log(.default, log: log, "stopAnimation preview=%{public}d", isPreview ? 1 : 0)
        webView?.evaluateJavaScript("window.__saver && window.__saver.stop()")
        super.stopAnimation()
    }

    /// Every 10 s, log the page's state so a frozen saver can be diagnosed with
    /// `/usr/bin/log show --predicate 'subsystem == "io.kylekovary.ShanShui"'`.
    public override func animateOneFrame() {
        os_log(.default, log: log, "animateOneFrame fired preview=%{public}d", isPreview ? 1 : 0)
        var done = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            if !done { os_log(.error, log: log, "probe: no JS response after 5s (web process stalled?)") }
        }
        let probe = "JSON.stringify({cursx: typeof MEM!=='undefined' ? Math.round(MEM.cursx) : null, vis: document.visibilityState, raf: !!(window.__saver && window.__saver.running()), stats: window.__saver && window.__saver.stats()})"
        webView?.evaluateJavaScript(probe) { result, error in
            done = true
            os_log(.default, log: log, "probe preview=%{public}d %{public}@ %{public}@",
                   self.isPreview ? 1 : 0, String(describing: result ?? "nil"), error.map { "err=\($0)" } ?? "")
        }
    }

    /// Used by the preview host to capture what WebKit actually painted.
    public func snapshot(_ completion: @escaping (NSImage?) -> Void) {
        guard let wv = webView else { return completion(nil) }
        wv.takeSnapshot(with: nil) { image, _ in completion(image) }
    }

    public override var hasConfigureSheet: Bool { false }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        os_log(.error, log: log, "web content process terminated")
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        os_log(.error, log: log, "navigation failed: %{public}@", error.localizedDescription)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        os_log(.error, log: log, "provisional navigation failed: %{public}@", error.localizedDescription)
    }
}
