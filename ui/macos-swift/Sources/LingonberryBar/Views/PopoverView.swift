import SwiftUI
import AppKit

// MARK: - Reactive Theme (follows macOS @Environment(\.colorScheme) dynamically)

struct ThemePalette {
    let isDark: Bool

    init(colorScheme: ColorScheme) {
        self.isDark = (colorScheme == .dark)
    }

    var bg: Color        { isDark ? Color(0x09090B) : Color(0xFAFAFA) }
    var card: Color      { isDark ? Color(0x111114) : Color.white }
    var card2: Color     { isDark ? Color(0x18181B) : Color(0xF4F4F5) }
    var text: Color      { isDark ? Color(0xFAFAFA) : Color(0x09090B) }
    var textMuted: Color { isDark ? Color(0xA1A1AA) : Color(0x52525B) }
    var textDim: Color   { isDark ? Color(0x71717A) : Color(0xA1A1AA) }
    var accent: Color    { isDark ? Color(0x6366F1) : Color(0x4F46E5) }
    var ok: Color        { isDark ? Color(0x34D399) : Color(0x059669) }
    var warn: Color      { isDark ? Color(0xF59E0B) : Color(0xD97706) }
    var err: Color       { isDark ? Color(0xF87171) : Color(0xDC2626) }
    var border: Color     { isDark ? Color.white.opacity(0.09) : Color.black.opacity(0.08) }
    var borderSoft: Color { isDark ? Color.white.opacity(0.05) : Color.black.opacity(0.04) }
    var accentWash: Color { accent.opacity(isDark ? 0.16 : 0.08) }
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

func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
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
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    var body: some View {
        VStack(spacing: 0) {
            HeaderView(store: store) {
                Task { await store.quit() }
            }
            if store.showSetup {
                if scrolls {
                    ScrollView { SetupPanelView(store: store) }.scrollIndicators(.visible)
                } else {
                    SetupPanelView(store: store)
                }
            } else if scrolls {
                ScrollView { content }.scrollIndicators(.visible)
            } else {
                content
            }
        }
        .frame(width: 880, height: height, alignment: .top)
        .background(theme.bg)
    }

