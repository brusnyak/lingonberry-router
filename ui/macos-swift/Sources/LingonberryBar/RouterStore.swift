import SwiftUI
import Combine
import AppKit

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

    private let client = RouterClient()
    private var timer: Timer?
    private let pollInterval: TimeInterval = 3.0

    func start() {
        Task { await self.refresh() }
        timer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { _ in
            Task { await self.refresh() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private var retryCount: Int = 0
    /// True while we're still in the initial startup retry window — suppress
    /// the error banner so the user doesn't see "data missing" while core
    /// finishes launching.
    private var isInitialStartup: Bool = true

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
        } catch {
            let msg = "RouterStore.refresh failed: \(error.localizedDescription)\n"
            FileHandle.standardError.write(msg.data(using: .utf8)!)

            // Only mark router down if we never connected successfully.
            // If we already have snapshot data, this is a transient failure — keep
            // isRouterUp true and clear the banner so the user sees stale-but-real data.
            if self.snapshot == nil {
                self.isRouterUp = false
                // During initial startup, don't show a banner — just retry silently.
                // Only surface the error once retries are exhausted.
                if self.isInitialStartup {
                    self.retryCount += 1
                    if self.retryCount <= 5 {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
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

    func killWorker(pid: Int) async {
        // POST to /api/kill/:pid
        guard let url = URL(string: "http://127.0.0.1:8799/api/kill/\(pid)") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse, http.statusCode == 200 {
                await refresh()
            }
        } catch {
            self.lastError = "Kill failed: \(error.localizedDescription)"
        }
    }

    func runPrompt(_ prompt: String, worker: String? = nil, caller: String? = nil, liveApi: Bool = false) async -> RunRow? {
        do {
            let run = try await client.run(prompt: prompt, worker: worker, caller: caller, liveApi: liveApi)
            await refresh()
            return run
        } catch {
            self.lastError = "Run failed: \(error.localizedDescription)"
            return nil
        }
    }

    func toggleCron(_ name: String) async {
        guard let url = URL(string: "http://127.0.0.1:8799/api/jobs/\(name)/toggle") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse, http.statusCode == 200 {
                await refresh()
            }
        } catch {
            self.lastError = "Toggle failed: \(error.localizedDescription)"
        }
    }

    func runCronNow(_ name: String) async {
        guard let url = URL(string: "http://127.0.0.1:8799/api/jobs/\(name)/run") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse, http.statusCode == 200 {
                await refresh()
            }
        } catch {
            self.lastError = "Run now failed: \(error.localizedDescription)"
        }
    }

    func quit() async {
        guard let url = URL(string: "http://127.0.0.1:8799/shutdown") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        _ = try? await URLSession.shared.data(for: req)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            NSApplication.shared.terminate(nil)
        }
    }

    var overview: Overview? { snapshot?.overview }
    var workers: [WorkerStatus] { snapshot?.workers ?? [] }
    var liveWorkers: [LiveWorker] { snapshot?.workers_live ?? [] }
    var sessions: [SessionRow] { snapshot?.sessions ?? [] }
    var jobs: [JobRow] { snapshot?.jobs ?? [] }
    var cronJobs: [CronJob] { snapshot?.cron_live ?? [] }
    var system: SystemInfo? { snapshot?.system }

    var completedCount: Int { snapshot?.overview.completed_24h ?? 0 }
    var failedCount: Int { snapshot?.overview.failed_24h ?? 0 }
    var runningCount: Int { snapshot?.overview.running ?? 0 }
    var cpuPct: String {
        guard let pct = snapshot?.overview.cpu_pct else { return "--" }
        return String(format: "%.0f%%", pct)
    }
}
