import AppKit
import ScreenSaver

// Minimal host so a saver can be iterated on without the screensaver engine.
// Run via `make preview-<saver>`, which sets WEBSAVER_BUNDLE to the built .saver.
//
//   WEBSAVER_SNAPSHOT=/path/prefix  write prefix-1.png at 6s and prefix-2.png at 12s, then quit
//   WEBSAVER_SNAP_TIMES=6,12,30     override snapshot times (seconds)
//   WEBSAVER_CYCLE_AT=20            force a playlist switch at 20s (playlist savers only)
//   WEBSAVER_QUIT_AFTER=45          quit after 45s
final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    func applicationDidFinishLaunching(_ n: Notification) {
        let env = ProcessInfo.processInfo.environment
        let rect = NSRect(x: 0, y: 0, width: 1280, height: 800)
        window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Saver preview"
        let view = SaverPrincipal(frame: rect, isPreview: false)!
        view.autoresizingMask = [.width, .height]
        window.contentView = view
        window.center()
        window.makeKeyAndOrderFront(nil)
        view.startAnimation()
        NSApp.activate(ignoringOtherApps: true)

        if let at = env["WEBSAVER_CYCLE_AT"].flatMap(Double.init) {
            DispatchQueue.main.asyncAfter(deadline: .now() + at) { view.cycleNow() }
        }
        if let prefix = env["WEBSAVER_SNAPSHOT"] {
            let times = (env["WEBSAVER_SNAP_TIMES"] ?? "6,12").split(separator: ",").compactMap { Double($0) }
            for (i, t) in times.enumerated() {
                DispatchQueue.main.asyncAfter(deadline: .now() + t) {
                    view.snapshot { img in
                        if let tiff = img?.tiffRepresentation,
                           let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                            try? png.write(to: URL(fileURLWithPath: "\(prefix)-\(i + 1).png"))
                        }
                        if i == times.count - 1 && env["WEBSAVER_QUIT_AFTER"] == nil { NSApp.terminate(nil) }
                    }
                }
            }
        }
        if let secs = env["WEBSAVER_QUIT_AFTER"].flatMap(Double.init) {
            DispatchQueue.main.asyncAfter(deadline: .now() + secs) { NSApp.terminate(nil) }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
