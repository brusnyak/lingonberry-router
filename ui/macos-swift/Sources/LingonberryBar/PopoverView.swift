import SwiftUI

enum BarThemeMode: String, CaseIterable {
    case system = "System"
    case light = "Day"
    case dark = "Night"
}

enum PopoverTab: String, CaseIterable {
    case overview = "Overview"
    case cron = "Cron Oversight"
}

struct PopoverView: View {
    @ObservedObject var client: RouterClient
    @AppStorage("lingonberry-bar-theme") private var themeMode: BarThemeMode = .dark
    @State private var tab: PopoverTab = .overview
    @State private var expandedSessionId: String?
    @State private var expandedJobName: String?

    private var colorSchemeOverride: ColorScheme? {
        switch themeMode {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            Divider().opacity(0.25)

            if let snap = client.snapshot {
                telemetryStrip(snap)
                Divider().opacity(0.2)

                ScrollView {
                    if tab == .overview {
                        VStack(spacing: 12) {
                            orchestrationCard(snap)
                            sessionsAndRightColumn(snap)
                        }
                        .padding(14)
                    } else {
                        cronOversightView(snap)
                            .padding(14)
                    }
                }
                .frame(maxHeight: 560)

                footerBar(snap)
            } else {
                VStack(spacing: 8) {
                    Text("Waiting for lingonberry-core on 127.0.0.1:8799")
                        .font(.system(size: 12, weight: .medium))
                    Text("Run `lingonberry-core serve` or click Rescan.")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Button("Retry Connection") {
                        Task { await client.refresh() }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                .frame(maxWidth: .infinity, minHeight: 240)
            }
        }
        .frame(width: 660)
        .background(Color(NSColor.windowBackgroundColor))
        .preferredColorScheme(colorSchemeOverride)
    }

    private var headerBar: some View {
        HStack(spacing: 10) {
            Text("Lingonberry Router")
                .font(.system(size: 13, weight: .semibold))

            Picker("", selection: $tab) {
                ForEach(PopoverTab.allCases, id: \.self) { t in
                    Text(t.rawValue).tag(t)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 210)

            Spacer()

            Picker("", selection: $themeMode) {
                ForEach(BarThemeMode.allCases, id: \.self) { m in
                    Text(m.rawValue).tag(m)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 155)

            Button("Rescan") {
                Task { await client.rescan() }
            }
            .buttonStyle(.borderless)
            .font(.system(size: 11, weight: .medium))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func telemetryStrip(_ snap: Snapshot) -> some View {
        let total = max(1, snap.overview.completed24h + snap.overview.failed24h)
        let successPct = Int(Double(snap.overview.completed24h) / Double(total) * 100.0)
        let activeKeys = snap.workers.filter { $0.status == "active" || $0.status == "idle" }.count

        return VStack(spacing: 8) {
            HStack(spacing: 12) {
                Text("running: \(snap.overview.running) slots")
                Text("·").foregroundStyle(.tertiary)
                Text(String(format: "avg: %.1fs", snap.overview.avgDurationS ?? 0.0))
                Text("·").foregroundStyle(.tertiary)
                Text("keys: \(activeKeys)/\(snap.workers.count)")
                Text("·").foregroundStyle(.tertiary)
                Text("cron pids: \(snap.cronLive.count)")
                Spacer()
                Text("success \(successPct)%")
                    .foregroundStyle(.green)
            }
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(.secondary)

            GeometryReader { geo in
                let passRatio = CGFloat(snap.overview.completed24h) / CGFloat(total)
                HStack(spacing: 1) {
                    Rectangle().fill(Color.green.opacity(0.75))
                        .frame(width: max(4, geo.size.width * passRatio))
                    Rectangle().fill(Color.red.opacity(0.65))
                }
            }
            .frame(height: 3)
            .clipShape(RoundedRectangle(cornerRadius: 2))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private func orchestrationCard(_ snap: Snapshot) -> some View {
        let callers = Array(Set(snap.sessions.prefix(3).compactMap { $0.caller }))
        let callerList = callers.isEmpty ? ["claude", "codex"] : callers
        let workers = Array(snap.workers.prefix(3))

        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("ORCHESTRATION")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(snap.overview.liveWorkers) active · \(snap.jobs.count) cron")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(callerList, id: \.self) { caller in
                        Text(caller)
                            .font(.system(size: 11, design: .monospaced))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.primary.opacity(0.05))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                }
                .frame(width: 120)

                Spacer()

                VStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color.primary.opacity(0.25), lineWidth: 1)
                        .frame(width: 54, height: 54)
                        .overlay(
                            Image(systemName: "arrow.triangle.branch")
                                .font(.system(size: 18, weight: .medium))
                        )
                    Text("Router")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                VStack(alignment: .leading, spacing: 6) {
                    ForEach(workers) { w in
                        HStack {
                            Circle()
                                .fill(w.status == "down" ? Color.orange : w.status == "active" ? Color.blue : Color.green)
                                .frame(width: 6, height: 6)
                            Text(w.name)
                                .font(.system(size: 10, design: .monospaced))
                                .lineLimit(1)
                            Spacer()
                            Text(w.provider ?? "api")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Color.primary.opacity(0.05))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                }
                .frame(width: 190)

                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
                .frame(width: 34)
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.03))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.1), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func sessionsAndRightColumn(_ snap: Snapshot) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("SESSIONS")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)

                ForEach(snap.sessions.prefix(4)) { s in
                    VStack(alignment: .leading, spacing: 4) {
                        Button {
                            expandedSessionId = expandedSessionId == s.id ? nil : s.id
                        } label: {
                            HStack {
                                Circle()
                                    .fill(s.state == "done" ? Color.green : s.state == "running" ? Color.blue : Color.orange)
                                    .frame(width: 6, height: 6)
                                Text(s.prompt)
                                    .font(.system(size: 11, weight: .medium))
                                    .lineLimit(1)
                                Spacer()
                                Text(String(format: "%.1fs", s.durationS))
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)

                        if expandedSessionId == s.id {
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(s.steps) { st in
                                    Text("> \(st.title) — \(st.detail)")
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.top, 4)
                        }
                    }
                    .padding(8)
                    .background(Color.primary.opacity(0.03))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.08), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)

            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("WORKER SLOTS")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.secondary)

                    if snap.workersLive.isEmpty {
                        Text("Idle — waiting for dispatch")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.primary.opacity(0.03))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    } else {
                        ForEach(snap.workersLive) { w in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(w.worker).font(.system(size: 11, weight: .medium))
                                    Text("pid \(w.pid) · \(w.key ?? "local")")
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("Kill") {
                                    Task { await client.killWorker(pid: w.pid) }
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.mini)
                                .tint(.red)
                            }
                            .padding(8)
                            .background(Color.primary.opacity(0.03))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("CRON JOBS")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.secondary)

                    ForEach(snap.jobs.prefix(3)) { job in
                        HStack(spacing: 6) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(job.name)
                                    .font(.system(size: 11, weight: .medium))
                                    .lineLimit(1)
                                Text("\(job.schedule) · \(job.health)")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundStyle(job.health == "crashed" ? Color.red : Color.secondary)
                            }
                            Spacer()
                            if job.health == "crashed" {
                                Button("Heal") {
                                    Task { await client.healJob(name: job.name) }
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.mini)
                            } else {
                                Button(job.paused == true ? "Resume" : "Pause") {
                                    Task { await client.toggleJob(name: job.name) }
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.mini)
                            }
                        }
                        .padding(7)
                        .background(Color.primary.opacity(0.03))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
            .frame(width: 240)
        }
    }

    private func cronOversightView(_ snap: Snapshot) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("LIVE CRON PROCESSES (\(snap.cronLive.count))")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Rescan OS Crons") {
                    Task { await client.rescan() }
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)
            }

            if snap.cronLive.isEmpty {
                Text("No active cron child processes running right now.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.03))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                ForEach(snap.cronLive) { proc in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(proc.jobName) · pid \(proc.pid)")
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                            Text(proc.command)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Text(String(format: "%.1f%% · %.1fMB", proc.cpuPct, proc.memMb))
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                        Button("Kill PID") {
                            Task { await client.killCronPid(pid: proc.pid) }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                        .tint(.red)
                    }
                    .padding(8)
                    .background(Color.primary.opacity(0.03))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }

            Text("SCHEDULED & WATCHDOG JOBS (\(snap.jobs.count))")
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)

            ForEach(snap.jobs) { job in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(job.name) [\(job.source)]")
                                .font(.system(size: 11, weight: .semibold))
                            Text("\(job.schedule) · health: \(job.health) · crashes: \(job.crashCount)")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(job.health == "crashed" ? Color.red : Color.secondary)
                        }
                        Spacer()
                        Button(job.autoRestart ? "KeepAlive On" : "KeepAlive Off") {
                            Task { await client.toggleWatchdog(name: job.name) }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                        Button(job.paused == true ? "Resume" : "Pause") {
                            Task { await client.toggleJob(name: job.name) }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                        Button("Run") {
                            Task { await client.runJob(name: job.name) }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                        if job.health == "crashed" {
                            Button("Heal") {
                                Task { await client.healJob(name: job.name) }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.mini)
                        }
                    }

                    Button {
                        expandedJobName = expandedJobName == job.name ? nil : job.name
                    } label: {
                        Text(expandedJobName == job.name ? "Hide Logs" : "Show Tail Logs")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)

                    if expandedJobName == job.name {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(job.logTail, id: \.self) { line in
                                Text("> \(line)")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .padding(8)
                .background(Color.primary.opacity(0.03))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.08), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    private func footerBar(_ snap: Snapshot) -> some View {
        HStack {
            Text("~/.lingonberry/router.json · 127.0.0.1:8799")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
            Spacer()
            Text(snap.router.up ? "daemon online" : "offline")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
            Button("Quit") {
                client.stop()
                NSApplication.shared.terminate(nil)
            }
            .buttonStyle(.borderless)
            .font(.system(size: 10, weight: .medium))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.primary.opacity(0.03))
    }
}
