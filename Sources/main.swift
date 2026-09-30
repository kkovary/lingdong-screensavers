import AppKit
import ScreenSaver

// Minimal host so the view can be iterated on without the screensaver engine.
// Run with SHAN_SHUI_RESOURCES=Resources.
final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    func applicationDidFinishLaunching(_ n: Notification) {
        let rect = NSRect(x: 0, y: 0, width: 1280, height: 800)
        window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Shan Shui preview"
        let view = ShanShuiView(frame: rect, isPreview: false)!
        view.autoresizingMask = [.width, .height]
        window.contentView = view
        window.center()
        window.makeKeyAndOrderFront(nil)
        view.startAnimation()
        NSApp.activate(ignoringOtherApps: true)
        // SHAN_SHUI_SNAPSHOT=/path/prefix writes prefix-1.png at 6s and prefix-2.png at 12s, then quits.
        if let prefix = ProcessInfo.processInfo.environment["SHAN_SHUI_SNAPSHOT"] {
            for (i, delay) in [6.0, 12.0].enumerated() {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    view.snapshot { img in
                        if let tiff = img?.tiffRepresentation,
                           let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                            try? png.write(to: URL(fileURLWithPath: "\(prefix)-\(i + 1).png"))
                        }
                        if i == 1 { NSApp.terminate(nil) }
                    }
                }
            }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
