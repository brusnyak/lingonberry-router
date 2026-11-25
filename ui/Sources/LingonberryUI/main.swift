import SwiftUI
import AppKit

// Lingonberry Router — menu-bar app on the Rust core. Shows what is running now.
// Every element maps to a field of GET /snapshot. Nothing shows capability that is not in use.
let CORE_URL = ProcessInfo.processInfo.environment["LINGONBERRY_CORE_URL"] ?? "http://127.0.0.1:8799"
/// Activity window for the live flow: only callers and workers with a run inside it are drawn.
let FLOW_WINDOW: Double = 15 * 60

// MARK: - models (snake_case JSON; optional everywhere so a core field change never blanks the UI)

struct Snapshot: Decodable {
    var ts: Double?
    var overview: Overview?
    var workers: [KeySlot]?
    var workers_live: [LiveWorker]?
    var sessions: [SessionRow]?
}

struct Overview: Decodable {
    var live_workers: Int?
    var completed_24h: Int?
    var failed_24h: Int?
    var avg_duration_s: Double?
    var calls_24h: Int?
}

/// `workers[]` is key_status: name = env var, calls_24h = calls in the last 60 s.
struct KeySlot: Decodable, Identifiable {
    var id: String { name }
    var name: String
    var status: String
    var calls_24h: Int?
}

struct LiveWorker: Decodable, Identifiable {
    var id: String { run_id ?? "\(worker)-\(pid)" }
    var pid: UInt32
    var worker: String
    var caller: String?
    var key: String?
    var model: String?
    var provider: String?
    var run_id: String?
    var task: String?
    var elapsed_s: Double?
}

struct SessionRow: Decodable, Identifiable {
    var id: String
    var ts: Double
    var prompt: String
    var worker: String
    var caller: String?
    var key: String?
    var state: String
    var duration_s: Double
    var reason: String?
    var output: String?
}

// MARK: - theme

/// Colour tokens, one value per appearance, resolved by AppKit at draw time.
final class Tokens: Sendable {
    static let shared = Tokens()
    private static func token(_ light: (CGFloat, CGFloat, CGFloat, CGFloat), _ dark: (CGFloat, CGFloat, CGFloat, CGFloat)) -> Color {
        Color(nsColor: NSColor(name: nil) { ap in
            let c = ap.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: c.0, green: c.1, blue: c.2, alpha: c.3)
        })
    }
    let bg = Tokens.token((0.965, 0.967, 0.973, 1), (0.110, 0.114, 0.129, 1))
    let card = Tokens.token((1, 1, 1, 1), (0.157, 0.165, 0.184, 1))
    let fill = Tokens.token((0, 0, 0, 0.045), (1, 1, 1, 0.06))
    let line = Tokens.token((0, 0, 0, 0.09), (1, 1, 1, 0.09))
    let txt = Tokens.token((0.102, 0.110, 0.125, 1), (0.949, 0.953, 0.961, 1))
    let mute = Tokens.token((0.420, 0.443, 0.494, 1), (0.690, 0.706, 0.745, 1))
    let green = Tokens.token((0.118, 0.557, 0.353, 1), (0.240, 0.812, 0.557, 1))
    let amber = Tokens.token((0.612, 0.384, 0.000, 1), (0.961, 0.647, 0.137, 1))
    let red = Tokens.token((0.773, 0.184, 0.169, 1), (0.941, 0.420, 0.408, 1))
    let blue = Tokens.token((0.169, 0.357, 0.835, 1), (0.424, 0.592, 0.961, 1))
    let violet = Tokens.token((0.427, 0.259, 0.780, 1), (0.686, 0.549, 1.000, 1))
    let teal = Tokens.token((0.000, 0.475, 0.510, 1), (0.255, 0.812, 0.839, 1))
    let pink = Tokens.token((0.722, 0.176, 0.451, 1), (0.973, 0.463, 0.694, 1))
    let olive = Tokens.token((0.400, 0.420, 0.050, 1), (0.741, 0.780, 0.239, 1))
}
let T = Tokens.shared

