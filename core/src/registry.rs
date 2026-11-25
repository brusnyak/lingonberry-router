use crate::config::Config;
use crate::discovery::build_workers;
use crate::types::{DiscoveredWorker, DiscoveryData, WorkerStatus};
use anyhow::{bail, Result};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct KeyState {
    pub name: String,
    pub provider: String,
    pub cooling_until: f64,
    pub inflight: usize,
    pub ok: usize,
    pub fail: usize,
    pub window: Vec<f64>,
}

pub fn now_sec() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

pub struct RegistryInner {
    pub workers: Vec<DiscoveredWorker>,
    pub keys: BTreeMap<String, KeyState>,
    pub down_workers: BTreeSet<String>,
    pub rpm_limit: usize,
    pub provider_rpm_caps: BTreeMap<String, usize>,
    pub cooldown_s: u64,
    pub max_inflight: usize,
    pub default_worker: String,
}

/// Thread-safe worker & key-slot registry with RAII LeaseGuard.
#[derive(Clone)]
pub struct Registry {
    inner: Arc<Mutex<RegistryInner>>,
}

/// RAII lease guard: automatically releases the leased inflight slot on Drop if not explicitly committed.
pub struct LeaseGuard {
    registry: Registry,
    key_name: String,
    released: bool,
}

impl LeaseGuard {
    pub fn key_name(&self) -> &str {
        &self.key_name
    }

    pub fn complete(mut self, ok: bool, cooldown_override_s: Option<u64>) {
        self.registry
            .release_key(&self.key_name, ok, cooldown_override_s);
        self.released = true;
    }
}

impl Drop for LeaseGuard {
    fn drop(&mut self) {
        if !self.released {
            // Panic or early cancel safety: never leak inflight capacity
            self.registry.release_key(&self.key_name, false, Some(5));
        }
    }
}

impl Registry {
    pub fn new(discovery: &DiscoveryData, cfg: &Config) -> Self {
        let excluded: BTreeSet<&str> = cfg.excluded_agents.iter().map(String::as_str).collect();
        let mut workers: Vec<DiscoveredWorker> = build_workers(discovery)
            .into_iter()
            .filter(|w| !excluded.contains(w.agent.as_str()))
            .collect();
        workers.sort_by(|a, b| a.id.cmp(&b.id));

        let mut keys = BTreeMap::new();
        for (provider, names) in &discovery.keys {
            for name in names {
                keys.insert(
                    name.clone(),
                    KeyState {
                        name: name.clone(),
                        provider: provider.clone(),
                        cooling_until: 0.0,
                        inflight: 0,
                        ok: 0,
                        fail: 0,
                        window: Vec::new(),
                    },
                );
            }
        }

        Self {
            inner: Arc::new(Mutex::new(RegistryInner {
                workers,
                keys,
                down_workers: BTreeSet::new(),
                rpm_limit: cfg.rpm_per_key,
                provider_rpm_caps: BTreeMap::new(),
                cooldown_s: cfg.cooldown_s,
                max_inflight: cfg.max_inflight_per_key,
                default_worker: cfg.default_worker.clone(),
            })),
        }
    }

    pub fn refresh(&self, discovery: &DiscoveryData, cfg: &Config) {
        let mut guard = self.inner.lock().unwrap();
        let excluded: BTreeSet<&str> = cfg.excluded_agents.iter().map(String::as_str).collect();
        let mut workers: Vec<DiscoveredWorker> = build_workers(discovery)
            .into_iter()
            .filter(|w| !excluded.contains(w.agent.as_str()))
            .collect();
        workers.sort_by(|a, b| a.id.cmp(&b.id));
        guard.workers = workers;
        guard.rpm_limit = cfg.rpm_per_key;
        guard.cooldown_s = cfg.cooldown_s;
        guard.max_inflight = cfg.max_inflight_per_key;
        guard.default_worker = cfg.default_worker.clone();

        for (provider, names) in &discovery.keys {
            for name in names {
                guard.keys.entry(name.clone()).or_insert_with(|| KeyState {
                    name: name.clone(),
                    provider: provider.clone(),
                    cooling_until: 0.0,
                    inflight: 0,
                    ok: 0,
                    fail: 0,
                    window: Vec::new(),
                });
            }
        }
    }

    pub fn set_rpm_limit(&self, target: &str, rpm: usize) -> bool {
        let clamped = rpm.clamp(5, 300);
        let mut guard = self.inner.lock().unwrap();
        if let Some(k) = guard.keys.get(target) {
            let prov = k.provider.clone();
            guard.provider_rpm_caps.insert(prov, clamped);
            return true;
        }
        let has_provider = guard.keys.values().any(|k| k.provider == target);
        if has_provider {
            guard.provider_rpm_caps.insert(target.to_string(), clamped);
            return true;
        }
        false
    }

