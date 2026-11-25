using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace LingonberryTray;

public sealed class OverviewDto
{
    [JsonPropertyName("running")] public int Running { get; set; }
    [JsonPropertyName("live_workers")] public int LiveWorkers { get; set; }
    [JsonPropertyName("completed_24h")] public int Completed24h { get; set; }
    [JsonPropertyName("failed_24h")] public int Failed24h { get; set; }
    [JsonPropertyName("avg_duration_s")] public double? AvgDurationS { get; set; }
}

public sealed class WorkerStatusDto
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "idle";
    [JsonPropertyName("provider")] public string? Provider { get; set; }
}

public sealed class LiveWorkerDto
{
    [JsonPropertyName("pid")] public uint Pid { get; set; }
    [JsonPropertyName("worker")] public string Worker { get; set; } = "";
    [JsonPropertyName("key")] public string? Key { get; set; }
    [JsonPropertyName("elapsed_s")] public double ElapsedS { get; set; }
}

public sealed class SessionRowDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("prompt")] public string Prompt { get; set; } = "";
    [JsonPropertyName("worker")] public string Worker { get; set; } = "";
    [JsonPropertyName("state")] public string State { get; set; } = "";
    [JsonPropertyName("duration_s")] public double DurationS { get; set; }
}

public sealed class JobRowDto
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("source")] public string Source { get; set; } = "";
    [JsonPropertyName("schedule")] public string Schedule { get; set; } = "";
    [JsonPropertyName("health")] public string Health { get; set; } = "healthy";
    [JsonPropertyName("paused")] public bool? Paused { get; set; }
    [JsonPropertyName("auto_restart")] public bool AutoRestart { get; set; }
    [JsonPropertyName("crash_count")] public uint CrashCount { get; set; }
    [JsonPropertyName("running_pid")] public uint? RunningPid { get; set; }
}

public sealed class LiveCronProcessDto
{
    [JsonPropertyName("pid")] public uint Pid { get; set; }
    [JsonPropertyName("job_name")] public string JobName { get; set; } = "";
    [JsonPropertyName("command")] public string Command { get; set; } = "";
    [JsonPropertyName("cpu_pct")] public double CpuPct { get; set; }
    [JsonPropertyName("mem_mb")] public double MemMb { get; set; }
}

public sealed class SnapshotDto
{
    [JsonPropertyName("overview")] public OverviewDto Overview { get; set; } = new();
    [JsonPropertyName("workers")] public List<WorkerStatusDto> Workers { get; set; } = new();
    [JsonPropertyName("workers_live")] public List<LiveWorkerDto> WorkersLive { get; set; } = new();
    [JsonPropertyName("sessions")] public List<SessionRowDto> Sessions { get; set; } = new();
    [JsonPropertyName("jobs")] public List<JobRowDto> Jobs { get; set; } = new();
    [JsonPropertyName("cron_live")] public List<LiveCronProcessDto> CronLive { get; set; } = new();
}

public sealed class RouterClient
{
    private readonly HttpClient _http = new()
    {
        BaseAddress = new Uri("http://127.0.0.1:8799/"),
        Timeout = TimeSpan.FromSeconds(2)
    };

    public async Task<SnapshotDto?> FetchSnapshotAsync()
    {
        try
        {
            var json = await _http.GetStringAsync("snapshot");
            return JsonSerializer.Deserialize<SnapshotDto>(json);
        }
        catch
        {
            return null;
        }
    }

    public async Task PostAsync(string path)
    {
        try
        {
            using var content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
            await _http.PostAsync(path, content);
        }
        catch { }
    }

    public Task KillWorkerAsync(uint pid) => PostAsync($"kill/{pid}");
    public Task KillCronPidAsync(uint pid) => PostAsync($"api/jobs/kill/{pid}");
    public Task ToggleJobAsync(string name) => PostAsync($"api/jobs/{Uri.EscapeDataString(name)}/toggle");
    public Task RunJobAsync(string name) => PostAsync($"api/jobs/{Uri.EscapeDataString(name)}/run");
    public Task HealJobAsync(string name) => PostAsync($"api/jobs/{Uri.EscapeDataString(name)}/heal");
    public Task ToggleWatchdogAsync(string name) => PostAsync($"api/jobs/{Uri.EscapeDataString(name)}/watchdog");
    public Task RescanAsync() => PostAsync("api/rescan");
}
