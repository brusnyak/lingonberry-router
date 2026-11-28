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
    let readiness: ReadinessReport?
    let overnight: OvernightSummary?
    let watchdog: WatchdogStatus?
    let sandbox: SandboxHealth?
    let swarm: SwarmSummary?
    let gateway: GatewayMemorySummary?
    let specs: [KiroSpecManifest]?
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
    let cost_tier: String?
    let source: String?
    let fail_count: Int?

    var id: String { name }
    var isCooling: Bool { cooling_remaining_s > 0 }
}

struct LiveWorker: Codable, Identifiable {
    let pid: Int
    let worker: String
    let caller: String?
    let key: String?
    let model: String?
    let provider: String?
    let run_id: String?
    let task: String
    let started: Double
    let elapsed_s: Double
    let fanout_group: String?

    var id: String { run_id ?? "\(pid)-\(worker)" }
}

struct SessionRow: Codable, Identifiable {
    let id: String
    let ts: Double
    let prompt: String
    let worker: String
    let caller: String?
    let key: String?
    let model: String?
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
    let gate_status: String?
    let cost_tier: String?
    let escalation_from: String?
    let sandbox_tier: String?
    let complexity_tier: String?
    let spec_id: String?
}

struct SessionStep: Codable, Identifiable {
    let ts: Double
    let stage: String
    let title: String
    let detail: String
    let tone: String

    var id: String { "\(ts)-\(stage)-\(title)" }
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
    let workflow_loop: String?
    let skills: [String]?
}

struct JobRow: Codable, Identifiable {
    let name: String
    let every_s: Int?
    let schedule: String?
    let command: String?
    let prompt: String?
    let source: String?
    let scope: String?
    let read_only: Bool?
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
    var isReadOnly: Bool { (read_only ?? false) || scope == "discovered" }

