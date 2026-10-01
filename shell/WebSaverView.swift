import ScreenSaver
import WebKit
import os.log

/// Generic screensaver that shows bundled web pages in a WKWebView.
///
/// Each saver subclasses this with a unique @objc name (macOS can load several
/// savers into one host process, so class names must not collide) and
/// configures it through its own Info.plist:
///
///   WSIndex             page to load, relative to Resources (default index.html)
///   WSScript            script injected at document end (default saver.js; optional)
///   WSBackground        hex colour shown before the page paints (default FFFFFF)
///   WSFileAccess        1 = let the page fetch() other files in Resources (WASM runtimes)
///   WSPlaylist          optional JSON file in Resources listing several pages, each
///                       {name, dir, index, script, fileAccess, background}; overrides the above
///   WSPlaylistSeconds   with a playlist: every N seconds pick a page at random. Picking the
///                       one already showing leaves it running; otherwise the new page loads
///                       hidden, crossfades in once window.__saverReady is true, and the old
///                       page is torn down.
///
/// Pages may expose window.__saver = { start(), stop(), stats() }.
open class WebSaverView: ScreenSaverView, WKNavigationDelegate {
    struct Page {
        let name: String, dir: String, index: String, script: String?
        let fileAccess: Bool, background: String
    }

    private var pages: [Page] = []
    private var current: (page: Int, view: WKWebView)?
    private var incoming: (page: Int, view: WKWebView)?
    private var switchTimer: Timer?
    private var readyPoll: Timer?
    private var probing = false, crossfading = false
    private lazy var bundle: Bundle = {
        // The preview host has no bundle of its own; it points at a built .saver.
        if let p = ProcessInfo.processInfo.environment["WEBSAVER_BUNDLE"], let b = Bundle(path: p) { return b }
        return Bundle(for: type(of: self))
    }()
    private lazy var log = OSLog(subsystem: bundle.bundleIdentifier ?? "io.kylekovary.WebSaver", category: "saver")

