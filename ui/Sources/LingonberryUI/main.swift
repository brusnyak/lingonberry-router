import SwiftUI
import AppKit

// Lingonberry Router — native macOS menu-bar app.
// Port of the proven Agent Router (RouterBar) layout, on the Rust core.
// Data: GET http://127.0.0.1:8799/snapshot, one poll every 3 s. No Python, no shelling out for state.
let CORE_URL = "http://127.0.0.1:8799"

// MARK: - models (snake_case JSON, optional everywhere so a core field change never blanks the UI)

struct Snapshot: Decodable {
    var ts: Double?
    var overview: Overview?
    var workers: [WorkerStatus]?
    var workers_live: [LiveWorker]?
    var sessions: [SessionRow]?
    var jobs: [JobRow]?
    var router: RouterState?
    var system: SystemInfo?
}

struct Overview: Decodable {
    var running: Int?
    var live_workers: Int?
    var completed_24h: Int?
    var failed_24h: Int?
    var avg_duration_s: Double?
    var cost_24h_usd: Double?
    var calls_24h: Int?
    var cpu_pct: Double?
}

struct WorkerStatus: Decodable, Identifiable {
    var id: String { name }
    var name: String
    var status: String
    var calls_24h: Int?
    var ok_24h: Int?
    var key: String?
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

struct JobRow: Decodable, Identifiable {
    var id: String { name }
    var name: String
    var source: String?
    var every_s: Double?
    var last: Double?
    var rc: Int?
    var paused: Bool?
    var next_in_s: Int?
}

struct RouterState: Decodable { var up: Bool?; var serve: Bool?; var proxy: Bool? }

struct SystemInfo: Decodable {
    var cpu_pct: Double?; var load1: Double?; var ram_used_gb: Double?; var ram_total_gb: Double?
    var disk_used_gb: Double?; var disk_total_gb: Double?
}

// MARK: - theme

/// Sendable colour set. One value per appearance, resolved by AppKit at draw time.
final class Tokens: Sendable {
    static let shared = Tokens()
    private static func token(_ light: (CGFloat, CGFloat, CGFloat, CGFloat), _ dark: (CGFloat, CGFloat, CGFloat, CGFloat)) -> Color {
        Color(nsColor: NSColor(name: nil) { ap in
            let c = ap.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: c.0, green: c.1, blue: c.2, alpha: c.3)
        })
    }
    let bg = Tokens.token((0.961, 0.965, 0.973, 1), (0.110, 0.114, 0.129, 1))
    let card = Tokens.token((1, 1, 1, 1), (0.157, 0.165, 0.184, 1))
    let fill = Tokens.token((0, 0, 0, 0.06), (1, 1, 1, 0.08))
    let line = Tokens.token((0, 0, 0, 0.12), (1, 1, 1, 0.12))
    let txt = Tokens.token((0.102, 0.110, 0.125, 1), (0.949, 0.953, 0.961, 1))
    let mute = Tokens.token((0.333, 0.357, 0.400, 1), (0.647, 0.663, 0.706, 1))
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

/// One stable colour per calling agent, so a lane keeps its identity across refreshes.
func callerColor(_ caller: String?) -> Color {
    let c = (caller ?? "unknown").lowercased()
    switch c {
    case "claude": return T.blue
    case "codex": return T.green
    case "opencode", "omp": return T.violet
    case "cline": return T.amber
    case "pi": return T.teal
    case "kilo": return T.pink
    case "jcode": return T.olive
    case "shell", "zsh", "bash", "fish": return T.mute
    default:
        let palette = [T.blue, T.green, T.amber, T.violet, T.teal, T.pink, T.olive]
        let h = c.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7fff_ffff }
        return palette[h % palette.count]
    }
}

