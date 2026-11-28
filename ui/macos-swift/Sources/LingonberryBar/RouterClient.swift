import Foundation

enum RouterClientError: LocalizedError {
    case invalidURL(String)
    case httpError(Int, String)
    case missingToken

    var errorDescription: String? {
        switch self {
        case .invalidURL(let path):
            return "Invalid router URL: \(path)"
        case .httpError(let code, let msg):
            return "HTTP \(code): \(msg)"
        case .missingToken:
            return "Local router bearer token not found at ~/.lingonberry/api.token"
        }
    }
}

actor RouterClient {
    private let baseURL: URL
    private let session: URLSession
    private var cachedToken: String?

    init(baseURL: URL = URL(string: "http://127.0.0.1:8799")!) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 30
        self.session = URLSession(configuration: config)
    }

    private func tokenFileURL() -> URL {
        if let custom = ProcessInfo.processInfo.environment["LINGONBERRY_HOME"],
           !custom.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return URL(fileURLWithPath: custom).appendingPathComponent("api.token")
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".lingonberry")
            .appendingPathComponent("api.token")
    }

    private func loadBearerToken(forceReload: Bool = false) -> String? {
        if !forceReload, let cached = cachedToken, !cached.isEmpty {
            return cached
        }
        let url = tokenFileURL()
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else {
            return nil
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        cachedToken = trimmed
        return trimmed
    }

    private func encodeSegment(_ raw: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return raw.addingPercentEncoding(withAllowedCharacters: allowed) ?? raw
    }

    private func makeRequest(
        method: String,
        path: String,
        body: [String: Any]? = nil,
        timeout: TimeInterval = 12,
        forceReloadToken: Bool = false
    ) throws -> URLRequest {
        let normalized = path.hasPrefix("/") ? String(path.dropFirst()) : path
        guard let url = URL(string: normalized, relativeTo: baseURL)?.absoluteURL else {
            throw RouterClientError.invalidURL(path)
        }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = method
        if let token = loadBearerToken(forceReload: forceReloadToken) {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else if method != "GET" {
            throw RouterClientError.missingToken
        }
        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return req
    }

    private func perform(
        method: String,
        path: String,
        body: [String: Any]? = nil,
        timeout: TimeInterval = 12
    ) async throws -> Data {
        var req = try makeRequest(method: method, path: path, body: body, timeout: timeout, forceReloadToken: false)
        var (data, resp) = try await session.data(for: req)
        if let http = resp as? HTTPURLResponse, http.statusCode == 401 {
            // Core may have rotated or freshly created ~/.lingonberry/api.token.
            req = try makeRequest(method: method, path: path, body: body, timeout: timeout, forceReloadToken: true)
            (data, resp) = try await session.data(for: req)
        }
        guard let http = resp as? HTTPURLResponse else {
            throw RouterClientError.httpError(0, "Non-HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            if let decoded = try? JSONDecoder().decode(APIErrorPayload.self, from: data),
               let msg = decoded.error, !msg.isEmpty {
                throw RouterClientError.httpError(http.statusCode, msg)
            }
            let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            throw RouterClientError.httpError(http.statusCode, text.isEmpty ? "Request failed" : text)
        }
        return data
    }

    // MARK: - Queries

    func snapshot() async throws -> Snapshot {
        let data = try await perform(method: "GET", path: "/api/snapshot")
        return try JSONDecoder().decode(Snapshot.self, from: data)
    }

    func version() async throws -> VersionResp {
        let data = try await perform(method: "GET", path: "/version")
        return try JSONDecoder().decode(VersionResp.self, from: data)
    }

    func discover() async throws -> DiscoverData {
        let data = try await perform(method: "GET", path: "/api/discover")
        return try JSONDecoder().decode(DiscoverData.self, from: data)
    }

    func keys() async throws -> [KeyStatus] {
        let data = try await perform(method: "GET", path: "/api/keys")
        return try JSONDecoder().decode([KeyStatus].self, from: data)
    }

    func runs() async throws -> [RunRow] {
        let data = try await perform(method: "GET", path: "/api/runs")
        return try JSONDecoder().decode([RunRow].self, from: data)
    }

    func readiness() async throws -> ReadinessEndpointResponse {
        let data = try await perform(method: "GET", path: "/api/readiness")
        return try JSONDecoder().decode(ReadinessEndpointResponse.self, from: data)
    }

    func selfConfig() async throws -> SelfConfigPlan {
        let data = try await perform(method: "GET", path: "/api/self-config")
        return try JSONDecoder().decode(SelfConfigPlan.self, from: data)
    }

    // MARK: - Routing & Execution

    func route(prompt: String, phase: String = "plan", caller: String? = nil) async throws -> Receipt {
        var body: [String: Any] = ["prompt": prompt, "phase": phase]
        if let caller = caller { body["caller"] = caller }
        let data = try await perform(method: "POST", path: "/api/route", body: body)
        return try JSONDecoder().decode(Receipt.self, from: data)
    }

    func run(
        prompt: String,
        worker: String? = nil,
        caller: String? = nil,
        liveApi: Bool = false,
        gate: String? = nil,
        worktree: Bool = false,
        readOnly: Bool = false,
        approve: Bool = false
    ) async throws -> RunRow {
        var body: [String: Any] = ["prompt": prompt]
        if let worker = worker { body["worker"] = worker }
        if let caller = caller { body["caller"] = caller }
        if liveApi { body["live_api"] = true }
        if let gate = gate, !gate.isEmpty { body["gate"] = gate }
        if worktree { body["worktree"] = true }
        if readOnly { body["read_only"] = true }
        if approve { body["approve"] = true }
        let data = try await perform(method: "POST", path: "/api/run", body: body, timeout: 45)
        let response = try JSONDecoder().decode(RunResponse.self, from: data)
        return response.run
    }

    // MARK: - Worker & Job Control

    func killWorker(pid: Int) async throws {
        _ = try await perform(method: "POST", path: "/api/kill/\(pid)")
    }

    func toggleJob(name: String) async throws {
        _ = try await perform(method: "POST", path: "/api/jobs/\(encodeSegment(name))/toggle")
    }

    func runJobNow(name: String) async throws {
        _ = try await perform(method: "POST", path: "/api/jobs/\(encodeSegment(name))/run")
    }

    func healJob(name: String) async throws {
        _ = try await perform(method: "POST", path: "/api/jobs/\(encodeSegment(name))/heal")
    }

    func rescan() async throws -> Snapshot {
        let data = try await perform(method: "POST", path: "/api/rescan")
        return try JSONDecoder().decode(Snapshot.self, from: data)
    }

    func shutdown() async throws {
        _ = try await perform(method: "POST", path: "/shutdown", timeout: 4)
    }

    // MARK: - Setup: pi-rust, Keychain, Self-Config, Overnight

    func installPi() async throws -> InstallPiResponse {
        let data = try await perform(method: "POST", path: "/api/install/pi", timeout: 180)
        return try JSONDecoder().decode(InstallPiResponse.self, from: data)
    }

    func addKey(
        provider: String,
        label: String,
        apiKey: String,
        costTier: String,
        baseUrl: String?,
        model: String?,
        rpmLimit: Int?,
        testFirst: Bool = true
    ) async throws -> KeyAddResponse {
        var body: [String: Any] = [
            "provider": provider,
            "api_key": apiKey,
            "cost_tier": costTier,
            "test_first": testFirst,
        ]
        if !label.isEmpty { body["label"] = label }
        if let baseUrl = baseUrl, !baseUrl.isEmpty { body["base_url"] = baseUrl }
        if let model = model, !model.isEmpty { body["model"] = model }
        if let rpmLimit = rpmLimit { body["rpm_limit"] = rpmLimit }
        let data = try await perform(method: "POST", path: "/api/keys/add", body: body, timeout: 30)
        return try JSONDecoder().decode(KeyAddResponse.self, from: data)
    }

    func testKey(slot: String? = nil, provider: String? = nil, apiKey: String? = nil, baseUrl: String? = nil) async throws -> KeyTestResponse {
        var body: [String: Any] = [:]
        if let slot = slot { body["slot"] = slot }
        if let provider = provider { body["provider"] = provider }
        if let apiKey = apiKey { body["api_key"] = apiKey }
        if let baseUrl = baseUrl, !baseUrl.isEmpty { body["base_url"] = baseUrl }
        let data = try await perform(method: "POST", path: "/api/keys/test", body: body, timeout: 30)
        return try JSONDecoder().decode(KeyTestResponse.self, from: data)
    }

    func deleteKey(slot: String) async throws -> Snapshot? {
        let data = try await perform(method: "DELETE", path: "/api/keys/\(encodeSegment(slot))")
        let decoded = try JSONDecoder().decode(ActionSnapshotResponsePayload.self, from: data)
        return decoded.snapshot
    }

    func resetKey(name: String) async throws {
        _ = try await perform(method: "POST", path: "/api/keys/\(encodeSegment(name))/reset")
    }

    func applySelfConfig(targets: [String]?) async throws -> SelfConfigPlan {
        var body: [String: Any] = [:]
        if let targets = targets { body["targets"] = targets }
        let data = try await perform(method: "POST", path: "/api/self-config/apply", body: body)
        return try JSONDecoder().decode(SelfConfigPlan.self, from: data)
    }

    func toggleOvernight(enabled: Bool?, budgetUsd: Double?, maxRuns: Int?) async throws -> OvernightActionResponse {
        var body: [String: Any] = [:]
        if let enabled = enabled { body["enabled"] = enabled }
        if let budgetUsd = budgetUsd { body["nightly_budget_usd"] = budgetUsd }
        if let maxRuns = maxRuns { body["max_runs_per_night"] = maxRuns }
        let data = try await perform(method: "POST", path: "/api/overnight/toggle", body: body)
        return try JSONDecoder().decode(OvernightActionResponse.self, from: data)
    }

    func scanOvernight() async throws -> OvernightActionResponse {
        let data = try await perform(method: "POST", path: "/api/overnight/scan", timeout: 20)
        return try JSONDecoder().decode(OvernightActionResponse.self, from: data)
    }

    func approveTicket(id: String, allowPaid: Bool = false) async throws -> OvernightActionResponse {
        let body: [String: Any] = ["allow_paid": allowPaid]
        let data = try await perform(method: "POST", path: "/api/overnight/tickets/\(encodeSegment(id))/approve", body: body, timeout: 20)
        return try JSONDecoder().decode(OvernightActionResponse.self, from: data)
    }

    func deferTicket(id: String) async throws -> OvernightActionResponse {
        let data = try await perform(method: "POST", path: "/api/overnight/tickets/\(encodeSegment(id))/defer")
        return try JSONDecoder().decode(OvernightActionResponse.self, from: data)
    }

    // MARK: - Kiro Specs

    func createSpec(
        title: String,
        goal: String,
        requirementsMd: String,
        designMd: String,
        allowedPathGlobs: [String],
        gateCmd: String,
        sandboxTier: String,
        maxBudgetUsd: Double
    ) async throws -> SpecActionResponse {
        let body: [String: Any] = [
            "title": title,
            "goal": goal,
            "requirements_md": requirementsMd,
            "design_md": designMd,
            "allowed_path_globs": allowedPathGlobs,
            "gate_cmd": gateCmd,
            "sandbox_tier": sandboxTier,
            "max_budget_usd": maxBudgetUsd,
        ]
        let data = try await perform(method: "POST", path: "/api/specs", body: body)
        return try JSONDecoder().decode(SpecActionResponse.self, from: data)
    }

    func approveSpec(id: String) async throws -> SpecActionResponse {
        let data = try await perform(method: "POST", path: "/api/specs/\(encodeSegment(id))/approve")
        return try JSONDecoder().decode(SpecActionResponse.self, from: data)
    }

    func runSpec(id: String) async throws -> SpecActionResponse {
        let data = try await perform(method: "POST", path: "/api/specs/\(encodeSegment(id))/run", timeout: 30)
        return try JSONDecoder().decode(SpecActionResponse.self, from: data)
    }
}

private struct ActionSnapshotResponsePayload: Codable {
    let ok: Bool?
    let snapshot: Snapshot?
}
