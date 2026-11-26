import SwiftUI
import AppKit

let LABEL = "dev.lingonberry.router"

func loadSnap() -> Data? {
    let url = URL(string: "http://127.0.0.1:8799/api/snapshot")!
    return try? Data(contentsOf: url)
}

struct Overview: Decodable {
    var running: Int? = 0
    var completed_24h: Int? = 0
    var failed_24h: Int? = 0
    var avg_duration_s: Double? = 0
    var cpu_pct: Double? = 0
}

struct WorkerRow: Decodable, Identifiable {
    var id: String { name }
    let name: String
    let status: String
}

struct Snap: Decodable {
    var overview = Overview()
    var workers: [WorkerRow] = []
}

final class Store: ObservableObject {
    @Published var snap = Snap()
    @Published var routerUp = true

    init() {
        refresh()
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    func refresh() {
        DispatchQueue.global().async {
            let d = loadSnap()
            DispatchQueue.main.async {
                if let d = d, let s = try? JSONDecoder().decode(Snap.self, from: d) {
                    self.snap = s
                }
                self.routerUp = (d != nil)
            }
        }
    }
}

struct Tokens {
    static let bg = Color(NSColor.windowBackgroundColor)
    static let card = Color(NSColor.controlBackgroundColor)
    static let line = Color(NSColor.separatorColor)
    static let txt = Color(NSColor.labelColor)
    static let mute = Color(NSColor.secondaryLabelColor)
    static let green = Color.green
    static let blue = Color.blue
    static let amber = Color.orange
    static let red = Color.red
}

struct ContentView: View {
    @ObservedObject var s: Store
    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(spacing: 12) {
                    tiles
                    graphSection
                    workersSection
                }.padding(16)
            }
        }
        .frame(minWidth: 700, minHeight: 520)
        .background(Tokens.bg)
    }

    var header: some View {
        HStack {
            Image(systemName: "point.3.connected.trianglepath.dotted")
                .foregroundStyle(Tokens.blue)
            Text("Lingonberry Router")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Tokens.txt)
            Pill(t: s.routerUp ? "Running" : "Stopped", c: s.routerUp ? Tokens.green : Tokens.red)
            Spacer()
            Button("Quit") { NSApplication.shared.terminate(nil) }
                .buttonStyle(.plain)
                .foregroundStyle(Tokens.red)
        }.padding(.horizontal, 14).padding(.vertical, 10)
        .background(Tokens.card)
        .overlay(Rectangle().fill(Tokens.line).frame(height: 1), alignment: .bottom)
    }

    var tiles: some View {
        let o = s.snap.overview
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 10)], spacing: 10) {
            Tile(v: "\(o.running ?? 0)", l: "Running", c: Tokens.blue, icon: "play.circle")
            Tile(v: "\(o.completed_24h ?? 0)", l: "Done 24h", c: Tokens.green, icon: "checkmark.circle")
            Tile(v: "\(o.failed_24h ?? 0)", l: "Failed 24h", c: Tokens.amber, icon: "xmark.circle")
            Tile(v: String(format: "%.1f%%", o.cpu_pct ?? 0), l: "CPU", c: Tokens.blue, icon: "cpu")
        }
    }

    var graphSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Orchestration").font(.system(size: 12, weight: .semibold)).foregroundStyle(Tokens.mute)
                Spacer()
                Text(s.routerUp ? "live" : "stopped").font(.system(size: 11)).foregroundStyle(Tokens.mute)
            }
            Canvas { ctx, size in
                let y = size.height / 2
                let xs = [0.2, 0.5, 0.8].map { $0 * size.width }
                for i in 0..<2 {
                    var p = Path(); p.move(to: CGPoint(x: xs[i] + 20, y: y))
                    p.addLine(to: CGPoint(x: xs[i+1] - 20, y: y))
                    ctx.stroke(p, with: .color(Tokens.line), lineWidth: 1.5)
                }
                let names = ["point.3.connected.trianglepath.dotted", "arrow.triangle.branch", "cpu"]
                let titles = ["Caller", "Router", "Worker"]
                for i in 0..<3 {
                    let c = (i == 1 && !s.routerUp) ? Tokens.red : [Tokens.blue, Tokens.green, Tokens.blue][i]
                    ctx.fill(Path(ellipseIn: CGRect(x: xs[i]-20, y: y-20, width: 40, height: 40)), with: .color(c.opacity(0.16)))
                    ctx.stroke(Path(ellipseIn: CGRect(x: xs[i]-20, y: y-20, width: 40, height: 40)), with: .color(c), lineWidth: 1.5)
                    Image(systemName: names[i]).font(.system(size: 14)).foregroundStyle(Tokens.txt).position(x: xs[i], y: y)
                    Text(titles[i]).font(.system(size: 10)).foregroundStyle(Tokens.mute).position(x: xs[i], y: y + 34)
                }
            }.frame(height: 120)
        }.padding(12).background(Tokens.card).overlay(RoundedRectangle(cornerRadius: 10).stroke(Tokens.line))
    }

    var workersSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Workers (\(s.snap.workers.count))").font(.system(size: 12, weight: .semibold)).foregroundStyle(Tokens.mute)
                Spacer()
            }
            ForEach(s.snap.workers) { w in
                HStack {
                    Circle().fill(w.status == "active" ? Tokens.green : Tokens.mute).frame(width: 6, height: 6)
                    Text(w.name).font(.system(size: 11)).foregroundStyle(Tokens.txt).lineLimit(1)
                    Spacer()
                    Pill(t: w.status, c: w.status == "active" ? Tokens.green : Tokens.mute)
                }
            }
            if s.snap.workers.isEmpty {
                Text("Idle — waiting for dispatch").font(.system(size: 11)).foregroundStyle(Tokens.mute)
            }
        }.padding(12).background(Tokens.card).overlay(RoundedRectangle(cornerRadius: 10).stroke(Tokens.line))
    }
}

struct Tile: View {
    let v: String, l: String, c: Color, icon: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 11)).foregroundStyle(c)
                Text(l).font(.system(size: 10)).foregroundStyle(Tokens.mute)
            }
            Text(v).font(.system(size: 18, weight: .semibold).monospacedDigit()).foregroundStyle(Tokens.txt)
        }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.card).overlay(RoundedRectangle(cornerRadius: 8).stroke(Tokens.line))
    }
}

struct Pill: View {
    let t: String, c: Color
    var body: some View {
        Text(t).font(.system(size: 9, weight: .semibold)).foregroundStyle(c)
            .padding(.horizontal, 6).padding(.vertical, 1.5)
            .background(Capsule().fill(c.opacity(0.15))).lineLimit(1).fixedSize()
    }
}

@main
struct LingonberryBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    var body: some Scene {
        MenuBarExtra("Lingonberry Router") {
            ContentView(s: delegate.store)
        }.menuBarExtraStyle(.window)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let store = Store()
    var win: NSWindow?

    func applicationDidFinishLaunching(_ n: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openWindow(); return true
    }

    func openWindow() {
        if win == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 740, height: 600),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered, defer: false)
            w.title = "Lingonberry Router"
            w.contentViewController = NSHostingController(rootView: ContentView(s: store))
            w.center(); win = w
        }
        store.refresh()
        win?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