@MainActor
func stateColor(_ s: String) -> Color {
    switch s.lowercased() {
    case "done", "active", "ok": return T.green
    case "running", "queued", "leased": return T.blue
    case "failed", "down", "error": return T.red
    case "blocked", "escalated": return T.amber
    case "idle": return T.mute
    default: return T.mute.opacity(0.6)
    }
}
func stateLabel(_ s: String) -> String { s == "unchecked" ? "Unchecked" : s.capitalized }
func fmtDur(_ s: Double?) -> String {
    guard let s = s else { return "-" }
    if s < 90 { return "\(Int(s))s" }
    if s < 5400 { return "\(Int(s / 60))m \(Int(s.truncatingRemainder(dividingBy: 60)))s" }
    return String(format: "%.1fh", s / 3600)
}
func fmtTime(_ t: Double) -> String {
    let d = Date(timeIntervalSince1970: t); let f = DateFormatter()
    f.dateFormat = Calendar.current.isDateInToday(d) ? "HH:mm" : "d MMM HH:mm"; return f.string(from: d)
}

// MARK: - store

@MainActor
final class Store: ObservableObject {
    static let shared = Store()
    @Published var snap = Snapshot()
    @Published var connected = false
    @Published var open: [String: Bool] = ["sessions": true, "workers_live": true, "availability": false, "jobs": false, "system": true, "routing": true]
    @Published var showAllSessions = false
    @Published var selected: SessionRow?
    @Published var killTarget: LiveWorker?
    var popoverShown = false
    private var pollTask: Task<Void, Never>?

    var overview: Overview { snap.overview ?? Overview() }
    var workers: [WorkerStatus] { snap.workers ?? [] }
    var live: [LiveWorker] { snap.workers_live ?? [] }
    var sessions: [SessionRow] { snap.sessions ?? [] }
    var jobs: [JobRow] { snap.jobs ?? [] }
    var system: SystemInfo { snap.system ?? SystemInfo() }
    var routerUp: Bool { connected }

    func startPolling(interval: TimeInterval = 3) {
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
        } catch {
            connected = false
        }
    }

    func kill(_ w: LiveWorker) async {
        guard let url = URL(string: "\(CORE_URL)/kill/\(w.pid)") else { return }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 4
        _ = try? await URLSession.shared.data(for: req)
        await fetch()
    }
}

// MARK: - building blocks

struct Pill: View {
    let t: String, c: Color
    var body: some View {
        Text(t).font(.system(size: 10, weight: .semibold)).foregroundStyle(c)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(c.opacity(0.15))).lineLimit(1).fixedSize()
    }
}
struct Tile: View {
    let v: String, l: String, c: Color, icon: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) { Image(systemName: icon).font(.system(size: 11)).foregroundStyle(c); Text(l).font(.system(size: 11)).foregroundStyle(T.mute).lineLimit(1).minimumScaleFactor(0.75) }
            Text(v).font(.system(size: 22, weight: .semibold).monospacedDigit()).foregroundStyle(T.txt).lineLimit(1).minimumScaleFactor(0.6)
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 10).stroke(T.line))
    }
}
struct Section<Content: View>: View {
    let id: String, title: String, trailing: String
    @ObservedObject var s: Store
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { withAnimation(.easeInOut(duration: 0.15)) { s.open[id] = !(s.open[id] ?? true) } } label: {
                HStack(spacing: 6) {
                    Image(systemName: (s.open[id] ?? true) ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold)).foregroundStyle(T.mute).frame(width: 10)
                    Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(T.txt)
                    Spacer(); Text(trailing).font(.system(size: 11)).foregroundStyle(T.mute)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
            if s.open[id] ?? true { content() }
        }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.line))
    }
}
@MainActor
func meter(_ n: String, _ v: Double, _ max: Double, _ label: String) -> some View {
    let f = Swift.min(1, v / Swift.max(max, 1)), c = f > 0.85 ? T.red : f > 0.65 ? T.amber : T.green
    return VStack(alignment: .leading, spacing: 4) {
        HStack { Text(n).font(.system(size: 11)).foregroundStyle(T.mute); Spacer(); Text(label).font(.system(size: 11).monospacedDigit()).foregroundStyle(T.txt) }
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(T.fill)
                Capsule().fill(c).frame(width: g.size.width * f)
            }
        }.frame(height: 6)
    }
}

// MARK: - orchestration graph

struct CallerLane: Identifiable {
    let id: String
    let name: String
    let count: Int
}

