//! Host hardware (RAM / APFS disk / load) and per-provider RPM/subscription headroom watchdog.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, System};

fn now_sec() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PressureLevel {
    Normal,
    Warn,
    Critical,
}

impl PressureLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            PressureLevel::Normal => "normal",
            PressureLevel::Warn => "warn",
            PressureLevel::Critical => "critical",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchdogStatus {
    pub memory_pressure: String,
    pub ram_used_pct: f64,
    pub disk_pressure: String,
    pub free_disk_gb: f64,
    pub cpu_pct: f64,
    pub max_concurrent_workers: usize,
    pub active_workers: usize,
    pub paused_reason: Option<String>,
    pub provider_rpm_used: BTreeMap<String, usize>,
    pub subscription_burst_used: usize,
    pub subscription_burst_cap: usize,
}

pub struct HostWatchdog {
    inner: Arc<Mutex<WatchdogInner>>,
}

struct WatchdogInner {
    ram_warn_pct: f64,
    ram_critical_pct: f64,
    disk_warn_free_gb: f64,
    disk_critical_free_gb: f64,
    base_max_workers: usize,
    provider_windows: BTreeMap<String, VecDeque<f64>>,
    sub_window: VecDeque<f64>,
    sub_5h_cap: usize,
    last_status: WatchdogStatus,
}

impl Clone for HostWatchdog {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl Default for HostWatchdog {
    fn default() -> Self {
        Self::new(6)
    }
}

impl HostWatchdog {
    pub fn new(base_max_workers: usize) -> Self {
        let initial = WatchdogStatus {
            memory_pressure: "normal".into(),
            ram_used_pct: 40.0,
            disk_pressure: "normal".into(),
            free_disk_gb: 64.0,
            cpu_pct: 12.0,
            max_concurrent_workers: base_max_workers.max(1),
            active_workers: 0,
            paused_reason: None,
            provider_rpm_used: BTreeMap::new(),
            subscription_burst_used: 0,
            subscription_burst_cap: 45,
        };
        Self {
            inner: Arc::new(Mutex::new(WatchdogInner {
                ram_warn_pct: 78.0,
                ram_critical_pct: 90.0,
                disk_warn_free_gb: 15.0,
                disk_critical_free_gb: 10.0,
                base_max_workers: base_max_workers.max(1),
                provider_windows: BTreeMap::new(),
                sub_window: VecDeque::new(),
                sub_5h_cap: 45,
                last_status: initial,
            })),
        }
    }