    private var content: some View {
        VStack(spacing: 12) {
            if let r = store.readiness, (!r.pi_installed || r.mode == "bare_minimum") {
                ReadinessBannerView(readiness: r, store: store)
            }
            StatStripView(store: store)
            GraphView(store: store)
            CardsRowView(store: store)
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
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    var body: some View {
        HStack(spacing: 10) {
            Text("Lingonberry")
                .font(mono(13.5, .semibold))
                .foregroundStyle(theme.text)
            Text(store.isRouterUp ? "127.0.0.1:8799" : "offline")
                .font(mono(10.5))
                .foregroundStyle(store.isRouterUp ? theme.ok : theme.err)

            if !store.pendingTickets.isEmpty {
                Button(action: {
                    store.setupTab = .overnight
                    store.showSetup = true
                }) {
                    Text("\(store.pendingTickets.count) overnight")
                        .font(mono(9.5, .semibold))
                        .foregroundStyle(theme.card)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(theme.warn)
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                }
                .buttonStyle(.plain)
                .focusable(false)
            }

            if let error = store.lastError {
                Text(error)
                    .font(mono(8.5))
                    .foregroundStyle(theme.err)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer()

            Button(action: {
                store.showSetup.toggle()
            }) {
                HStack(spacing: 4) {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 11, weight: .medium))
                    Text("Setup")
                        .font(mono(10, .medium))
                }
                .foregroundStyle(store.showSetup ? theme.accent : theme.textMuted)
                .padding(.horizontal, 7)
                .frame(height: 24)
                .background(store.showSetup ? theme.accentWash : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .focusable(false)
            .help("Keychain keys, pi-rust, self-config, and Overnight tickets")

            Button(action: { Task { await store.refresh() } }) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.textMuted)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .focusable(false)
            .help("Refresh")

            Button(action: onQuit) {
                Text("Quit")
                    .font(mono(10.5, .medium))
                    .foregroundStyle(theme.textMuted)
                    .padding(.horizontal, 6)
                    .frame(height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .focusable(false)
        }
        .padding(.horizontal, 16)
        .frame(height: 42)
        .background(theme.card)
        .overlay(Rectangle().fill(theme.border).frame(height: 1), alignment: .bottom)
    }
}

// MARK: - Readiness Banner

struct ReadinessBannerView: View {
    let readiness: ReadinessReport
    @ObservedObject var store: RouterStore
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wrench.and.screwdriver")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.warn)
            Text(readiness.pi_installed
                 ? "Bare minimum mode — add a free NVIDIA NIM / Groq / Google key or start Ollama."
                 : "pi-rust not installed — running built-in mini-harness fallback.")
                .font(mono(10))
                .foregroundStyle(theme.text)
                .lineLimit(1)
            Spacer()
            if !readiness.pi_installed {
                Button(store.isBusyAction ? "Installing…" : "Install pi-rust") {
                    store.setupTab = .selfConfig
                    store.showSetup = true
                    Task { await store.installPiRust() }
                }
                .buttonStyle(.plain)
                .font(mono(9.5, .semibold))
                .foregroundStyle(theme.card)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(theme.accent)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .disabled(store.isBusyAction)
            } else {
                Button("Add Key") {
                    store.setupTab = .keys
                    store.showSetup = true
                }
                .buttonStyle(.plain)
                .font(mono(9.5, .semibold))
                .foregroundStyle(theme.card)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(theme.accent)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(theme.warn.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.warn.opacity(0.35)))
    }
}

// MARK: - Stats

struct StatStripView: View {
    @ObservedObject var store: RouterStore
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    var body: some View {
        HStack(spacing: 0) {
            cell("Running", "\(store.runningCount)/\(store.watchdog?.max_concurrent_workers ?? 6)", store.runningCount > 0 ? theme.ok : theme.text)
            divider
            cell("RAM · Disk", store.watchdogSummary, store.watchdog?.paused_reason != nil ? theme.err : theme.text)
            divider
            cell("Sandbox", store.sandbox?.default_local_tier ?? "seatbelt", theme.ok)
            divider
            cell("5h Burst", store.burstSummary, theme.text)
            divider
            cell("Success", store.successPct, theme.ok)
        }
        .padding(.vertical, 10)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))
    }

    private var divider: some View {
        Rectangle().fill(theme.borderSoft).frame(width: 1, height: 28)
    }

    private func cell(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(mono(10))
                .foregroundStyle(theme.textMuted)
            Text(value)
                .font(mono(18, .semibold))
                .monospacedDigit()
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
    }
}

// MARK: - Graph (collapsed strip when idle; true Caller -> Router -> Worker when active)

struct GraphView: View {
    @ObservedObject var store: RouterStore
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    private func providerColor(_ provider: String?) -> Color {
        guard let p = provider?.lowercased() else { return theme.textDim }
        switch p {
        case "nim": return Color(0xF59E0B)
        case "google": return Color(0x3B82F6)
        case "groq": return Color(0xA855F7)
        case "openrouter": return Color(0xEC4899)
        case "ollama": return Color(0x10B981)
        default: return theme.accent
        }
    }

    private var activeRows: [LiveWorker] {
        store.liveWorkers
    }

    private var isIdle: Bool {
        activeRows.isEmpty
    }

