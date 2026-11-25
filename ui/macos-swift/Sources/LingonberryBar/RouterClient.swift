import Foundation
import Combine

@MainActor
final class RouterClient: ObservableObject {
    @Published var snapshot: Snapshot?
    @Published var connected: Bool = false
    @Published var lastError: String?

    private let baseURL = URL(string: "http://127.0.0.1:8799")!
    private var timer: Timer?
    private var coreProcess: Process?

    func start() {
        ensureDaemonRunning()
        Task { await refresh() }
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.refresh()
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        if let proc = coreProcess, proc.isRunning {
            proc.terminate()
        }
    }

    private func ensureDaemonRunning() {
        Task {
            do {
                let (_, response) = try await URLSession.shared.data(from: baseURL.appendingPathComponent("version"))
                if (response as? HTTPURLResponse)?.statusCode == 200 { return }
            } catch {
                // Attempt to spawn local lingonberry-core binary on macOS
                let proc = Process()
                proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
                proc.arguments = ["lingonberry-core", "serve", "127.0.0.1:8799"]
                proc.standardInput = FileHandle.nullDevice
                proc.standardOutput = FileHandle.nullDevice
                proc.standardError = FileHandle.nullDevice
                try? proc.run()
                coreProcess = proc
            }
        }
    }

    func refresh() async {
        do {
            let (data, response) = try await URLSession.shared.data(from: baseURL.appendingPathComponent("snapshot"))
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                connected = false
                return
            }
            snapshot = try JSONDecoder().decode(Snapshot.self, from: data)
            connected = true
            lastError = nil
        } catch {
            connected = false
            lastError = error.localizedDescription
        }
    }

    func postAction(_ path: String) async {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        _ = try? await URLSession.shared.data(for: req)
        await refresh()
    }

    func killWorker(pid: UInt32) async { await postAction("kill/\(pid)") }
    func killCronPid(pid: UInt32) async { await postAction("api/jobs/kill/\(pid)") }
    func toggleJob(name: String) async { await postAction("api/jobs/\(name)/toggle") }
    func runJob(name: String) async { await postAction("api/jobs/\(name)/run") }
    func healJob(name: String) async { await postAction("api/jobs/\(name)/heal") }
    func toggleWatchdog(name: String) async { await postAction("api/jobs/\(name)/watchdog") }
    func rescan() async { await postAction("api/rescan") }
}
