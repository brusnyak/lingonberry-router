import SwiftUI
import Combine
import AppKit
import UserNotifications

enum SetupTab: String, CaseIterable, Identifiable {
    case keys = "Keys"
    case selfConfig = "Self-Config & pi"
    case overnight = "Overnight"

    var id: String { rawValue }
}

final class RouterStore: ObservableObject {
    @Published var snapshot: Snapshot?
    @Published var isRouterUp: Bool = false
    @Published var lastError: String?
    @Published var isRefreshing: Bool = false
    @Published var version: VersionResp?

    // UI state kept off @State: the CLT toolchain cannot load SwiftUIMacros.
    @Published var selectedJob: String?
    @Published var expandedSession: String?
    @Published var sessionFilter: String = "all"
    @Published var showSetup: Bool = false
    @Published var setupTab: SetupTab = .keys

    // Setup / Keychain / Self-Config / Overnight state
    @Published var discoverData: DiscoverData?
    @Published var selfConfigPlan: SelfConfigPlan?
    @Published var piInstallCmd: String?
    @Published var isBusyAction: Bool = false
    @Published var actionNotice: String?
    @Published var actionError: String?

    private let client = RouterClient()
    private var timer: Timer?
    private let pollInterval: TimeInterval = 3.0
    private var retryCount: Int = 0
    private var isInitialStartup: Bool = true
    private var notifiedTicketIds: Set<String> = []