    /// Probes host RAM, macOS `memory_pressure` (if present), and workspace free disk space.
    pub fn refresh(&self, workspace_root: &Path, active_workers: usize) -> WatchdogStatus {
        let mut sys = System::new_all();
        sys.refresh_cpu_usage();
        sys.refresh_memory();

        let ram_total = sys.total_memory().max(1) as f64;
        let ram_used = sys.used_memory() as f64;
        let ram_used_pct = ((ram_used / ram_total) * 100.0 * 10.0).round() / 10.0;

        let cpu_pct = if sys.cpus().is_empty() {
            0.0
        } else {
            let avg = sys.cpus().iter().map(|c| c.cpu_usage() as f64).sum::<f64>()
                / sys.cpus().len() as f64;
            (avg * 10.0).round() / 10.0
        };

        let disks = Disks::new_with_refreshed_list();
        let abs = std::fs::canonicalize(workspace_root).unwrap_or_else(|_| workspace_root.to_path_buf());
        let free_disk_gb = disks
            .iter()
            .filter(|d| abs.starts_with(d.mount_point()))
            .max_by_key(|d| d.mount_point().as_os_str().len())
            .or_else(|| disks.first())
            .map(|d| (d.available_space() as f64 / (1024.0 * 1024.0 * 1024.0) * 10.0).round() / 10.0)
            .unwrap_or(64.0);

        let mac_pressure = probe_macos_memory_pressure();

        let mut guard = self.inner.lock().unwrap();
        let now = now_sec();
        guard.sub_window.retain(|t| now - *t <= 18_000.0);
        for q in guard.provider_windows.values_mut() {
            q.retain(|t| now - *t <= 60.0);
        }

        let mem_level = if mac_pressure == Some(PressureLevel::Critical)
            || ram_used_pct >= guard.ram_critical_pct
        {
            PressureLevel::Critical
        } else if mac_pressure == Some(PressureLevel::Warn)
            || ram_used_pct >= guard.ram_warn_pct
            || cpu_pct >= 85.0
        {
            PressureLevel::Warn
        } else {
            PressureLevel::Normal
        };

        let disk_level = if free_disk_gb < guard.disk_critical_free_gb {
            PressureLevel::Critical
        } else if free_disk_gb < guard.disk_warn_free_gb {
            PressureLevel::Warn
        } else {
            PressureLevel::Normal
        };

        let (max_concurrent_workers, paused_reason) = if mem_level == PressureLevel::Critical {
            (
                0,
                Some(format!(
                    "RAM critical ({ram_used_pct:.1}%): pausing new spawns & signaling heavy children"
                )),
            )
        } else if disk_level == PressureLevel::Critical {
            (
                0,
                Some(format!(
                    "Disk critical ({free_disk_gb:.1} GB free < {} GB): blocking new worktrees",
                    guard.disk_critical_free_gb
                )),
            )
        } else if mem_level == PressureLevel::Warn || disk_level == PressureLevel::Warn {
            ((guard.base_max_workers / 2).max(1), None)
        } else {
            (guard.base_max_workers, None)
        };

        let provider_rpm_used = guard
            .provider_windows
            .iter()
            .map(|(p, q)| (p.clone(), q.len()))
            .collect();

        let status = WatchdogStatus {
            memory_pressure: mem_level.as_str().to_string(),
            ram_used_pct,
            disk_pressure: disk_level.as_str().to_string(),
            free_disk_gb,
            cpu_pct,
            max_concurrent_workers,
            active_workers,
            paused_reason,
            provider_rpm_used,
            subscription_burst_used: guard.sub_window.len(),
            subscription_burst_cap: guard.sub_5h_cap,
        };
        guard.last_status = status.clone();
        status
    }

    pub fn current_status(&self) -> WatchdogStatus {
        self.inner.lock().unwrap().last_status.clone()
    }

    pub fn record_provider_call(&self, provider: &str, is_subscription_cli: bool) {
        let mut guard = self.inner.lock().unwrap();
        let now = now_sec();
        let entry = guard
            .provider_windows
            .entry(provider.to_string())
            .or_default();
        entry.retain(|t| now - *t <= 60.0);
        entry.push_back(now);
        if is_subscription_cli {
            guard.sub_window.retain(|t| now - *t <= 18_000.0);
            guard.sub_window.push_back(now);
        }
    }

    pub fn subscription_headroom(&self) -> usize {
        let mut guard = self.inner.lock().unwrap();
        let now = now_sec();
        guard.sub_window.retain(|t| now - *t <= 18_000.0);
        guard.sub_5h_cap.saturating_sub(guard.sub_window.len())
    }
}

fn probe_macos_memory_pressure() -> Option<PressureLevel> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let out = Command::new("memory_pressure").arg("-Q").output().ok()?;
    let txt = String::from_utf8_lossy(&out.stdout).to_ascii_lowercase();
    if txt.contains("critical") {
        Some(PressureLevel::Critical)
    } else if txt.contains("warn") {
        Some(PressureLevel::Warn)
    } else if txt.contains("normal") {
        Some(PressureLevel::Normal)
    } else {
        None
    }
}

/// Safe interpreter heap ceiling env vars injected into spawned worker commands so runaway Node/Bun
/// subprocesses never trigger kernel swap panic.
pub fn safe_worker_env_limits() -> [(&'static str, &'static str); 2] {
    [
        ("NODE_OPTIONS", "--max-old-space-size=2048"),
        ("BUN_JSC_gcMaxHeapSize", "2147483648"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watchdog_tracks_provider_and_subscription_windows() {
        let wd = HostWatchdog::new(6);
        wd.record_provider_call("nim", false);
        wd.record_provider_call("claude", true);
        assert_eq!(wd.subscription_headroom(), 44);
        let status = wd.refresh(Path::new("."), 1);
        assert_eq!(status.provider_rpm_used.get("nim").copied(), Some(1));
        assert_eq!(status.subscription_burst_used, 1);
        assert!(status.max_concurrent_workers <= 6);
    }
}
