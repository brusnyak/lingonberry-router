//! 50-Agent Single-Repo Swarm Coordination:
//! - Dynamic Semaphore bounded by Watchdog memory/disk capacity
//! - File-Path & Domain Glob Lease Locks preventing overlapping mutations on one repo
//! - Serial Rebase-and-Merge Queue ensuring verified linear integration onto the target branch

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathLease {
    pub run_id: String,
    pub repo_root: String,
    pub globs: Vec<String>,
    pub worktree_path: String,
    pub sandbox_tier: String,
    pub lease_state: String, // queued | leased | gate_checking | merge_queued | merged | conflict | released
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeQueueItem {
    pub run_id: String,
    pub repo_root: String,
    pub branch_or_worktree: String,
    pub gate_cmd: String,
    pub status: String, // queued | rebasing | gating | merged | conflict
    pub attempt: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SwarmSummary {
    pub max_concurrent: usize,
    pub active_workers: usize,
    pub queued_count: usize,
    pub active_leases: Vec<PathLease>,
    pub merge_queue: Vec<MergeQueueItem>,
}

#[derive(Clone)]
pub struct SwarmCoordinator {
    semaphore: Arc<Semaphore>,
    inner: Arc<Mutex<SwarmInner>>,
}

struct SwarmInner {
    max_concurrent: usize,
    active_workers: usize,
    queued_count: usize,
    leases: BTreeMap<String, PathLease>,
    merge_queue: VecDeque<MergeQueueItem>,
}

impl Default for SwarmCoordinator {
    fn default() -> Self {
        Self::new(6)
    }
}

impl SwarmCoordinator {
    pub fn new(max_concurrent: usize) -> Self {
        let cap = max_concurrent.max(1);
        Self {
            semaphore: Arc::new(Semaphore::new(cap)),
            inner: Arc::new(Mutex::new(SwarmInner {
                max_concurrent: cap,
                active_workers: 0,
                queued_count: 0,
                leases: BTreeMap::new(),
                merge_queue: VecDeque::new(),
            })),
        }
    }

    /// Acquires bounded execution slot without starving or crashing the machine under 50-agent load.
    pub async fn acquire_worker_slot(&self) -> Option<OwnedSemaphorePermit> {
        {
            let mut g = self.inner.lock().unwrap();
            g.queued_count += 1;
        }
        let permit = Arc::clone(&self.semaphore).acquire_owned().await.ok();
        let mut g = self.inner.lock().unwrap();
        g.queued_count = g.queued_count.saturating_sub(1);
        if permit.is_some() {
            g.active_workers += 1;
        }
        permit
    }

    pub fn mark_worker_finished(&self) {
        let mut g = self.inner.lock().unwrap();
        g.active_workers = g.active_workers.saturating_sub(1);
    }

    pub fn active_workers(&self) -> usize {
        self.inner.lock().unwrap().active_workers
    }

    /// Checks whether two glob/path patterns overlap within the same repository.
    pub fn globs_overlap(a: &str, b: &str) -> bool {
        let na = a.trim().trim_start_matches("./").trim_end_matches("/**");
        let nb = b.trim().trim_start_matches("./").trim_end_matches("/**");
        if na == "*" || nb == "*" || na.is_empty() || nb.is_empty() || na == nb {
            return true;
        }
        na.starts_with(&format!("{nb}/")) || nb.starts_with(&format!("{na}/"))
    }

    /// Acquires non-overlapping path leases for a worktree run in `repo_root`.
    pub fn acquire_path_lease(
        &self,
        run_id: &str,
        repo_root: &Path,
        globs: Vec<String>,
        worktree_path: &Path,
        sandbox_tier: &str,
    ) -> Result<PathLease, String> {
        let repo_str = repo_root.to_string_lossy().into_owned();
        let clean_globs: Vec<String> = if globs.is_empty() {
            vec!["*".into()]
        } else {
            globs
        };
        let mut g = self.inner.lock().unwrap();
        for (other_id, existing) in &g.leases {
            if other_id == run_id
                || existing.repo_root != repo_str
                || matches!(existing.lease_state.as_str(), "merged" | "released" | "conflict")
            {
                continue;
            }
            for ng in &clean_globs {
                for eg in &existing.globs {
                    if Self::globs_overlap(ng, eg) {
                        return Err(format!(
                            "path lease conflict with active run {other_id} ({eg} overlaps {ng})"
                        ));
                    }
                }
            }
        }
        let lease = PathLease {
            run_id: run_id.to_string(),
            repo_root: repo_str,
            globs: clean_globs,
            worktree_path: worktree_path.to_string_lossy().into_owned(),
            sandbox_tier: sandbox_tier.to_string(),
            lease_state: "leased".into(),
        };
        g.leases.insert(run_id.to_string(), lease.clone());
        Ok(lease)
    }

    pub fn update_lease_state(&self, run_id: &str, state: &str) {
        let mut g = self.inner.lock().unwrap();
        if let Some(l) = g.leases.get_mut(run_id) {
            l.lease_state = state.to_string();
        }
    }

    pub fn release_lease(&self, run_id: &str) {
        let mut g = self.inner.lock().unwrap();
        if let Some(l) = g.leases.get_mut(run_id) {
            l.lease_state = "released".into();
        }
    }

    pub fn enqueue_merge(
        &self,
        run_id: &str,
        repo_root: &Path,
        worktree_path: &Path,
        gate_cmd: &str,
    ) -> MergeQueueItem {
        let mut g = self.inner.lock().unwrap();
        if let Some(l) = g.leases.get_mut(run_id) {
            l.lease_state = "merge_queued".into();
        }
        let item = MergeQueueItem {
            run_id: run_id.to_string(),
            repo_root: repo_root.to_string_lossy().into_owned(),
            branch_or_worktree: worktree_path.to_string_lossy().into_owned(),
            gate_cmd: gate_cmd.to_string(),
            status: "queued".into(),
            attempt: 1,
        };
        g.merge_queue.push_back(item.clone());
        while g.merge_queue.len() > 60 {
            g.merge_queue.pop_front();
        }
        item
    }

    pub fn mark_merge_status(&self, run_id: &str, status: &str) {
        let mut g = self.inner.lock().unwrap();
        for item in &mut g.merge_queue {
            if item.run_id == run_id {
                item.status = status.to_string();
            }
        }
        if let Some(l) = g.leases.get_mut(run_id) {
            l.lease_state = if status == "merged" {
                "merged".into()
            } else if status == "conflict" {
                "conflict".into()
            } else {
                l.lease_state.clone()
            };
        }
    }

    pub fn summary(&self) -> SwarmSummary {
        let g = self.inner.lock().unwrap();
        SwarmSummary {
            max_concurrent: g.max_concurrent,
            active_workers: g.active_workers,
            queued_count: g.queued_count,
            active_leases: g
                .leases
                .values()
                .filter(|l| l.lease_state != "released")
                .cloned()
                .collect(),
            merge_queue: g.merge_queue.iter().cloned().collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_overlapping_globs_allow_concurrent_leases_and_overlapping_rejects() {
        let coord = SwarmCoordinator::new(6);
        let repo = Path::new("/tmp/repo");
        assert!(coord
            .acquire_path_lease("r1", repo, vec!["core/src/agents.rs".into()], Path::new("/tmp/wt-1"), "seatbelt")
            .is_ok());
        assert!(coord
            .acquire_path_lease("r2", repo, vec!["ui/macos-swift/**".into()], Path::new("/tmp/wt-2"), "seatbelt")
            .is_ok());
        assert!(coord
            .acquire_path_lease("r3", repo, vec!["core/src/**".into()], Path::new("/tmp/wt-3"), "seatbelt")
            .is_err());
    }
}