    func start() {
        Task { await self.refresh() }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            Task { await self.refresh() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    @MainActor
    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let snap = try await client.snapshot()
            self.snapshot = snap
            self.isRouterUp = true
            self.lastError = nil
            self.retryCount = 0
            self.isInitialStartup = false
            self.notifyNewOvernightTickets(snap.overnight?.tickets ?? [])
        } catch {
            let msg = "RouterStore.refresh failed: \(error.localizedDescription)\n"
            FileHandle.standardError.write(msg.data(using: .utf8)!)

            if self.snapshot == nil {
                self.isRouterUp = false
                if self.isInitialStartup {
                    self.retryCount += 1
                    if self.retryCount <= 5 {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                            guard let self = self else { return }
                            Task { await self.refresh() }
                        }
                    } else {
                        self.lastError = error.localizedDescription
                        self.isInitialStartup = false
                    }
                } else {
                    self.lastError = error.localizedDescription
                }
            } else {
                self.lastError = nil
            }
        }
    }

    @MainActor
    func loadSetupDetails() async {
        do {
            async let d = client.discover()
            async let sc = client.selfConfig()
            async let r = client.readiness()
            let (disc, plan, readyResp) = try await (d, sc, r)
            self.discoverData = disc
            self.selfConfigPlan = plan
            self.piInstallCmd = readyResp.pi_install_cmd
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    @MainActor
    func killWorker(pid: Int) async {
        do {
            try await client.killWorker(pid: pid)
            await refresh()
        } catch {
            self.lastError = "Kill failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    func runPrompt(
        _ prompt: String,
        worker: String? = nil,
        caller: String? = nil,
        liveApi: Bool = false,
        gate: String? = nil,
        worktree: Bool = false,
        readOnly: Bool = false,
        approve: Bool = false
    ) async -> RunRow? {
        do {
            let run = try await client.run(
                prompt: prompt,
                worker: worker,
                caller: caller,
                liveApi: liveApi,
                gate: gate,
                worktree: worktree,
                readOnly: readOnly,
                approve: approve
            )
            await refresh()
            return run
        } catch {
            self.lastError = "Run failed: \(error.localizedDescription)"
            return nil
        }
    }

    @MainActor
    func toggleCron(_ name: String) async {
        do {
            try await client.toggleJob(name: name)
            await refresh()
        } catch {
            self.lastError = "Toggle failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    func runCronNow(_ name: String) async {
        do {
            try await client.runJobNow(name: name)
            await refresh()
        } catch {
            self.lastError = "Run now failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    func healCron(_ name: String) async {
        do {
            try await client.healJob(name: name)
            await refresh()
        } catch {
            self.lastError = "Heal failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    func rescanAll() async {
        isBusyAction = true
        defer { isBusyAction = false }
        do {
            self.snapshot = try await client.rescan()
            await loadSetupDetails()
            self.actionError = nil
            self.actionNotice = "Rescanned agents, keys, and host jobs"
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    // MARK: - Keychain & Providers

    @MainActor
    func addKeychainKey(
        provider: String,
        label: String,
        apiKey: String,
        costTier: String,
        baseUrl: String?,
        model: String?,
        rpmLimit: Int?
    ) async -> Bool {
        isBusyAction = true
        actionError = nil
        actionNotice = nil
        defer { isBusyAction = false }
        do {
            let resp = try await client.addKey(
                provider: provider,
                label: label,
                apiKey: apiKey,
                costTier: costTier,
                baseUrl: baseUrl,
                model: model,
                rpmLimit: rpmLimit,
                testFirst: true
            )
            if let snap = resp.snapshot { self.snapshot = snap }
            await loadSetupDetails()
            let count = resp.models?.count ?? 0
            self.actionNotice = "Saved \(resp.slot ?? provider) to Keychain (\(count) models verified)"
            return true
        } catch {
            self.actionError = error.localizedDescription
            return false
        }
    }

    @MainActor
    func testKeySlot(_ slot: String) async {
        isBusyAction = true
        actionError = nil
        actionNotice = nil
        defer { isBusyAction = false }
        do {
            let resp = try await client.testKey(slot: slot)
            let count = resp.models?.count ?? 0
            self.actionNotice = "\(slot) reachable (\(count) models)"
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    @MainActor
    func deleteKeySlot(_ slot: String) async {
        isBusyAction = true
        actionError = nil
        actionNotice = nil
        defer { isBusyAction = false }
        do {
            if let snap = try await client.deleteKey(slot: slot) {
                self.snapshot = snap
            } else {
                await refresh()
            }
            await loadSetupDetails()
            self.actionNotice = "Removed \(slot) from Keychain"
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    @MainActor
    func resetKeyCooldown(_ name: String) async {
        do {
            try await client.resetKey(name: name)
            await refresh()
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    // MARK: - pi-rust & Self-Config

    @MainActor
    func installPiRust() async {
        isBusyAction = true
        actionError = nil
        actionNotice = "Installing pi-rust via \(piInstallCmd ?? "cargo/brew")…"
        defer { isBusyAction = false }
        do {
            let resp = try await client.installPi()
            if let snap = resp.snapshot { self.snapshot = snap }
            await loadSetupDetails()
            self.actionNotice = "pi-rust installed and wired to loopback proxy"
        } catch {
            self.actionNotice = nil
            self.actionError = error.localizedDescription
        }
    }

    @MainActor
    func applySelfConfig(targets: [String]) async {
        isBusyAction = true
        actionError = nil
        actionNotice = nil
        defer { isBusyAction = false }
        do {
            let updated = try await client.applySelfConfig(targets: targets)
            self.selfConfigPlan = updated
            self.actionNotice = "Applied \(targets.count) self-config target(s)"
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    // MARK: - Overnight Mode

    @MainActor
    func toggleOvernight(enabled: Bool?, budgetUsd: Double?, maxRuns: Int?) async {
        isBusyAction = true
        actionError = nil
        defer { isBusyAction = false }
        do {
            let resp = try await client.toggleOvernight(enabled: enabled, budgetUsd: budgetUsd, maxRuns: maxRuns)
            if let snap = resp.snapshot { self.snapshot = snap }
            self.actionNotice = "Overnight settings updated"
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    @MainActor
    func scanOvernightProposals() async {
        isBusyAction = true
        actionError = nil
        defer { isBusyAction = false }
        do {
            let resp = try await client.scanOvernight()
            if let snap = resp.snapshot {
                self.snapshot = snap
                self.notifyNewOvernightTickets(snap.overnight?.tickets ?? [])
            }
            self.actionNotice = "Scanned repositories for overnight tickets"
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    @MainActor
    func approveTicket(id: String, allowPaid: Bool = false) async {
        isBusyAction = true
        actionError = nil
        defer { isBusyAction = false }
        do {
            let resp = try await client.approveTicket(id: id, allowPaid: allowPaid)
            if let snap = resp.snapshot { self.snapshot = snap }
            self.actionNotice = "Approved ticket \(id) in isolated worktree"
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    @MainActor
    func deferTicket(id: String) async {
        isBusyAction = true
        actionError = nil
        defer { isBusyAction = false }
        do {
            let resp = try await client.deferTicket(id: id)
            if let snap = resp.snapshot { self.snapshot = snap }
            self.actionNotice = "Deferred ticket \(id)"
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    // MARK: - Kiro Specs

    @MainActor
    func createSpec(
        title: String,
        goal: String,
        allowedPathGlobs: [String],
        gateCmd: String,
        sandboxTier: String,
        maxBudgetUsd: Double
    ) async {
        isBusyAction = true
        actionError = nil
        defer { isBusyAction = false }
        do {
            let resp = try await client.createSpec(
                title: title,
                goal: goal,
                requirementsMd: "WHEN executing spec, THE worker SHALL stay within allowed path globs and pass \(gateCmd).",
                designMd: "Run in isolated git worktree under \(sandboxTier) isolation with serial merge queue.",
                allowedPathGlobs: allowedPathGlobs,
                gateCmd: gateCmd,
                sandboxTier: sandboxTier,
                maxBudgetUsd: maxBudgetUsd
            )
            if let snap = resp.snapshot { self.snapshot = snap }
            self.actionNotice = "Drafted Kiro Spec \(resp.spec?.spec_id ?? "")"
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    @MainActor
    func approveSpec(id: String) async {
        isBusyAction = true
        actionError = nil
        defer { isBusyAction = false }
        do {
            let resp = try await client.approveSpec(id: id)
            if let snap = resp.snapshot { self.snapshot = snap }
            self.actionNotice = "Signed SHA-256 digest for spec \(id)"
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    @MainActor
    func runSpec(id: String) async {
        isBusyAction = true
        actionError = nil
        defer { isBusyAction = false }
        do {
            let resp = try await client.runSpec(id: id)
            if let snap = resp.snapshot { self.snapshot = snap }
            self.actionNotice = "Dispatched approved spec \(id) into sandboxed swarm"
        } catch {
            self.actionError = error.localizedDescription
        }
    }

    @MainActor
    func quit() async {
        try? await client.shutdown()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            NSApplication.shared.terminate(nil)
        }
    }

    // MARK: - Notifications (guarded for bundled .app only)

    private func notifyNewOvernightTickets(_ tickets: [OvernightTicket]) {
        guard Bundle.main.bundleIdentifier != nil else { return }
        let pending = tickets.filter { $0.status == "pending_approval" && !notifiedTicketIds.contains($0.id) }
        guard !pending.isEmpty else { return }
        let center = UNUserNotificationCenter.current()
        for t in pending {
            notifiedTicketIds.insert(t.id)
            let content = UNMutableNotificationContent()
            content.title = "Lingonberry Overnight Proposal"
            content.subtitle = t.title
            content.body = "\(t.cost_tier) · ~\(t.estimated_tokens) tok"
            content.categoryIdentifier = "OVERNIGHT_TICKET"
            content.userInfo = ["ticket_id": t.id]
            let req = UNNotificationRequest(identifier: "lb-ticket-\(t.id)", content: content, trigger: nil)
            center.add(req)
        }
    }

    // MARK: - Computed state

    var overview: Overview? { snapshot?.overview }
    var workers: [WorkerStatus] { snapshot?.workers ?? [] }
    var liveWorkers: [LiveWorker] { snapshot?.workers_live ?? [] }
    var sessions: [SessionRow] { snapshot?.sessions ?? [] }
    var jobs: [JobRow] { snapshot?.jobs ?? [] }
    var managedJobs: [JobRow] { jobs.filter { !$0.isReadOnly } }
    var discoveredJobs: [JobRow] { jobs.filter { $0.isReadOnly } }
    var cronJobs: [CronJob] { snapshot?.cron_live ?? [] }
    var system: SystemInfo? { snapshot?.system }
    var readiness: ReadinessReport? { snapshot?.readiness }
    var overnight: OvernightSummary? { snapshot?.overnight }
    var watchdog: WatchdogStatus? { snapshot?.watchdog }
    var sandbox: SandboxHealth? { snapshot?.sandbox }
    var swarm: SwarmSummary? { snapshot?.swarm }
    var gateway: GatewayMemorySummary? { snapshot?.gateway }
    var specs: [KiroSpecManifest] { snapshot?.specs ?? [] }
    var pendingTickets: [OvernightTicket] {
        (overnight?.tickets ?? []).filter { $0.status == "pending_approval" }
    }

    var completedCount: Int { snapshot?.overview.completed_24h ?? 0 }
    var failedCount: Int { snapshot?.overview.failed_24h ?? 0 }
    var runningCount: Int { snapshot?.overview.running ?? 0 }
    var cpuPct: String {
        guard let pct = snapshot?.overview.cpu_pct else { return "--" }
        return String(format: "%.0f%%", pct)
    }
}
