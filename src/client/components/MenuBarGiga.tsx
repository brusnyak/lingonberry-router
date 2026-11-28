import React, { useMemo, useState } from 'react';
import type { RouterRuntimeState } from '../lib/routerClient';
import type { KiroSpecManifest, SessionRow, WorkerStatus } from '../../types';
import idleMockupImg from '../../assets/images/menubar_idle_preview_1795822249074.jpg';
import activeMockupImg from '../../assets/images/menubar_active_preview_1795822249329.jpg';

export type MenuBarViewMode = 'interactive' | 'mockup-idle' | 'mockup-active';

interface MenuBarGigaProps {
  state: RouterRuntimeState;
  busy: boolean;
  initialViewMode?: MenuBarViewMode;
  onRefresh: () => Promise<void> | void;
  onKillWorker: (pid: number) => Promise<void> | void;
  onAdjustProviderRpm: (provider: string, nextRpm: number) => Promise<void> | void;
  onToggleJob?: (name: string) => Promise<void> | void;
  onRunJob?: (name: string) => Promise<void> | void;
  onHealJob?: (name: string) => Promise<void> | void;
  onRoute?: (p: { prompt: string; caller: string; worktree: boolean }) => Promise<void> | void;
  onRun?: (p: {
    prompt: string;
    caller: string;
    worktree: boolean;
    simulate_fault: 'none' | '429' | 'truncated' | 'gate-escalate';
    live_api: boolean;
  }) => Promise<void> | void;
  onFanout?: (p: { prompt: string; caller: string; worktree: boolean }) => Promise<void> | void;
  onSetIdle?: () => Promise<void> | void;
  onApproveSpec?: (specId: string) => Promise<void> | void;
  onRunSpec?: (specId: string) => Promise<void> | void;
  onToggleChannel?: (id: string) => Promise<void> | void;
  onResetKey?: (name: string) => Promise<void> | void;
  onOpenCronTab?: () => void;
  onOpenAgentsTab?: () => void;
}

const isRunning = (s: SessionRow) => s.state === 'running' || s.state === 'leased';
const isBlocked = (s: SessionRow) => ['blocked', 'escalated', 'failed'].includes(s.state);