    private func info(_ key: String) -> String? { bundle.object(forInfoDictionaryKey: key) as? String }
    private var switchSeconds: Double { Double(info("WSPlaylistSeconds") ?? "0") ?? 0 }

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
        pages = loadPlaylist() ?? [Page(name: bundle.bundleIdentifier ?? "page", dir: "",
                                       index: info("WSIndex") ?? "index.html", script: info("WSScript") ?? "saver.js",
                                       fileAccess: info("WSFileAccess") == "1", background: info("WSBackground") ?? "FFFFFF")]
        let i = Int.random(in: pages.indices)
        if let wv = makeWebView(pages[i]) {
            addSubview(wv)
            current = (i, wv)
            layer?.backgroundColor = Self.color(pages[i].background).cgColor
            os_log(.default, log: log, "showing %{public}@", pages[i].name)
        }
    }

    private func loadPlaylist() -> [Page]? {
        guard let file = info("WSPlaylist"), !file.isEmpty, let res = bundle.resourceURL,
              let data = try? Data(contentsOf: res.appendingPathComponent(file)),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]], !list.isEmpty else { return nil }
        return list.map { d in
            Page(name: d["name"] as? String ?? "?", dir: d["dir"] as? String ?? "",
                 index: d["index"] as? String ?? "index.html", script: d["script"] as? String,
                 fileAccess: d["fileAccess"] as? Bool ?? false, background: d["background"] as? String ?? "FFFFFF")
        }
    }

    private func makeWebView(_ page: Page) -> WKWebView? {
        guard let res = bundle.resourceURL else {
            os_log(.error, log: log, "no resource URL")
            return nil
        }
        let root = page.dir.isEmpty ? res : res.appendingPathComponent(page.dir, isDirectory: true)
        let config = WKWebViewConfiguration()
        // Opt-in: savers that bundle a WASM runtime such as Pyodide need the page
        // to fetch() sibling file:// resources, which WebKit's file-URL policy
        // otherwise blocks even though loadFileURL grants read access.
        if page.fileAccess {
            config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        }
        if let script = page.script,
           let js = try? String(contentsOf: root.appendingPathComponent(script), encoding: .utf8) {
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
        wv.loadFileURL(root.appendingPathComponent(page.index), allowingReadAccessTo: root)
        return wv
    }

    // MARK: playlist

    private func scheduleSwitch() {
        switchTimer?.invalidate()
        guard switchSeconds > 0, pages.count > 1 else { return }
        switchTimer = Timer.scheduledTimer(withTimeInterval: switchSeconds, repeats: false) { [weak self] _ in
            self?.turn(forceChange: false)
        }
    }

    /// Pick a page at random. The page already showing just keeps running.
    private func turn(forceChange: Bool) {
        guard let cur = current, incoming == nil else { return }
        var j = Int.random(in: pages.indices)
        if forceChange && pages.count > 1 { while j == cur.page { j = Int.random(in: pages.indices) } }
        if j == cur.page {
            os_log(.default, log: log, "turn: keeping %{public}@", pages[j].name)
            scheduleSwitch()
            return
        }
        guard let wv = makeWebView(pages[j]) else { return scheduleSwitch() }
        // Load the new page fully opaque *underneath* the current one, then fade
        // the old page out on top, so a page is never transparent while it
        // starts (WebKit may treat a fully transparent view as hidden).
        addSubview(wv, positioned: .below, relativeTo: cur.view)
        incoming = (j, wv)
        os_log(.default, log: log, "turn: loading %{public}@", pages[j].name)
        let started = Date()
        readyPoll?.invalidate()
        readyPoll = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] t in
            guard let self, let inc = self.incoming else { return t.invalidate() }
            // A page busy starting up (Hermit loads Python for a few seconds) answers
            // late; keep one question in flight so answers can't pile up.
            if self.probing || self.crossfading { return }
            self.probing = true
            inc.view.evaluateJavaScript("window.__saverReady === true") { r, _ in
                self.probing = false
                guard self.incoming?.view === inc.view, !self.crossfading else { return }
                if (r as? Bool) == true {
                    t.invalidate()
                    os_log(.default, log: self.log, "turn: %{public}@ ready after %.1fs", self.pages[inc.page].name,
                           Date().timeIntervalSince(started))
                    self.crossfade()
                } else if Date().timeIntervalSince(started) > 90 {
                    t.invalidate()
                    os_log(.error, log: self.log, "turn: %{public}@ never became ready; keeping current", self.pages[inc.page].name)
                    inc.view.removeFromSuperview()
                    self.incoming = nil
                    self.scheduleSwitch()
                }
            }
        }
    }

    private func crossfade() {
        guard let old = current, let new = incoming, !crossfading else { return }
        crossfading = true
        new.view.evaluateJavaScript("window.__saver && window.__saver.start && window.__saver.start()")
        layer?.backgroundColor = Self.color(pages[new.page].background).cgColor
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 3
            old.view.animator().alphaValue = 0
        }, completionHandler: {
            old.view.evaluateJavaScript("window.__saver && window.__saver.stop && window.__saver.stop()")
            old.view.navigationDelegate = nil
            old.view.removeFromSuperview()          // releases the page and its web process
            self.current = new
            self.incoming = nil
            self.crossfading = false
            self.scheduleSwitch()
        })
    }

    // MARK: ScreenSaverView

    open override func startAnimation() {
        super.startAnimation()
        os_log(.default, log: log, "startAnimation preview=%{public}d frame=%{public}@",
               isPreview ? 1 : 0, window.map { "\($0.frame)" } ?? "nil")
        current?.view.evaluateJavaScript("window.__saver && window.__saver.start && window.__saver.start()")
        scheduleSwitch()
    }

    open override func stopAnimation() {
        os_log(.default, log: log, "stopAnimation preview=%{public}d", isPreview ? 1 : 0)
        switchTimer?.invalidate(); readyPoll?.invalidate()
        [current?.view, incoming?.view].compactMap { $0 }.forEach {
            $0.evaluateJavaScript("window.__saver && window.__saver.stop && window.__saver.stop()")
        }
        super.stopAnimation()
    }

    /// Every 10 s, log the page's state so a frozen saver can be diagnosed with
    /// `/usr/bin/log show --predicate 'subsystem == "<bundle id>"'`.
    open override func animateOneFrame() {
        guard let cur = current else { return }
        let name = pages[cur.page].name
        let probe = "JSON.stringify({vis: document.visibilityState, ready: window.__saverReady === true, stats: window.__saver && window.__saver.stats ? window.__saver.stats() : null})"
        cur.view.evaluateJavaScript(probe) { result, error in
            os_log(.default, log: self.log, "probe preview=%{public}d page=%{public}@ %{public}@ %{public}@",
                   self.isPreview ? 1 : 0, name, String(describing: result ?? "nil"), error.map { "err=\($0)" } ?? "")
        }
    }

    open override var hasConfigureSheet: Bool { false }

    /// Used by the preview host to capture what WebKit actually painted.
    public func snapshot(_ completion: @escaping (NSImage?) -> Void) {
        guard let wv = current?.view else { return completion(nil) }
        wv.takeSnapshot(with: nil) { image, _ in completion(image) }
    }

    /// Used by the preview host to exercise a switch without waiting.
    public func cycleNow() { turn(forceChange: true) }

    // MARK: WKNavigationDelegate

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        os_log(.error, log: log, "web content process terminated; reloading")
        webView.reload()
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