/// Callers (coloured, one lane each) → Router → Workers (with key slot) → Done.
struct GraphView: View {
    let snap: Snapshot
    let routerUp: Bool
    let animated: Bool

    var lanes: [CallerLane] {
        let recent = (snap.sessions ?? []).prefix(40)
        var counts: [(String, Int)] = []
        for r in recent {
            let key = (r.caller?.isEmpty == false) ? r.caller! : "unknown"
            if let i = counts.firstIndex(where: { $0.0 == key }) { counts[i].1 += 1 } else { counts.append((key, 1)) }
        }
        return counts.sorted { $0.1 > $1.1 }.prefix(4).map { CallerLane(id: $0.0, name: $0.0, count: $0.1) }
    }

    var body: some View {
        let live = (snap.workers_live ?? []).count
        let usable = (snap.workers ?? []).filter { ($0.status == "active" || $0.status == "idle") }.count
        let done = snap.overview?.completed_24h ?? 0
        let failed = snap.overview?.failed_24h ?? 0
        TimelineView(animated ? .animation(minimumInterval: 1.0 / 12) : .animation(minimumInterval: 3600)) { tl in
            Canvas { ctx, size in
                let t = tl.date.timeIntervalSinceReferenceDate
                let y = size.height / 2 - 34
                let x = [0.13, 0.42, 0.70, 0.92].map { $0 * size.width }

                // Caller lanes: one coloured line per distinct calling agent.
                let laneList = lanes
                let laneColors: [Color] = laneList.map { callerColor($0.name) }
                for (i, _) in laneList.enumerated() {
                    let dy = CGFloat(i - (laneList.count - 1) / 2) * 9.0
                    var p = Path()
                    p.move(to: CGPoint(x: x[0] + 34, y: y + dy))
                    p.addLine(to: CGPoint(x: x[1] - 34, y: y + dy * 0.4))
                    ctx.stroke(p, with: .color(laneColors[i].opacity(0.55)), lineWidth: 1.5)
                    if live > 0 || routerUp {
                        for k in 0..<2 {
                            let f = (t * 0.55 + Double(k) / 2 + Double(i) * 0.17).truncatingRemainder(dividingBy: 1)
                            let px = x[0] + 34 + (x[1] - x[0] - 68) * f
                            let py = y + dy - dy * 0.6 * f
                            ctx.fill(Path(ellipseIn: CGRect(x: px - 2.5, y: py - 2.5, width: 5, height: 5)),
                                     with: .color(laneColors[i]))
                        }
                    }
                }
                // Router → Workers → Done
                let tailColors: [Color] = [T.green.opacity(0.65), T.green.opacity(0.65)]
                for i in 1..<3 {
                    var p = Path()
                    p.move(to: CGPoint(x: x[i] + 34, y: y)); p.addLine(to: CGPoint(x: x[i + 1] - 34, y: y))
                    ctx.stroke(p, with: .color(T.line), lineWidth: 1.5)
                    if live > 0 || routerUp {
                        for k in 0..<3 {
                            let f = (t * 0.6 + Double(k) / 3 + Double(i) * 0.2).truncatingRemainder(dividingBy: 1)
                            let px = x[i] + 34 + (x[i + 1] - x[i] - 68) * f
                            ctx.fill(Path(ellipseIn: CGRect(x: px - 3, y: y - 3, width: 6, height: 6)),
                                     with: .color(tailColors[i - 1]))
                        }
                    }
                }
                // Nodes
                let nodeColors: [Color] = [T.blue, routerUp ? T.green : T.red, live > 0 ? T.amber : T.green, failed > 0 ? T.amber : T.green]
                for i in 0..<4 {
                    ctx.fill(Path(ellipseIn: CGRect(x: x[i] - 30, y: y - 30, width: 60, height: 60)), with: .color(nodeColors[i].opacity(0.14)))
                    ctx.stroke(Path(ellipseIn: CGRect(x: x[i] - 30, y: y - 30, width: 60, height: 60)), with: .color(nodeColors[i]), lineWidth: 1.5)
                }
            }.overlay {
                GeometryReader { g in
                    let x = [0.13, 0.42, 0.70, 0.92].map { $0 * g.size.width }
                    let y = g.size.height / 2 - 34
                    let icons = ["terminal", "arrow.triangle.branch", "cpu", "checkmark.seal"]
                    ZStack {
                        ForEach(0..<4, id: \.self) { i in
                            Image(systemName: icons[i]).font(.system(size: 18)).foregroundStyle(T.txt)
                                .position(x: x[i], y: y)
                        }
                        nodeLabel(x: x[0], y: y, title: "Callers", sub: callerSummary(), color: T.txt)
                        nodeLabel(x: x[1], y: y, title: "Lingonberry Router", sub: routerUp ? "running" : "stopped", color: routerUp ? T.green : T.red)
                        nodeLabel(x: x[2], y: y, title: "Workers", sub: "\(live) live · \(usable) usable", color: T.txt)
                        nodeLabel(x: x[3], y: y, title: "Done 24h", sub: failed > 0 ? "\(done) ok · \(failed) failed" : "\(done) ok", color: T.txt)
                    }
                }
            }
        }.frame(height: 132)
    }