    var body: some View {
        if isIdle {
            // Compact idle bar — frees space for providers, jobs, and scannable sessions.
            HStack(spacing: 8) {
                Circle()
                    .fill(store.isRouterUp ? theme.ok : theme.err)
                    .frame(width: 6, height: 6)
                Text("Orchestration")
                    .font(mono(10.5, .semibold))
                    .foregroundStyle(theme.textMuted)
                Text("Router idle · ready for dispatch")
                    .font(mono(10))
                    .foregroundStyle(theme.textDim)
                Spacer()
                if let r = store.readiness {
                    Text("\(r.agents_count) agents · \(r.free_keys_count) free keys · \(store.specs.count) specs")
                        .font(mono(9.5))
                        .foregroundStyle(theme.textDim)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))
        } else {
            let visibleRows = Array(activeRows.prefix(5))
            let panelHeight: CGFloat = max(132, CGFloat(visibleRows.count) * 52 + 24)
            let callers: [String] = {
                var seen: [String] = []
                for w in visibleRows {
                    let c = w.caller ?? "shell"
                    if !seen.contains(c) { seen.append(c) }
                }
                return seen
            }()

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Text("Orchestration")
                        .font(mono(11, .semibold))
                        .foregroundStyle(theme.textMuted)
                    Spacer()
                    Text("\(activeRows.count) running")
                        .font(mono(10.5, .medium))
                        .foregroundStyle(theme.ok)
                }

                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    let now = ctx.date.timeIntervalSince1970
                    GeometryReader { geo in
                        let w = geo.size.width
                        let h = geo.size.height
                        let centerX = w * 0.5
                        let midY = h * 0.5
                        let routerHalfW: CGFloat = 52
                        let leftAnchorX: CGFloat = 138
                        let rightAnchorX: CGFloat = w - 210

                        ZStack {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(theme.card)
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(theme.border, lineWidth: 1)

                            // Caller -> Router Bezier curves
                            ForEach(Array(callers.enumerated()), id: \.offset) { i, _ in
                                let y = h * CGFloat(i + 1) / CGFloat(callers.count + 1)
                                let start = CGPoint(x: leftAnchorX, y: y)
                                let end = CGPoint(x: centerX - routerHalfW, y: midY)
                                Path { p in
                                    p.move(to: start)
                                    let dx = (end.x - start.x) * 0.5
                                    p.addCurve(
                                        to: end,
                                        control1: CGPoint(x: start.x + dx, y: start.y),
                                        control2: CGPoint(x: end.x - dx, y: end.y)
                                    )
                                }
                                .stroke(theme.ok.opacity(0.45), lineWidth: 2)
                            }

                            // Router -> Worker Bezier curves
                            ForEach(Array(visibleRows.enumerated()), id: \.element.id) { i, worker in
                                let y = h * CGFloat(i + 1) / CGFloat(visibleRows.count + 1)
                                let start = CGPoint(x: centerX + routerHalfW, y: midY)
                                let end = CGPoint(x: rightAnchorX, y: y)
                                let col = providerColor(worker.provider)
                                Path { p in
                                    p.move(to: start)
                                    let dx = (end.x - start.x) * 0.5
                                    p.addCurve(
                                        to: end,
                                        control1: CGPoint(x: start.x + dx, y: start.y),
                                        control2: CGPoint(x: end.x - dx, y: end.y)
                                    )
                                }
                                .stroke(col.opacity(0.55), lineWidth: 2.5)
                            }

                            // Caller pills (fixedSize prevents full-width HStack overflow)
                            ForEach(Array(callers.enumerated()), id: \.offset) { i, caller in
                                let y = h * CGFloat(i + 1) / CGFloat(callers.count + 1)
                                GraphNodeView(
                                    label: caller,
                                    subtitle: nil,
                                    icon: callerIcon(caller),
                                    color: theme.ok,
                                    theme: theme
                                )
                                .position(x: 78, y: y)
                            }

                            // Worker pills with live elapsed + stop action
                            ForEach(Array(visibleRows.enumerated()), id: \.element.id) { i, worker in
                                let y = h * CGFloat(i + 1) / CGFloat(visibleRows.count + 1)
                                let liveS = max(worker.elapsed_s, max(0, now - worker.started))
                                let col = providerColor(worker.provider)
                                HStack(spacing: 6) {
                                    GraphNodeView(
                                        label: worker.worker,
                                        subtitle: String(format: "%.0fs", liveS),
                                        icon: workerIcon(worker.worker),
                                        color: col,
                                        theme: theme
                                    )
                                    Button(action: { Task { await store.killWorker(pid: worker.pid) } }) {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.system(size: 13))
                                            .foregroundStyle(theme.textDim)
                                    }
                                    .buttonStyle(.plain)
                                    .focusable(false)
                                    .help("Stop worker run")
                                }
                                .fixedSize()
                                .position(x: w - 108, y: y)
                            }

                            // Center Router badge
                            VStack(spacing: 3) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 11)
                                        .fill(theme.accent.opacity(0.15))
                                    RoundedRectangle(cornerRadius: 11)
                                        .stroke(theme.accent, lineWidth: 1.5)
                                    Image(systemName: "network")
                                        .font(.system(size: 18, weight: .medium))
                                        .foregroundStyle(theme.accent)
                                }
                                .frame(width: 46, height: 46)
                                Text("Router")
                                    .font(mono(11, .semibold))
                                    .foregroundStyle(theme.text)
                            }
                            .fixedSize()
                            .position(x: centerX, y: midY)
                        }
                    }
                    .frame(height: panelHeight)
                }
            }
            .padding(12)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))
        }
    }

    private func callerIcon(_ name: String) -> String {
        let lower = name.lowercased()
        if lower.contains("claude") { return "sparkles" }
        if lower.contains("codex") { return "hexagon.fill" }
        if lower.contains("opencode") { return "arrow.triangle.branch" }
        if lower.contains("overnight") { return "moon.stars.fill" }
        return "terminal"
    }

    private func workerIcon(_ name: String) -> String {
        let lower = name.lowercased()
        if lower.hasPrefix("pi:") { return "cpu" }
        if lower.contains("nim") { return "cube.fill" }
        if lower.contains("google") { return "sparkles" }
        if lower.contains("groq") { return "bolt.fill" }
        if lower.contains("openrouter") { return "arrow.triangle.branch" }
        return "cpu"
    }
}

