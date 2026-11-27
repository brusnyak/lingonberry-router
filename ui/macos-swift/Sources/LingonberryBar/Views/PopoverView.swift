import SwiftUI

// MARK: - Theme (light by default, day/night adaptive)

private enum Theme {
    static let isDark: Bool = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua

    static let bg        = isDark ? Color(0x0f0b0d) : Color(0xfaf7f8)
    static let card      = isDark ? Color(0x1a1316) : Color.white
    static let card2     = isDark ? Color(0x241a1f) : Color(0xf5eff1)
    static let text      = isDark ? Color(0xf6f1f3) : Color(0x1b1215)
    static let textMuted = isDark ? Color(0xb7a7ae) : Color(0x6b5d63)
    static let textDim   = isDark ? Color(0x827177) : Color(0xa2959b)
    static let accent    = isDark ? Color(0xe86a9b) : Color(0xa3144f)
    static let ok        = isDark ? Color(0x3fbf7f) : Color(0x16875a)
    static let warn      = isDark ? Color(0xe0a13a) : Color(0xa96700)
    static let err       = isDark ? Color(0xe5645c) : Color(0xc0342c)

    static var border: Color { isDark ? Color.white.opacity(0.10) : Color.black.opacity(0.09) }
    static var borderSoft: Color { isDark ? Color.white.opacity(0.06) : Color.black.opacity(0.05) }
    static var accentWash: Color { accent.opacity(isDark ? 0.16 : 0.08) }
}

extension Color {
    init(_ hex: UInt) {
        self.init(
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }
}

private func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    .system(size: size, weight: weight, design: .monospaced)
}

// Snapshot rendering cannot draw ScrollView content, so dev snapshots flatten lists.
enum RenderFlags { static var noScroll = false }

private struct ScrollingStack<Content: View>: View {
    var limit: CGFloat = 180
    @ViewBuilder var content: Content
    var body: some View {
        if RenderFlags.noScroll {
            content
                .frame(height: limit, alignment: .top)
                .clipped()
        } else {
            ScrollView { content }
                .scrollIndicators(.visible)
        }
    }
}

// MARK: - Root

struct PopoverView: View {
    @ObservedObject var store: RouterStore
    var scrolls: Bool = true
    var height: CGFloat = 720

    var body: some View {
        VStack(spacing: 0) {
            HeaderView(store: store) {
                Task { await store.quit() }
            }
            if scrolls {
                ScrollView { content }.scrollIndicators(.visible)
            } else {
                content
            }
        }
        .frame(width: 880, height: height, alignment: .top)
        .background(Theme.bg)
    }

    private var content: some View {
        VStack(spacing: 12) {
            StatStripView(store: store)
            GraphView(store: store)
            ThreeCardsView(store: store)
            if let name = store.selectedJob, let job = store.jobs.first(where: { $0.name == name }) {
                JobDetailView(job: job, store: store, onClose: { store.selectedJob = nil })
            }
            SessionsView(store: store)
        }
        .padding(14)
    }
}

// MARK: - Header

struct HeaderView: View {
    @ObservedObject var store: RouterStore
    var onQuit: () -> Void

    var body: some View {
        HStack(spacing: 9) {
            Circle()
                .fill(store.isRouterUp ? Theme.ok : Theme.err)
                .frame(width: 7, height: 7)
            Text("Lingonberry Router")
                .font(mono(14, .semibold))
                .foregroundStyle(Theme.text)
            Text("127.0.0.1:8799")
                .font(mono(10.5))
                .foregroundStyle(Theme.textDim)
            if let error = store.lastError {
                Text(error)
                    .font(mono(8.5))
                    .foregroundStyle(Theme.err)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            Button(action: { Task { await store.refresh() } }) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textMuted)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .focusable(false)
            .tint(Theme.textMuted)
            .help("Refresh")

            Button(action: onQuit) {
                Text("Quit")
                    .font(mono(10.5, .medium))
                    .foregroundStyle(Theme.textMuted)
                    .padding(.horizontal, 6)
                    .frame(height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .focusable(false)
        }
        .padding(.horizontal, 16)
        .frame(height: 42)
        .background(Theme.card)
        .overlay(Rectangle().fill(Theme.border).frame(height: 1), alignment: .bottom)
    }
}

// MARK: - Stats

struct StatStripView: View {
    @ObservedObject var store: RouterStore

    var body: some View {
        HStack(spacing: 0) {
            cell("Running", "\(store.runningCount)", store.runningCount > 0 ? Theme.ok : Theme.text)
            divider
            cell("Avg", store.avgDuration, Theme.text)
            divider
            cell("Success", store.successPct, Theme.ok)
            divider
            cell("Tasks 24h", "\(store.completedCount + store.failedCount)", Theme.text)
        }
        .padding(.vertical, 12)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border))
    }