    pub fn list_workers(&self) -> Vec<DiscoveredWorker> {
        self.inner.lock().unwrap().workers.clone()
    }

    pub fn find_worker(&self, id: &str) -> Option<DiscoveredWorker> {
        self.inner
            .lock()
            .unwrap()
            .workers
            .iter()
            .find(|w| w.id == id)
            .cloned()
    }

    pub fn mark_worker_down(&self, worker_id: &str, down: bool) {
        let mut guard = self.inner.lock().unwrap();
        if down {
            guard.down_workers.insert(worker_id.to_string());
        } else {
            guard.down_workers.remove(worker_id);
        }
    }

    pub fn is_worker_down(&self, worker_id: &str) -> bool {
        self.inner.lock().unwrap().down_workers.contains(worker_id)
    }

    pub fn select_best_worker(&self) -> Option<DiscoveredWorker> {
        let guard = self.inner.lock().unwrap();
        let available: Vec<&DiscoveredWorker> = guard
            .workers
            .iter()
            .filter(|w| !guard.down_workers.contains(&w.id))
            .collect();

        available
            .iter()
            .find(|w| {
                w.id == guard.default_worker && (w.key_slot.is_none() || w.agent == "pi")
            })
            .or_else(|| {
                available
                    .iter()
                    .find(|w| w.agent == "pi" && w.key_slot.is_none())
            })
            .or_else(|| available.iter().find(|w| w.key_slot.is_none()))
            .or_else(|| available.first())
            .map(|w| (*w).clone())
    }

    pub fn find_fallback_worker(
        &self,
        exclude_keys: &BTreeSet<String>,
        prefer_provider: Option<&str>,
    ) -> Option<DiscoveredWorker> {
        let guard = self.inner.lock().unwrap();
        let now = now_sec();
        let routable: Vec<&DiscoveredWorker> = guard
            .workers
            .iter()
            .filter(|w| {
                if guard.down_workers.contains(&w.id) {
                    return false;
                }
                let Some(slot) = &w.key_slot else {
                    return false;
                };
                if exclude_keys.contains(slot) {
                    return false;
                }
                let Some(ks) = guard.keys.get(slot) else {
                    return false;
                };
                now >= ks.cooling_until && ks.inflight < guard.max_inflight
            })
            .collect();

        if let Some(prov) = prefer_provider {
            if let Some(same) = routable.iter().find(|w| w.provider == prov) {
                return Some((*same).clone());
            }
        }
        routable.first().map(|w| (*w).clone())
    }

    pub fn lease_guard(&self, prefer: Option<&str>, provider: Option<&str>) -> Result<LeaseGuard> {
        let key = self.lease_key_in(prefer, provider)?;
        Ok(LeaseGuard {
            registry: self.clone(),
            key_name: key,
            released: false,
        })
    }

    pub fn lease_key_in(&self, prefer: Option<&str>, provider: Option<&str>) -> Result<String> {
        let mut guard = self.inner.lock().unwrap();
        let now = now_sec();
        let max_inflight = guard.max_inflight;
        let default_rpm = guard.rpm_limit;
        let caps = guard.provider_rpm_caps.clone();

        let mut candidate_names: Vec<String> = guard
            .keys
            .values()
            .filter(|k| provider.map(|p| k.provider == p).unwrap_or(true))
            .map(|k| k.name.clone())
            .collect();

        candidate_names.sort_by(|a, b| {
            let ka = &guard.keys[a];
            let kb = &guard.keys[b];
            let a_pref = usize::from(prefer == Some(ka.name.as_str()));
            let b_pref = usize::from(prefer == Some(kb.name.as_str()));
            b_pref
                .cmp(&a_pref)
                .then(ka.inflight.cmp(&kb.inflight))
                .then(ka.window.len().cmp(&kb.window.len()))
        });

        for name in candidate_names {
            let k = guard.keys.get_mut(&name).unwrap();
            if now < k.cooling_until {
                continue;
            }
            let effective_rpm = caps.get(&k.provider).copied().unwrap_or(default_rpm);
            k.window.retain(|t| now - *t <= 60.0);
            if k.window.len() >= effective_rpm || k.inflight >= max_inflight {
                continue;
            }
            k.inflight += 1;
            k.window.push(now);
            return Ok(k.name.clone());
        }

        bail!(
            "no free key (provider={}, max_inflight={}, rpm_limit={})",
            provider.unwrap_or("any"),
            max_inflight,
            provider.and_then(|p| caps.get(p).copied()).unwrap_or(default_rpm)
        );
    }

