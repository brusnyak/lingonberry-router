import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  GitFork,
  RefreshCw,
  RotateCcw,
  Square,
} from 'lucide-react';
import type { RouterRuntimeState } from '../lib/routerClient';
import { OrchestrationGraph } from './OrchestrationGraph';

type SessionFilter = 'all' | 'active' | 'blocked' | 'done';

interface MenuBarGigaProps {
  state: RouterRuntimeState;
  busy: boolean;
  onRefresh: () => Promise<void> | void;
  onRoute: (params: { prompt: string; caller: string; worktree: boolean }) => Promise<void> | void;
  onRun: (params: {
    prompt: string;
    caller: string;
    worktree: boolean;
    simulate_fault: 'none' | '429' | 'truncated';
    live_api: boolean;
  }) => Promise<void> | void;
  onFanout: (params: { prompt: string; caller: string; worktree: boolean }) => Promise<void> | void;
  onKillWorker: (pid: number) => Promise<void> | void;
  onResetKey: (name: string) => Promise<void> | void;
  onAdjustProviderRpm: (provider: string, nextRpm: number) => Promise<void> | void;
  onToggleJob: (name: string) => Promise<void> | void;
  onRunJob: (name: string) => Promise<void> | void;
  onHealJob: (name: string) => Promise<void> | void;
  onOpenCronTab: () => void;
  onOpenAgentsTab?: () => void;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatTimeOfDay(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const MenuBarGiga: React.FC<MenuBarGigaProps> = ({
  state,
  busy,
  onRefresh,
  onRoute,
  onRun,
  onFanout,
  onKillWorker,
  onResetKey,
  onAdjustProviderRpm,
  onToggleJob,
  onRunJob,
  onHealJob,
  onOpenCronTab,
  onOpenAgentsTab,
}) => {
  const snap = state.snapshot;
  const [caller, setCaller] = useState('claude');
  const [prompt, setPrompt] = useState(
    'audit auth middleware for cookie drops and verify with tests'
  );
  const [worktree, setWorktree] = useState(true);
  const [fault, setFault] = useState<'none' | '429' | 'truncated'>('none');
  const [useLiveGemini, setUseLiveGemini] = useState(false);

  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    snap.sessions[0]?.id ?? null
  );
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [unmounted, setUnmounted] = useState(false);

  const stats = useMemo(() => {
    const passed = snap.overview.completed_24h;
    const blocked = snap.sessions.filter(
      (s) => s.state === 'blocked' || s.state === 'escalated'
    ).length;
    const failed = snap.overview.failed_24h;
    const total = Math.max(1, passed + blocked + failed);
    const successPct = ((passed / total) * 100).toFixed(1);
    const healthyKeys = snap.workers.filter((w) => w.status !== 'down').length;
    return { passed, blocked, failed, total, successPct, healthyKeys };
  }, [snap]);

  // Group key slots by provider for the Providers column
  const providerGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        provider: string;
        calls: number;
        rpmLimit: number;
        inflight: number;
        coolingSlot: { name: string; remaining: number } | null;
        slotCount: number;
      }
    >();
    for (const w of snap.workers) {
      const prov = (w.provider || 'local').toLowerCase();
      const existing = map.get(prov) ?? {
        provider: prov,
        calls: 0,
        rpmLimit: w.rpm_limit ?? 40,
        inflight: 0,
        coolingSlot: null,
        slotCount: 0,
      };
      existing.calls += w.calls_24h;
      existing.rpmLimit = w.rpm_limit ?? existing.rpmLimit;
      existing.inflight += w.inflight ?? (w.status === 'active' ? 1 : 0);
      existing.slotCount += 1;
      if (w.status === 'down' && !existing.coolingSlot) {
        existing.coolingSlot = { name: w.name, remaining: w.cooling_remaining_s ?? 0 };
      }
      map.set(prov, existing);
    }
    return Array.from(map.values());
  }, [snap.workers]);

  const sessionCounts = useMemo(() => {
    let active = 0;
    let blocked = 0;
    let done = 0;
    for (const s of snap.sessions) {
      if (s.state === 'running' || s.state === 'leased') active += 1;
      else if (s.state === 'blocked' || s.state === 'escalated' || s.state === 'failed') blocked += 1;
      else if (s.state === 'done') done += 1;
    }
    return { all: snap.sessions.length, active, blocked, done };
  }, [snap.sessions]);

  const filteredSessions = useMemo(() => {
    const list = snap.sessions.filter((s) => {
      if (sessionFilter === 'all') return true;
      if (sessionFilter === 'active') return s.state === 'running' || s.state === 'leased';
      if (sessionFilter === 'blocked')
        return s.state === 'blocked' || s.state === 'escalated' || s.state === 'failed';
      return s.state === 'done';
    });
    return showAllSessions ? list : list.slice(0, 5);
  }, [snap.sessions, sessionFilter, showAllSessions]);

  const localClis = state.discovery.agents.slice(0, 3);

  if (unmounted) {
    return (
      <div className="w-full max-w-[900px] mx-auto rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#0f1118] p-5 flex items-center justify-between gap-4 shadow-sm">
        <div className="text-xs font-mono text-zinc-600 dark:text-slate-400">
          Popover minimized · daemon remains bound to 127.0.0.1:8799.
        </div>
        <button
          type="button"
          onClick={() => setUnmounted(false)}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-slate-100 text-white dark:text-zinc-900 text-xs font-semibold"
        >
          Reopen Popover
        </button>
      </div>
    );
  }

  return (
    <section
      aria-label="Lingonberry Router Menu Bar Popover"
      className="w-full max-w-[900px] mx-auto rounded-2xl bg-white dark:bg-[#0f1118] text-zinc-800 dark:text-slate-200 border border-zinc-200 dark:border-white/[0.08] shadow-lg dark:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col"
    >
      {/* Popover Top Header */}
      <header className="px-4 py-3 bg-[#f8f9fb] dark:bg-[#13151f] border-b border-zinc-200 dark:border-white/[0.07] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <GitFork className="w-3.5 h-3.5" />
          </div>
          <h2 className="text-[13px] font-semibold tracking-tight text-zinc-900 dark:text-white font-mono truncate">
            Lingonberry Router
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-[10.5px] font-mono text-zinc-500 dark:text-slate-400 px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.06]">
            <span>loopback:</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              127.0.0.1:8799
            </span>
            <span className="text-zinc-300 dark:text-white/15">·</span>
            <span>{state.mode === 'live-api' ? 'local-api' : 'sandbox'}</span>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void onRefresh()}
            title="Refresh & Rescan State"
            className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-500 dark:text-slate-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] border border-transparent hover:border-zinc-300 dark:hover:border-white/[0.08] transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setUnmounted(true)}
            className="px-2.5 py-1 rounded-md text-[11px] font-mono text-zinc-600 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-500/10 border border-zinc-200 dark:border-white/[0.08] transition"
          >
            Hide
          </button>
        </div>
      </header>

      {/* Main Canvas */}
      <div className="p-3.5 space-y-3.5 bg-[#f4f5f7]/60 dark:bg-[#0c0e13]">
        {/* Telemetry Strip + 24h Distribution Bar */}
        <div className="bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08] rounded-xl p-3 font-mono space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    snap.overview.running > 0 ? 'bg-sky-500' : 'bg-emerald-500'
                  }`}
                />
                <span className="text-zinc-500 dark:text-slate-400">running:</span>
                <span className="text-zinc-900 dark:text-white font-semibold">
                  {snap.overview.running} active
                </span>
              </div>
              <span className="text-zinc-300 dark:text-white/15">·</span>
              <div>
                <span className="text-zinc-500 dark:text-slate-400">avg: </span>
                <span className="text-zinc-800 dark:text-slate-200">
                  {snap.overview.avg_duration_s !== null
                    ? `${snap.overview.avg_duration_s.toFixed(1)}s`
                    : '—'}
                </span>
              </div>
              <span className="text-zinc-300 dark:text-white/15">·</span>
              <div>
                <span className="text-zinc-500 dark:text-slate-400">keys: </span>
                <span className="text-zinc-800 dark:text-slate-200">
                  {stats.healthyKeys}/{snap.workers.length}
                </span>
              </div>
              <span className="text-zinc-300 dark:text-white/15">·</span>
              <div>
                <span className="text-zinc-500 dark:text-slate-400">cron pids: </span>
                <span className="text-zinc-800 dark:text-slate-200">{snap.cron_live.length}</span>
              </div>
              <span className="text-zinc-300 dark:text-white/15">·</span>
              <div>
                <span className="text-zinc-500 dark:text-slate-400">pass rate: </span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  {stats.successPct}%
                </span>
              </div>
            </div>
            <div className="text-[10px] text-zinc-400 dark:text-slate-500">
              {snap.overview.calls_24h ?? snap.sessions.length} tasks recorded
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-zinc-200 dark:bg-white/[0.06]">
              <div
                className="bg-emerald-500 h-full transition-all"
                style={{ width: `${(stats.passed / stats.total) * 100}%` }}
                title={`${stats.passed} passed`}
              />
              {stats.blocked > 0 && (
                <div
                  className="bg-amber-500 h-full transition-all"
                  style={{ width: `${(stats.blocked / stats.total) * 100}%` }}
                  title={`${stats.blocked} blocked`}
                />
              )}
              {stats.failed > 0 && (
                <div
                  className="bg-rose-500 h-full transition-all"
                  style={{ width: `${(stats.failed / stats.total) * 100}%` }}
                  title={`${stats.failed} failed`}
                />
              )}
            </div>
            <div className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-slate-500 tabular-nums">
              <div className="flex items-center gap-3">
                <span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {stats.passed}
                  </span>{' '}
                  passed
                </span>
                <span>
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                    {stats.blocked}
                  </span>{' '}
                  blocked
                </span>
                <span>
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">
                    {stats.failed}
                  </span>{' '}
                  failed
                </span>
              </div>
              <span>past 24h</span>
            </div>
          </div>
        </div>

        {/* Interactive Dispatch Strip */}
        <section className="bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08] rounded-xl p-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              aria-label="Caller agent"
              value={caller}
              onChange={(e) => setCaller(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-[#f8f9fb] dark:bg-[#0c0e14] text-[11px] font-mono text-zinc-800 dark:text-slate-200"
            >
              <option value="claude">caller: claude</option>
              <option value="codex">caller: codex</option>
              <option value="opencode">caller: opencode</option>
              <option value="shell">caller: shell</option>
            </select>

            <input
              type="text"
              aria-label="Raw prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Raw prompt to cook, route, and verify…"
              className="flex-1 h-8 px-3 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-[#f8f9fb] dark:bg-[#0c0e14] text-xs text-zinc-900 dark:text-slate-100 placeholder:text-zinc-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-amber-500/60"
            />

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={busy || !prompt.trim()}
                onClick={() => void onRoute({ prompt, caller, worktree })}
                className="h-8 px-2.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-[#f8f9fb] dark:bg-[#0c0e14] hover:bg-zinc-100 dark:hover:bg-[#171a25] text-[11px] font-mono font-medium text-zinc-700 dark:text-slate-200 disabled:opacity-45"
              >
                Route
              </button>
              <button
                type="button"
                disabled={busy || !prompt.trim()}
                onClick={() =>
                  void onRun({
                    prompt,
                    caller,
                    worktree,
                    simulate_fault: fault,
                    live_api: useLiveGemini,
                  })
                }
                className="h-8 px-3 rounded-lg bg-zinc-900 dark:bg-[#e5a950] text-white dark:text-[#1b1200] hover:opacity-90 text-[11px] font-semibold disabled:opacity-45"
              >
                Run
              </button>
              <button
                type="button"
                disabled={busy || !prompt.trim()}
                onClick={() => void onFanout({ prompt, caller, worktree })}
                className="h-8 px-2.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-[#f8f9fb] dark:bg-[#0c0e14] hover:bg-zinc-100 dark:hover:bg-[#171a25] text-[11px] font-mono font-medium text-zinc-700 dark:text-slate-200 disabled:opacity-45"
              >
                Fanout ×3
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={worktree}
                  onChange={(e) => setWorktree(e.target.checked)}
                  className="rounded border-zinc-300 dark:border-white/20"
                />
                <span className="font-mono text-[10.5px]">--worktree gate</span>
              </label>

              <label className="inline-flex items-center gap-1.5">
                <span className="font-mono text-[10.5px]">fault:</span>
                <select
                  value={fault}
                  onChange={(e) => setFault(e.target.value as 'none' | '429' | 'truncated')}
                  className="px-1.5 py-0.5 rounded border border-zinc-200 dark:border-white/[0.08] bg-[#f8f9fb] dark:bg-[#0c0e14] text-[10.5px] font-mono text-zinc-700 dark:text-slate-300"
                >
                  <option value="none">none</option>
                  <option value="429">429 burst (failover)</option>
                  <option value="truncated">truncated output</option>
                </select>
              </label>

              {state.capabilities.live_gemini_available && (
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useLiveGemini}
                    onChange={(e) => setUseLiveGemini(e.target.checked)}
                    className="rounded border-zinc-300 dark:border-white/20"
                  />
                  <span className="font-mono text-[10.5px] text-emerald-600 dark:text-emerald-400">
                    live GEMINI_API_KEY
                  </span>
                </label>
              )}
            </div>

            {onOpenAgentsTab && (
              <button
                type="button"
                onClick={onOpenAgentsTab}
                className="font-mono text-[10.5px] text-zinc-500 dark:text-slate-400 hover:text-zinc-900 dark:hover:text-white"
              >
                self-config &amp; skills →
              </button>
            )}
          </div>
        </section>

        {/* 4-Column Orchestration Graph */}
        <OrchestrationGraph
          workers={snap.workers}
          workersLive={snap.workers_live}
          sessions={snap.sessions}
          activeSessionId={expandedSessionId}
          onSelectSession={(id) =>
            setExpandedSessionId((prev) => (prev === id ? null : id))
          }
        />

        {/* 3-Column Bento Grid: Workers | Providers | Scheduled Tasks */}
        <div className="grid grid-cols-12 gap-3">
          {/* Column 1: Workers */}
          <section className="col-span-12 md:col-span-4 bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08] rounded-xl p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-zinc-200/80 dark:border-white/[0.06] mb-2.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      snap.workers_live.length > 0 ? 'bg-sky-500' : 'bg-emerald-500'
                    }`}
                  />
                  <span className="font-mono uppercase tracking-wider text-[11px] font-semibold text-zinc-700 dark:text-slate-200">
                    Workers
                  </span>
                </div>
                <span className="text-[10px] text-zinc-500 dark:text-slate-400 font-mono tabular-nums">
                  {snap.workers_live.length} running · {snap.workers.length} slots
                </span>
              </div>

              <div className="space-y-2 font-mono">
                {snap.workers_live.map((w) => (
                  <div
                    key={`${w.pid}-${w.worker}`}
                    className="p-2 rounded-lg bg-[#f8f9fb] dark:bg-[#0c0e14] border border-sky-500/30 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
                        <span className="font-semibold text-zinc-900 dark:text-white truncate">
                          {w.worker}
                        </span>
                        <span className="text-[9.5px] text-zinc-400 dark:text-slate-500">
                          pid {w.pid}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onKillWorker(w.pid)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] text-rose-700 dark:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition shrink-0"
                      >
                        <Square className="w-2.5 h-2.5" />
                        kill
                      </button>
                    </div>
                    <p className="text-[10.5px] text-zinc-600 dark:text-slate-300 truncate">
                      {w.task}
                    </p>
                    <div className="flex items-center justify-between text-[9.5px] text-zinc-500 dark:text-slate-500 pt-1 border-t border-zinc-200/70 dark:border-white/[0.04] tabular-nums">
                      <span>active {formatElapsed(w.elapsed_s)}</span>
                      <span className="text-sky-600 dark:text-sky-400">
                        {w.key ?? 'local-cli'}
                      </span>
                    </div>
                  </div>
                ))}

                {snap.workers.slice(0, snap.workers_live.length > 0 ? 2 : 4).map((slot) => (
                  <div
                    key={slot.name}
                    className="p-2 rounded-lg bg-[#f8f9fb] dark:bg-[#0c0e14]/70 border border-zinc-200/80 dark:border-white/[0.05] flex items-center justify-between gap-2 text-[10.5px]"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          slot.status === 'down'
                            ? 'bg-amber-500'
                            : slot.status === 'active'
                              ? 'bg-sky-500'
                              : 'bg-emerald-500'
                        }`}
                      />
                      <span className="truncate text-zinc-700 dark:text-slate-300">
                        {slot.name}
                      </span>
                    </div>
                    {slot.status === 'down' ? (
                      <button
                        type="button"
                        onClick={() => void onResetKey(slot.name)}
                        className="text-[9.5px] text-amber-600 dark:text-amber-400 hover:underline shrink-0"
                      >
                        cool {slot.cooling_remaining_s ?? 0}s · reset
                      </button>
                    ) : (
                      <span className="text-[9.5px] text-emerald-600 dark:text-emerald-400 shrink-0 tabular-nums">
                        {slot.ok_24h} ok
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Column 2: Providers (+ / - live RPM cap) */}
          <section className="col-span-12 md:col-span-4 bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08] rounded-xl p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-zinc-200/80 dark:border-white/[0.06] mb-2.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="font-mono uppercase tracking-wider text-[11px] font-semibold text-zinc-700 dark:text-slate-200">
                    Providers
                  </span>
                </div>
                <span className="text-[10px] text-zinc-500 dark:text-slate-400 font-mono">
                  {providerGroups.length} remote · {localClis.length} local
                </span>
              </div>

              <div className="space-y-2 font-mono">
                {providerGroups.slice(0, 3).map((pg) => {
                  const pct = Math.min(100, Math.round((pg.calls / Math.max(1, pg.rpmLimit)) * 100));
                  return (
                    <div
                      key={pg.provider}
                      className="p-2 rounded-lg bg-[#f8f9fb] dark:bg-[#0c0e14] border border-zinc-200/80 dark:border-white/[0.06] space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-zinc-800 dark:text-slate-200 flex items-center gap-1.5 uppercase">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              pg.coolingSlot ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                          />
                          {pg.provider}
                        </span>
                        {pg.coolingSlot ? (
                          <button
                            type="button"
                            onClick={() => void onResetKey(pg.coolingSlot!.name)}
                            className="text-[9.5px] text-amber-700 dark:text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/25 hover:bg-amber-500/20"
                          >
                            reset {pg.coolingSlot.name}
                          </button>
                        ) : (
                          <span className="text-[9.5px] text-zinc-500 dark:text-slate-400">
                            {pg.slotCount} {pg.slotCount === 1 ? 'key' : 'keys'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[9.5px] text-zinc-500 dark:text-slate-400 tabular-nums">
                        <span>
                          {pg.calls} calls · {pg.rpmLimit} RPM cap
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Decrease ${pg.provider} RPM limit`}
                            onClick={() =>
                              void onAdjustProviderRpm(pg.provider, Math.max(5, pg.rpmLimit - 5))
                            }
                            className="w-4 h-4 flex items-center justify-center rounded bg-zinc-200/70 dark:bg-white/[0.05] hover:bg-zinc-300 dark:hover:bg-white/[0.12] text-zinc-700 dark:text-slate-200 border border-zinc-300 dark:border-white/[0.08]"
                          >
                            -
                          </button>
                          <span className="px-1 font-semibold text-zinc-800 dark:text-slate-200">
                            {pg.rpmLimit}
                          </span>
                          <button
                            type="button"
                            aria-label={`Increase ${pg.provider} RPM limit`}
                            onClick={() =>
                              void onAdjustProviderRpm(pg.provider, Math.min(300, pg.rpmLimit + 5))
                            }
                            className="w-4 h-4 flex items-center justify-center rounded bg-zinc-200/70 dark:bg-white/[0.05] hover:bg-zinc-300 dark:hover:bg-white/[0.12] text-zinc-700 dark:text-slate-200 border border-zinc-300 dark:border-white/[0.08]"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div className="h-1 w-full bg-zinc-200 dark:bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            pg.coolingSlot ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.max(8, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-2 pt-1.5 border-t border-zinc-200/80 dark:border-white/[0.05] flex items-center justify-between text-[9.5px] font-mono text-zinc-500 dark:text-slate-400">
              <span>Local CLIs:</span>
              <div className="flex items-center gap-2 truncate">
                {localClis.map((a, idx) => (
                  <React.Fragment key={a.id}>
                    {idx > 0 && <span className="text-zinc-300 dark:text-white/15">·</span>}
                    <span className="text-zinc-700 dark:text-slate-300">{a.id}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </section>

          {/* Column 3: Scheduled Tasks */}
          <section className="col-span-12 md:col-span-4 bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08] rounded-xl p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-zinc-200/80 dark:border-white/[0.06] mb-2.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="font-mono uppercase tracking-wider text-[11px] font-semibold text-zinc-700 dark:text-slate-200">
                    Scheduled Tasks
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onOpenCronTab}
                  className="text-[10px] font-mono text-sky-600 dark:text-sky-400 hover:underline"
                >
                  oversight →
                </button>
              </div>

              <div className="space-y-2 font-mono">
                {snap.jobs.slice(0, 3).map((job) => {
                  const isCrashed = job.health === 'crashed';
                  return (
                    <div
                      key={job.name}
                      className="p-2 rounded-lg bg-[#f8f9fb] dark:bg-[#0c0e14] border border-zinc-200/80 dark:border-white/[0.06] flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-800 dark:text-slate-200">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              isCrashed
                                ? 'bg-rose-500'
                                : job.health === 'running'
                                  ? 'bg-sky-500'
                                  : job.paused
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500'
                            }`}
                          />
                          <span className="truncate font-medium">{job.name}</span>
                        </div>
                        <div className="text-[9.5px] text-zinc-500 dark:text-slate-500 mt-0.5 pl-3 truncate">
                          {job.schedule} ·{' '}
                          <span
                            className={
                              isCrashed
                                ? 'text-rose-600 dark:text-rose-400'
                                : job.paused
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : ''
                            }
                          >
                            {job.paused ? 'paused' : job.health}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {isCrashed ? (
                          <button
                            type="button"
                            onClick={() => void onHealJob(job.name)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                            Heal
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void onToggleJob(job.name)}
                            className="px-1.5 py-0.5 rounded text-[9.5px] bg-white dark:bg-white/[0.04] hover:bg-zinc-100 dark:hover:bg-white/[0.08] text-zinc-600 dark:text-slate-300 border border-zinc-200 dark:border-white/[0.06] transition"
                          >
                            {job.paused ? 'Resume' : 'Pause'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void onRunJob(job.name)}
                          className="px-1.5 py-0.5 rounded text-[9.5px] bg-white dark:bg-white/[0.04] hover:bg-emerald-500/15 hover:text-emerald-700 dark:hover:text-emerald-300 text-zinc-600 dark:text-slate-300 border border-zinc-200 dark:border-white/[0.06] transition"
                        >
                          Run
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-2 pt-1.5 border-t border-zinc-200/80 dark:border-white/[0.05] flex items-center justify-between text-[9.5px] font-mono text-zinc-500 dark:text-slate-400">
              <span>{snap.jobs.length} host + router jobs</span>
              <span>{snap.cron_live.length} active PIDs</span>
            </div>
          </section>
        </div>

        {/* Sessions / Traces with Filter Tabs + Expandable Timelines */}
        <section className="bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08] rounded-xl p-3.5 space-y-3 font-mono">
          <div className="flex flex-wrap items-center justify-between pb-2.5 border-b border-zinc-200/80 dark:border-white/[0.06] gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold uppercase tracking-wider text-[11px] text-zinc-800 dark:text-slate-200">
                Sessions / Traces
              </span>
              <span className="text-zinc-500 dark:text-slate-500 text-[10px]">
                {filteredSessions.length} shown · {snap.sessions.length} total
              </span>
            </div>

            <div
              role="tablist"
              aria-label="Filter sessions"
              className="flex items-center gap-1 bg-[#f4f5f7] dark:bg-[#0c0e14] p-0.5 rounded-lg border border-zinc-200 dark:border-white/[0.06] text-[10px]"
            >
              {(
                [
                  { id: 'all', label: `All (${sessionCounts.all})` },
                  { id: 'active', label: `Active (${sessionCounts.active})` },
                  { id: 'blocked', label: `Blocked (${sessionCounts.blocked})` },
                  { id: 'done', label: `Done (${sessionCounts.done})` },
                ] as const
              ).map((t) => {
                const active = sessionFilter === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSessionFilter(t.id)}
                    className={`px-2 py-0.5 rounded transition ${
                      active
                        ? 'bg-white dark:bg-white/[0.1] text-zinc-900 dark:text-white font-semibold shadow-2xs'
                        : 'text-zinc-500 dark:text-slate-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            {filteredSessions.length === 0 ? (
              <div className="p-3 rounded-lg bg-[#f8f9fb] dark:bg-[#0c0e14] border border-zinc-200/80 dark:border-white/[0.05] text-[11px] text-zinc-500 dark:text-slate-400">
                No sessions match this filter.
              </div>
            ) : (
              filteredSessions.map((s) => {
                const open = expandedSessionId === s.id;
                const isRunning = s.state === 'running' || s.state === 'leased';
                const isBlocked =
                  s.state === 'blocked' || s.state === 'escalated' || s.state === 'failed';
                const statusBadgeClass = isRunning
                  ? 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30'
                  : isBlocked
                    ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30'
                    : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25';

                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border transition overflow-hidden ${
                      isRunning
                        ? 'bg-[#f8f9fb] dark:bg-[#0c0e14] border-sky-500/30'
                        : isBlocked
                          ? 'bg-[#f8f9fb] dark:bg-[#0c0e14] border-amber-500/25'
                          : 'bg-[#f8f9fb] dark:bg-[#0c0e14] border-zinc-200 dark:border-white/[0.06]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedSessionId(open ? null : s.id)}
                      className="w-full p-2.5 text-left hover:bg-zinc-100/70 dark:hover:bg-[#10131d] transition"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          {open ? (
                            <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-400" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-400" />
                          )}
                          <span className="text-[10px] text-zinc-500 dark:text-slate-400 pt-0.5 shrink-0 tabular-nums">
                            {formatTimeOfDay(s.ts)}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] font-semibold text-zinc-900 dark:text-white">
                                {s.worker}
                              </span>
                              <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                                {s.caller ?? 'shell'}
                              </span>
                              {s.key && (
                                <span className="text-[9.5px] text-zinc-500 dark:text-slate-500">
                                  {s.key}
                                </span>
                              )}
                              {s.failover_from && (
                                <span className="text-[9.5px] text-amber-600 dark:text-amber-400">
                                  failover ← {s.failover_from}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-zinc-600 dark:text-slate-300 leading-snug truncate mt-0.5">
                              {s.prompt}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col items-end shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded text-[9.5px] font-semibold border capitalize ${statusBadgeClass}`}
                          >
                            {s.state}
                          </span>
                          <span className="text-[9.5px] text-zinc-500 dark:text-slate-500 mt-1 tabular-nums">
                            {s.duration_s.toFixed(1)}s
                            {s.tokens_in || s.tokens_out
                              ? ` · ${s.tokens_in ?? 0} in / ${s.tokens_out ?? 0} out`
                              : ''}
                          </span>
                        </div>
                      </div>
                    </button>

                    {open && (
                      <div className="px-3 py-2.5 border-t border-zinc-200/80 dark:border-white/[0.06] bg-white dark:bg-[#090b0e] text-[10.5px] space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-zinc-200/70 dark:border-white/[0.04] text-[9.5px] text-zinc-500 dark:text-slate-400">
                          <span>receipt: {s.receipt_id ?? 'local-run'}</span>
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {s.state === 'done' ? 'Gate: PASS' : `State: ${s.state}`}
                          </span>
                        </div>

                        <div className="space-y-1 pl-2 border-l border-zinc-300 dark:border-zinc-700">
                          {(s.steps ?? []).map((st, idx) => (
                            <div
                              key={`${s.id}-${idx}`}
                              className="text-zinc-700 dark:text-slate-300 leading-snug"
                            >
                              <span className="text-zinc-400 dark:text-slate-500">&gt; </span>
                              <span className="font-semibold">{st.title}</span>
                              <span className="text-zinc-500 dark:text-slate-400">
                                {' '}
                                — {st.detail}
                              </span>
                            </div>
                          ))}
                        </div>

                        {s.output && (
                          <pre className="pt-1.5 border-t border-zinc-200/70 dark:border-white/[0.04] text-[10px] whitespace-pre-wrap text-emerald-700 dark:text-emerald-300">
                            {s.output}
                          </pre>
                        )}
                        {s.reason && (
                          <div className="text-[10px] text-amber-700 dark:text-amber-300">
                            {s.reason}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {snap.sessions.length > 5 && (
            <div className="pt-2 border-t border-zinc-200/70 dark:border-white/[0.04] flex items-center justify-between text-[10px] text-zinc-500 dark:text-slate-500">
              <span>Showing {filteredSessions.length} traces</span>
              <button
                type="button"
                onClick={() => setShowAllSessions((v) => !v)}
                className="text-zinc-600 dark:text-slate-300 hover:underline"
              >
                {showAllSessions
                  ? 'Collapse list'
                  : `View all ${snap.sessions.length} history logs →`}
              </button>
            </div>
          )}
        </section>

        {/* Quiet Daemon Footer */}
        <footer className="pt-2 px-1 flex flex-wrap items-center justify-between text-[10px] text-zinc-500 dark:text-slate-500 font-mono border-t border-zinc-200 dark:border-white/[0.06] gap-y-1">
          <div className="flex items-center gap-2 truncate">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">/daemon</span>
            <span className="truncate">~/.lingonberry/config.json</span>
            <span>·</span>
            <span>127.0.0.1:8799</span>
          </div>
          <div className="flex items-center gap-3 shrink-0 tabular-nums">
            <span>
              ram:{' '}
              {snap.system.ram_used_gb !== null ? `${snap.system.ram_used_gb.toFixed(1)} GB` : '—'}
            </span>
            <span>
              cpu: {snap.system.cpu_pct !== null ? `${snap.system.cpu_pct.toFixed(0)}%` : '—'}
            </span>
          </div>
        </footer>
      </div>
    </section>
  );
};