private let palette: [Color] = [T.blue, T.green, T.amber, T.violet, T.teal, T.pink, T.olive]

/// Stable colour per string, so a name keeps its colour across refreshes.
func stableColor(_ s: String) -> Color {
    let h = s.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7fff_ffff }
    return palette[h % palette.count]
}

/// One colour per calling agent; unknown callers are grey.
func callerColor(_ caller: String?) -> Color {
    let c = (caller ?? "unknown").lowercased()
    switch c {
    case "claude": return T.blue
    case "codex": return T.green
    case "opencode", "omp": return T.violet
    case "cline": return T.amber
    case "pi": return T.teal
    case "unknown", "": return T.mute
    default: return stableColor(c)
    }
}

func stateColor(_ s: String) -> Color {
    switch s.lowercased() {
    case "done", "active", "ok": return T.green
    case "running", "queued", "leased": return T.blue
    case "failed", "down", "error": return T.red
    case "blocked", "escalated": return T.amber
    default: return T.mute
    }
}
func stateLabel(_ s: String) -> String {
    switch s.lowercased() {
    case "down": return "Cooling"
    case "active": return "Active"
    default: return s.capitalized
    }
}
func fmtDur(_ s: Double?) -> String {
    guard let s = s else { return "–" }
    if s < 90 { return "\(Int(s))s" }
    if s < 5400 { return "\(Int(s / 60))m \(Int(s.truncatingRemainder(dividingBy: 60)))s" }
    return String(format: "%.1fh", s / 3600)
}
func fmtTime(_ t: Double) -> String {
    let d = Date(timeIntervalSince1970: t); let f = DateFormatter()
    f.dateFormat = Calendar.current.isDateInToday(d) ? "HH:mm:ss" : "d MMM HH:mm"; return f.string(from: d)
}
func callerName(_ c: String?) -> String { (c?.isEmpty == false) ? c! : "unknown" }
func keyName(_ k: String?) -> String { (k?.isEmpty == false) ? k! : "no key" }
func runsText(_ n: Int) -> String { "\(n) run\(n == 1 ? "" : "s")" }
func flowLabel(_ r: SessionRow) -> String { (r.key?.isEmpty == false) ? "\(r.worker) · \(r.key!)" : r.worker }
func liveLabel(_ w: LiveWorker) -> String { (w.key?.isEmpty == false) ? "\(w.worker) · \(w.key!)" : w.worker }

// MARK: - core binary and lifecycle

/// Newest existing core binary (bundled, release or debug): a fresh debug build is not shadowed by an old release.
func newestCoreBinary() -> String? {
    let home = FileManager.default.homeDirectoryForCurrentUser
    let candidates = [
        Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/lingonberry-core").path,
        home.appendingPathComponent("Developer/lingonberry-router/core/target/release/lingonberry-core").path,
        home.appendingPathComponent("Developer/lingonberry-router/core/target/debug/lingonberry-core").path,
    ].filter { FileManager.default.fileExists(atPath: $0) }
    return candidates.max { mtime($0) < mtime($1) }
}