struct GraphNodeView: View {
    let label: String
    let subtitle: String?
    let icon: String
    let color: Color
    let theme: ThemePalette

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(color)
            Text(label)
                .font(mono(10, .medium))
                .foregroundStyle(theme.text)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 120, alignment: .leading)
            if let subtitle = subtitle {
                Text(subtitle)
                    .font(mono(9.5))
                    .foregroundStyle(theme.textDim)
                    .monospacedDigit()
            }
        }
        .fixedSize()
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(color.opacity(0.12))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(color.opacity(0.45), lineWidth: 1))
        )
    }
}

// MARK: - Cards Row (hides WorkersCard when idle)

struct CardsRowView: View {
    @ObservedObject var store: RouterStore
    private let cardHeight: CGFloat = 224

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if !store.liveWorkers.isEmpty {
                WorkersCard(store: store).frame(maxWidth: .infinity, maxHeight: cardHeight)
            }
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
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(mono(11, .semibold))
                    .foregroundStyle(theme.textMuted)
                Spacer()
                Text(meta)
                    .font(mono(9.5))
                    .foregroundStyle(theme.textDim)
            }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(12)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))
    }
}

struct WorkersCard: View {
    @ObservedObject var store: RouterStore
    var body: some View {
        CardShell(title: "Active Workers", meta: "\(store.liveWorkers.count) live") {
            ScrollingStack {
                LazyVStack(spacing: 5) {
                    ForEach(store.liveWorkers) { worker in
                        WorkerRow(worker: worker) {
                            Task { await store.killWorker(pid: worker.pid) }
                        }
                    }
                }
            }
        }
    }
}

struct WorkerRow: View {
    let worker: LiveWorker
    var onKill: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let liveS = max(worker.elapsed_s, max(0, ctx.date.timeIntervalSince1970 - worker.started))
            HStack(spacing: 7) {
                Circle().fill(theme.ok).frame(width: 5, height: 5)
                VStack(alignment: .leading, spacing: 2) {
                    Text(worker.worker)
                        .font(mono(10.5, .medium))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    Text(worker.task)
                        .font(mono(9.5))
                        .foregroundStyle(theme.textDim)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer(minLength: 4)
                Text(String(format: "%.0fs", liveS))
                    .font(mono(9.5))
                    .foregroundStyle(theme.textDim)
                    .monospacedDigit()
                Button(action: onKill) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(theme.textDim)
                }
                .buttonStyle(.plain)
                .focusable(false)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(theme.card2)
            .clipShape(RoundedRectangle(cornerRadius: 7))
        }
    }
}

