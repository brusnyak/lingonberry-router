import SwiftUI

@main
struct LingonberryBarApp: App {
    @StateObject private var client = RouterClient()

    init() {
        // Defer starting poller cleanly once MainActor initializes
    }

    var body: some Scene {
        MenuBarExtra {
            PopoverView(client: client)
                .onAppear {
                    if !client.connected {
                        client.start()
                    }
                }
        } label: {
            Label {
                Text("Lingonberry")
            } icon: {
                Image(systemName: client.snapshot?.overview.running ?? 0 > 0
                    ? "point.3.filled.connected.trianglepath.dotted"
                    : "point.3.connected.trianglepath.dotted")
            }
        }
        .menuBarExtraStyle(.window)
    }
}