    func callerSummary() -> String {
        let l = lanes
        if l.isEmpty { return "none yet" }
        let head = l.prefix(2).map { "\($0.name) \($0.count)" }.joined(separator: " · ")
        return l.count > 2 ? head + " · +\(l.count - 2)" : head
    }

    @ViewBuilder
    func nodeLabel(x: CGFloat, y: CGFloat, title: String, sub: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(T.txt).lineLimit(1)
            Text(sub).font(.system(size: 10)).foregroundStyle(T.mute).lineLimit(1).frame(width: 190)
        }.position(x: x, y: y + 52)
    }
}

// MARK: - dashboard

struct Dash: View {
    @ObservedObject var s: Store
    var snap: Snapshot { s.snap }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(spacing: 12) {
                    tiles
                    Section(id: "graph", title: "Orchestration", trailing: s.connected ? "live" : "core unreachable", s: s) {
                        GraphView(snap: snap, routerUp: s.connected, animated: s.popoverShown)
                    }
                    routingSection
                    HStack(alignment: .top, spacing: 12) {
                        sessionsSection.frame(maxWidth: .infinity)
                        VStack(spacing: 12) { workersLiveSection; availabilitySection; systemSection }
                            .frame(minWidth: 250, idealWidth: 310, maxWidth: 330)
                    }
                    jobsSection
                }.padding(16)
            }
            if let sel = s.selected { detail(sel) }
        }
        .frame(minWidth: 780, maxWidth: .infinity, minHeight: 620, maxHeight: .infinity)
        .background(T.bg)
        .onChange(of: s.sessions.map(\.id)) { _, _ in
            if let cur = s.selected, let fresh = s.sessions.first(where: { $0.id == cur.id }) { s.selected = fresh }
        }
    }

    var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "point.3.connected.trianglepath.dotted").foregroundStyle(T.blue).font(.system(size: 16))
            Text("Lingonberry Router").font(.system(size: 15, weight: .semibold)).foregroundStyle(T.txt)
            Pill(t: s.connected ? "Running" : "Stopped", c: s.connected ? T.green : T.red)
            Text("\(s.live.count) working").font(.system(size: 10)).foregroundStyle(T.mute)
            if let c = s.overview.calls_24h { Text("· \(c) runs 24h").font(.system(size: 10)).foregroundStyle(T.mute) }
            Spacer()
            if let ts = snap.ts { Text(fmtTime(ts)).font(.system(size: 10).monospacedDigit()).foregroundStyle(T.mute) }
        }.padding(.horizontal, 16).padding(.vertical, 10)
        .background(T.card).overlay(Rectangle().fill(T.line).frame(height: 1), alignment: .bottom)
    }

    var tiles: some View {
        let o = s.overview
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 10)], spacing: 10) {
            Tile(v: "\(o.live_workers ?? 0)", l: "Workers live", c: T.blue, icon: "play.circle")
            Tile(v: "\(o.completed_24h ?? 0)", l: "Done 24h", c: T.green, icon: "checkmark.circle")
            Tile(v: "\(o.failed_24h ?? 0)", l: "Failed 24h", c: T.red, icon: "xmark.circle")
            Tile(v: fmtDur(o.avg_duration_s), l: "Avg duration", c: T.blue, icon: "clock")
            Tile(v: o.cost_24h_usd.map { String(format: "$%.2f", $0) } ?? "–", l: "Cost 24h", c: T.amber, icon: "dollarsign.circle")
            Tile(v: o.cpu_pct.map { String(format: "%.0f%%", $0) } ?? "–", l: "CPU", c: T.blue, icon: "cpu")
        }
    }

    /// caller → worker → key slot, in the caller's colour. This is the honest routing chain.
    var routingSection: some View {
        let rows = routingRows()
        return Section(id: "routing", title: "Routing", trailing: rows.isEmpty ? "no runs" : "caller → worker → key", s: s) {
            VStack(alignment: .leading, spacing: 6) {
                if rows.isEmpty { Text("No runs recorded yet").font(.system(size: 11)).foregroundStyle(T.mute) }
                ForEach(rows) { row in
                    HStack(spacing: 8) {
                        Circle().fill(callerColor(row.caller)).frame(width: 7, height: 7)
                        Text(row.caller).font(.system(size: 11, weight: .semibold)).foregroundStyle(callerColor(row.caller)).frame(width: 76, alignment: .leading)
                        Image(systemName: "arrow.right").font(.system(size: 9)).foregroundStyle(T.mute)
                        Text(row.worker).font(.system(size: 11, weight: .medium)).foregroundStyle(T.txt)
                        Image(systemName: "arrow.right").font(.system(size: 9)).foregroundStyle(T.mute)
                        Text(row.key ?? "no key (CLI)")
                            .font(.system(size: 10).monospaced()).foregroundStyle(row.key == nil ? T.mute : T.amber)
                        Spacer()
                        Text("\(row.count)× · last \(fmtTime(row.last))").font(.system(size: 10).monospacedDigit()).foregroundStyle(T.mute)
                        Pill(t: stateLabel(row.state), c: stateColor(row.state))
                    }
                }
            }
        }
    }

    struct RoutingRow: Identifiable {
        var id: String { "\(caller)-\(worker)-\(key ?? "")" }
        let caller: String, worker: String, key: String?, count: Int, last: Double, state: String
    }

    func routingRows() -> [RoutingRow] {
        var out: [RoutingRow] = []
        for r in s.sessions.prefix(40) {
            let caller = (r.caller?.isEmpty == false) ? r.caller! : "unknown"
            if let i = out.firstIndex(where: { $0.caller == caller && $0.worker == r.worker && $0.key == r.key }) {
                let old = out[i]
                out[i] = RoutingRow(caller: caller, worker: r.worker, key: r.key, count: old.count + 1, last: max(old.last, r.ts), state: r.state)
            } else {
                out.append(RoutingRow(caller: caller, worker: r.worker, key: r.key, count: 1, last: r.ts, state: r.state))
            }
        }
        return Array(out.prefix(6))
    }

    var sessionsSection: some View {
        let all = s.sessions, shown = s.showAllSessions ? all : Array(all.prefix(6))
        return Section(id: "sessions", title: "Sessions", trailing: "\(all.count) latest", s: s) {
            VStack(alignment: .leading, spacing: 0) {
                if all.isEmpty { Text("No sessions yet").font(.system(size: 12)).foregroundStyle(T.mute) }
                ForEach(Array(shown.enumerated()), id: \.element.id) { i, r in
                    HStack(alignment: .top, spacing: 10) {
                        Text(fmtTime(r.ts)).font(.system(size: 10).monospacedDigit()).foregroundStyle(T.mute).frame(width: 62, alignment: .leading).padding(.top, 2)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(r.prompt).font(.system(size: 12)).foregroundStyle(T.txt).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                            HStack(spacing: 6) {
                                Text((r.caller?.isEmpty == false ? r.caller! : "unknown"))
                                    .font(.system(size: 10, weight: .semibold)).foregroundStyle(callerColor(r.caller))
                                Image(systemName: "arrow.right").font(.system(size: 8)).foregroundStyle(T.mute)
                                Text(r.worker).font(.system(size: 10, weight: .semibold)).foregroundStyle(T.txt)
                                if let k = r.key, !k.isEmpty { Text(k).font(.system(size: 10).monospaced()).foregroundStyle(T.mute) }
                                if let why = r.reason, !why.isEmpty { Text("· " + why).font(.system(size: 10)).foregroundStyle(T.mute).lineLimit(1) }
                            }
                        }
                        Spacer(minLength: 4)
                        VStack(alignment: .trailing, spacing: 3) {
                            Pill(t: stateLabel(r.state), c: stateColor(r.state))
                            Text(fmtDur(r.duration_s)).font(.system(size: 10).monospacedDigit()).foregroundStyle(T.mute)
                        }
                    }
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                    .onTapGesture { s.selected = (s.selected?.id == r.id) ? nil : r }
                    .background(s.selected?.id == r.id ? T.fill : Color.clear)
                    if i < shown.count - 1 { Rectangle().fill(T.line).frame(height: 1) }
                }
                if all.count > 6 {
                    Button(s.showAllSessions ? "Show fewer" : "Show all \(all.count)") { s.showAllSessions.toggle() }
                        .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(T.blue).padding(.top, 6)
                }
            }
        }
    }

    var workersLiveSection: some View {
        let live = s.live
        return Section(id: "workers_live", title: "Workers running", trailing: "\(live.count)", s: s) {
            VStack(alignment: .leading, spacing: 8) {
                if live.isEmpty { Text("No router-spawned workers").font(.system(size: 11)).foregroundStyle(T.mute).padding(.vertical, 4) }
                ForEach(live) { w in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(callerColor(w.caller)).frame(width: 7, height: 7).padding(.top, 4)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 5) {
                                Text(w.worker).font(.system(size: 12, weight: .medium)).foregroundStyle(T.txt)
                                if let c = w.caller { Text("← \(c)").font(.system(size: 10)).foregroundStyle(callerColor(c)) }
                                if let k = w.key, !k.isEmpty { Text("· \(k)").font(.system(size: 10).monospaced()).foregroundStyle(T.mute) }
                                Text("\(w.pid)").font(.system(size: 10).monospacedDigit()).foregroundStyle(T.mute)
                                Text(fmtDur(w.elapsed_s)).font(.system(size: 10).monospacedDigit()).foregroundStyle(T.mute)
                            }
                            if let m = w.model, !m.isEmpty { Text("model: \(m) · \(w.provider ?? "cli")").font(.system(size: 10)).foregroundStyle(T.mute) }
                            if let t = w.task, !t.isEmpty { Text(t).font(.system(size: 10)).foregroundStyle(T.mute).lineLimit(2) }
                        }
                        Spacer(minLength: 2)
                        Button { s.killTarget = w } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 11)).foregroundStyle(T.red)
                        }.buttonStyle(.plain).help("Stop \(w.worker) (pid \(w.pid))")
                    }
                }
            }
        }
    }

    var availabilitySection: some View {
        let all = s.workers
        let usable = all.filter { $0.status == "active" || $0.status == "idle" }
        return Section(id: "availability", title: "Key slots", trailing: "\(usable.count)/\(all.count) usable", s: s) {
            VStack(alignment: .leading, spacing: 8) {
                if all.isEmpty { Text("No keys discovered").font(.system(size: 11)).foregroundStyle(T.mute).padding(.vertical, 6) }
                ForEach(all) { w in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(stateColor(w.status)).frame(width: 7, height: 7).padding(.top, 4)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(w.name).font(.system(size: 12, weight: .medium)).foregroundStyle(T.txt)
                            if let c = w.calls_24h, c > 0 { Text("\(c) calls 60s · \(w.ok_24h ?? 0) ok").font(.system(size: 10)).foregroundStyle(T.mute) }
                        }
                        Spacer(minLength: 2)
                        Pill(t: stateLabel(w.status), c: stateColor(w.status))
                    }
                }
            }
        }
    }

    var jobsSection: some View {
        Section(id: "jobs", title: "Scheduled jobs", trailing: "\(s.jobs.count)", s: s) {
            VStack(alignment: .leading, spacing: 6) {
                if s.jobs.isEmpty {
                    Text("Core does not own schedules (launchd owns them) — nothing to show")
                        .font(.system(size: 11)).foregroundStyle(T.mute)
                }
                ForEach(s.jobs) { j in
                    HStack(spacing: 8) {
                        Circle().fill((j.paused == true) ? T.mute : ((j.rc ?? 0) == 0 ? T.green : T.red)).frame(width: 6, height: 6)
                        Text(j.name).font(.system(size: 11)).foregroundStyle(T.txt).lineLimit(1)
                        Spacer()
                        Text(j.every_s.map { "every \(fmtDur($0))" } ?? "one-shot").font(.system(size: 10)).foregroundStyle(T.mute)
                    }
                }
            }
        }
    }

    var systemSection: some View {
        let y = s.system
        return Section(id: "system", title: "System", trailing: y.load1.map { String(format: "load %.1f", $0) } ?? "", s: s) {
            VStack(alignment: .leading, spacing: 12) {
                if let c = y.cpu_pct { meter("CPU", c, 100, String(format: "%.0f%%", c)) }
                if let u = y.ram_used_gb, let t = y.ram_total_gb { meter("RAM", u, t, String(format: "%.1f / %.0f GB", u, t)) }
                if let u = y.disk_used_gb, let t = y.disk_total_gb { meter("Disk", u, t, String(format: "%.0f / %.0f GB", u, t)) }
                if y.cpu_pct == nil && y.ram_used_gb == nil { Text("No metrics").font(.system(size: 11)).foregroundStyle(T.mute) }
            }
        }
    }

    /// Click a session: full prompt, the worker response, copy buttons.
    func detail(_ r: SessionRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle().fill(callerColor(r.caller)).frame(width: 8, height: 8)
                Text(r.caller ?? "unknown").font(.system(size: 11, weight: .semibold)).foregroundStyle(callerColor(r.caller))
                Image(systemName: "arrow.right").font(.system(size: 9)).foregroundStyle(T.mute)
                Text(r.worker).font(.system(size: 11, weight: .semibold)).foregroundStyle(T.txt)
                if let k = r.key { Text(k).font(.system(size: 10).monospaced()).foregroundStyle(T.amber) }
                Pill(t: stateLabel(r.state), c: stateColor(r.state))
                Text(fmtTime(r.ts)).font(.system(size: 10).monospacedDigit()).foregroundStyle(T.mute)
                Text(fmtDur(r.duration_s)).font(.system(size: 10).monospacedDigit()).foregroundStyle(T.mute)
                Spacer()
                Button("Copy prompt") { copy(r.prompt) }.buttonStyle(.plain).font(.system(size: 10)).foregroundStyle(T.blue)
                Button("Copy output") { copy(r.output ?? "") }.buttonStyle(.plain).font(.system(size: 10)).foregroundStyle(T.blue)
                Button("Close") { s.selected = nil }.buttonStyle(.plain).font(.system(size: 10)).foregroundStyle(T.mute)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text("PROMPT").font(.system(size: 9, weight: .bold)).foregroundStyle(T.mute)
                    Text(r.prompt).font(.system(size: 11).monospaced()).foregroundStyle(T.txt)
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    if let out = r.output, !out.isEmpty {
                        Divider()
                        Text("OUTPUT").font(.system(size: 9, weight: .bold)).foregroundStyle(T.mute)
                        Text(out).font(.system(size: 11).monospaced()).foregroundStyle(T.txt)
                            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    } else if let why = r.reason, !why.isEmpty {
                        Divider()
                        Text("ERROR").font(.system(size: 9, weight: .bold)).foregroundStyle(T.mute)
                        Text(why).font(.system(size: 11).monospaced()).foregroundStyle(T.red)
                            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }.frame(maxHeight: 170)
        }
        .padding(12)
        .background(T.card)
        .overlay(Rectangle().fill(T.line).frame(height: 1), alignment: .top)
    }

    func copy(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }
}

