import Foundation

actor RouterClient {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL = URL(string: "http://127.0.0.1:8799")!) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 5
        config.timeoutIntervalForResource = 10
        self.session = URLSession(configuration: config)
    }

    func snapshot() async throws -> Snapshot {
        let url = baseURL.appendingPathComponent("/api/snapshot")
        let (data, _) = try await session.data(from: url)
        return try JSONDecoder().decode(Snapshot.self, from: data)
    }

    func version() async throws -> VersionResp {
        let url = baseURL.appendingPathComponent("/version")
        let (data, _) = try await session.data(from: url)
        return try JSONDecoder().decode(VersionResp.self, from: data)
    }

    func discover() async throws -> DiscoverData {
        let url = baseURL.appendingPathComponent("/api/discover")
        let (data, _) = try await session.data(from: url)
        return try JSONDecoder().decode(DiscoverData.self, from: data)
    }

    func keys() async throws -> [KeyStatus] {
        let url = baseURL.appendingPathComponent("/api/keys")
        let (data, _) = try await session.data(from: url)
        return try JSONDecoder().decode([KeyStatus].self, from: data)
    }

    func runs() async throws -> [RunRow] {
        let url = baseURL.appendingPathComponent("/api/runs")
        let (data, _) = try await session.data(from: url)
        return try JSONDecoder().decode([RunRow].self, from: data)
    }

    func route(prompt: String, phase: String = "plan", caller: String? = nil) async throws -> Receipt {
        var url = baseURL.appendingPathComponent("/api/route")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["prompt": prompt, "phase": phase]
        if let caller = caller { body["caller"] = caller }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await session.data(for: req)
        return try JSONDecoder().decode(Receipt.self, from: data)
    }

    func run(prompt: String, worker: String? = nil, caller: String? = nil, liveApi: Bool = false) async throws -> RunRow {
        var url = baseURL.appendingPathComponent("/api/run")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["prompt": prompt]
        if let worker = worker { body["worker"] = worker }
        if let caller = caller { body["caller"] = caller }
        if liveApi { body["live_api"] = true }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await session.data(for: req)
        let response = try JSONDecoder().decode(RunResponse.self, from: data)
        return response.run
    }
}

struct DiscoverData: Codable {
    let agents: [AgentInfo]
    let keys: [String: [String]]
    let providers: [String: ProviderInfo]
    let library_dirs: [String]
    let ssh_hosts: [String]
    let git_projects: [String]
    let browsers: [String]
}

struct AgentInfo: Codable {
    let id: String
    let path: String?
}

struct ProviderInfo: Codable {
    let id: String
    let base_url: String
    let style: String?
}