    private var divider: some View {
        Rectangle().fill(Theme.borderSoft).frame(width: 1, height: 30)
    }

    private func cell(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(mono(10.5))
                .foregroundStyle(Theme.textMuted)
            Text(value)
                .font(mono(19, .semibold))
                .monospacedDigit()
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
    }
}

// MARK: - Graph (adaptive: idle = center badge only; active = caller → router → worker with provider colors)

struct GraphView: View {
    @ObservedObject var store: RouterStore

    /// Consistent per-provider colors so the user learns which color means which worker.
    private func providerColor(_ provider: String?) -> Color {
        guard let p = provider?.lowercased() else { return Theme.textDim }
        switch p {
        case "nim": return Color(0xF59E0B)      // orange — NVIDIA NIM
        case "google": return Color(0x3B82F6)   // blue — Google/Gemini
        case "groq": return Color(0xA855F7)     // purple — Groq
        case "openrouter": return Color(0xEC4899) // pink — OpenRouter
        default: return Color(0x8B5CF6)         // violet fallback
        }
    }

    private var isIdle: Bool {
        store.liveWorkers.isEmpty &&
        store.sessions.allSatisfy { $0.state != "running" && $0.state != "leased" }
    }

    /// Callers who initiated work that is currently running or leased.
    private var activeCallers: [String] {
        let fromLive = store.liveWorkers.compactMap { $0.caller }.filter { $0 != "shell" }
        let fromSessions = store.sessions
            .filter { $0.state == "running" || $0.state == "leased" }
            .compactMap { $0.caller }
            .filter { $0 != "shell" }
        return Array(Set(fromLive + fromSessions)).sorted()
    }

    /// Workers currently executing (live dispatches).
    private var liveWorkersList: [LiveWorker] {
        store.liveWorkers
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text("Orchestration")
                    .font(mono(11, .semibold))
                    .foregroundStyle(Theme.textMuted)
                Spacer()
                Text(isIdle ? "idle" : "\(store.liveWorkers.count) running")
                    .font(mono(10.5))
                    .foregroundStyle(isIdle ? Theme.textDim : Theme.ok)
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 10)

            GeometryReader { geo in
                let w = geo.size.width
                let h = geo.size.height
                let midY = h / 2
                let centerX = w / 2
                let badgeW: CGFloat = 140

                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Theme.bg)

                    if !isIdle {
                        // Curved lines: left callers → center
                        ForEach(0..<activeCallers.count, id: \.self) { i in
                            let caller = activeCallers[i]
                            let y = h * CGFloat(i + 1) / CGFloat(activeCallers.count + 1)
                            let start = CGPoint(x: 90, y: y)
                            let end = CGPoint(x: centerX - badgeW / 2, y: midY)
                            Path { p in
                                p.move(to: start)
                                let dx = (end.x - start.x) * 0.5
                                p.addCurve(to: end,
                                           control1: CGPoint(x: start.x + dx, y: start.y),
                                           control2: CGPoint(x: end.x - dx, y: end.y))
                            }
                            .stroke(Color(0x6b5d63).opacity(0.5), lineWidth: 2)
                        }

                        // Curved lines: center → right workers
                        ForEach(Array(liveWorkersList.enumerated()), id: \.offset) { i, worker in
                            let y = h * CGFloat(i + 1) / CGFloat(liveWorkersList.count + 1)
                            let start = CGPoint(x: centerX + badgeW / 2, y: midY)
                            let end = CGPoint(x: w - 90, y: y)
                            let color = providerColor(worker.provider)
                            Path { p in
                                p.move(to: start)
                                let dx = (end.x - start.x) * 0.5
                                p.addCurve(to: end,
                                           control1: CGPoint(x: start.x + dx, y: start.y),
                                           control2: CGPoint(x: end.x - dx, y: end.y))
                            }
                            .stroke(color.opacity(0.55), lineWidth: 3)
                        }

                        // Left caller nodes
                        ForEach(Array(activeCallers.enumerated()), id: \.offset) { i, caller in
                            let y = h * CGFloat(i + 1) / CGFloat(activeCallers.count + 1)
                            GraphNodeView(
                                node: GraphNode(
                                    id: caller,
                                    label: caller,
                                    icon: callerIcon(caller),
                                    color: Theme.ok
                                ),
                                at: CGPoint(x: 60, y: y),
                                alignment: .leading
                            )
                        }

                        // Right worker nodes — colored by provider
                        ForEach(Array(liveWorkersList.enumerated()), id: \.offset) { i, worker in
                            let y = h * CGFloat(i + 1) / CGFloat(liveWorkersList.count + 1)
                            GraphNodeView(
                                node: GraphNode(
                                    id: worker.worker,
                                    label: worker.worker,
                                    icon: workerIcon(worker.worker),
                                    color: providerColor(worker.provider)
                                ),
                                at: CGPoint(x: w - 60, y: y),
                                alignment: .trailing
                            )
                        }
                    }

