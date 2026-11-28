import SwiftUI
import AppKit
import Foundation
import UserNotifications

/// Draws a crisp Retina monochrome template icon matching the branching Lingonberry Router mark.
private func makeMenuBarLingonberryIcon() -> NSImage {
    let size = NSSize(width: 18, height: 18)
    let img = NSImage(size: size, flipped: false) { _ in
        NSColor.labelColor.setStroke()
        NSColor.labelColor.setFill()

        // Main trunk curving up-right to the hero berry
        let mainTrunk = NSBezierPath()
        mainTrunk.lineWidth = 1.55
        mainTrunk.lineCapStyle = .round
        mainTrunk.move(to: NSPoint(x: 8.8, y: 2.5))
        mainTrunk.curve(to: NSPoint(x: 12.6, y: 10.8),
                        controlPoint1: NSPoint(x: 8.8, y: 5.8),
                        controlPoint2: NSPoint(x: 8.8, y: 8.8))
        mainTrunk.stroke()

        // Lower-left branch
        let leftBranch = NSBezierPath()
        leftBranch.lineWidth = 1.4
        leftBranch.lineCapStyle = .round
        leftBranch.move(to: NSPoint(x: 8.8, y: 5.0))
        leftBranch.curve(to: NSPoint(x: 3.2, y: 8.8),
                         controlPoint1: NSPoint(x: 7.0, y: 6.8),
                         controlPoint2: NSPoint(x: 4.6, y: 6.8))
        leftBranch.stroke()

        // Upper-left branch
        let midBranch = NSBezierPath()
        midBranch.lineWidth = 1.3
        midBranch.lineCapStyle = .round
        midBranch.move(to: NSPoint(x: 8.8, y: 7.8))
        midBranch.curve(to: NSPoint(x: 6.1, y: 11.8),
                        controlPoint1: NSPoint(x: 7.2, y: 9.2),
                        controlPoint2: NSPoint(x: 6.4, y: 10.2))
        midBranch.stroke()

        // Right branch
        let rightBranch = NSBezierPath()
        rightBranch.lineWidth = 1.3
        rightBranch.lineCapStyle = .round
        rightBranch.move(to: NSPoint(x: 9.4, y: 3.7))
        rightBranch.curve(to: NSPoint(x: 14.8, y: 7.9),
                          controlPoint1: NSPoint(x: 10.6, y: 6.0),
                          controlPoint2: NSPoint(x: 12.8, y: 6.4))
        rightBranch.stroke()

        // Satellite worker nodes
        NSBezierPath(ovalIn: NSRect(x: 1.65, y: 7.75, width: 2.7, height: 2.7)).fill()
        NSBezierPath(ovalIn: NSRect(x: 4.55, y: 10.85, width: 2.9, height: 2.9)).fill()
        NSBezierPath(ovalIn: NSRect(x: 13.65, y: 6.75, width: 2.7, height: 2.7)).fill()

        // Hero lingonberry orb + twin top leaves
        NSBezierPath(ovalIn: NSRect(x: 10.75, y: 9.75, width: 4.9, height: 4.9)).fill()

        let leftLeaf = NSBezierPath()
        leftLeaf.move(to: NSPoint(x: 13.0, y: 14.8))
        leftLeaf.curve(to: NSPoint(x: 9.8, y: 15.5),
                       controlPoint1: NSPoint(x: 11.8, y: 16.0),
                       controlPoint2: NSPoint(x: 10.5, y: 16.0))
        leftLeaf.curve(to: NSPoint(x: 13.0, y: 14.7),
                       controlPoint1: NSPoint(x: 10.3, y: 14.6),
                       controlPoint2: NSPoint(x: 11.7, y: 14.2))
        leftLeaf.close()
        leftLeaf.fill()

        let rightLeaf = NSBezierPath()
        rightLeaf.move(to: NSPoint(x: 13.4, y: 14.8))
        rightLeaf.curve(to: NSPoint(x: 16.6, y: 15.9),
                        controlPoint1: NSPoint(x: 14.5, y: 16.2),
                        controlPoint2: NSPoint(x: 15.8, y: 16.4))
        rightLeaf.curve(to: NSPoint(x: 13.4, y: 14.7),
                        controlPoint1: NSPoint(x: 16.0, y: 14.9),
                        controlPoint2: NSPoint(x: 14.6, y: 14.3))
        rightLeaf.close()
        rightLeaf.fill()

        return true
    }
    img.isTemplate = true
    return img
}

@main
struct LingonberryBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        MenuBarExtra {
            PopoverView(store: delegate.store)
        } label: {
            Image(nsImage: makeMenuBarLingonberryIcon())
        }
        .menuBarExtraStyle(.window)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    let store: RouterStore
    private var coreProcess: Process?

    override init() {
        self.store = RouterStore()
        super.init()
    }

    /// Locate `lingonberry-core` inside the app bundle, Cargo bin, local bin, or Homebrew.
    private var coreBinaryURL: URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let candidates: [URL] = [
            Bundle.main.bundleURL
                .appendingPathComponent("Contents")
                .appendingPathComponent("MacOS")
                .appendingPathComponent("lingonberry-core"),
            home.appendingPathComponent(".cargo/bin/lingonberry-core"),
            home.appendingPathComponent(".local/bin/lingonberry-core"),
            URL(fileURLWithPath: "/opt/homebrew/bin/lingonberry-core"),
            URL(fileURLWithPath: "/usr/local/bin/lingonberry-core"),
        ]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    /// Returns true if the core HTTP API is already responding to /health.
    private func coreIsRunning() -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8799/health") else { return false }
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

    /// Launch the bundled or installed core backend non-blockingly if it isn't already running.
    private func ensureCoreRunning() {
        if coreIsRunning() { return }
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

    private func setupNotificationsIfBundled() {
        guard Bundle.main.bundleIdentifier != nil else { return }
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let approve = UNNotificationAction(identifier: "APPROVE_FREE", title: "Approve (Free · Worktree)", options: [])
        let deferAction = UNNotificationAction(identifier: "DEFER_TICKET", title: "Defer", options: [.destructive])
        let category = UNNotificationCategory(
            identifier: "OVERNIGHT_TICKET",
            actions: [approve, deferAction],
            intentIdentifiers: [],
            options: []
        )
        center.setNotificationCategories([category])
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        if let ticketId = userInfo["ticket_id"] as? String {
            switch response.actionIdentifier {
            case "APPROVE_FREE":
                Task { await store.approveTicket(id: ticketId, allowPaid: false) }
            case "DEFER_TICKET":
                Task { await store.deferTicket(id: ticketId) }
            default:
                DispatchQueue.main.async {
                    self.store.setupTab = .overnight
                    self.store.showSetup = true
                }
            }
        }
        completionHandler()
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        if ProcessInfo.processInfo.environment["LB_DARK"] == "1" {
            NSApp.appearance = NSAppearance(named: .darkAqua)
        }
        if let url = Bundle.module.url(forResource: "appicon_1024", withExtension: "png", subdirectory: "Resources"),
           let appIcon = NSImage(contentsOf: url) {
            NSApp.applicationIconImage = appIcon
        }
        NSApp.setActivationPolicy(.accessory)

        setupNotificationsIfBundled()
        ensureCoreRunning()

        Task { await store.refresh() }
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
        if let proc = coreProcess, proc.isRunning {
            proc.terminate()
        }
    }
}
