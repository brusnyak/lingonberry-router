import React from 'react';
import { Layers, Shield, Cpu, Play } from 'lucide-react';
import type { RouterRuntimeState } from '../lib/routerClient';

interface SwarmSafetyPageProps {
  state: RouterRuntimeState;
  busy: boolean;
  onDispatchSwarm: (count: number) => Promise<void> | void;
  onSetPressure: (level: 'normal' | 'warn' | 'critical') => Promise<void> | void;
  onTriggerEscalation: (prompt: string) => Promise<void> | void;
  onKillWorker: (pid: number) => Promise<void> | void;
}

export const SwarmSafetyPage: React.FC<SwarmSafetyPageProps> = ({
  state,
  busy,
  onDispatchSwarm,
  onSetPressure,
  onTriggerEscalation,
  onKillWorker,
}) => {
  const snap = state.snapshot;
  const watchdog = snap.watchdog;
  const swarm = snap.swarm;
  const sandbox = snap.sandbox;
  const pressure = watchdog?.memory_pressure ?? 'normal';

  return (
    <div className="space-y-10 pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-6">
        <div className="space-y-1.5">
          <div className="text-xs font-mono text-indigo-600 dark:text-indigo-400 font-medium">
            Swarm Coordinator · Watchdog · Tiered Sandbox
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-950 dark:text-white tracking-tight [text-wrap:balance]">
            50-Agent Swarm &amp; System Protection
          </h1>
          <p className="text-[13.5px] text-zinc-600 dark:text-zinc-400 max-w-xl">
            Isolated git worktrees, non-overlapping file leases, serial merges, and RAM/Disk/RPM
            watchdogs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs shrink-0">
          {[12, 24, 50].map((count) => (
            <button
              key={count}
              type="button"
              disabled={busy}
              onClick={() => void onDispatchSwarm(count)}
              className={`px-3.5 py-2 rounded-lg border transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                count === 50
                  ? 'bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 border-transparent font-semibold'
                  : 'bg-white dark:bg-[#111114] text-zinc-800 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
            >
              <Play className="w-3 h-3" />
              <span>{count}-Task Swarm</span>
            </button>
          ))}
        </div>
      </div>

      {/* Watchdog KPI Row & Fault Injection */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">
              Host RAM, Disk &amp; Burst Watchdog
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
            <span className="text-zinc-500 dark:text-zinc-400 mr-1">Pressure:</span>
            {(
              [
                { id: 'normal', label: 'Normal (54%)' },
                { id: 'warn', label: 'Warn (82%)' },
                { id: 'critical', label: 'Critical Pause (92%)' },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                disabled={busy}
                onClick={() => void onSetPressure(btn.id)}
                className={`px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  pressure === btn.id
                    ? btn.id === 'critical'
                      ? 'bg-red-600 text-white border-red-600'
                      : btn.id === 'warn'
                        ? 'bg-amber-500 text-zinc-950 border-amber-500 font-semibold'
                        : 'bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 border-transparent font-semibold'
                    : 'bg-zinc-50 dark:bg-[#09090B] text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {watchdog?.paused_reason && (
          <div className="px-6 py-3 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900/50 text-xs font-mono text-red-700 dark:text-red-300">
            Spawn Gate Paused: {watchdog.paused_reason}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 dark:divide-zinc-800 font-mono tabular-nums">
          <div className="p-5">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Semaphore Cap</div>
            <div className="text-xl font-semibold text-zinc-950 dark:text-white mt-1">
              {swarm?.active_workers ?? 0} / {watchdog?.max_concurrent_workers ?? 8}
            </div>
            <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              {swarm?.queued_count ?? 0} queued
            </div>
          </div>

          <div className="p-5">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Memory Pressure</div>
            <div
              className={`text-xl font-semibold mt-1 ${
                pressure === 'critical'
                  ? 'text-red-600 dark:text-red-400'
                  : pressure === 'warn'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {watchdog ? `${watchdog.ram_used_pct.toFixed(1)}%` : '54.2%'}
            </div>
            <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              {pressure} · 1536MB cap
            </div>
          </div>

          <div className="p-5">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">APFS Free Disk</div>
            <div className="text-xl font-semibold text-zinc-950 dark:text-white mt-1">
              {watchdog ? `${watchdog.free_disk_gb.toFixed(1)} GB` : '325.6 GB'}
            </div>
            <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              Pauses &lt; 5 GB
            </div>
          </div>

          <div className="p-5">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">5h Sub Burst</div>
            <div className="text-xl font-semibold text-zinc-950 dark:text-white mt-1">
              {watchdog
                ? `${watchdog.subscription_burst_used} / ${watchdog.subscription_burst_cap}`
                : '2 / 45'}
            </div>
            <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              Claude · Codex guard
            </div>
          </div>

          <div className="p-5">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Sandbox Engines</div>
            <div className="text-xl font-semibold text-zinc-950 dark:text-white mt-1">
              {sandbox?.seatbelt_available && sandbox?.docker_available ? '2 Active' : '1 Active'}
            </div>
            <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              Seatbelt · {sandbox?.docker_runtime ?? 'Docker'}
            </div>
          </div>
        </div>
      </section>

      {/* Live Running Workers + Escalation Demo */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">
                File-Path Leases ({swarm?.active_leases.length ?? 0})
              </h2>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onTriggerEscalation(
                  'Fix subtle race condition in core/src/agents.rs and verify cargo test'
                )
              }
              className="px-3 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
            >
              Test Escalation → Claude
            </button>
          </div>

          {(swarm?.active_leases ?? []).length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <div className="text-sm font-medium text-zinc-950 dark:text-white">
                No worktree path leases allocated
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Launch a swarm wave above to inspect non-overlapping glob locks.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-[#18181B]/70 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 text-[10.5px]">
                    <th className="py-3 px-4 font-medium">Run ID</th>
                    <th className="py-3 px-4 font-medium">Path Globs</th>
                    <th className="py-3 px-4 font-medium">Worktree</th>
                    <th className="py-3 px-4 font-medium">Sandbox</th>
                    <th className="py-3 px-4 font-medium text-right">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 tabular-nums">
                  {(swarm?.active_leases ?? []).slice(0, 10).map((lease) => (
                    <tr key={lease.run_id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                      <td className="py-3 px-4 text-zinc-950 dark:text-white font-medium">
                        {lease.run_id}
                      </td>
                      <td className="py-3 px-4 text-indigo-600 dark:text-indigo-400">
                        {lease.globs.join(', ')}
                      </td>
                      <td className="py-3 px-4 text-zinc-500 dark:text-zinc-400">
                        {lease.worktree_path}
                      </td>
                      <td className="py-3 px-4 text-zinc-600 dark:text-zinc-300">
                        {lease.sandbox_tier}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-medium ${
                          lease.lease_state === 'active'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-zinc-400 dark:text-zinc-500'
                        }`}
                      >
                        {lease.lease_state}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Serial Merge Queue + Active PID Kill */}
        <section className="lg:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">
              Merge Queue &amp; Live PIDs
            </h2>
            <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 tabular-nums">
              {snap.workers_live.length} live · {swarm?.merge_queue.length ?? 0} merges
            </span>
          </div>

          <div className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs font-mono">
            {snap.workers_live.slice(0, 4).map((w) => (
              <div key={w.pid} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-zinc-950 dark:text-white truncate">
                    PID {w.pid} · {w.worker}
                  </div>
                  <div className="text-[10.5px] text-zinc-500 dark:text-zinc-400 truncate">
                    {w.task}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onKillWorker(w.pid)}
                  className="px-2.5 py-1 rounded border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0"
                >
                  SIGTERM
                </button>
              </div>
            ))}

            {(swarm?.merge_queue ?? []).slice(0, 6).map((item) => (
              <div key={item.run_id} className="px-5 py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-zinc-950 dark:text-zinc-200 truncate">{item.run_id}</div>
                  <div className="text-[10.5px] text-zinc-500 dark:text-zinc-400 truncate">
                    {item.branch_or_worktree} · {item.gate_cmd}
                  </div>
                </div>
                <span
                  className={`shrink-0 font-medium ${
                    item.status === 'merged'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : item.status === 'verifying'
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {item.status}
                </span>
              </div>
            ))}

            {snap.workers_live.length === 0 && (swarm?.merge_queue ?? []).length === 0 && (
              <div className="p-8 text-center text-zinc-500 dark:text-zinc-400">
                Serial merge queue idle. Verified worktrees rebase and test sequentially.
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Tiered Isolation Policy Breakdown */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-200 dark:divide-zinc-800">
        <div className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-white">
            <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Tier 1 · Local macOS Seatbelt (SBPL)</span>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Confines writes to the leased worktree while denying reads on ~/.ssh, Keychains, .env,
            and api.token.
          </p>
          <pre className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 font-mono text-[10.5px] text-zinc-700 dark:text-zinc-300 overflow-x-auto">
{`(version 1)
(allow default)
(deny file-read* (subpath "~/.ssh") (subpath "~/.aws") (literal "~/.lingonberry/api.token"))
(deny file-write* (require-not (subpath "/tmp/lb-wt/<run_id>")))`}
          </pre>
        </div>

        <div className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-white">
            <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Tier 2 · Ephemeral Docker (Overnight Specs)</span>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Drops Linux capabilities, mounts root read-only, caps memory/CPU, and keeps raw API
            keys on the host proxy.
          </p>
          <pre className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 font-mono text-[10.5px] text-zinc-700 dark:text-zinc-300 overflow-x-auto">
{`docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges \\
  --memory=2g --cpus=2 -e NODE_OPTIONS="--max-old-space-size=1536" \\
  -v /tmp/lb-wt/<run_id>:/workspace:rw lingonberry-worker:latest`}
          </pre>
        </div>
      </section>
    </div>
  );
};