func mtime(_ path: String) -> Double {
    ((try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
}

@MainActor
final class CoreHost {
    static let shared = CoreHost()
    private(set) var process: Process?

    func isPortOpen() async -> Bool {
        guard let url = URL(string: "\(CORE_URL)/snapshot") else { return false }
        var req = URLRequest(url: url); req.timeoutInterval = 2
        guard let (_, resp) = try? await URLSession.shared.data(for: req) else { return false }
        return (resp as? HTTPURLResponse)?.statusCode == 200
    }

    /// Start the newest core only when nothing listens on the port. Never starts a second copy.
    func startIfNeeded() async {
        guard !(await isPortOpen()), let path = newestCoreBinary() else { return }
        let p = Process(); p.executableURL = URL(fileURLWithPath: path); p.arguments = ["serve"]
        if (try? p.run()) != nil { process = p }
    }

    /// Ask the core to exit, then wait until its port is free.
    func shutdown() async {
        if let url = URL(string: "\(CORE_URL)/shutdown") {
            var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 2
            _ = try? await URLSession.shared.data(for: req)
        }
        for _ in 0..<20 where await isPortOpen() {
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        process = nil
    }
}

// MARK: - store

@MainActor
final class Store: ObservableObject {
    static let shared = Store()
    @Published var snap = Snapshot()
    @Published var connected = false
    @Published var coreStale = false
    @Published var showAllRuns = false
    @Published var openRuns: Set<String> = []
    @Published var killTarget: LiveWorker?
    /// Set by AppDelegate: opens the full window.
    var openWindow: (() -> Void)?
    private var pollTask: Task<Void, Never>?

    var overview: Overview { snap.overview ?? Overview() }
    var keys: [KeySlot] { snap.workers ?? [] }
    var live: [LiveWorker] { snap.workers_live ?? [] }
    var sessions: [SessionRow] { snap.sessions ?? [] }

    func startPolling(interval: TimeInterval = 2) {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.fetch()
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            }
        }
    }
    func stopPolling() { pollTask?.cancel(); pollTask = nil }

    func fetch() async {
        guard let url = URL(string: "\(CORE_URL)/snapshot") else { return }
        var req = URLRequest(url: url); req.timeoutInterval = 4
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { connected = false; return }
            snap = try JSONDecoder().decode(Snapshot.self, from: data)
            connected = true
            await checkBuild()
        } catch {
            connected = false
        }
    }

    /// Running core started before the binary on disk was rebuilt.
    func checkBuild() async {
        guard let path = newestCoreBinary(), let url = URL(string: "\(CORE_URL)/version") else { return }
        var req = URLRequest(url: url); req.timeoutInterval = 2
        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let v = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let running = v["exe_mtime"] as? Double else { return }
        coreStale = mtime(path) > running + 1
    }

    /// Kill one router-spawned worker group. The core refuses any pid it did not start.
    func kill(_ w: LiveWorker) async {
        guard let url = URL(string: "\(CORE_URL)/kill/\(w.pid)") else { return }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 4
        _ = try? await URLSession.shared.data(for: req)
        await fetch()
    }

    func stopWorkers() async {
        for w in live { await kill(w) }
    }

    /// Stop the router and this app.
    func stopEverything() async {
        await stopWorkers()
        await CoreHost.shared.shutdown()
        NSApp.terminate(nil)
    }

    /// Stop the router, then relaunch the app; the new instance starts the newest core.
    func restartEverything() async {
        await CoreHost.shared.shutdown()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "sleep 1; /usr/bin/open -n \"$0\"", Bundle.main.bundlePath]
        try? p.run()
        NSApp.terminate(nil)
    }
}

// MARK: - building blocks

struct Pill: View {
    let t: String, c: Color
    var body: some View {
        Text(t).font(.system(size: 10, weight: .semibold)).foregroundStyle(c)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(c.opacity(0.13))).lineLimit(1).fixedSize()
    }
}

struct Chip: View {
    let text: String, color: Color
    var mono = false
    var body: some View {
        Text(text)
            .font(.system(size: 10.5, weight: .medium, design: mono ? .monospaced : .default))
            .foregroundStyle(color).lineLimit(1)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 5).fill(color.opacity(0.12)))
            .fixedSize()
    }
}

struct Card<Content: View>: View {
    let title: String, trailing: String
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text(title.uppercased()).font(.system(size: 10, weight: .semibold)).tracking(0.6).foregroundStyle(T.mute)
                Spacer(minLength: 8)
                Text(trailing).font(.system(size: 10.5)).foregroundStyle(T.mute).lineLimit(1)
            }
            content()
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(T.card))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(T.line))
    }
}

// MARK: - running routers (live only, each killable)