    var nextRun: String {
        if isReadOnly { return "host-monitored" }
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
    let pid: Int
    let job_name: String
    let source: String
    let command: String
    let cpu_pct: Double
    let mem_mb: Double?
    let elapsed_s: UInt64

    var id: String { "\(pid)-\(job_name)" }
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

// MARK: - Readiness, Self-Config & Overnight

struct ReadinessReport: Codable {
    let pi_installed: Bool
    let pi_path: String?
    let mini_harness_ready: Bool
    let agents_count: Int
    let free_keys_count: Int
    let paid_keys_count: Int
    let external_skills_count: Int
    let mode: String
    let recommendations: [String]
}

struct ReadinessEndpointResponse: Codable {
    let readiness: ReadinessReport
    let pi_install_cmd: String?
}

struct OvernightTicket: Codable, Identifiable {
    let id: String
    let title: String
    let prompt: String
    let repo_path: String?
    let status: String
    let cost_tier: String
    let estimated_tokens: Int
    let created_at: String
    let run_id: String?
    let gate_status: String?
    let summary: String?
}

struct OvernightSummary: Codable {
    let enabled: Bool
    let free_only: Bool
    let nightly_budget_usd: Double
    let spent_today_usd: Double
    let runs_tonight: Int
    let max_runs_per_night: Int
    let tickets: [OvernightTicket]
}

struct SelfConfigTarget: Codable, Identifiable {
    let target: String
    let scope: String
    let path: String
    let status: String
    let reason: String
    let snippet: String

    var id: String { path }
}

struct SelfConfigPlan: Codable {
    let os: String
    let preferred_root: String
    let strategy: String
    let targets: [SelfConfigTarget]
}

// MARK: - Discovery & Keychain

struct DiscoverData: Codable {
    let agents: [AgentInfo]
    let keys: [String: [String]]
    let providers: [String: ProviderInfo]
    let library_dirs: [String]
    let ssh_hosts: [String]
    let git_projects: [String]
    let browsers: [String]
    let keychain_slots: [KeychainSlotMeta]?
}

struct AgentInfo: Codable, Identifiable {
    let id: String
    let path: String?
}

struct ProviderInfo: Codable {
    let id: String
    let base_url: String
    let style: String?
}

struct KeychainSlotMeta: Codable, Identifiable {
    let slot: String
    let provider: String
    let label: String
    let cost_tier: String
    let rpm_limit: Int?
    let base_url: String?
    let model: String?

    var id: String { slot }
}

// MARK: - Route receipt (POST /api/route)

struct Receipt: Codable {
    let receipt_id: String
    let context_hash: String
    let catalog_hash: String
    let policy_hash: String
    let pool_hash: String
    let registry_hash: String
    let phase: String
    let selected: ReceiptSelection?
    let alternatives: [ReceiptSelection]
    let exclusions: [ReceiptExclusion]
    let abstention: String?
    let created_at: String
    let caller: String?
    let cooked: CookedPromptInfo?
}

struct ReceiptSelection: Codable {
    let worker: String
    let model: String?
    let effort: String?
    let gate: String?
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
    let gate_status: String?
    let worktree_path: String?
    let cost_tier: String?
    let budget_approved: Bool?
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

// MARK: - API responses & bodies

struct APIErrorPayload: Codable {
    let ok: Bool?
    let error: String?
}

struct RunResponse: Codable {
    let run: RunRow
    let snapshot: Snapshot?
}

struct KeyAddResponse: Codable {
    let ok: Bool
    let slot: String?
    let models: [String]?
    let error: String?
    let snapshot: Snapshot?
}

struct KeyTestResponse: Codable {
    let ok: Bool
    let models: [String]?
    let error: String?
}

struct InstallPiResponse: Codable {
    let ok: Bool
    let error: String?
    let readiness: ReadinessReport?
    let snapshot: Snapshot?
}

struct OvernightActionResponse: Codable {
    let ok: Bool?
    let error: String?
    let overnight: OvernightSummary?
    let snapshot: Snapshot?
    let ticket: OvernightTicket?
}

struct JobActionResponse: Codable {
    let snapshot: Snapshot?
}

// MARK: - Watchdog, Tiered Sandbox, Swarm, Channels, Kiro Specs

struct WatchdogStatus: Codable {
    let memory_pressure: String
    let ram_used_pct: Double
    let disk_pressure: String
    let free_disk_gb: Double
    let cpu_pct: Double
    let max_concurrent_workers: Int
    let active_workers: Int
    let paused_reason: String?
    let provider_rpm_used: [String: Int]
    let subscription_burst_used: Int
    let subscription_burst_cap: Int
}

struct SandboxHealth: Codable {
    let seatbelt_available: Bool
    let docker_available: Bool
    let docker_runtime: String?
    let default_local_tier: String
    let default_overnight_tier: String
}

struct PathLease: Codable, Identifiable {
    let run_id: String
    let repo_root: String
    let globs: [String]
    let worktree_path: String
    let sandbox_tier: String
    let lease_state: String

    var id: String { run_id }
}

struct MergeQueueItem: Codable, Identifiable {
    let run_id: String
    let repo_root: String
    let branch_or_worktree: String
    let gate_cmd: String
    let status: String
    let attempt: Int

    var id: String { run_id }
}

struct SwarmSummary: Codable {
    let max_concurrent: Int
    let active_workers: Int
    let queued_count: Int
    let active_leases: [PathLease]
    let merge_queue: [MergeQueueItem]
}

struct ChannelBridgeStatus: Codable, Identifiable {
    let id: String
    let label: String
    let transport: String
    let enabled: Bool
    let connected: Bool
    let session_key_prefix: String
    let description: String
}

struct GatewayMemorySummary: Codable {
    let memory_path: String
    let steering_dir: String
    let entries_count: Int
    let channels: [ChannelBridgeStatus]
}

struct SpecWaveTask: Codable, Identifiable {
    let task_id: String
    let wave: Int
    let title: String
    let path_globs: [String]
    let gate_cmd: String
    let status: String

    var id: String { task_id }
}

struct KiroSpecManifest: Codable, Identifiable {
    let spec_id: String
    let title: String
    let goal: String
    let repo_root: String
    let requirements_md: String
    let design_md: String
    let tasks_dag: [SpecWaveTask]
    let allowed_path_globs: [String]
    let forbidden_actions: [String]
    let gate_cmd: String
    let sandbox_tier: String
    let max_budget_usd: Double
    let sha256_digest: String
    let approved_at: String?
    let status: String
    let created_at: String

    var id: String { spec_id }
}

struct SpecActionResponse: Codable {
    let ok: Bool?
    let error: String?
    let spec: KiroSpecManifest?
    let snapshot: Snapshot?
}