function clock(ts: number): string {
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime())
    ? '--:--'
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function ago(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function dur(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)}s`;
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

export const MenuBarGiga: React.FC<MenuBarGigaProps> = ({
  state,
  busy,
  initialViewMode = 'interactive',
  onRefresh,
  onKillWorker,
  onAdjustProviderRpm,
  onRun,
  onFanout,
  onSetIdle,
  onApproveSpec,
  onRunSpec,
  onToggleChannel,
}) => {
  const snap = state.snapshot;
  const [viewMode, setViewMode] = useState<MenuBarViewMode>(initialViewMode);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<'keys' | 'channels' | 'specs'>('keys');
  const [filter, setFilter] = useState<'all' | 'active' | 'blocked' | 'done'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [idleImgFailed, setIdleImgFailed] = useState(false);
  const [activeImgFailed, setActiveImgFailed] = useState(false);
  const [menubarSvgFailed, setMenubarSvgFailed] = useState(false);

  const running = useMemo(() => snap.sessions.filter(isRunning), [snap.sessions]);
  const blocked = useMemo(() => snap.sessions.filter(isBlocked), [snap.sessions]);
  const done = useMemo(() => snap.sessions.filter((s) => s.state === 'done'), [snap.sessions]);
  const finished = snap.overview.completed_24h + snap.overview.failed_24h;
  const successPct = finished === 0 ? null : (snap.overview.completed_24h / finished) * 100;
  const hasActive = running.length > 0 || snap.workers_live.length > 0;

  const visibleSessions = useMemo(() => {
    const list =
      filter === 'active'
        ? running
        : filter === 'blocked'
          ? blocked
          : filter === 'done'
            ? done
            : snap.sessions;
    return list.slice(0, 5);
  }, [filter, snap.sessions, running, blocked, done]);

  const activeCallers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of running) {
      const c = s.caller ?? 'shell';
      seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    return Array.from(seen.entries());
  }, [running]);

  const providers = useMemo(() => {
    const map = new Map<string, WorkerStatus[]>();
    for (const w of snap.workers) {
      const p = (w.provider || 'local').toLowerCase();
      map.set(p, [...(map.get(p) ?? []), w]);
    }
    return Array.from(map.entries()).map(([provider, workers]) => ({
      provider,
      workers,
      rpm: workers[0]?.rpm_limit ?? 0,
      calls: workers.reduce((n, w) => n + w.calls_24h, 0),
      inflight: workers.reduce((n, w) => n + (w.inflight ?? 0), 0),
    }));
  }, [snap.workers]);

  const watchdog = snap.watchdog;
  const sandbox = snap.sandbox;
  const swarm = snap.swarm;
  const gateway = snap.gateway;
  const specs: KiroSpecManifest[] = snap.specs ?? [];

  return (
    <section className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] text-zinc-950 dark:text-zinc-100 overflow-hidden">
      <style>{`
        @keyframes lb-flow { to { stroke-dashoffset: -20; } }
        .lb-flow { stroke-dasharray: 5 5; animation: lb-flow 1.1s linear infinite; }
      `}</style>

      {/* Simulator Toolbar */}
      <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#18181B]/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800">
          {(
            [
              { id: 'interactive', label: 'Interactive Popover' },
              { id: 'mockup-idle', label: 'Mockup: Idle' },
              { id: 'mockup-active', label: 'Mockup: Active' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setViewMode(item.id)}
              className={`px-3 py-1 rounded-md text-[11px] font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                viewMode === item.id
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-2xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {viewMode === 'interactive' && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            {onSetIdle && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSetIdle()}
                className="px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                Idle State
              </button>
            )}
            {onFanout && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void onFanout({
                    prompt: 'Verify Seatbelt SBPL worktree boundaries and API token guard',
                    caller: 'tg:owner',
                    worktree: true,
                  })
                }
                className="px-3 py-1.5 rounded-md bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 font-semibold whitespace-nowrap shrink-0 transition-colors"
              >
                Active Swarm
              </button>
            )}
            {onRun && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void onRun({
                    prompt: 'Refactor auth token rotation & run cargo test',
                    caller: 'mcp:claude',
                    worktree: true,
                    simulate_fault: 'gate-escalate',
                    live_api: false,
                  })
                }
                className="px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                Test Escalation
              </button>
            )}
          </div>
        )}
      </div>

      {/* Mode 2 & 3: Generated Native macOS Mockups */}
      {viewMode === 'mockup-idle' && (
        <div className="p-6 sm:p-8 bg-zinc-50 dark:bg-[#09090B] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-zinc-500 dark:text-zinc-400">
            <span>macOS SwiftUI MenuBarExtra · Idle</span>
            <span>Collapsed graph · Hidden worker cards</span>
          </div>
          {!idleImgFailed ? (
            <img
              src={idleMockupImg}
              alt="macOS SwiftUI Lingonberry Menu Bar Idle State Preview"
              referrerPolicy="no-referrer"
              onError={() => setIdleImgFailed(true)}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 object-cover max-h-[520px]"
            />
          ) : (
            <div className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-900 p-8 text-center font-mono text-xs text-zinc-300">
              macOS Idle Popover — Router idle · Watchdog Normal
            </div>
          )}
        </div>
      )}

      {viewMode === 'mockup-active' && (
        <div className="p-6 sm:p-8 bg-zinc-50 dark:bg-[#09090B] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-zinc-500 dark:text-zinc-400">
            <span>macOS SwiftUI MenuBarExtra · Active Swarm</span>
            <span>Caller → Router → Worker curves · Kill PID</span>
          </div>
          {!activeImgFailed ? (
            <img
              src={activeMockupImg}
              alt="macOS SwiftUI Lingonberry Menu Bar Active Swarm State Preview"
              referrerPolicy="no-referrer"
              onError={() => setActiveImgFailed(true)}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 object-cover max-h-[520px]"
            />
          ) : (
            <div className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-900 p-8 text-center font-mono text-xs text-zinc-300">
              macOS Active Swarm — Live orchestration curves + PID controls
            </div>
          )}
        </div>
      )}

      {/* Mode 1: Interactive SwiftUI-Faithful Popover Simulator */}
      {viewMode === 'interactive' && (
        <div className="p-6 sm:p-10 bg-zinc-50 dark:bg-[#09090B] flex flex-col items-center gap-3">
          {/* Realistic macOS Top Menu Bar Strip showing monochrome template Lingonberry icon */}
          <div className="w-full max-w-[540px] px-4 h-7 rounded-lg bg-zinc-200/80 dark:bg-[#18181B] border border-zinc-300/70 dark:border-zinc-800 flex items-center justify-end gap-4 text-[11px] font-mono text-zinc-700 dark:text-zinc-200">
            <span className="mr-auto text-[10.5px] text-zinc-500 dark:text-zinc-400">
              macOS Menu Bar Preview
            </span>
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded bg-white/80 dark:bg-zinc-800 shadow-2xs">
              {!menubarSvgFailed ? (
                <img
                  src="/assets/lingonberry-menubar.svg"
                  alt="Lingonberry template menu bar icon"
                  referrerPolicy="no-referrer"
                  onError={() => setMenubarSvgFailed(true)}
                  className="w-4 h-4 dark:invert"
                />
              ) : (
                <span className="text-[10px] font-semibold">LB</span>
              )}
            </span>
            <span className="tabular-nums text-zinc-600 dark:text-zinc-300">Tue 09:41</span>
          </div>

          <div className="w-full max-w-[540px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] shadow-2xl overflow-hidden">
            {/* Popover Header */}
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-[13px] font-semibold tracking-tight text-zinc-950 dark:text-white whitespace-nowrap shrink-0">
                  Lingonberry
                </span>
                <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0">
                  127.0.0.1:8799
                </span>
              </div>

              <div className="flex items-center gap-2.5 text-[11px] font-mono shrink-0">
                <span
                  className={
                    hasActive
                      ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                      : 'text-zinc-400 dark:text-zinc-500'
                  }
                >
                  {hasActive ? `${running.length} running` : 'idle'}
                </span>
                <button
                  type="button"
                  onClick={() => setSetupOpen((v) => !v)}
                  className={`px-2.5 py-1 rounded-md border text-[11px] transition-colors whitespace-nowrap shrink-0 ${
                    setupOpen
                      ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {setupOpen ? 'Done' : 'Setup'}
                </button>
                <button
                  type="button"
                  onClick={() => void onRefresh()}
                  disabled={busy}
                  className="px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
                >
                  {busy ? 'Sync…' : 'Sync'}
                </button>
              </div>
            </div>

            {/* Stat Strip */}
            <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#18181B]/45 grid grid-cols-5 gap-3 font-mono tabular-nums text-[10.5px]">
              <div>
                <div className="text-zinc-400 dark:text-zinc-500">Workers</div>
                <div className="font-semibold text-zinc-950 dark:text-white mt-0.5">
                  {running.length}/{watchdog?.max_concurrent_workers ?? 8}
                </div>
              </div>
              <div>
                <div className="text-zinc-400 dark:text-zinc-500">RAM · Disk</div>
                <div
                  className={`font-semibold mt-0.5 ${
                    watchdog?.memory_pressure === 'critical'
                      ? 'text-red-600 dark:text-red-400'
                      : watchdog?.memory_pressure === 'warn'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-zinc-950 dark:text-white'
                  }`}
                >
                  {watchdog
                    ? `${watchdog.ram_used_pct.toFixed(0)}% · ${watchdog.free_disk_gb.toFixed(0)}G`
                    : '54% · 325G'}
                </div>
              </div>
              <div>
                <div className="text-zinc-400 dark:text-zinc-500">Sandbox</div>
                <div className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 truncate">
                  {sandbox?.default_local_tier ?? 'seatbelt'}
                </div>
              </div>
              <div>
                <div className="text-zinc-400 dark:text-zinc-500">5h Burst</div>
                <div className="font-semibold text-zinc-950 dark:text-white mt-0.5">
                  {watchdog
                    ? `${watchdog.subscription_burst_used}/${watchdog.subscription_burst_cap}`
                    : '2/45'}
                </div>
              </div>
              <div>
                <div className="text-zinc-400 dark:text-zinc-500">Success</div>
                <div className="font-semibold text-zinc-950 dark:text-white mt-0.5">
                  {successPct == null ? '—' : `${successPct.toFixed(0)}%`}
                </div>
              </div>
            </div>

            {watchdog?.paused_reason && (
              <div className="px-5 py-2.5 border-b border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-[11px] font-mono text-red-700 dark:text-red-300">
                Watchdog Alert: {watchdog.paused_reason}
              </div>
            )}

            {/* Collapsible Setup Drawer */}
            {setupOpen && (
              <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-[#09090B]/60 space-y-3.5">
                <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                  {(
                    [
                      { id: 'keys', label: 'Keys & RPM' },
                      { id: 'channels', label: 'Channels & pi' },
                      { id: 'specs', label: `Kiro Specs (${specs.length})` },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSetupTab(t.id)}
                      className={`flex-1 py-1 rounded-md text-[11px] font-mono transition-colors whitespace-nowrap shrink-0 ${
                        setupTab === t.id
                          ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white font-semibold'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {setupTab === 'keys' && (
                  <div className="space-y-2 font-mono text-[11px]">
                    {providers.map((p) => (
                      <div
                        key={p.provider}
                        className="flex items-center justify-between py-1.5 border-b border-zinc-200/70 dark:border-zinc-800/70 last:border-0"
                      >
                        <div>
                          <span className="font-semibold text-zinc-950 dark:text-white">
                            {p.provider}
                          </span>
                          <span className="text-zinc-500 dark:text-zinc-400 ml-2">
                            {p.workers.length} slot{p.workers.length === 1 ? '' : 's'} · {p.calls}{' '}
                            calls
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 tabular-nums">
                          <button
                            type="button"
                            onClick={() =>
                              void onAdjustProviderRpm(p.provider, Math.max(5, p.rpm - 5))
                            }
                            className="w-6 h-6 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            −
                          </button>
                          <span className="w-14 text-center">{p.rpm}/min</span>
                          <button
                            type="button"
                            onClick={() =>
                              void onAdjustProviderRpm(p.provider, Math.min(300, p.rpm + 5))
                            }
                            className="w-6 h-6 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {setupTab === 'channels' && (
                  <div className="space-y-2 font-mono text-[11px]">
                    <div className="text-zinc-500 dark:text-zinc-400">
                      pi-rust ready · {gateway?.entries_count ?? 0} MEMORY.md entries
                    </div>
                    {(gateway?.channels ?? []).map((ch) => (
                      <div
                        key={ch.id}
                        className="flex items-center justify-between py-1.5 border-b border-zinc-200/70 dark:border-zinc-800/70 last:border-0"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-semibold text-zinc-950 dark:text-white">
                            {ch.label}
                          </div>
                          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                            {ch.transport}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onToggleChannel && void onToggleChannel(ch.id)}
                          className={`px-2.5 py-1 rounded border text-[10px] whitespace-nowrap shrink-0 ${
                            ch.enabled
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          {ch.enabled ? 'Connected' : 'Enable'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {setupTab === 'specs' && (
                  <div className="space-y-2 font-mono text-[11px]">
                    {specs.map((spec) => (
                      <div
                        key={spec.spec_id}
                        className="flex items-center justify-between gap-2 py-1.5 border-b border-zinc-200/70 dark:border-zinc-800/70 last:border-0"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-950 dark:text-white truncate">
                            {spec.title}
                          </div>
                          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                            {spec.status} · {spec.sandbox_tier} · sha256:
                            {spec.sha256_digest.slice(0, 8)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {spec.status === 'draft' && onApproveSpec && (
                            <button
                              type="button"
                              onClick={() => void onApproveSpec(spec.spec_id)}
                              className="px-2 py-1 rounded bg-indigo-600 text-white font-semibold text-[10px]"
                            >
                              Sign
                            </button>
                          )}
                          {onRunSpec && (
                            <button
                              type="button"
                              onClick={() => void onRunSpec(spec.spec_id)}
                              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-[10px] hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              Run
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Graph Section: Idle collapses cleanly; Active shows flow + kill controls */}
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
              {!hasActive ? (
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400 py-0.5">
                  <span>Router idle · {specs.length} specs ready</span>
                  <span>
                    {sandbox?.seatbelt_available ? 'Seatbelt' : 'Local'} ·{' '}
                    {sandbox?.docker_available ? 'Docker ready' : 'Docker off'}
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-[1fr_36px_auto_36px_1fr] items-center gap-0">
                    <div className="space-y-1.5">
                      {activeCallers.map(([c, n]) => (
                        <div
                          key={c}
                          className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#18181B] flex items-center justify-between text-[11px] font-mono"
                        >
                          <span className="text-zinc-700 dark:text-zinc-200 truncate">{c}</span>
                          <span className="text-zinc-400 tabular-nums">{n}</span>
                        </div>
                      ))}
                    </div>
                    <svg
                      width="36"
                      height="12"
                      viewBox="0 0 36 12"
                      className="justify-self-center text-indigo-500"
                      aria-hidden="true"
                    >
                      <path
                        d="M0 6 H36"
                        stroke="currentColor"
                        strokeOpacity={0.75}
                        strokeWidth={1.4}
                        fill="none"
                        className="lb-flow"
                      />
                    </svg>
                    <div className="px-3.5 py-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-center font-mono">
                      <div className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                        Router
                      </div>
                      <div className="text-[10px] text-indigo-600/80 dark:text-indigo-300/80 tabular-nums">
                        {running.length} active
                        {swarm && swarm.queued_count > 0 ? ` · ${swarm.queued_count} queued` : ''}
                      </div>
                    </div>
                    <svg
                      width="36"
                      height="12"
                      viewBox="0 0 36 12"
                      className="justify-self-center text-indigo-500"
                      aria-hidden="true"
                    >
                      <path
                        d="M0 6 H36"
                        stroke="currentColor"
                        strokeOpacity={0.75}
                        strokeWidth={1.4}
                        fill="none"
                        className="lb-flow"
                      />
                    </svg>
                    <div className="space-y-1.5">
                      {snap.workers_live.slice(0, 4).map((w) => (
                        <div
                          key={w.pid}
                          className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#18181B] flex items-center justify-between gap-1.5 text-[11px] font-mono"
                        >
                          <span className="text-zinc-950 dark:text-zinc-100 truncate">
                            {w.worker}
                          </span>
                          <button
                            type="button"
                            onClick={() => void onKillWorker(w.pid)}
                            className="text-[10px] text-red-600 dark:text-red-400 hover:underline shrink-0"
                          >
                            Kill
                          </button>
                        </div>
                      ))}
                      {snap.workers_live.length > 4 && (
                        <div className="text-[10px] font-mono text-zinc-500 text-right tabular-nums">
                          +{snap.workers_live.length - 4} more running
                        </div>
                      )}
                    </div>
                  </div>

                  {swarm && swarm.active_leases.some((l) => l.lease_state === 'active') && (
                    <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 flex items-center justify-between pt-1.5 border-t border-zinc-200/70 dark:border-zinc-800/70">
                      <span>
                        PathLeases:{' '}
                        {swarm.active_leases.filter((l) => l.lease_state === 'active').length}
                      </span>
                      <span>Merge Queue: {swarm.merge_queue.length}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Compact Sessions Stream */}
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-zinc-950 dark:text-white">
                  Recent Sessions
                </span>
                <div className="flex items-center gap-1 p-0.5 rounded-md bg-zinc-100 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 font-mono text-[10px]">
                  {(
                    [
                      ['all', `all ${snap.sessions.length}`],
                      ['active', `run ${running.length}`],
                      ['blocked', `warn ${blocked.length}`],
                      ['done', `done ${done.length}`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFilter(key)}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        filter === key
                          ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white font-semibold'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {visibleSessions.length === 0 ? (
                <div className="py-3 text-center text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                  No sessions matching filter.
                </div>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {visibleSessions.map((s) => {
                    const open = openId === s.id;
                    const active = isRunning(s);
                    return (
                      <li key={s.id} className="py-2.5 first:pt-0 last:pb-0">
                        <button
                          type="button"
                          onClick={() => setOpenId(open ? null : s.id)}
                          className="w-full text-left flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-x-1.5 text-[10.5px] font-mono text-zinc-500 dark:text-zinc-400">
                              <span className="tabular-nums">{clock(s.ts)}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-zinc-950 dark:text-zinc-200">
                                {s.caller ?? 'shell'}
                              </span>
                              <span aria-hidden="true">→</span>
                              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                                {s.worker}
                              </span>
                              {s.sandbox_tier && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{s.sandbox_tier}</span>
                                </>
                              )}
                              {s.escalation_from && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-indigo-600 dark:text-indigo-400">
                                    escalated from {s.escalation_from}
                                  </span>
                                </>
                              )}
                            </div>
                            <p className="text-[12px] text-zinc-800 dark:text-zinc-200 truncate">
                              {s.prompt}
                            </p>
                          </div>

                          <div className="text-right font-mono text-[10.5px] shrink-0 tabular-nums">
                            <div
                              className={
                                active
                                  ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                                  : s.state === 'done'
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-red-600 dark:text-red-400'
                              }
                            >
                              {s.state}
                            </div>
                            <div className="text-zinc-400 dark:text-zinc-500">
                              {dur(s.duration_s)} · {ago(s.ts)}
                            </div>
                          </div>
                        </button>

                        {open && (
                          <div className="mt-2 pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70 space-y-1.5 text-[11px] font-mono">
                            {s.cooked && (
                              <div className="text-zinc-600 dark:text-zinc-400">
                                skill: {s.cooked.selected_skill} · hook: {s.cooked.selected_hook} ·
                                gate: {s.cooked.gate_policy}
                              </div>
                            )}
                            {s.output && (
                              <div className="p-2 rounded bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300">
                                {s.output}
                              </div>
                            )}
                            {(s.steps ?? []).length > 0 && (
                              <div className="space-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                                {(s.steps ?? []).map((st, idx) => (
                                  <div key={idx} className="flex gap-2">
                                    <span className="tabular-nums">{clock(st.ts)}</span>
                                    <span
                                      className={
                                        st.tone === 'warn'
                                          ? 'text-amber-600 dark:text-amber-400'
                                          : st.tone === 'done'
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : 'text-zinc-700 dark:text-zinc-300'
                                      }
                                    >
                                      {st.title}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Popover Footer */}
            <div className="px-5 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#18181B]/45 flex items-center justify-between text-[10.5px] font-mono text-zinc-500 dark:text-zinc-400">
              <span>~/.lingonberry/config.json</span>
              <span className="tabular-nums">
                {snap.system.app_ram_gb != null
                  ? `menubar ${snap.system.app_ram_gb.toFixed(2)} GB`
                  : 'SwiftUI + Rust'}
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