struct RunningRow: View {
    let w: LiveWorker
    let onStop: () -> Void
    var body: some View {
        HStack(alignment: .center, spacing: 9) {
            RoundedRectangle(cornerRadius: 2).fill(callerColor(w.caller)).frame(width: 3, height: 34)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Chip(text: callerName(w.caller), color: callerColor(w.caller))
                    Image(systemName: "arrow.right").font(.system(size: 8, weight: .bold)).foregroundStyle(T.mute)
                    Chip(text: liveLabel(w), color: stableColor(w.key ?? w.worker), mono: true)
                }
                Text((w.task?.isEmpty == false) ? w.task! : "—")
                    .font(.system(size: 11)).foregroundStyle(T.mute).lineLimit(1)
            }
            Spacer(minLength: 6)
            Text(fmtDur(w.elapsed_s)).font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(T.txt)
            Button(action: onStop) {
                Image(systemName: "stop.circle.fill").font(.system(size: 16)).foregroundStyle(T.red)
            }
            .buttonStyle(.plain)
            .help("Stop this router worker (pid \(w.pid))")
        }
    }
}

extension LiveWorker {
    /// Shape a running worker like a run so the graph draws only what is in flight now.
    static func asRun(_ w: LiveWorker) -> SessionRow {
        SessionRow(id: w.id, ts: 0, prompt: w.task ?? "", worker: w.worker, caller: w.caller, key: w.key,
                   state: "running", duration_s: w.elapsed_s ?? 0, reason: nil, output: nil)
    }
}

// MARK: - runs (collapsed by default; expand for the whole conversation)

struct RunRow: View {
    let r: SessionRow
    let open: Bool
    let onToggle: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onToggle) {
                HStack(alignment: .center, spacing: 8) {
                    Image(systemName: open ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8, weight: .bold)).foregroundStyle(T.mute).frame(width: 9)
                    Text(fmtTime(r.ts)).font(.system(size: 10).monospacedDigit()).foregroundStyle(T.mute)
                        .frame(width: 52, alignment: .leading)
                    Text(r.prompt).font(.system(size: 11.5)).foregroundStyle(T.txt).lineLimit(1)
                    Spacer(minLength: 6)
                    Chip(text: callerName(r.caller), color: callerColor(r.caller))
                    Pill(t: stateLabel(r.state), c: stateColor(r.state))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if open {
                Conversation(r: r).padding(.top, 8).padding(.leading, 17)
            }
        }
        .padding(.vertical, 6).padding(.horizontal, 8)
        .background(RoundedRectangle(cornerRadius: 7).fill(open ? T.fill : Color.clear))
    }
}

/// The whole exchange: what was asked, by whom, through which worker and key, and what came back.
struct Conversation: View {
    let r: SessionRow
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Chip(text: callerName(r.caller), color: callerColor(r.caller))
                Image(systemName: "arrow.right").font(.system(size: 8, weight: .bold)).foregroundStyle(T.mute)
                Chip(text: flowLabel(r), color: stableColor(r.key ?? r.worker), mono: true)
                Text(fmtDur(r.duration_s)).font(.system(size: 10.5).monospacedDigit()).foregroundStyle(T.mute)
                Spacer()
                Button("Copy prompt") { copy(r.prompt) }.buttonStyle(.plain).font(.system(size: 10.5)).foregroundStyle(T.blue)
                Button("Copy output") { copy(r.output ?? r.reason ?? "") }.buttonStyle(.plain).font(.system(size: 10.5)).foregroundStyle(T.blue)
            }
            block("Prompt", r.prompt, T.txt)
            if let out = r.output, !out.isEmpty {
                block("Output", out, T.txt)
            } else if let why = r.reason, !why.isEmpty {
                block("Error", why, T.red)
            } else {
                Text(r.state == "running" ? "Waiting for the worker…" : "No output recorded")
                    .font(.system(size: 11)).foregroundStyle(T.mute)
            }
        }
    }

    func block(_ label: String, _ text: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.system(size: 9, weight: .semibold)).tracking(0.5).foregroundStyle(T.mute)
            ScrollView {
                Text(text)
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(color)
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 220)
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 6).fill(T.fill))
        }
    }

    func copy(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }
}

// MARK: - live flow (only what ran inside the activity window)

struct NodeCount: Identifiable { let id: String; let n: Int }
struct PairCount: Identifiable { let id: String; let caller: String; let worker: String; let n: Int }