                    // Center badge: Router Dispatch
                    VStack(spacing: 4) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(isIdle ? Theme.textDim.opacity(0.12) : Theme.accent.opacity(0.15))
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(isIdle ? Theme.textDim : Theme.accent, lineWidth: 1.5)
                            Image(systemName: "network")
                                .font(.system(size: 20, weight: .medium))
                                .foregroundStyle(isIdle ? Theme.textDim : Theme.accent)
                        }
                        .frame(width: 56, height: 56)
                        Text("Router")
                            .font(mono(12, .semibold))
                            .foregroundStyle(Theme.text)
                        Text("Dispatch")
                            .font(mono(10, .medium))
                            .foregroundStyle(Theme.textMuted)
                    }
                    .position(x: centerX, y: midY)
                }
                .frame(height: 260)
                .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
        }
    }

    private func callerIcon(_ name: String) -> String {
        switch name.lowercased() {
        case "claude": return "dot.circle"
        case "codex": return "hexagon.fill"
        case "opencode": return "arrow.triangle.branch"
        case "shell": return "terminal"
        default: return "circle"
        }
    }

    private func workerIcon(_ name: String) -> String {
        let lower = name.lowercased()
        if lower.hasPrefix("pi:") { return "cube.fill" }
        if lower.contains("nim") { return "cube.fill" }
        if lower.contains("google") { return "arrow.triangle.branch" }
        if lower.contains("groq") { return "pi" }
        if lower.contains("openrouter") { return "arrow.triangle.merge" }
        return "circle"
    }
}

struct GraphNode {
    let id: String
    let label: String
    let icon: String
    let color: Color
}

struct GraphNodeView: View {
    let node: GraphNode
    let at: CGPoint
    var alignment: Alignment = .leading

    var body: some View {
        HStack(spacing: 6) {
            if alignment == .trailing { Spacer() }
            Image(systemName: node.icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(node.color)
            Text(node.label)
                .font(mono(10, .medium))
                .foregroundStyle(Theme.text)
                .lineLimit(1)
            if alignment == .leading { Spacer() }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(node.color.opacity(0.12))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(node.color.opacity(0.4), lineWidth: 1))
        )
        .position(x: at.x, y: at.y)
    }
}

// MARK: - Three columns

struct ThreeCardsView: View {
    @ObservedObject var store: RouterStore
    private let cardHeight: CGFloat = 236

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            WorkersCard(store: store).frame(maxWidth: .infinity, maxHeight: cardHeight)
            ProvidersCard(store: store).frame(maxWidth: .infinity, maxHeight: cardHeight)
            JobsCard(store: store).frame(maxWidth: .infinity, maxHeight: cardHeight)
        }
        .frame(height: cardHeight)
    }
}

private struct CardShell<Content: View>: View {
    let title: String
    let meta: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(mono(11, .semibold))
                    .foregroundStyle(Theme.textMuted)
                Spacer()
                Text(meta)
                    .font(mono(9.5))
                    .foregroundStyle(Theme.textDim)
            }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(12)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border))
    }
}