// MARK: - core lifecycle

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

    /// Start the core only when nothing is listening. Never starts a second copy.
    func startIfNeeded() async {
        guard !(await isPortOpen()) else { return }
        let candidates = [
            Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/lingonberry-core").path,
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Developer/lingonberry-router/core/target/release/lingonberry-core").path,
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Developer/lingonberry-router/core/target/debug/lingonberry-core").path,
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Developer/agent-router/core/target/debug/lingonberry-core").path,
        ]
        for path in candidates where FileManager.default.fileExists(atPath: path) {
            let p = Process(); p.executableURL = URL(fileURLWithPath: path); p.arguments = ["serve"]
            if (try? p.run()) != nil { process = p; return }
        }
    }

    func stopIfOwned() {
        process?.terminate(); process = nil
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
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: "point.3.connected.trianglepath.dotted", accessibilityDescription: "Lingonberry Router")
        item.button?.target = self
        item.button?.action = #selector(click(_:))
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        Task {
            await CoreHost.shared.startIfNeeded()
            store.startPolling()
        }
        Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateTitle() }
        }
        if ProcessInfo.processInfo.environment["LINGONBERRY_TEST_WINDOW"] == "1" { openWindow() }
        // Receipt hook: render the real window to PNG without screen-capture permission.
        if let out = ProcessInfo.processInfo.environment["LINGONBERRY_SHOT"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
                guard let self, let view = self.win?.contentView,
                      let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { NSApp.terminate(nil); return }
                view.cacheDisplay(in: view.bounds, to: rep)
                if let png = rep.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: out))
                }
                NSApp.terminate(nil)
            }
        }
    }
    func applicationWillTerminate(_ n: Notification) {
        store.stopPolling()
        CoreHost.shared.stopIfOwned()
    }
    func updateTitle() {
        let n = store.live.count
        item.button?.title = n > 0 ? " \(n)" : ""
    }
    @objc func click(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let m = NSMenu()
            m.addItem(withTitle: "Full window", action: #selector(openWindow), keyEquivalent: "").target = self
            if !store.live.isEmpty {
                m.addItem(withTitle: "Kill all \(store.live.count) workers", action: #selector(killAll), keyEquivalent: "").target = self
            }
            m.addItem(withTitle: "Quit (stops core if this app started it)", action: #selector(quitApp), keyEquivalent: "q").target = self
            item.menu = m; item.button?.performClick(nil); item.menu = nil
        } else { togglePopover() }
    }
    @objc func killAll() {
        Task { @MainActor in
            for w in store.live { await store.kill(w) }
        }
    }
    @objc func quitApp() {
        store.stopPolling()
        CoreHost.shared.stopIfOwned()
        NSApp.terminate(nil)
    }
    func togglePopover() {
        if pop == nil {
            let p = NSPopover()
            p.behavior = .transient
            p.animates = true
            let v = NSHostingController(rootView: Dash(s: store))
            v.view.frame = NSRect(x: 0, y: 0, width: 800, height: 660)
            p.contentViewController = v
            p.contentSize = NSSize(width: 800, height: 660)
            pop = p
        }
        Task { await store.fetch() }
        guard let b = item.button, let p = pop else { return }
        if p.isShown { p.performClose(nil); store.popoverShown = false }
        else {
            NSApp.activate(ignoringOtherApps: true)
            p.show(relativeTo: b.bounds, of: b, preferredEdge: .minY)
            store.popoverShown = true
        }
    }
    @objc func openWindow() {
        if win == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 980, height: 780),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            w.title = "Lingonberry Router"; w.isReleasedWhenClosed = false; w.delegate = self
            w.contentMinSize = NSSize(width: 760, height: 560)
            w.contentViewController = NSHostingController(rootView: Dash(s: store))
            if !w.setFrameUsingName("LingonberryRouterWindowV2") { w.setContentSize(NSSize(width: 980, height: 820)); w.center() }
            w.setFrameAutosaveName("LingonberryRouterWindowV2")
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
