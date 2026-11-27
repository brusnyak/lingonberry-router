import SwiftUI
import AppKit
import Foundation

@main
struct LingonberryBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        MenuBarExtra {
            PopoverView(store: delegate.store)
        } label: {
            let appIcon: NSImage = {
                let img = NSImage(named: "icon") ?? NSImage(size: NSSize(width: 16, height: 16))
                img.size = NSSize(width: 16, height: 16)
                return img
            }()
            Image(nsImage: appIcon)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 16, height: 16)
                .foregroundStyle(.secondary)
        }
        .menuBarExtraStyle(.window)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let store: RouterStore
    private var coreProcess: Process?

    override init() {
        self.store = RouterStore()
        super.init()
    }

    /// Locate the bundled `lingonberry-core` binary inside the app bundle.
    private var coreBinaryURL: URL? {
        Bundle.main.bundleURL
            .appendingPathComponent("Contents")
            .appendingPathComponent("MacOS")
            .appendingPathComponent("lingonberry-core")
    }

    /// Returns true if the core HTTP API is already responding to /api/snapshot.
    /// Uses a background URLSession delegate queue so the completion handler can
    /// fire even while the main thread is blocked on the semaphore — never
    /// deadlocks the main run loop, and no DispatchGroup means no unbalanced leave.
    private func coreIsRunning() -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8799/api/snapshot") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.0

        let semaphore = DispatchSemaphore(value: 0)
        var result = false

        let session = URLSession(configuration: .ephemeral, delegate: nil, delegateQueue: OperationQueue())
        let task = session.dataTask(with: request) { _, response, _ in
            result = (response as? HTTPURLResponse)?.statusCode == 200
            semaphore.signal()
        }
        task.resume()
        return semaphore.wait(timeout: .now() + 1.0) == .success && result
    }

    /// Launch the bundled core backend if it isn't already running.
    /// Non-blocking: just starts the process and returns. The 3-second refresh
    /// timer will keep retrying until core is up.
    private func ensureCoreRunning() {
        // If core is already responding, nothing to do.
        if coreIsRunning() { return }

        // Otherwise, try to launch the bundled core binary.
        guard let binary = coreBinaryURL else { return }

        let process = Process()
        process.executableURL = binary
        process.arguments = ["serve"]
        process.standardOutput = nil
        process.standardError = nil

        do {
            try process.run()
            coreProcess = process
        } catch {
            let msg = "Failed to launch lingonberry-core: \(error)\n"
            FileHandle.standardError.write(msg.data(using: .utf8)!)
        }
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        if ProcessInfo.processInfo.environment["LB_DARK"] == "1" {
            NSApp.appearance = NSAppearance(named: .darkAqua)
        }
        NSApp.setActivationPolicy(.accessory)

        // Launch core if needed (non-blocking). The refresh timer below
        // will keep retrying until core is up and serving data.
        ensureCoreRunning()

        // Initial refresh attempt — may fail if core is still starting,
        // but the 3-second timer and refresh() retry handle it.
        Task { await store.refresh() }

        // Periodic refresh every 3 seconds.
        store.start()

        // Dev-only: render the popover to a PNG without opening a window.
        if let out = ProcessInfo.processInfo.environment["LB_SNAPSHOT"] {
            RenderFlags.noScroll = true
            let env = ProcessInfo.processInfo.environment
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                if let job = env["LB_SNAPSHOT_JOB"] { self.store.selectedJob = job }
                if let ses = env["LB_SNAPSHOT_SESSION"] { self.store.expandedSession = ses }
                if let f = env["LB_SNAPSHOT_FILTER"] { self.store.sessionFilter = f }
            }
            // Wait until the store has loaded snapshot data so the rendered PNG shows
            // real content instead of the initial empty state.
            func waitForSnapshot() {
                if self.store.snapshot != nil {
                    renderSnapshot()
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        waitForSnapshot()
                    }
                }
            }
            func renderSnapshot() {
                let h = Double(ProcessInfo.processInfo.environment["LB_SNAPSHOT_HEIGHT"].flatMap { Double($0) } ?? 1500)
                let renderer = ImageRenderer(content: PopoverView(store: self.store, scrolls: false, height: h))
                renderer.scale = 2
                guard let image = renderer.nsImage,
                      let tiff = image.tiffRepresentation,
                      let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    fputs("snapshot failed\n", stderr)
                    NSApp.terminate(nil)
                    return
                }
                try? png.write(to: URL(fileURLWithPath: out))
                fputs("snapshot written: \(out)\n", stderr)
                NSApp.terminate(nil)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) {
                waitForSnapshot()
            }
        }

        // Dev-only: open the popover in a normal window so it can be screenshotted.
        if ProcessInfo.processInfo.environment["LB_PREVIEW"] == "1" {
            NSApp.setActivationPolicy(.regular)
            let window = NSWindow(
                contentRect: NSRect(x: 40, y: 40, width: 880, height: 720),
                styleMask: [.titled, .closable],
                backing: .buffered,
                defer: false
            )
            window.title = "Lingonberry Preview"
            window.contentView = NSHostingView(rootView: PopoverView(store: store))
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        return true
    }

    func applicationWillTerminate(_ n: Notification) {
        store.stop()
    }
}
