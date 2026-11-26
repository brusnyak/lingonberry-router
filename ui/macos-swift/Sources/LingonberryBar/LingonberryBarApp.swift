import AppKit
import Foundation

@main
class LingonberryBarApp: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var popover: NSPopover!
    var client: RouterClient!
    var popoverVC: PopoverViewController!

    func applicationDidFinishLaunching(_ notification: Notification) {
        client = RouterClient()
        popoverVC = PopoverViewController(client: client)

        popover = NSPopover()
        popover.behavior = .transient
        popover.animates = true
        popover.contentViewController = popoverVC

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = NSImage(named: "LingonberryIcon")
            button.image?.size = NSSize(width: 18, height: 18)
            button.action = #selector(togglePopover)
            button.target = self
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        client.start()
    }

    @objc func togglePopover() {
        if let button = statusItem.button {
            if popover.isShown {
                popover.performClose(nil)
            } else {
                popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
                Task { await client.refresh() }
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        client.stop()
    }
}