/// Positions for one frame. Columns follow the card width; the compact layout keeps the popover tight.
struct GraphLayout {
    let caller: [CGPoint], worker: [CGPoint]
    let router: CGPoint, done: CGPoint, failed: CGPoint
    let nw: CGFloat, rw: CGFloat, ow: CGFloat

    init(w: CGFloat, h: CGFloat, nc: Int, nwk: Int) {
        let compact = w < 560
        nw = compact ? 88 : min(150, max(118, w * 0.2))
        rw = compact ? 76 : min(118, max(96, w * 0.15))
        ow = compact ? 80 : 92
        let gap: CGFloat = compact ? 12 : 30
        let x0 = nw / 2 + 6
        let x3 = w - ow / 2 - 6
        let x2 = x3 - ow / 2 - gap - nw / 2
        let x1 = (x0 + x2) / 2
        func slots(_ n: Int, _ x: CGFloat) -> [CGPoint] {
            (0..<n).map { i in CGPoint(x: x, y: n <= 1 ? h / 2 : 26 + (h - 52) * CGFloat(i) / CGFloat(n - 1)) }
        }
        caller = slots(nc, x0)
        worker = slots(nwk, x2)
        router = CGPoint(x: x1, y: h / 2)
        done = CGPoint(x: x3, y: h * 0.3)
        failed = CGPoint(x: x3, y: h * 0.7)
    }
}

func ribbon(_ a: CGPoint, _ b: CGPoint) -> Path {
    var p = Path(); p.move(to: a)
    let mx = (a.x + b.x) / 2
    p.addCurve(to: b, control1: CGPoint(x: mx, y: a.y), control2: CGPoint(x: mx, y: b.y))
    return p
}

/// Point on the same S-curve at t in 0...1, so pulses travel exactly along the ribbon.
func ribbonPoint(_ a: CGPoint, _ b: CGPoint, _ t: CGFloat) -> CGPoint {
    let mx = (a.x + b.x) / 2
    let c1 = CGPoint(x: mx, y: a.y), c2 = CGPoint(x: mx, y: b.y)
    let u = 1 - t
    let x = u*u*u*a.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*b.x
    let y = u*u*u*a.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*b.y
    return CGPoint(x: x, y: y)
}

struct FlowGraph: View {
    let recent: [SessionRow]
    let live: [LiveWorker]
    let connected: Bool

    private var callers: [NodeCount] {
        Dictionary(recent.map { (callerName($0.caller), 1) }, uniquingKeysWith: +)
            .map { NodeCount(id: $0.key, n: $0.value) }.sorted { $0.n > $1.n }
    }
    private var workers: [NodeCount] {
        Dictionary(recent.map { (flowLabel($0), 1) }, uniquingKeysWith: +)
            .map { NodeCount(id: $0.key, n: $0.value) }.sorted { $0.n > $1.n }
    }
    private var pairs: [PairCount] {
        Dictionary(recent.map { ("\(callerName($0.caller))|\(flowLabel($0))", 1) }, uniquingKeysWith: +).map { item in
            let parts = item.key.split(separator: "|", maxSplits: 1).map(String.init)
            return PairCount(id: item.key, caller: parts[0], worker: parts[1], n: item.value)
        }
    }

