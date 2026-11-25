import Foundation

struct Overview: Codable {
    let running: Int
    let liveWorkers: Int
    let completed24h: Int
    let failed24h: Int
    let avgDurationS: Double?
    let cost24hUsd: Double?
    let calls24h: Int?
    let cpuPct: Double?

    enum CodingKeys: String, CodingKey {
        case running
        case liveWorkers = "live_workers"
        case completed24h = "completed_24h"
        case failed24h = "failed_24h"
        case avgDurationS = "avg_duration_s"
        case cost24hUsd = "cost_24h_usd"
        case calls24h = "calls_24h"
        case cpuPct = "cpu_pct"
    }
}

struct WorkerStatus: Codable, Identifiable {
    var id: String { name }
    let name: String
    let status: String
    let calls24h: Int
    let ok24h: Int
    let key: String?
    let provider: String?
    let coolingRemainingS: UInt64

    enum CodingKeys: String, CodingKey {
        case name, status, key, provider
        case calls24h = "calls_24h"
        case ok24h = "ok_24h"
        case coolingRemainingS = "cooling_remaining_s"
    }
}

struct LiveWorker: Codable, Identifiable {
    var id: String { "\(pid)-\(worker)" }
    let pid: UInt32
    let worker: String
    let caller: String?
    let key: String?
    let model: String?
    let provider: String?
    let runId: String?
    let task: String
    let started: Double
    let elapsedS: Double
    let fanoutGroup: String?

    enum CodingKeys: String, CodingKey {
        case pid, worker, caller, key, model, provider, task, started
        case runId = "run_id"
        case elapsedS = "elapsed_s"
        case fanoutGroup = "fanout_group"
    }
}

struct SessionStep: Codable, Identifiable {
    var id: String { "\(ts)-\(stage)-\(title)" }
    let ts: Double
    let stage: String
    let title: String
    let detail: String
    let tone: String
}

struct SessionRow: Codable, Identifiable {
    let id: String
    let ts: Double
    let prompt: String
    let worker: String
    let caller: String?
    let key: String?
    let state: String
    let durationS: Double
    let reason: String?
    let output: String?
    let receiptId: String?
    let steps: [SessionStep]
    let fanoutGroup: String?
    let failoverFrom: String?
    let tokensIn: UInt64?
    let tokensOut: UInt64?

    enum CodingKeys: String, CodingKey {
        case id, ts, prompt, worker, caller, key, state, reason, output, steps
        case durationS = "duration_s"
        case receiptId = "receipt_id"
        case fanoutGroup = "fanout_group"
        case failoverFrom = "failover_from"
        case tokensIn = "tokens_in"
        case tokensOut = "tokens_out"
    }
}

struct JobRow: Codable, Identifiable {
    var id: String { name }
    let name: String
    let source: String
    let schedule: String
    let command: String
    let everyS: UInt64?
    let last: Double?
    let rc: Int32?
    let paused: Bool?
    let nextInS: UInt64?
    let prompt: String?
    let health: String
    let runningPid: UInt32?
    let crashCount: UInt32
    let restartCount: UInt32
    let autoRestart: Bool
    let lastError: String?
    let logTail: [String]

    enum CodingKeys: String, CodingKey {
        case name, source, schedule, command, last, rc, paused, prompt, health
        case everyS = "every_s"
        case nextInS = "next_in_s"
        case runningPid = "running_pid"
        case crashCount = "crash_count"
        case restartCount = "restart_count"
        case autoRestart = "auto_restart"
        case lastError = "last_error"
        case logTail = "log_tail"
    }
}

struct LiveCronProcess: Codable, Identifiable {
    var id: UInt32 { pid }
    let pid: UInt32
    let jobName: String
    let source: String
    let command: String
    let cpuPct: Double
    let memMb: Double
    let elapsedS: UInt64

    enum CodingKeys: String, CodingKey {
        case pid, source, command
        case jobName = "job_name"
        case cpuPct = "cpu_pct"
        case memMb = "mem_mb"
        case elapsedS = "elapsed_s"
    }
}

struct RouterState: Codable {
    let up: Bool
    let serve: Bool
    let proxy: Bool
}

struct SystemInfo: Codable {
    let cpuPct: Double?
    let load1: Double?
    let ramUsedGb: Double?
    let ramTotalGb: Double?
    let diskUsedGb: Double?
    let diskTotalGb: Double?

    enum CodingKeys: String, CodingKey {
        case load1
        case cpuPct = "cpu_pct"
        case ramUsedGb = "ram_used_gb"
        case ramTotalGb = "ram_total_gb"
        case diskUsedGb = "disk_used_gb"
        case diskTotalGb = "disk_total_gb"
    }
}

struct Snapshot: Codable {
    let ts: Double
    let overview: Overview
    let workers: [WorkerStatus]
    let workersLive: [LiveWorker]
    let sessions: [SessionRow]
    let jobs: [JobRow]
    let cronLive: [LiveCronProcess]
    let router: RouterState
    let system: SystemInfo

    enum CodingKeys: String, CodingKey {
        case ts, overview, workers, sessions, jobs, router, system
        case workersLive = "workers_live"
        case cronLive = "cron_live"
    }
}