struct WorkersCard: View {
    @ObservedObject var store: RouterStore
    var body: some View {
        CardShell(title: "Workers", meta: "\(store.liveWorkers.count) live") {
            ScrollingStack {
                LazyVStack(spacing: 5) {
                    if store.liveWorkers.isEmpty {
                        Text("Idle — waiting for dispatch")
                            .font(mono(10.5))
                            .foregroundStyle(Theme.textDim)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 6)
                    } else {
                        ForEach(store.liveWorkers) { worker in
                            WorkerRow(worker: worker)
                        }
                    }
                }
            }
        }
    }
}

struct WorkerRow: View {
    let worker: LiveWorker
    var body: some View {
        HStack(spacing: 7) {
            Circle().fill(Theme.ok).frame(width: 5, height: 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(worker.worker)
                    .font(mono(10.5, .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(worker.task)
                    .font(mono(9.5))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 4)
            Text(String(format: "%.0fs", worker.elapsed_s))
                .font(mono(9.5))
                .foregroundStyle(Theme.textDim)
                .monospacedDigit()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(Theme.card2)
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

struct ProvidersCard: View {
    @ObservedObject var store: RouterStore
    var body: some View {
        CardShell(title: "Providers", meta: "\(store.workers.count) keys") {
            ScrollingStack {
                LazyVStack(spacing: 5) {
                    ForEach(grouped, id: \.name) { group in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(group.name)
                                .font(mono(9.5, .medium))
                                .foregroundStyle(Theme.textDim)
                                .padding(.top, 2)
                            ForEach(group.keys) { key in
                                HStack(spacing: 6) {
                                    Circle()
                                        .fill(key.isCooling ? Theme.warn : Theme.ok)
                                        .frame(width: 5, height: 5)
                                    Text(key.name)
                                        .font(mono(10))
                                        .foregroundStyle(Theme.text)
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                    Spacer(minLength: 4)
                                    Text(key.isCooling ? "\(key.cooling_remaining_s)s" : key.status)
                                        .font(mono(9.5))
                                        .foregroundStyle(key.isCooling ? Theme.warn : Theme.textDim)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private struct Group { let name: String; let keys: [WorkerStatus] }

    private var grouped: [Group] {
        let labels = ["nim": "NVIDIA NIM", "groq": "Groq", "google": "Google", "openrouter": "OpenRouter"]
        var order: [String] = []
        var buckets: [String: [WorkerStatus]] = [:]
        for w in store.workers {
            let id = w.provider ?? "other"
            if buckets[id] == nil { order.append(id) }
            buckets[id, default: []].append(w)
        }
        return order.map { Group(name: labels[$0] ?? $0, keys: buckets[$0] ?? []) }
    }
}

struct JobsCard: View {
    @ObservedObject var store: RouterStore

    var body: some View {
        CardShell(title: "Routerjobs", meta: "\(store.jobs.count) · click to inspect") {
            ScrollingStack {
                LazyVStack(spacing: 5) {
                    if store.jobs.isEmpty {
                        Text("No scheduled jobs")
                            .font(mono(10.5))
                            .foregroundStyle(Theme.textDim)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 6)
                    } else {
                        ForEach(store.jobs) { job in
                            JobRowView(
                                job: job,
                                selected: store.selectedJob == job.name,
                                onSelect: {
                                    store.selectedJob = (store.selectedJob == job.name) ? nil : job.name
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

struct JobRowView: View {
    let job: JobRow
    let selected: Bool
    var onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 7) {
                Circle()
                    .fill(job.paused == true ? Theme.textDim : (job.health == "healthy" ? Theme.ok : Theme.warn))
                    .frame(width: 5, height: 5)
                VStack(alignment: .leading, spacing: 2) {
                    Text(job.name)
                        .font(mono(10.5, .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    HStack(spacing: 6) {
                        Text(job.nextRun)
                            .font(mono(9.5))
                            .foregroundStyle(Theme.textDim)
                        if let rc = job.rc, rc != 0 {
                            Text("rc \(rc)")
                                .font(mono(9.5))
                                .foregroundStyle(Theme.err)
                        }
                    }
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(selected ? Theme.accent : Theme.textDim)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? Theme.accentWash : Theme.card2)
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .stroke(selected ? Theme.accent.opacity(0.5) : .clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focusable(false)
    }
}

// MARK: - Job detail

struct JobDetailView: View {
    let job: JobRow
    @ObservedObject var store: RouterStore
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(job.name)
                    .font(mono(12, .semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(job.paused == true ? "paused" : (job.health ?? "unknown"))
                    .font(mono(9.5, .medium))
                    .foregroundStyle(job.paused == true ? Theme.textDim : (job.health == "healthy" ? Theme.ok : Theme.warn))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Theme.card2)
                    .clipShape(Capsule())
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Theme.textMuted)
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .focusable(false)
            }

            HStack(alignment: .top, spacing: 18) {
                field("Source", job.source ?? "—")
                field("Schedule", job.schedule ?? "—")
                field("Next run", job.nextRun)
                field("Last run", job.lastRun)
                field("Exit", job.rc.map { "\($0)" } ?? "—")
                field("Crashes", "\(job.crash_count ?? 0)")
            }

            VStack(alignment: .leading, spacing: 3) {
                Text("Command")
                    .font(mono(9.5))
                    .foregroundStyle(Theme.textDim)
                Text(job.command ?? job.prompt ?? "—")
                    .font(mono(10.5))
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
                    .lineLimit(2)
            }

            if let logs = job.log_tail, !logs.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Log tail")
                        .font(mono(9.5))
                        .foregroundStyle(Theme.textDim)
                    ForEach(Array(logs.prefix(6).enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(mono(10))
                            .foregroundStyle(Theme.textMuted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                    }
                }
            }

            if let err = job.last_error, !err.isEmpty {
                Text(err)
                    .font(mono(10))
                    .foregroundStyle(Theme.err)
                    .lineLimit(2)
            }

            HStack(spacing: 8) {
                action(job.paused == true ? "Resume" : "Pause") {
                    Task { await store.toggleCron(job.name) }
                }
                action("Run now", emphasis: true) {
                    Task { await store.runCronNow(job.name) }
                }
                Spacer()
            }
        }
        .padding(14)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.accent.opacity(0.35)))
    }

    private func field(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(mono(9.5))
                .foregroundStyle(Theme.textDim)
            Text(value)
                .font(mono(10.5, .medium))
                .foregroundStyle(Theme.text)
        }
    }

    private func action(_ title: String, emphasis: Bool = false, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(title)
                .font(mono(10.5, .medium))
                .foregroundStyle(emphasis ? Theme.card : Theme.text)
                .padding(.horizontal, 10)
                .frame(height: 26)
                .background(emphasis ? Theme.accent : Theme.card2)
                .clipShape(RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(emphasis ? .clear : Theme.border))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focusable(false)
    }
}

// MARK: - Sessions

struct SessionsView: View {
    @ObservedObject var store: RouterStore

    private var filter: String { store.sessionFilter }
    private var expanded: String? { store.expandedSession }

    private var visible: [SessionRow] {
        let all = store.sessions
        switch filter {
        case "running": return all.filter { $0.state == "running" }
        case "blocked": return all.filter { $0.state == "blocked" || $0.state == "failed" }
        case "done": return all.filter { $0.state == "done" }
        default: return all
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Sessions")
                    .font(mono(11, .semibold))
                    .foregroundStyle(Theme.textMuted)
                Spacer()
                tab("all", store.sessions.count)
                tab("running", store.sessions.filter { $0.state == "running" }.count)
                tab("blocked", store.sessions.filter { $0.state == "blocked" || $0.state == "failed" }.count)
                tab("done", store.sessions.filter { $0.state == "done" }.count)
            }

            VStack(spacing: 6) {
                ForEach(Array(visible.prefix(expanded == nil ? 8 : 20))) { session in
                    SessionRowView(
                        session: session,
                        expanded: store.expandedSession == session.id,
                        onToggle: {
                            store.expandedSession = (store.expandedSession == session.id) ? nil : session.id
                        }
                    )
                }
                if visible.isEmpty {
                    Text("No sessions in this state")
                        .font(mono(10.5))
                        .foregroundStyle(Theme.textDim)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(12)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border))
    }

    private func tab(_ id: String, _ count: Int) -> some View {
        Button(action: { store.sessionFilter = id }) {
            Text("\(id) \(count)")
                .font(mono(10, filter == id ? .medium : .regular))
                .monospacedDigit()
                .foregroundStyle(filter == id ? Theme.text : Theme.textDim)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(filter == id ? Theme.card2 : .clear)
                .clipShape(Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .focusable(false)
    }
}

struct SessionRowView: View {
    let session: SessionRow
    let expanded: Bool
    var onToggle: () -> Void

    private var stateColor: Color {
        switch session.state {
        case "done": return Theme.ok
        case "running": return Theme.warn
        default: return Theme.err
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: onToggle) {
                HStack(spacing: 7) {
                    Circle().fill(stateColor).frame(width: 5, height: 5)
                    Text(session.worker)
                        .font(mono(10.5, .medium))
                        .foregroundStyle(Theme.text)
                    if let key = session.key {
                        Text(key)
                            .font(mono(9.5))
                            .foregroundStyle(Theme.textDim)
                    }
                    Spacer(minLength: 6)
                    Text(session.caller)
                        .font(mono(9.5))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                    Text(session.state)
                        .font(mono(9.5))
                        .foregroundStyle(stateColor)
                    Text(String(format: "%.1fs", session.duration_s))
                        .font(mono(9.5))
                        .foregroundStyle(Theme.textDim)
                        .monospacedDigit()
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(expanded ? Theme.accent : Theme.textDim)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .focusable(false)

            Text(session.prompt)
                .font(mono(10.5))
                .foregroundStyle(Theme.text.opacity(0.9))
                .lineLimit(expanded ? 4 : 1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)

            if expanded {
                detail
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Theme.card2)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(expanded ? Theme.accent.opacity(0.45) : .clear)
        )
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let cooked = session.cooked {
                HStack(spacing: 6) {
                    tag("skill", cooked.selected_skill)
                    tag("command", cooked.selected_command)
                    tag("hook", cooked.selected_hook)
                    tag("gate", cooked.gate_policy)
                    tag("class", cooked.task_class)
                }
                .lineLimit(1)

                if !cooked.retrieval_sources.isEmpty {
                    Text("context: " + cooked.retrieval_sources.prefix(3).joined(separator: "  ·  "))
                        .font(mono(9.5))
                        .foregroundStyle(Theme.textDim)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            HStack(spacing: 10) {
                keyValue("tokens", "\(session.tokens_in ?? 0) in / \(session.tokens_out ?? 0) out")
                keyValue("duration", String(format: "%.1fs", session.duration_s))
                if let rid = session.receipt_id {
                    keyValue("receipt", String(rid.prefix(8)))
                }
                Spacer()
            }

            if let output = session.output, !output.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Worker output")
                        .font(mono(9.5))
                        .foregroundStyle(Theme.textDim)
                    Text(output)
                        .font(mono(10))
                        .foregroundStyle(Theme.text)
                        .lineLimit(16)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .background(Theme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            } else {
                Text("No worker output recorded for this run")
                    .font(mono(9.5))
                    .foregroundStyle(Theme.textDim)
            }

            if !session.steps.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Pipeline")
                        .font(mono(9.5))
                        .foregroundStyle(Theme.textDim)
                    ForEach(Array(session.steps.prefix(6))) { step in
                        HStack(spacing: 6) {
                            Circle()
                                .fill(step.tone == "error" ? Theme.err : Theme.accent)
                                .frame(width: 4, height: 4)
                            Text(step.title)
                                .font(mono(9.5, .medium))
                                .foregroundStyle(Theme.text)
                            Text(step.detail)
                                .font(mono(9.5))
                                .foregroundStyle(Theme.textDim)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                    }
                }
            }
        }
    }

    private func tag(_ label: String, _ value: String) -> some View {
        HStack(spacing: 3) {
            Text(label)
                .foregroundStyle(Theme.textDim)
            Text(value.isEmpty ? "—" : value)
                .foregroundStyle(Theme.text)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .font(mono(9.5))
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 5))
    }

    private func keyValue(_ label: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Text(label)
                .foregroundStyle(Theme.textDim)
            Text(value)
                .foregroundStyle(Theme.textMuted)
                .monospacedDigit()
        }
        .font(mono(9.5))
    }
}

// MARK: - Store extensions

extension RouterStore {
    var avgDuration: String {
        guard let d = snapshot?.overview.avg_duration_s else { return "--" }
        return String(format: "%.1fs", d)
    }
    var successPct: String {
        let total = max(completedCount + failedCount, 1)
        return "\(Int(Double(completedCount) / Double(total) * 100))%"
    }
}