    var body: some View {
        let cs = Array(callers.prefix(4)), ws = Array(workers.prefix(6))
        let ps = pairs.filter { p in cs.contains { $0.id == p.caller } && ws.contains { $0.id == p.worker } }
        let rows = max(cs.count, ws.count, 1)
        let h = CGFloat(rows) * 44 + 28
        let maxP = ps.map(\.n).max() ?? 1
        let liveCallers = Set(live.map { callerName($0.caller) })
        let liveWorkers = Set(live.map(liveLabel))

        GeometryReader { g in
            let L = GraphLayout(w: g.size.width, h: h, nc: cs.count, nwk: ws.count)
            let hubL = CGPoint(x: L.router.x - L.rw / 2, y: L.router.y)
            let hubR = CGPoint(x: L.router.x + L.rw / 2, y: L.router.y)
            ZStack {
                Canvas { ctx, _ in
                    for p in ps {
                        guard let i = cs.firstIndex(where: { $0.id == p.caller }),
                              let j = ws.firstIndex(where: { $0.id == p.worker }) else { continue }
                        let col = callerColor(p.caller).opacity(0.8)
                        let lw = 1.5 + 6 * CGFloat(p.n) / CGFloat(maxP)
                        ctx.stroke(ribbon(CGPoint(x: L.caller[i].x + L.nw / 2, y: L.caller[i].y), hubL), with: .color(col), lineWidth: lw)
                        ctx.stroke(ribbon(hubR, CGPoint(x: L.worker[j].x - L.nw / 2, y: L.worker[j].y)), with: .color(col), lineWidth: lw)
                    }
                }

                if !live.isEmpty {
                    TimelineView(.animation(minimumInterval: 1.0 / 15)) { tl in
                        let t = tl.date.timeIntervalSinceReferenceDate
                        ForEach(Array(live.enumerated()), id: \.offset) { k, lw in
                            if let j = ws.firstIndex(where: { $0.id == liveLabel(lw) }) {
                                let f = CGFloat((t * 0.6 + Double(k) * 0.37).truncatingRemainder(dividingBy: 1))
                                let pt = ribbonPoint(hubR, CGPoint(x: L.worker[j].x - L.nw / 2, y: L.worker[j].y), f)
                                Circle().fill(callerColor(lw.caller)).frame(width: 7, height: 7).position(pt)
                            }
                        }
                    }
                }

                ForEach(Array(cs.enumerated()), id: \.offset) { i, c in
                    FlowNode(title: c.id, sub: runsText(c.n), color: callerColor(c.id), width: L.nw, live: liveCallers.contains(c.id))
                        .position(L.caller[i])
                }
                FlowNode(title: "Router", sub: connected ? "hub" : "offline", color: connected ? T.green : T.red, width: L.rw, live: false)
                    .position(L.router)
                ForEach(Array(ws.enumerated()), id: \.offset) { j, wk in
                    FlowNode(title: wk.id, sub: runsText(wk.n), color: stableColor(wk.id), width: L.nw, live: liveWorkers.contains(wk.id), mono: true)
                        .position(L.worker[j])
                }
            }
        }
        .frame(height: h)
    }
}

struct FlowNode: View {
    let title: String, sub: String, color: Color, width: CGFloat
    var live: Bool = false
    var mono: Bool = false
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Circle().fill(color).frame(width: 5, height: 5)
                Text(title)
                    .font(.system(size: 10.5, weight: .semibold, design: mono ? .monospaced : .default))
                    .foregroundStyle(T.txt).lineLimit(1).truncationMode(.middle)
            }
            Text(sub).font(.system(size: 9.5)).foregroundStyle(T.mute).lineLimit(1)
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .frame(width: width, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(T.card))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(live ? color : T.line, lineWidth: live ? 1.4 : 1))
    }
}

// MARK: - dashboard

