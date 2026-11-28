import React, { useState } from 'react';
import {
  FileCheck2,
  Lock,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { RouterRuntimeState } from '../lib/routerClient';

interface SpecsGatewayCronPageProps {
  state: RouterRuntimeState;
  busy: boolean;
  onShowToast: (msg: string) => void;
  onCreateSpec: (params: {
    title: string;
    goal: string;
    allowed_path_globs: string[];
    gate_cmd: string;
    sandbox_tier: 'seatbelt' | 'docker';
    max_budget_usd: number;
  }) => Promise<void> | void;
  onApproveSpec: (specId: string) => Promise<void> | void;
  onRunSpec: (specId: string) => Promise<void> | void;
  onToggleChannel: (id: string) => Promise<void> | void;
  onAppendMemory: (note: string) => Promise<void> | void;
  onRescanCron: () => Promise<void> | void;
  onKillCronPid: (pid: number) => Promise<void> | void;
  onToggleJob: (name: string) => Promise<void> | void;
  onToggleWatchdog: (name: string) => Promise<void> | void;
  onRunJob: (name: string) => Promise<void> | void;
  onHealJob: (name: string) => Promise<void> | void;
  onSimulateCrash: (name: string) => Promise<void> | void;
  onCreateJob: (params: {
    name: string;
    every_s: number;
    schedule: string;
    command: string;
    prompt: string;
    auto_restart: boolean;
  }) => Promise<void> | void;
}

export const SpecsGatewayCronPage: React.FC<SpecsGatewayCronPageProps> = ({
  state,
  busy,
  onShowToast,
  onCreateSpec,
  onApproveSpec,
  onRunSpec,
  onToggleChannel,
  onAppendMemory,
  onRescanCron,
  onKillCronPid,
  onToggleJob,
  onToggleWatchdog,
  onRunJob,
  onHealJob,
  onSimulateCrash,
  onCreateJob,
}) => {
  const snap = state.snapshot;
  const [subTab, setSubTab] = useState<'specs' | 'gateway' | 'cron'>('specs');

  const [specTitle, setSpecTitle] = useState('');
  const [specGoal, setSpecGoal] = useState('');
  const [specGlobs, setSpecGlobs] = useState('core/src/**, tests/**');
  const [specGate, setSpecGate] = useState('cargo test');
  const [specTier, setSpecTier] = useState<'seatbelt' | 'docker'>('docker');
  const [specBudget, setSpecBudget] = useState('1.50');
  const [specError, setSpecError] = useState<string | null>(null);
  const [expandedSpec, setExpandedSpec] = useState<string | null>(
    snap.specs?.[0]?.spec_id ?? null
  );

  const [memoryInput, setMemoryInput] = useState('');

  const [expandedJobLogs, setExpandedJobLogs] = useState<string | null>(null);
  const [jobName, setJobName] = useState('');
  const [jobSchedule, setJobSchedule] = useState('*/15 * * * *');
  const [jobEveryS, setJobEveryS] = useState('900');
  const [jobCommand, setJobCommand] = useState('');
  const [jobAutoRestart, setJobAutoRestart] = useState(true);

  const specs = snap.specs ?? [];
  const gateway = snap.gateway;
  const channels = gateway?.channels ?? [];
  const hostDiscoveredJobs = snap.jobs.filter((j) => j.read_only || j.scope === 'discovered');
  const managedJobs = snap.jobs.filter((j) => !j.read_only && j.scope !== 'discovered');

  const handleTryRunSpec = async (specId: string) => {
    setSpecError(null);
    try {
      await onRunSpec(specId);
      onShowToast(`Dispatched Kiro spec ${specId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Spec execution blocked';
      setSpecError(msg);
      onShowToast(msg);
    }
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Header & Sub-Navigation */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-6">
        <div className="space-y-1.5">
          <div className="text-xs font-mono text-indigo-600 dark:text-indigo-400 font-medium">
            Kiro Anti-Drift · Zero-Hosting Channels · Read-Only Host Cron
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-950 dark:text-white tracking-tight">
            Specs, Channels &amp; Cron Oversight
          </h1>
          <p className="text-[13.5px] text-zinc-600 dark:text-zinc-400 max-w-xl">
            Owner-signed SHA-256 specs for overnight runs, outbound messaging adapters, and read-only
            launchd monitoring.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800 shrink-0">
          {(
            [
              { id: 'specs', label: `Kiro Specs (${specs.length})` },
              {
                id: 'gateway',
                label: `Channels (${channels.filter((c) => c.enabled).length}/${channels.length})`,
              },
              { id: 'cron', label: `Cron (${snap.jobs.length})` },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubTab(item.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors whitespace-nowrap shrink-0 ${
                subTab === item.id
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white font-semibold shadow-2xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* SUB-TAB 1: KIRO ANTI-DRIFT SPECS */}
      {subTab === 'specs' && (
        <div className="space-y-6">
          {specError && (
            <div className="p-4 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs font-mono text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
              <span>{specError}</span>
              <button
                type="button"
                onClick={() => setSpecError(null)}
                className="underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Author New Kiro Spec */}
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-white">
              <FileCheck2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Author Kiro Spec Manifest</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 text-xs">
              <input
                type="text"
                placeholder="Spec title (e.g. Harden Webhook HMAC)"
                value={specTitle}
                onChange={(e) => setSpecTitle(e.target.value)}
                className="sm:col-span-4 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] text-zinc-950 dark:text-white"
              />
              <input
                type="text"
                placeholder="Objective / acceptance goal"
                value={specGoal}
                onChange={(e) => setSpecGoal(e.target.value)}
                className="sm:col-span-5 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] text-zinc-950 dark:text-white"
              />
              <select
                value={specTier}
                onChange={(e) => setSpecTier(e.target.value as 'seatbelt' | 'docker')}
                className="sm:col-span-3 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] font-mono text-zinc-950 dark:text-white"
              >
                <option value="docker">Docker (Overnight)</option>
                <option value="seatbelt">Seatbelt (Local)</option>
              </select>

              <input
                type="text"
                placeholder="Allowed path globs (comma separated)"
                value={specGlobs}
                onChange={(e) => setSpecGlobs(e.target.value)}
                className="sm:col-span-5 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] font-mono text-zinc-950 dark:text-white"
              />
              <input
                type="text"
                placeholder="Gate command (e.g. cargo test)"
                value={specGate}
                onChange={(e) => setSpecGate(e.target.value)}
                className="sm:col-span-3 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] font-mono text-zinc-950 dark:text-white"
              />
              <input
                type="number"
                step="0.25"
                min="0"
                placeholder="Max USD"
                value={specBudget}
                onChange={(e) => setSpecBudget(e.target.value)}
                className="sm:col-span-2 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] font-mono tabular-nums text-zinc-950 dark:text-white"
              />
              <button
                type="button"
                disabled={busy || !specTitle.trim() || !specGoal.trim()}
                onClick={() => {
                  const title = specTitle.trim();
                  const goal = specGoal.trim();
                  const globs = specGlobs
                    .split(',')
                    .map((g) => g.trim())
                    .filter(Boolean);
                  void onCreateSpec({
                    title,
                    goal,
                    allowed_path_globs: globs.length > 0 ? globs : ['core/src/**'],
                    gate_cmd: specGate.trim() || 'cargo test',
                    sandbox_tier: specTier,
                    max_budget_usd: Number(specBudget) || 1.0,
                  });
                  setSpecTitle('');
                  setSpecGoal('');
                  onShowToast(`Created draft spec: ${title}`);
                }}
                className="sm:col-span-2 h-9 rounded-lg bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 font-semibold disabled:opacity-45"
              >
                Create Draft
              </button>
            </div>
          </section>

          {/* Spec Queue */}
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] divide-y divide-zinc-200 dark:divide-zinc-800">
            {specs.map((spec) => {
              const isOpen = expandedSpec === spec.spec_id;
              const isApproved = spec.status === 'approved' || spec.status === 'completed';
              return (
                <div key={spec.spec_id} className="p-6 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-xs font-mono">
                        <span
                          className={
                            isApproved
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              : 'text-amber-600 dark:text-amber-400 font-semibold'
                          }
                        >
                          {spec.status}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-zinc-500 dark:text-zinc-400">{spec.sandbox_tier}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-zinc-500 dark:text-zinc-400 tabular-nums">
                          budget ${spec.max_budget_usd.toFixed(2)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-zinc-400 dark:text-zinc-500">
                          sha256:{spec.sha256_digest.slice(0, 12)}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-zinc-950 dark:text-white">
                        {spec.title}
                      </h3>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">{spec.goal}</p>
                      <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                        globs: {spec.allowed_path_globs.join(', ')} · gate: {spec.gate_cmd}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs shrink-0">
                      <button
                        type="button"
                        onClick={() => setExpandedSpec(isOpen ? null : spec.spec_id)}
                        className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
                      >
                        {isOpen ? 'Hide Files' : 'Inspect Files'}
                      </button>

                      {spec.status === 'draft' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onApproveSpec(spec.spec_id)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 text-white font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        >
                          <Lock className="w-3 h-3" />
                          <span>Sign &amp; Approve</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleTryRunSpec(spec.spec_id)}
                        className={`px-3 py-1.5 rounded-lg border font-medium whitespace-nowrap shrink-0 ${
                          isApproved
                            ? 'bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 border-transparent'
                            : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {isApproved ? 'Execute Spec' : 'Test Unapproved'}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 text-[11px] font-mono">
                      <div className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800">
                        <div className="text-zinc-400 mb-1">requirements.md</div>
                        <pre className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                          {spec.requirements_md}
                        </pre>
                      </div>
                      <div className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800">
                        <div className="text-zinc-400 mb-1">design.md</div>
                        <pre className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                          {spec.design_md}
                        </pre>
                      </div>
                      <div className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800">
                        <div className="text-zinc-400 mb-1">tasks.md (waves)</div>
                        <ul className="space-y-1 text-zinc-700 dark:text-zinc-300">
                          {spec.tasks_dag.map((t) => (
                            <li key={t.task_id}>
                              W{t.wave}: {t.title} ({t.status})
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      )}

      {/* SUB-TAB 2: ZERO-HOSTING CHANNEL GATEWAY & SHARED MEMORY */}
      {subTab === 'gateway' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">
                  Outbound Channel Adapters (Zero Public Ports)
                </h2>
              </div>
              <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                No hosting required
              </span>
            </div>

            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {channels.map((ch) => (
                <div key={ch.id} className="p-5 flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-white">
                      <span>{ch.label}</span>
                      <span className="text-[11px] font-mono font-normal text-zinc-400 dark:text-zinc-500">
                        {ch.session_key_prefix}*
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                      {ch.transport}
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{ch.description}</p>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onToggleChannel(ch.id)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-mono shrink-0 transition-colors ${
                      ch.enabled
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {ch.enabled ? 'Connected' : 'Connect'}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="lg:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">
                Shared Cross-Session Memory
              </h2>
              <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">
                {gateway?.memory_path ?? '~/.lingonberry/memory/MEMORY.md'}
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Append shared steering rule…"
                value={memoryInput}
                onChange={(e) => setMemoryInput(e.target.value)}
                className="flex-1 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] text-xs text-zinc-950 dark:text-white"
              />
              <button
                type="button"
                disabled={busy || !memoryInput.trim()}
                onClick={() => {
                  void onAppendMemory(memoryInput.trim());
                  setMemoryInput('');
                  onShowToast('Appended to MEMORY.md');
                }}
                className="px-3.5 h-9 rounded-lg bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 text-xs font-semibold disabled:opacity-45 shrink-0"
              >
                Save Note
              </button>
            </div>

            <div className="space-y-2 max-h-[280px] overflow-y-auto font-mono text-[11px]">
              {(gateway?.recent_notes ?? []).map((note, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300"
                >
                  {note}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* SUB-TAB 3: HOST CRON OVERSIGHT */}
      {subTab === 'cron' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
              Host launchd &amp; crontab jobs stay strictly read-only (never dispatched as LLM
              calls).
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRescanCron()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#111114] text-xs font-mono shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              <span>Rescan Crons</span>
            </button>
          </div>

          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] p-5 space-y-3">
            <div className="text-xs font-mono font-semibold text-zinc-700 dark:text-zinc-200">
              Live OS Cron Processes ({snap.cron_live.length})
            </div>
            {snap.cron_live.length === 0 ? (
              <div className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                No active cron child processes running.
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {snap.cron_live.map((proc) => (
                  <div
                    key={proc.pid}
                    className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-zinc-950 dark:text-white">
                        PID {proc.pid} · {proc.job_name}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-lg">
                        {proc.command}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 tabular-nums">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {proc.cpu_pct.toFixed(1)}% cpu · {proc.mem_mb.toFixed(1)} MB ·{' '}
                        {proc.elapsed_s}s
                      </span>
                      <button
                        type="button"
                        onClick={() => void onKillCronPid(proc.pid)}
                        className="px-2.5 py-1 rounded border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        Kill PID
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] p-5 space-y-2.5">
            <div className="text-xs font-mono font-semibold text-zinc-700 dark:text-zinc-200">
              Discovered Host Jobs — Read-Only Monitor ({hostDiscoveredJobs.length})
            </div>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs font-mono">
              {hostDiscoveredJobs.map((job) => (
                <div key={job.name} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-zinc-950 dark:text-white">
                      {job.name} · {job.source}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {job.schedule} · {job.command}
                    </div>
                  </div>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0">
                    read-only
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] p-5 space-y-3">
            <div className="text-xs font-mono font-semibold text-zinc-700 dark:text-zinc-200">
              Managed Router Schedules ({managedJobs.length})
            </div>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {managedJobs.map((job) => {
                const logsOpen = expandedJobLogs === job.name;
                const isCrashed = job.health === 'crashed';
                return (
                  <div key={job.name} className="py-3 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0 space-y-0.5 font-mono">
                        <div className="text-xs font-semibold text-zinc-950 dark:text-white">
                          {job.name} ·{' '}
                          <span
                            className={
                              isCrashed
                                ? 'text-red-600 dark:text-red-400'
                                : job.paused
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-emerald-600 dark:text-emerald-400'
                            }
                          >
                            {job.health}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                          {job.schedule} · crashes: {job.crash_count} · restarts:{' '}
                          {job.restart_count}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] shrink-0">
                        <button
                          type="button"
                          onClick={() => void onToggleWatchdog(job.name)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded border ${
                            job.auto_restart
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          <ShieldCheck className="w-3 h-3" />
                          KeepAlive {job.auto_restart ? 'ON' : 'OFF'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onToggleJob(job.name)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
                        >
                          {job.paused ? (
                            <Play className="w-2.5 h-2.5" />
                          ) : (
                            <Pause className="w-2.5 h-2.5" />
                          )}
                          {job.paused ? 'Resume' : 'Pause'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onRunJob(job.name)}
                          className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
                        >
                          Run
                        </button>
                        <button
                          type="button"
                          onClick={() => void onSimulateCrash(job.name)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-red-600"
                        >
                          <XCircle className="w-2.5 h-2.5" />
                          Test Crash
                        </button>
                        {isCrashed && (
                          <button
                            type="button"
                            onClick={() => void onHealJob(job.name)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white font-semibold"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                            Heal
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpandedJobLogs(logsOpen ? null : job.name)}
                          className="px-2 py-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
                        >
                          {logsOpen ? 'Hide' : 'Logs'}
                        </button>
                      </div>
                    </div>

                    {logsOpen && (
                      <div className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-[10.5px] font-mono text-zinc-600 dark:text-zinc-400 space-y-0.5">
                        {job.log_tail.map((line, i) => (
                          <div key={i}>&gt; {line}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
              <input
                type="text"
                placeholder="job-name"
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                className="sm:col-span-3 h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] font-mono"
              />
              <input
                type="text"
                placeholder="*/15 * * * *"
                value={jobSchedule}
                onChange={(e) => setJobSchedule(e.target.value)}
                className="sm:col-span-2 h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] font-mono"
              />
              <input
                type="number"
                min={30}
                value={jobEveryS}
                onChange={(e) => setJobEveryS(e.target.value)}
                className="sm:col-span-2 h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] font-mono tabular-nums"
              />
              <input
                type="text"
                placeholder="Command or verified prompt"
                value={jobCommand}
                onChange={(e) => setJobCommand(e.target.value)}
                className="sm:col-span-3 h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B]"
              />
              <button
                type="button"
                disabled={busy || !jobName.trim()}
                onClick={() => {
                  const cleanName = jobName.trim();
                  const cmd = jobCommand.trim() || `lingonberry-core run "${cleanName}"`;
                  void onCreateJob({
                    name: cleanName,
                    every_s: Math.max(30, Number(jobEveryS) || 300),
                    schedule: jobSchedule.trim() || 'every 300s',
                    command: cmd,
                    prompt: cmd,
                    auto_restart: jobAutoRestart,
                  });
                  setJobName('');
                  setJobCommand('');
                  onShowToast(`Scheduled ${cleanName}`);
                }}
                className="sm:col-span-2 h-9 rounded-lg bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 font-semibold disabled:opacity-45"
              >
                Schedule
              </button>
            </div>
            <label className="inline-flex items-center gap-2 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={jobAutoRestart}
                onChange={(e) => setJobAutoRestart(e.target.checked)}
              />
              Enable KeepAlive auto-restart on non-zero exit
            </label>
          </section>
        </div>
      )}
    </div>
  );
};