struct ProvidersCard: View {
    @ObservedObject var store: RouterStore
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    var body: some View {
        CardShell(title: "Providers & Keys", meta: "\(store.workers.count) keys") {
            ScrollingStack {
                LazyVStack(spacing: 5) {
                    if store.workers.isEmpty {
                        Text("No keys configured — open Setup → Keys")
                            .font(mono(10))
                            .foregroundStyle(theme.textDim)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        ForEach(grouped, id: \.name) { group in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(group.name)
                                    .font(mono(9.5, .medium))
                                    .foregroundStyle(theme.textDim)
                                    .padding(.top, 2)
                                ForEach(group.keys) { key in
                                    HStack(spacing: 6) {
                                        Circle()
                                            .fill(key.isCooling ? theme.warn : theme.ok)
                                            .frame(width: 5, height: 5)
                                        Text(key.name)
                                            .font(mono(10))
                                            .foregroundStyle(theme.text)
                                            .lineLimit(1)
                                            .truncationMode(.middle)
                                        if key.cost_tier == "metered_paid" {
                                            Text("paid")
                                                .font(mono(8.5, .medium))
                                                .foregroundStyle(theme.warn)
                                        }
                                        Spacer(minLength: 4)
                                        Text(key.isCooling ? "\(key.cooling_remaining_s)s" : (key.inflight > 0 ? "\(key.inflight) live" : key.status))
                                            .font(mono(9.5))
                                            .foregroundStyle(key.isCooling ? theme.warn : theme.textDim)
                                    }
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
        let labels = [
            "nim": "NVIDIA NIM",
            "groq": "Groq",
            "google": "Google AI",
            "openrouter": "OpenRouter",
            "ollama": "Ollama (Local)",
            "openai": "OpenAI (Paid)",
            "anthropic": "Anthropic (Paid)",
        ]
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
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    var body: some View {
        CardShell(title: "Jobs", meta: "\(store.managedJobs.count) managed · \(store.discoveredJobs.count) host") {
            ScrollingStack {
                LazyVStack(alignment: .leading, spacing: 5) {
                    if !store.managedJobs.isEmpty {
                        Text("Managed by Lingonberry")
                            .font(mono(9, .semibold))
                            .foregroundStyle(theme.textDim)
                        ForEach(store.managedJobs) { job in
                            JobRowView(
                                job: job,
                                selected: store.selectedJob == job.name,
                                onSelect: {
                                    store.selectedJob = (store.selectedJob == job.name) ? nil : job.name
                                }
                            )
                        }
                    }

                    if !store.discoveredJobs.isEmpty {
                        Text("Host Discovered (Read-Only)")
                            .font(mono(9, .semibold))
                            .foregroundStyle(theme.textDim)
                            .padding(.top, store.managedJobs.isEmpty ? 0 : 4)
                        ForEach(store.discoveredJobs) { job in
                            JobRowView(
                                job: job,
                                selected: store.selectedJob == job.name,
                                onSelect: {
                                    store.selectedJob = (store.selectedJob == job.name) ? nil : job.name
                                }
                            )
                        }
                    }

                    if store.jobs.isEmpty {
                        Text("No scheduled jobs")
                            .font(mono(10.5))
                            .foregroundStyle(theme.textDim)
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
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 7) {
                Circle()
                    .fill(job.isReadOnly ? theme.textDim : (job.paused == true ? theme.textDim : (job.health == "healthy" ? theme.ok : theme.warn)))
                    .frame(width: 5, height: 5)
                VStack(alignment: .leading, spacing: 2) {
                    Text(job.name)
                        .font(mono(10.5, .medium))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    HStack(spacing: 6) {
                        Text(job.isReadOnly ? "\(job.source ?? "host") · read-only" : job.nextRun)
                            .font(mono(9.5))
                            .foregroundStyle(theme.textDim)
                        if let rc = job.rc, rc != 0 {
                            Text("rc \(rc)")
                                .font(mono(9.5))
                                .foregroundStyle(theme.err)
                        }
                    }
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(selected ? theme.accent : theme.textDim)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? theme.accentWash : theme.card2)
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .stroke(selected ? theme.accent.opacity(0.5) : .clear)
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
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(job.name)
                    .font(mono(12, .semibold))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                Text(job.isReadOnly ? "read-only host" : (job.paused == true ? "paused" : (job.health ?? "unknown")))
                    .font(mono(9.5, .medium))
                    .foregroundStyle(job.isReadOnly ? theme.textMuted : (job.paused == true ? theme.textDim : (job.health == "healthy" ? theme.ok : theme.warn)))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(theme.card2)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(theme.textMuted)
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
            }

            VStack(alignment: .leading, spacing: 3) {
                Text("Command")
                    .font(mono(9.5))
                    .foregroundStyle(theme.textDim)
                Text(job.command ?? job.prompt ?? "—")
                    .font(mono(10.5))
                    .foregroundStyle(theme.text)
                    .textSelection(.enabled)
                    .lineLimit(2)
            }

            if let logs = job.log_tail, !logs.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Log tail")
                        .font(mono(9.5))
                        .foregroundStyle(theme.textDim)
                    ForEach(Array(logs.prefix(4).enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(mono(10))
                            .foregroundStyle(theme.textMuted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                    }
                }
            }

            if let err = job.last_error, !err.isEmpty {
                Text(err)
                    .font(mono(10))
                    .foregroundStyle(theme.err)
                    .lineLimit(2)
            }

            if !job.isReadOnly {
                HStack(spacing: 8) {
                    action(job.paused == true ? "Resume" : "Pause") {
                        Task { await store.toggleCron(job.name) }
                    }
                    action("Run now", emphasis: true) {
                        Task { await store.runCronNow(job.name) }
                    }
                    if job.health != "healthy" {
                        action("Heal") {
                            Task { await store.healCron(job.name) }
                        }
                    }
                    Spacer()
                }
            } else {
                Text("Monitored read-only from host OS scheduler; Lingonberry never triggers host jobs automatically.")
                    .font(mono(9.5))
                    .foregroundStyle(theme.textDim)
            }
        }
        .padding(14)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.accent.opacity(0.35)))
    }

    private func field(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(mono(9.5))
                .foregroundStyle(theme.textDim)
            Text(value)
                .font(mono(10.5, .medium))
                .foregroundStyle(theme.text)
        }
    }

    private func action(_ title: String, emphasis: Bool = false, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(title)
                .font(mono(10.5, .medium))
                .foregroundStyle(emphasis ? theme.card : theme.text)
                .padding(.horizontal, 10)
                .frame(height: 26)
                .background(emphasis ? theme.accent : theme.card2)
                .clipShape(RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(emphasis ? .clear : theme.border))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focusable(false)
    }
}

// MARK: - Sessions (ADHD-friendly: crisp 2-line scan row + progressive disclosure detail)

struct SessionsView: View {
    @ObservedObject var store: RouterStore
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }
    private var filter: String { store.sessionFilter }
    private var expanded: String? { store.expandedSession }

    private var visible: [SessionRow] {
        let all = store.sessions
        switch filter {
        case "running": return all.filter { $0.state == "running" || $0.state == "leased" }
        case "blocked": return all.filter { $0.state == "blocked" || $0.state == "failed" || $0.state == "escalated" }
        case "done": return all.filter { $0.state == "done" }
        default: return all
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Sessions")
                    .font(mono(11, .semibold))
                    .foregroundStyle(theme.textMuted)
                Spacer()
                tab("all", store.sessions.count)
                tab("running", store.sessions.filter { $0.state == "running" || $0.state == "leased" }.count)
                tab("blocked", store.sessions.filter { $0.state == "blocked" || $0.state == "failed" || $0.state == "escalated" }.count)
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
                        .foregroundStyle(theme.textDim)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(12)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))
    }

    private func tab(_ id: String, _ count: Int) -> some View {
        Button(action: { store.sessionFilter = id }) {
            Text("\(id) \(count)")
                .font(mono(10, filter == id ? .medium : .regular))
                .monospacedDigit()
                .foregroundStyle(filter == id ? theme.text : theme.textDim)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(filter == id ? theme.card2 : .clear)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focusable(false)
    }
}

struct SessionRowView: View {
    let session: SessionRow
    let expanded: Bool
    var onToggle: () -> Void

    @ViewState private var showPipeline: Bool = false
    @ViewState private var copiedOutput: Bool = false
    @Environment(\.colorScheme) private var colorScheme

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    private var isActive: Bool {
        session.state == "running" || session.state == "leased"
    }

    private var stateColor: Color {
        switch session.state {
        case "done": return theme.ok
        case "running", "leased": return theme.warn
        default: return theme.err
        }
    }

    private var summaryLine: String {
        if let reason = session.reason, !reason.isEmpty, session.state != "done" {
            return reason
        }
        return session.prompt
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Button(action: onToggle) {
                HStack(spacing: 7) {
                    Circle().fill(stateColor).frame(width: 5, height: 5)
                    Text(session.worker)
                        .font(mono(10.5, .medium))
                        .foregroundStyle(theme.text)
                    if let key = session.key {
                        Text(key)
                            .font(mono(9.5))
                            .foregroundStyle(theme.textDim)
                            .lineLimit(1)
                    }
                    if let caller = session.caller, !caller.isEmpty {
                        Text("← \(caller)")
                            .font(mono(9.5))
                            .foregroundStyle(theme.textDim)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 6)

                    if let gate = session.gate_status, gate != "not_run" {
                        Image(systemName: gate == "passed" ? "checkmark.shield.fill" : "xmark.shield.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(gate == "passed" ? theme.ok : theme.err)
                            .help("Gate: \(gate)")
                    }

                    Text(session.state)
                        .font(mono(9.5))
                        .foregroundStyle(stateColor)

                    if isActive {
                        TimelineView(.periodic(from: .now, by: 1)) { ctx in
                            let liveS = max(session.duration_s, max(0, ctx.date.timeIntervalSince1970 - session.ts))
                            Text(String(format: "%.0fs", liveS))
                                .font(mono(9.5))
                                .foregroundStyle(theme.warn)
                                .monospacedDigit()
                        }
                    } else {
                        Text(String(format: "%.1fs", session.duration_s))
                            .font(mono(9.5))
                            .foregroundStyle(theme.textDim)
                            .monospacedDigit()
                    }

                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(expanded ? theme.accent : theme.textDim)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .focusable(false)

            Text(summaryLine)
                .font(mono(10.5))
                .foregroundStyle(session.state == "done" ? theme.text.opacity(0.88) : stateColor.opacity(0.92))
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
        .background(theme.card2)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(expanded ? theme.accent.opacity(0.45) : .clear)
        )
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                if let cooked = session.cooked {
                    tag("skill", cooked.selected_skill)
                    tag("gate", session.gate_status ?? cooked.gate_policy)
                } else if let gate = session.gate_status {
                    tag("gate", gate)
                }
                if let tier = session.cost_tier {
                    tag("tier", tier)
                }
                if let sb = session.sandbox_tier {
                    tag("sandbox", sb)
                }
                if let esc = session.escalation_from {
                    tag("escalated", esc)
                }
                keyValue("tokens", "\(session.tokens_in ?? 0)/\(session.tokens_out ?? 0)")
                if let rid = session.receipt_id {
                    keyValue("receipt", String(rid.prefix(8)))
                }
                Spacer()
            }

            if let output = session.output, !output.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Output")
                            .font(mono(9.5))
                            .foregroundStyle(theme.textDim)
                        Spacer()
                        Button(copiedOutput ? "Copied" : "Copy") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(output, forType: .string)
                            copiedOutput = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                copiedOutput = false
                            }
                        }
                        .buttonStyle(.plain)
                        .font(mono(9.5, .medium))
                        .foregroundStyle(copiedOutput ? theme.ok : theme.accent)
                    }
                    Text(output)
                        .font(mono(10))
                        .foregroundStyle(theme.text)
                        .lineLimit(14)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .background(theme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            } else if let reason = session.reason, !reason.isEmpty {
                Text(reason)
                    .font(mono(10))
                    .foregroundStyle(theme.err)
                    .textSelection(.enabled)
            } else {
                Text("No worker output recorded")
                    .font(mono(9.5))
                    .foregroundStyle(theme.textDim)
            }

            if !session.steps.isEmpty {
                Button(action: { showPipeline.toggle() }) {
                    HStack(spacing: 5) {
                        Image(systemName: showPipeline ? "chevron.down" : "chevron.right")
                            .font(.system(size: 8.5, weight: .semibold))
                        Text("Pipeline (\(session.steps.count) steps)")
                            .font(mono(9.5, .medium))
                    }
                    .foregroundStyle(theme.textMuted)
                }
                .buttonStyle(.plain)
                .focusable(false)

                if showPipeline {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(Array(session.steps.prefix(8))) { step in
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(step.tone == "error" ? theme.err : theme.accent)
                                    .frame(width: 4, height: 4)
                                Text(step.title)
                                    .font(mono(9.5, .medium))
                                    .foregroundStyle(theme.text)
                                Text(step.detail)
                                    .font(mono(9.5))
                                    .foregroundStyle(theme.textDim)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                            }
                        }
                    }
                }
            }
        }
    }

    private func tag(_ label: String, _ value: String) -> some View {
        HStack(spacing: 3) {
            Text(label)
                .foregroundStyle(theme.textDim)
            Text(value.isEmpty ? "—" : value)
                .foregroundStyle(theme.text)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .font(mono(9.5))
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 5))
    }

    private func keyValue(_ label: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Text(label)
                .foregroundStyle(theme.textDim)
            Text(value)
                .foregroundStyle(theme.textMuted)
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
    var watchdogSummary: String {
        guard let w = watchdog else { return "--" }
        return String(format: "%.0f%% · %.0fG", w.ram_used_pct, w.free_disk_gb)
    }
    var burstSummary: String {
        guard let w = watchdog else { return "0/45" }
        return "\(w.subscription_burst_used)/\(w.subscription_burst_cap)"
    }
}
