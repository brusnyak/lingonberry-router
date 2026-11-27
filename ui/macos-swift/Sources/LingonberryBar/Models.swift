import Foundation

// MARK: - Snapshot (GET /api/snapshot)

struct Snapshot: Codable {
    let ts: Double
    let overview: Overview
    let workers: [WorkerStatus]
    let workers_live: [LiveWorker]
    let sessions: [SessionRow]
    let jobs: [JobRow]
    let cron_live: [CronJob]
    let router: RouterState
    let system: SystemInfo
    let telemetry: [TelemetryPoint]
}

struct Overview: Codable {
    let running: Int
    let live_workers: Int
    let completed_24h: Int
    let failed_24h: Int
    let avg_duration_s: Double?
    let cost_24h_usd: Double?
    let calls_24h: Int?
    let cpu_pct: Double?
}

struct WorkerStatus: Codable, Identifiable {
    let name: String
    let status: String
    let calls_24h: Int
    let ok_24h: Int
    let key: String?
    let provider: String?
    let cooling_remaining_s: UInt64
    let rpm_limit: Int
    let inflight: Int

    var id: String { name }
    var isCooling: Bool { cooling_remaining_s > 0 }
}

struct LiveWorker: Codable, Identifiable {
    let pid: Int
    let worker: String
    let caller: String
    let key: String?
    let model: String?
    let provider: String?
    let run_id: String?
    let task: String
    let started: Double
    let elapsed_s: Double
    let fanout_group: String?

    var id: String { run_id ?? worker }
}

struct SessionRow: Codable, Identifiable {
    let id: String
    let ts: Double
    let prompt: String
    let worker: String
    let caller: String
    let key: String?
    let state: String
    let duration_s: Double
    let reason: String?
    let output: String?
    let receipt_id: String?
    let cooked: CookedPromptInfo?
    let steps: [SessionStep]
    let fanout_group: String?
    let failover_from: String?
    let tokens_in: Int?
    let tokens_out: Int?
}

struct SessionStep: Codable, Identifiable {
    let ts: Double
    let stage: String
    let title: String
    let detail: String
    let tone: String

    var id: String { "\(ts)-\(stage)" }
}

struct CookedPromptInfo: Codable {
    let raw_prompt: String
    let cooked_prompt: String
    let task_class: String
    let selected_skill: String
    let selected_command: String
    let selected_hook: String
    let retrieval_sources: [String]
    let gate_policy: String
}

struct JobRow: Codable, Identifiable {
    let name: String
    let every_s: Int?
    let schedule: String?
    let command: String?
    let prompt: String?
    let source: String?
    let auto_restart: Bool?
    let health: String?
    let crash_count: Int?
    let last: Double?
    let rc: Int?
    let paused: Bool?
    let next_in_s: Int?
    let running_pid: Int?
    let restart_count: Int?
    let last_error: String?
    let log_tail: [String]?

    var id: String { name }

    var nextRun: String {
        guard let n = next_in_s else { return paused == true ? "paused" : "manual" }
        if n >= 3600 { return String(format: "in %dh %02dm", n / 3600, (n % 3600) / 60) }
        if n >= 60 { return "in \(n / 60)m \(n % 60)s" }
        return "in \(n)s"
    }

    var lastRun: String {
        guard let l = last else { return "never" }
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: Date(timeIntervalSince1970: l))
    }
}

struct CronJob: Codable, Identifiable {
    let job_name: String
    let mem_mb: Double?
    let health: String?

    var id: String { job_name }
}

struct RouterState: Codable {
    let up: Bool
    let serve: Bool
    let proxy: Bool
}

struct SystemInfo: Codable {
    let cpu_pct: Double?
    let load1: Double?
    let ram_used_gb: Double?
    let ram_total_gb: Double?
    let disk_used_gb: Double?
    let disk_total_gb: Double?
    let app_cpu_pct: Double?
    let app_ram_gb: Double?
}

struct TelemetryPoint: Codable {
    let ts: Double
    let cpu_pct: Double
    let ram_pct: Double
    let disk_pct: Double
    let active_runs: Int
    let rpm: Int
}

// MARK: - Route receipt (GET /api/route)

struct Receipt: Codable {
    let receipt_id: String
    let context_hash: String
    let catalog_hash: String
    let policy_hash: String
    let pool_hash: String
    let registry_hash: String
    let phase: String
    let selected: ReceiptSelection
    let alternatives: [ReceiptSelection]
    let exclusions: [ReceiptExclusion]
    let abstention: String?
    let created_at: String
    let caller: String
    let cooked: CookedPromptInfo?
}

struct ReceiptSelection: Codable {
    let worker: String
    let model: String?
    let effort: String
    let gate: String
    let reason: String
}

struct ReceiptExclusion: Codable {
    let candidate_id: String
    let code: String
    let evidence: String
}

// MARK: - Run

struct RunRow: Codable, Identifiable {
    let id: String
    let created_at: String
    let worker: String
    let caller: String?
    let key_name: String?
    let model: String?
    let provider: String?
    let prompt: String
    let gate: String?
    let state: String
    let pid: Int?
    let elapsed_ms: Int?
    let gate_passed: Bool?
    let error: String?
    let output: String?
    let task_class: String?
    let receipt_id: String?
    let tokens_in: Int?
    let tokens_out: Int?
}

// MARK: - Keys (GET /api/keys)

struct KeyStatus: Codable, Identifiable {
    let name: String
    let status: String
    let calls_24h: Int
    let ok_24h: Int
    let key: String?
    let provider: String?
    let cooling_remaining_s: UInt64
    let rpm_limit: Int
    let inflight: Int

    var id: String { name }
    var isCooling: Bool { cooling_remaining_s > 0 }
}

// MARK: - Version

struct VersionResp: Codable {
    let pid: Int
    let version: String
    let exe_mtime: Double
}

// MARK: - API request bodies

struct RouteBody: Codable {
    let prompt: String
    let phase: String?
    let caller: String?
    let worktree: Bool?
}

struct RunBody: Codable {
    let prompt: String
    let caller: String?
    let worker: String?
    let phase: String?
    let worktree: Bool?
    let simulate_fault: String?
    let live_api: Bool?
}

/// Wrapper for POST /api/run response: { "run": RunRow, "snapshot": Snapshot }
struct RunResponse: Codable {
    let run: RunRow
}

struct FanoutBody: Codable {
    let prompts: [String]?
    let prompt: String?
    let caller: String?
    let worktree: Bool?
}