struct Dash: View {
    @ObservedObject var s: Store
    /// Menu-bar popover (compact) or the full window.
    var compact = false

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(spacing: 10) {
                    metrics
                    runningCard
                    flowCard
                    runsCard
                }
                .padding(12)
                .frame(maxWidth: compact ? .infinity : 760)
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(.top)
        }
        .frame(width: compact ? 420 : 900, height: compact ? 600 : 760)
        .background(T.bg)
        .confirmationDialog(
            "Stop \(s.killTarget?.worker ?? "worker")?",
            isPresented: Binding(get: { s.killTarget != nil }, set: { if !$0 { s.killTarget = nil } }),
            titleVisibility: .visible
        ) {
            Button("Stop pid \(s.killTarget?.pid ?? 0)", role: .destructive) {
                if let w = s.killTarget { Task { await s.kill(w) } }
                s.killTarget = nil
            }
            Button("Cancel", role: .cancel) { s.killTarget = nil }
        } message: {
            Text("Sends SIGTERM to the worker's process group. Its child processes stop too.")
        }
    }

    var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "point.3.connected.trianglepath.dotted").foregroundStyle(T.blue).font(.system(size: 13))
            Text("Lingonberry").font(.system(size: 13, weight: .semibold)).foregroundStyle(T.txt).fixedSize()
            Pill(t: s.connected ? (s.live.isEmpty ? "Idle" : "\(s.live.count) running") : "Offline",
                 c: s.connected ? (s.live.isEmpty ? T.mute : T.blue) : T.red)
            Spacer(minLength: 6)
            if s.coreStale {
                Button { Task { await s.restartEverything() } } label: { Pill(t: "Update ready · Restart", c: T.amber) }
                    .buttonStyle(.plain).help("The core on disk is newer than the running one")
            }
            Menu {
                Button("Open full window") { s.openWindow?() }
                Divider()
                Button("Restart router & app") { Task { await s.restartEverything() } }
                Button("Stop router & app", role: .destructive) { Task { await s.stopEverything() } }
            } label: {
                Image(systemName: "ellipsis.circle").font(.system(size: 14)).foregroundStyle(T.mute)
            }
            .menuStyle(.borderlessButton).fixedSize()
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(T.card)
        .overlay(Rectangle().fill(T.line).frame(height: 1), alignment: .bottom)
    }

    /// One line of totals. Nothing here describes capability, only work.
    var metrics: some View {
        let o = s.overview
        return HStack(spacing: 0) {
            metric("\(s.live.count)", "running", T.blue)
            metric("\(o.completed_24h ?? 0)", "done 24h", T.green)
            metric("\(o.failed_24h ?? 0)", "failed 24h", T.red)
            metric(fmtDur(o.avg_duration_s), "median", T.mute)
        }
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 10).fill(T.card))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(T.line))
    }

    func metric(_ v: String, _ l: String, _ c: Color) -> some View {
        VStack(spacing: 1) {
            Text(v).font(.system(size: 15, weight: .semibold).monospacedDigit()).foregroundStyle(c)
            Text(l).font(.system(size: 9.5)).foregroundStyle(T.mute)
        }
        .frame(maxWidth: .infinity)
    }

    var runningCard: some View {
        Card(title: "Running now", trailing: s.live.isEmpty ? "nothing" : "stop any one") {
            if s.live.isEmpty {
                Text("No router work is running.").font(.system(size: 11.5)).foregroundStyle(T.mute).padding(.vertical, 2)
            } else {
                VStack(spacing: 8) {
                    ForEach(s.live) { w in RunningRow(w: w) { s.killTarget = w } }
                    if s.live.count > 1 {
                        Button("Stop all \(s.live.count)") { Task { await s.stopWorkers() } }
                            .buttonStyle(.plain).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(T.red)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
            }
        }
    }

    /// Live state only: what is running this moment. History lives in Runs.
    var flowCard: some View {
        Card(title: "Live flow", trailing: s.live.isEmpty ? "idle" : "\(s.live.count) running") {
            if s.live.isEmpty {
                Text("Idle. Nothing is dispatched.").font(.system(size: 11.5)).foregroundStyle(T.mute).padding(.vertical, 2)
            } else {
                FlowGraph(recent: s.live.map { LiveWorker.asRun($0) }, live: s.live, connected: s.connected)
            }
        }
    }

    var runsCard: some View {
        let all = s.sessions
        let cap = compact ? 6 : 15
        let shown = s.showAllRuns ? all : Array(all.prefix(cap))
        return Card(title: "Runs", trailing: "\(all.count) latest · tap to expand") {
            VStack(spacing: 2) {
                if all.isEmpty {
                    Text("No runs yet.").font(.system(size: 11.5)).foregroundStyle(T.mute).padding(.vertical, 2)
                }
                ForEach(shown) { r in
                    RunRow(r: r, open: s.openRuns.contains(r.id)) {
                        if s.openRuns.contains(r.id) { s.openRuns.remove(r.id) } else { s.openRuns.insert(r.id) }
                    }
                }
                if all.count > cap {
                    Button(s.showAllRuns ? "Show fewer" : "Show all \(all.count)") { s.showAllRuns.toggle() }
                        .buttonStyle(.plain).font(.system(size: 10.5)).foregroundStyle(T.blue).padding(.top, 4)
                }
            }
        }
    }
}

// MARK: - app

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let store = Store.shared
    var item: NSStatusItem!
    var pop: NSPopover?
    var win: NSWindow?

    func applicationDidFinishLaunching(_ n: Notification) {
        NSApp.setActivationPolicy(.accessory)
        store.openWindow = { [weak self] in self?.openWindow() }
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: "point.3.connected.trianglepath.dotted", accessibilityDescription: "Lingonberry Router")
        item.button?.target = self
        item.button?.action = #selector(click(_:))
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        Task {
            await CoreHost.shared.startIfNeeded()
            store.startPolling()
        }
        Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateTitle() }
        }
        let env = ProcessInfo.processInfo.environment
        if env["LINGONBERRY_TEST_WINDOW"] == "1" { openWindow() }
        if env["LINGONBERRY_TEST_EXPAND"] == "1" {
            // Receipt hook only: expands the newest run so the conversation view can be rendered.
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
                if let first = self?.store.sessions.first { self?.store.openRuns.insert(first.id) }
            }
        }
        if env["LINGONBERRY_TEST_POPOVER"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.togglePopover() }
        }
        // Receipt hook: render the real view to PNG without screen-capture permission.
        if let out = env["LINGONBERRY_SHOT"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
                guard let self, let view = self.win?.contentView ?? self.pop?.contentViewController?.view,
                      let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { NSApp.terminate(nil); return }
                view.cacheDisplay(in: view.bounds, to: rep)
                if let png = rep.representation(using: .png, properties: [:]) { try? png.write(to: URL(fileURLWithPath: out)) }
                NSApp.terminate(nil)
            }
        }
    }

    func applicationWillTerminate(_ n: Notification) {
        store.stopPolling()
        CoreHost.shared.process?.terminate()
    }

    func updateTitle() {
        let n = store.live.count
        item.button?.title = n > 0 ? " \(n)" : ""
    }

    @objc func click(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let m = NSMenu()
            m.addItem(withTitle: "Open full window", action: #selector(openWindow), keyEquivalent: "").target = self
            m.addItem(.separator())
            m.addItem(withTitle: "Stop router & app", action: #selector(stopAll), keyEquivalent: "q").target = self
            item.menu = m; item.button?.performClick(nil); item.menu = nil
        } else {
            togglePopover()
        }
    }

    @objc func stopAll() { Task { await store.stopEverything() } }

    func togglePopover() {
        if pop == nil {
            let p = NSPopover()
            p.behavior = .transient
            p.animates = true
            let v = NSHostingController(rootView: Dash(s: store, compact: true))
            v.view.frame = NSRect(x: 0, y: 0, width: 420, height: 600)
            p.contentViewController = v
            p.contentSize = NSSize(width: 420, height: 600)
            pop = p
        }
        Task { await store.fetch() }
        guard let b = item.button, let p = pop else { return }
        if p.isShown { p.performClose(nil) } else {
            NSApp.activate(ignoringOtherApps: true)
            p.show(relativeTo: b.bounds, of: b, preferredEdge: .minY)
        }
    }

    @objc func openWindow() {
        if win == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 760),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            w.title = "Lingonberry Router"; w.isReleasedWhenClosed = false; w.delegate = self
            w.contentMinSize = NSSize(width: 480, height: 480)
            w.contentViewController = NSHostingController(rootView: Dash(s: store, compact: false))
            if !w.setFrameUsingName("LingonberryRouterWindowV4") { w.setContentSize(NSSize(width: 900, height: 760)); w.center() }
            w.setFrameAutosaveName("LingonberryRouterWindowV4")
            win = w
        }
        Task { await store.fetch() }
        NSApp.setActivationPolicy(.regular)
        win?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ n: Notification) { NSApp.setActivationPolicy(.accessory) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
