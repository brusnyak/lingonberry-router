use crate::types::{JobRow, LiveCronProcess};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use sysinfo::{Pid, Signal, System};

/// Scans the host OS for all scheduled cron / launchd / systemd / schtasks jobs
/// so the operator can see everything scheduled across the machine in one place.
pub fn scan_os_cron_jobs() -> Vec<JobRow> {
    let mut found = Vec::new();

    // 1. User crontab (macOS & Linux)
    #[cfg(unix)]
    {
        if let Ok(output) = Command::new("crontab").arg("-l").output() {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                found.extend(parse_crontab_text(&text));
            }
        }
    }

    // 2. macOS ~/Library/LaunchAgents/*.plist
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            let launch_dir = home.join("Library").join("LaunchAgents");
            if let Ok(entries) = fs::read_dir(launch_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) == Some("plist") {
                        if let Ok(xml) = fs::read_to_string(&path) {
                            if let Some(job) = parse_launchd_plist(&xml, &path) {
                                found.push(job);
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Linux ~/.config/systemd/user/*.timer
    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            let systemd_dir = home.join(".config").join("systemd").join("user");
            if let Ok(entries) = fs::read_dir(systemd_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) == Some("timer") {
                        if let Ok(unit) = fs::read_to_string(&path) {
                            if let Some(job) = parse_systemd_timer(&unit, &path) {
                                found.push(job);
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Windows Task Scheduler CSV (schtasks)
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("schtasks")
            .args(["/Query", "/FO", "CSV", "/NH"])
            .output()
        {
            if output.status.success() {
                let csv = String::from_utf8_lossy(&output.stdout);
                found.extend(parse_windows_schtasks(&csv));
            }
        }
    }

    found
}

pub fn parse_crontab_text(text: &str) -> Vec<JobRow> {
    let mut jobs = Vec::new();
    let mut idx = 0usize;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.contains('=') && !line.starts_with('@') && !line.chars().next().map(|c| c.is_ascii_digit() || c == '*').unwrap_or(false) {
            continue;
        }
        let (schedule, command) = if let Some(rest) = line.strip_prefix('@') {
            let mut parts = rest.splitn(2, char::is_whitespace);
            let kw = parts.next().unwrap_or("hourly");
            let cmd = parts.next().unwrap_or("").trim();
            (format!("@{kw}"), cmd.to_string())
        } else {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 6 {
                continue;
            }
            (parts[..5].join(" "), parts[5..].join(" "))
        };
        if command.is_empty() {
            continue;
        }
        idx += 1;
        let cmd_tail = command
            .split_whitespace()
            .next()
            .and_then(|p| p.rsplit('/').next())
            .unwrap_or("cron-task");
        jobs.push(JobRow {
            name: format!("crontab-{cmd_tail}-{idx}"),
            source: "crontab".into(),
            schedule,
            command: command.clone(),
            every_s: None,
            last: None,
            rc: Some(0),
            paused: Some(false),
            next_in_s: Some(300),
            prompt: Some(command),
            health: "healthy".into(),
            running_pid: None,
            crash_count: 0,
            restart_count: 0,
            auto_restart: true,
            last_error: None,
            log_tail: vec!["Discovered from user crontab".into()],
        });
    }
    jobs
}

pub fn parse_launchd_plist(xml: &str, path: &PathBuf) -> Option<JobRow> {
    let label = extract_plist_string(xml, "Label").or_else(|| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
    })?;
    let interval = extract_plist_int(xml, "StartInterval");
    let keep_alive = xml.contains("<key>KeepAlive</key>");
    let disabled = xml.contains("<key>Disabled</key>\n\t<true/>")
        || xml.contains("<key>Disabled</key><true/>");
    let command = extract_plist_string(xml, "Program")
        .unwrap_or_else(|| format!("launchctl job {label}"));

    Some(JobRow {
        name: label,
        source: "launchd".into(),
        schedule: interval
            .map(|s| format!("every {s}s"))
            .unwrap_or_else(|| "calendar / launchd".into()),
        command: command.clone(),
        every_s: interval,
        last: None,
        rc: Some(0),
        paused: Some(disabled),
        next_in_s: if disabled { None } else { interval },
        prompt: Some(command),
        health: if disabled { "paused" } else { "healthy" }.into(),
        running_pid: None,
        crash_count: 0,
        restart_count: 0,
        auto_restart: keep_alive,
        last_error: None,
        log_tail: vec![format!("Discovered LaunchAgent: {}", path.display())],
    })
}

pub fn parse_systemd_timer(unit: &str, path: &PathBuf) -> Option<JobRow> {
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(str::to_string)?;
    let mut schedule = "systemd timer".to_string();
    for line in unit.lines() {
        let t = line.trim();
        if let Some(val) = t.strip_prefix("OnCalendar=") {
            schedule = val.trim().to_string();
        } else if let Some(val) = t.strip_prefix("OnUnitActiveSec=") {
            schedule = format!("every {}", val.trim());
        }
    }
    Some(JobRow {
        name: name.clone(),
        source: "systemd".into(),
        schedule,
        command: format!("systemctl --user start {name}.service"),
        every_s: None,
        last: None,
        rc: Some(0),
        paused: Some(false),
        next_in_s: Some(300),
        prompt: Some(format!("systemd user unit {name}")),
        health: "healthy".into(),
        running_pid: None,
        crash_count: 0,
        restart_count: 0,
        auto_restart: true,
        last_error: None,
        log_tail: vec![format!("Discovered systemd timer: {}", path.display())],
    })
}

#[cfg(target_os = "windows")]
fn parse_windows_schtasks(csv: &str) -> Vec<JobRow> {
    let mut out = Vec::new();
    for raw in csv.lines().take(25) {
        let cols: Vec<&str> = raw.split("\",\"").map(|s| s.trim_matches('"')).collect();
        if cols.len() >= 3 {
            let name = cols[0].trim_start_matches('\\').to_string();
            let status = cols[2].to_ascii_lowercase();
            let paused = status.contains("disabled");
            out.push(JobRow {
                name: name.clone(),
                source: "schtasks".into(),
                schedule: cols.get(1).copied().unwrap_or("scheduled").into(),
                command: format!("schtasks /Run /TN \"{name}\""),
                every_s: None,
                last: None,
                rc: Some(0),
                paused: Some(paused),
                next_in_s: None,
                prompt: Some(name),
                health: if status.contains("running") {
                    "running"
                } else if paused {
                    "paused"
                } else {
                    "healthy"
                }
                .into(),
                running_pid: None,
                crash_count: 0,
                restart_count: 0,
                auto_restart: true,
                last_error: None,
                log_tail: vec!["Discovered via Windows Task Scheduler".into()],
            });
        }
    }
    out
}

fn extract_plist_string(xml: &str, key: &str) -> Option<String> {
    let needle = format!("<key>{key}</key>");
    let idx = xml.find(&needle)?;
    let rest = &xml[idx + needle.len()..];
    let start = rest.find("<string>")?;
    let after = &rest[start + 8..];
    let end = after.find("</string>")?;
    Some(after[..end].trim().to_string())
}

fn extract_plist_int(xml: &str, key: &str) -> Option<u64> {
    let needle = format!("<key>{key}</key>");
    let idx = xml.find(&needle)?;
    let rest = &xml[idx + needle.len()..];
    let start = rest.find("<integer>")?;
    let after = &rest[start + 9..];
    let end = after.find("</integer>")?;
    after[..end].trim().parse::<u64>().ok()
}

/// Inspects currently running OS processes matching any registered job command/name
/// so the operator sees live cron PIDs, CPU, memory, and uptime.
pub fn scan_live_cron_processes(jobs: &BTreeMap<String, JobRow>) -> Vec<LiveCronProcess> {
    let mut sys = System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let my_pid = std::process::id();
    let mut live = Vec::new();

    for (pid, proc_info) in sys.processes() {
        let pid_u32 = pid.as_u32();
        if pid_u32 == my_pid {
            continue;
        }
        let cmd_line = proc_info
            .cmd()
            .iter()
            .map(|s| s.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(" ");
        let proc_name = proc_info.name().to_string_lossy().into_owned();
        if cmd_line.is_empty() && proc_name.is_empty() {
            continue;
        }
        if proc_name == "curl"
            || proc_name == "ps"
            || cmd_line.contains("/api/jobs/")
        {
            continue;
        }

        for job in jobs.values() {
            let needle = job.command.split_whitespace().next().unwrap_or("");
            let matches_cmd = needle.len() > 3
                && !needle.starts_with("lingonberry-core")
                && cmd_line.contains(needle);
            let matches_name = job.name.len() > 4
                && proc_name != "sh"
                && proc_name != "bash"
                && cmd_line.contains(&job.name);
            if matches_cmd || matches_name {
                live.push(LiveCronProcess {
                    pid: pid_u32,
                    job_name: job.name.clone(),
                    source: job.source.clone(),
                    command: if cmd_line.is_empty() {
                        proc_name.clone()
                    } else {
                        cmd_line.clone()
                    },
                    cpu_pct: (proc_info.cpu_usage() as f64 * 10.0).round() / 10.0,
                    mem_mb: (proc_info.memory() as f64 / 1_048_576.0 * 10.0).round() / 10.0,
                    elapsed_s: proc_info.run_time(),
                });
                break;
            }
        }
    }

    live
}

/// Runs an external OS cron command (non-lingonberry-core) with stdin closed and captures exit code + log tail.
pub fn execute_os_cron_command(command: &str) -> (i32, Vec<String>) {
    #[cfg(windows)]
    let out = Command::new("cmd")
        .args(["/C", command])
        .stdin(std::process::Stdio::null())
        .output();
    #[cfg(not(windows))]
    let out = Command::new("sh")
        .args(["-c", command])
        .stdin(std::process::Stdio::null())
        .output();

    match out {
        Ok(res) => {
            let rc = res.status.code().unwrap_or(1);
            let stdout = String::from_utf8_lossy(&res.stdout);
            let stderr = String::from_utf8_lossy(&res.stderr);
            let mut lines: Vec<String> = stdout
                .lines()
                .chain(stderr.lines())
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .rev()
                .take(4)
                .collect();
            lines.reverse();
            if lines.is_empty() {
                lines.push(format!("os command finished with exit rc={rc}"));
            }
            (rc, lines)
        }
        Err(err) => (127, vec![format!("failed to spawn cron command: {err}")]),
    }
}

pub fn kill_os_pid(pid: u32) -> bool {
    let mut sys = System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    if let Some(p) = sys.process(Pid::from_u32(pid)) {
        return p.kill_with(Signal::Term).unwrap_or_else(|| p.kill());
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_crontab_schedules_and_ignores_comments() {
        let sample = r#"
# m h dom mon dow command
MAILTO=""
0 */4 * * * /usr/local/bin/vault-sync --quiet
@daily ~/scripts/cleanup.sh
"#;
        let parsed = parse_crontab_text(sample);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].schedule, "0 */4 * * *");
        assert_eq!(parsed[0].source, "crontab");
        assert_eq!(parsed[1].schedule, "@daily");
    }

    #[test]
    fn parses_macos_launchd_plist_keepalive_and_interval() {
        let plist = r#"
<plist version="1.0"><dict>
  <key>Label</key><string>com.lingonberry.audit</string>
  <key>Program</key><string>/usr/local/bin/lingonberry-core</string>
  <key>StartInterval</key><integer>900</integer>
  <key>KeepAlive</key><true/>
</dict></plist>
"#;
        let job = parse_launchd_plist(plist, &PathBuf::from("/tmp/audit.plist")).unwrap();
        assert_eq!(job.name, "com.lingonberry.audit");
        assert_eq!(job.every_s, Some(900));
        assert!(job.auto_restart);
    }
}