    pub fn release_key(&self, name: &str, ok: bool, custom_cooldown_s: Option<u64>) {
        let mut guard = self.inner.lock().unwrap();
        let cooldown = custom_cooldown_s.unwrap_or(guard.cooldown_s);
        if let Some(k) = guard.keys.get_mut(name) {
            k.inflight = k.inflight.saturating_sub(1);
            if ok {
                k.ok += 1;
            } else {
                k.fail += 1;
                k.cooling_until = now_sec() + cooldown as f64;
            }
        }
    }

    pub fn clear_cooldown(&self, name: &str) -> bool {
        let mut guard = self.inner.lock().unwrap();
        if let Some(k) = guard.keys.get_mut(name) {
            k.cooling_until = 0.0;
            return true;
        }
        false
    }

    pub fn total_rpm(&self) -> usize {
        let mut guard = self.inner.lock().unwrap();
        let now = now_sec();
        let mut total = 0;
        for k in guard.keys.values_mut() {
            k.window.retain(|t| now - *t <= 60.0);
            total += k.window.len();
        }
        total
    }

    pub fn key_status(&self) -> Vec<WorkerStatus> {
        let guard = self.inner.lock().unwrap();
        let now = now_sec();
        guard
            .keys
            .values()
            .map(|k| {
                let active_calls = k.window.iter().filter(|t| now - **t <= 60.0).count();
                let cooling_left = if k.cooling_until > now {
                    (k.cooling_until - now).ceil() as u64
                } else {
                    0
                };
                let status = if cooling_left > 0 {
                    "down"
                } else if k.inflight > 0 {
                    "active"
                } else {
                    "idle"
                };
                let rpm_limit = guard
                    .provider_rpm_caps
                    .get(&k.provider)
                    .copied()
                    .unwrap_or(guard.rpm_limit);
                WorkerStatus {
                    name: k.name.clone(),
                    status: status.to_string(),
                    calls_24h: active_calls,
                    ok_24h: k.ok,
                    key: Some(k.name.clone()),
                    provider: Some(k.provider.clone()),
                    cooling_remaining_s: cooling_left,
                    rpm_limit,
                    inflight: k.inflight,
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Provider;

    fn sample_discovery() -> DiscoveryData {
        let mut keys = BTreeMap::new();
        keys.insert("nim".into(), vec!["NIM_1".into(), "NIM_2".into()]);
        keys.insert("groq".into(), vec!["GROQ_API_KEY".into()]);
        let mut providers = BTreeMap::new();
        providers.insert(
            "nim".into(),
            Provider {
                id: "nim".into(),
                base_url: "https://integrate.api.nvidia.com/v1".into(),
                style: Some("openai".into()),
            },
        );
        DiscoveryData {
            agents: vec![],
            keys,
            providers,
            library_dirs: vec![],
            ssh_hosts: vec![],
            git_projects: vec![],
            browsers: vec![],
        }
    }

    #[test]
    fn raii_lease_guard_releases_on_drop() {
        let reg = Registry::new(&sample_discovery(), &Config::default());
        {
            let guard = reg.lease_guard(Some("NIM_1"), Some("nim")).unwrap();
            assert_eq!(guard.key_name(), "NIM_1");
            let status = reg.key_status();
            assert_eq!(
                status.iter().find(|k| k.name == "NIM_1").unwrap().status,
                "active"
            );
        } // dropped without complete()
        let after = reg.key_status();
        assert_eq!(
            after.iter().find(|k| k.name == "NIM_1").unwrap().status,
            "down"
        );
    }

    #[test]
    fn provider_scoped_lease_never_crosses_providers() {
        let reg = Registry::new(&sample_discovery(), &Config::default());
        assert!(reg.lease_key_in(None, Some("openai")).is_err());
        assert_eq!(reg.lease_key_in(None, Some("groq")).unwrap(), "GROQ_API_KEY");
    }

    #[test]
    fn provider_rpm_cap_updates_dynamically() {
        let reg = Registry::new(&sample_discovery(), &Config::default());
        assert!(reg.set_rpm_limit("groq", 15));
        let groq = reg
            .key_status()
            .into_iter()
            .find(|k| k.name == "GROQ_API_KEY")
            .unwrap();
        assert_eq!(groq.rpm_limit, 15);
    }
}
