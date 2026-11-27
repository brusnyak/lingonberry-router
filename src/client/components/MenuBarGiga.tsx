import React, { useMemo, useState } from 'react';
import type { RouterRuntimeState } from '../lib/routerClient';
import type { SessionRow, SessionStep, WorkerStatus } from '../../types';

/*
 * Menu bar workbench. Caller → Router → Workers flow.
 * Caller = who initiated the work (left). Worker = who executed it (right).
 * Idle by default: graph shows only the router. Callers, workers and gates appear when work runs.
 */

interface MenuBarGigaProps {
  state: RouterRuntimeState;
  busy: boolean;
  onRefresh: () => Promise<void> | void;
  onKillWorker: (pid: number) => Promise<void> | void;
  onAdjustProviderRpm: (provider: string, nextRpm: number) => Promise<void> | void;
  onToggleJob?: (name: string) => Promise<void> | void;
  onRunJob?: (name: string) => Promise<void> | void;
  onHealJob?: (name: string) => Promise<void> | void;
  onRoute?: (p: never) => unknown;
  onRun?: (p: never) => unknown;
  onFanout?: (p: never) => unknown;
  onResetKey?: (p: never) => unknown;
  onOpenCronTab?: () => void;
  onOpenAgentsTab?: () => void;
}

const isRunning = (s: SessionRow) => s.state === 'running' || s.state === 'leased';
const isBlocked = (s: SessionRow) => ['blocked', 'escalated', 'failed'].includes(s.state);

function clock(ts: number): string {
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
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

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard may be unavailable in a webview; the text stays selectable */
  }
}

export const MenuBarGiga: React.FC<MenuBarGigaProps> = ({
  state,
  busy,
  onRefresh,
  onKillWorker,
  onAdjustProviderRpm,
  onToggleJob,
  onRunJob,
  onHealJob,
}) => {
  const snap = state.snapshot;
  const [filter, setFilter] = useState<'all' | 'active' | 'blocked' | 'done'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const running = useMemo(() => snap.sessions.filter(isRunning), [snap.sessions]);
  const blocked = useMemo(() => snap.sessions.filter(isBlocked), [snap.sessions]);
  const done = useMemo(() => snap.sessions.filter((s) => s.state === 'done'), [snap.sessions]);
  const finished = snap.overview.completed_24h + snap.overview.failed_24h;
  const successPct = finished === 0 ? null : (snap.overview.completed_24h / finished) * 100;
  const hasActive = running.length > 0 || snap.workers_live.length > 0;

  const visibleSessions = useMemo(() => {
    const list =
      filter === 'active' ? running : filter === 'blocked' ? blocked : filter === 'done' ? done : snap.sessions;
    return showAll ? list : list.slice(0, 8);
  }, [filter, snap.sessions, running, blocked, done, showAll]);

  // Callers of work that is running now: who initiated (left side of graph).
  const activeCallers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of running) {
      const c = s.caller ?? 'shell';
      seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    return Array.from(seen.entries());
  }, [running]);

  // Providers, every key listed.
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
      active: workers.some((w) => w.status === 'active'),
    }));
  }, [snap.workers]);

  const activeKeys = new Set(snap.workers_live.map((w) => w.key).filter(Boolean));
  const activeProviders = providers.filter((p) => p.workers.some((w) => activeKeys.has(w.key ?? '')));

  let gatePass = 0;
  let gateFail = 0;
  for (const s of running) {
    const g = (s.steps ?? []).find((st: SessionStep) => st.stage === 'gate');
    if (!g) continue;
    if (g.tone === 'warn') gateFail += 1;
    else gatePass += 1;
  }

  const routerJobs = snap.jobs.filter((j) => j.source === 'lingonberry');

  const surfaceCls = document.documentElement.classList.contains('dark') ? 'lb-surface-alt' : 'lb-surface';
  const panelCls = document.documentElement.classList.contains('dark') ? 'lb-panel' : 'lb-surface-alt';
  const borderCls = document.documentElement.classList.contains('dark') ? 'border-white/[0.08]' : 'lb-border';
  const textCls = document.documentElement.classList.contains('dark') ? 'text-slate-200' : 'text-zinc-900';
  const mutedCls = document.documentElement.classList.contains('dark') ? 'text-slate-400' : 'text-zinc-500';

  return (
    <section
      className={`w-[900px] max-w-full rounded-2xl ${surfaceCls} ${textCls} border ${borderCls} shadow-popover overflow-hidden flex flex-col`}
    >
      <style>{`
        @keyframes lb-flow { to { stroke-dashoffset: -20; } }
        .lb-flow { stroke-dasharray: 5 5; animation: lb-flow 1.1s linear infinite; }
      `}</style>

      {/* header */}
      <header className="px-4 py-3 border-b flex items-center justify-between select-none">
        <div className="flex items-center space-x-3">
          <div className="w-6 h-6 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-[#fabb60]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="2.5"></circle>
              <path d="M12 2v3m0 14v3M2 12h3m14 0h3m-3.8-6.8l-2.1 2.1m-6.4 6.4l-2.1 2.1m0-10.6l2.1 2.1m6.4 6.4l2.1 2.1"></path>
            </svg>
          </div>
          <h1 className="text-[13px] font-semibold tracking-tight font-mono">Lingonberry Router</h1>
        </div>
        <div className="flex items-center space-x-2.5">
          <span className="hidden sm:inline text-[10px] font-mono {mutedCls}">127.0.0.1:8799</span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
            hasActive ? 'text-amber-300 border-amber-400/30 bg-amber-400/10' : `${mutedCls} border-white/[0.08] bg-white/[0.03]`
          }`}>
            {hasActive ? `${running.length} running` : 'idle'}
          </span>
          <button
            type="button"
            onClick={() => onRefresh()}
            disabled={busy}
            title="Refresh state"
            aria-label="Refresh state"
            className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] transition"
          >
            <svg className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} viewBox="0 0 24 24">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
            </svg>
          </button>
        </div>
      </header>

      <div className="p-3.5 space-y-3 overflow-y-auto max-h-[88vh]">
        {/* summary: plain text, no big bars */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 font-mono text-[11px] {mutedCls}">
          <span>running <span className={hasActive ? 'text-amber-300' : 'text-zinc-200'}>{running.length}</span></span>
          <span>avg <span className={textCls}>{snap.overview.avg_duration_s == null ? '—' : dur(snap.overview.avg_duration_s)}</span></span>
          <span>success <span className={textCls}>{successPct == null ? '—' : `${successPct.toFixed(0)}%`}</span></span>
          <span className="ml-auto text-zinc-500">{snap.sessions.length} tasks · 24h</span>
        </div>

        {/* graph: caller → router → worker */}
        <section className={`bg-zinc-900/20 dark:bg-white/[0.02] border rounded-xl p-3 ${borderCls}`}>
          {!hasActive ? (
            <div className="flex flex-col items-center justify-center py-4 gap-2">
              <div className="px-4 py-2 rounded-xl border bg-zinc-900/30 dark:bg-white/[0.03] text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
                Router
              </div>
              <span className="text-[10px] font-mono {mutedCls}">idle · nothing running</span>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_44px_auto_44px_1fr] items-center gap-0">
              <div className="space-y-2">
                {activeCallers.map(([c, n]) => (
                  <div key={c} className="px-3 py-2 rounded-lg border border-sky-400/30 bg-sky-400/[0.06] flex items-center justify-between text-[11px] font-mono">
                    <span className="text-sky-200 truncate">{c}</span>
                    <span className="text-sky-300/70">{n}</span>
                  </div>
                ))}
              </div>
              <svg width="44" height="12" viewBox="0 0 44 12" className="justify-self-center self-center" aria-hidden="true">
                <path d="M0 6 H44" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} fill="none" className="lb-flow" />
              </svg>
              <div className="px-4 py-3 rounded-lg border border-amber-400/40 bg-amber-400/[0.06] text-center">
                <div className="text-[11px] font-mono font-semibold text-amber-200">Router</div>
                <div className="text-[10px] font-mono text-amber-300/70 mt-0.5">{running.length} dispatching</div>
              </div>
              <svg width="44" height="12" viewBox="0 0 44 12" className="justify-self-center self-center" aria-hidden="true">
                <path d="M0 6 H44" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} fill="none" className="lb-flow" />
              </svg>
              <div className="space-y-2">
                {snap.workers_live.map((w) => (
                  <div key={w.pid} className="px-3 py-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] flex items-center justify-between text-[11px] font-mono">
                    <span className="text-amber-200 truncate">{w.worker}</span>
                    <span className="text-amber-300/70 truncate ml-2">{w.key ?? ''}</span>
                  </div>
                ))}
                {activeProviders.length === 0 && snap.workers_live.length === 0 && <div className="text-[10px] font-mono {mutedCls}">no worker yet</div>}
                <div className="pt-1 space-y-1">
                  {gateFail + gatePass > 0 && (
                    <div className="flex items-center justify-between text-[10px] font-mono {mutedCls}">
                      <span>gates</span>
                      <span><span className="text-emerald-400">{gatePass} pass</span> · <span className={gateFail ? 'text-rose-400' : 'text-zinc-600'}>{gateFail} fail</span></span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* workers, providers, router jobs — tight grid, no gaps */}
        <div className="grid grid-cols-12 gap-2">
          <section className="col-span-12 md:col-span-4 ${panelCls} border rounded-xl p-2.5 ${borderCls}">
            <div className="flex items-center justify-between pb-1 border-b mb-1.5 text-[10px]">
              <span className="font-medium text-zinc-200 dark:text-white">Workers</span>
              <span className="text-[9px] font-mono {mutedCls}">{snap.workers_live.length} running · {snap.workers.length} keys</span>
            </div>
            <div className="space-y-1 font-mono">
              {snap.workers_live.map((w) => (
                <div key={w.pid} className="p-1.5 rounded-lg bg-zinc-900/30 dark:bg-white/[0.02] border border-amber-400/20 space-y-0.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-medium text-amber-200">{w.worker}</span>
                    <button type="button" onClick={() => onKillWorker(w.pid)} className="px-1 py-0.5 rounded text-[8.5px] text-zinc-400 hover:text-rose-300 bg-white/[0.04] border border-white/[0.06]">stop</button>
                  </div>
                  <p className="text-[9.5px] text-zinc-400 truncate">{w.task}</p>
                </div>
              ))}
              {snap.workers.map((w) => (
                <div key={w.name} className="px-1.5 py-1 rounded-lg ${panelCls} flex items-center justify-between text-[9.5px] ${borderCls}">
                  <span className="text-zinc-300 dark:text-zinc-200 truncate" title={w.name}>{w.key ?? w.name}</span>
                  <span className={`text-[8.5px] shrink-0 ml-2 ${w.status === 'down' ? 'text-rose-400' : 'text-zinc-500'}`}>
                    {w.status === 'down' ? `cooling ${Math.round(w.cooling_remaining_s ?? 0)}s` : `${w.ok_24h} ok`}
                  </span>
                </div>
              ))}
              {snap.workers.length === 0 && <div className="text-[9px] text-zinc-500">none discovered</div>}
            </div>
          </section>

          <section className="col-span-12 md:col-span-4 ${panelCls} border rounded-xl p-2.5 ${borderCls}">
            <div className="flex items-center justify-between pb-1 border-b mb-1.5 text-[10px]">
              <span className="font-medium text-zinc-200 dark:text-white">Providers</span>
              <span className="text-[9px] font-mono {mutedCls}">{providers.length} · calls/min</span>
            </div>
            <div className="space-y-1.5 font-mono">
              {providers.map((p) => {
                const pct = p.rpm ? Math.min(100, Math.round((p.inflight / p.rpm) * 100)) : 0;
                return (
                  <div key={p.provider} className="p-1.5 rounded-lg bg-zinc-900/30 dark:bg-white/[0.02] space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-zinc-200 dark:text-white">{p.provider}</span>
                      <div className="flex items-center gap-1.5 text-[9px] text-zinc-300">
                        <button type="button" aria-label={`lower ${p.provider} limit`} onClick={() => onAdjustProviderRpm(p.provider, Math.max(5, p.rpm - 5))} className="w-3.5 h-3.5 rounded border border-white/[0.08] hover:bg-white/[0.06]">−</button>
                        <span className="w-12 text-center">{p.rpm}/min</span>
                        <button type="button" aria-label={`raise ${p.provider} limit`} onClick={() => onAdjustProviderRpm(p.provider, Math.min(300, p.rpm + 5))} className="w-3.5 h-3.5 rounded border border-white/[0.08] hover:bg-white/[0.06]">+</button>
                      </div>
                    </div>
                    <div className="h-px w-full bg-white/[0.06]">
                      <div className="h-px bg-amber-500/70" style={{ width: `${pct}%` }}></div>
                    </div>
                    <div className="text-[9px] text-zinc-500">{p.workers.length} key{p.workers.length === 1 ? '' : 's'} · {p.calls} calls 24h</div>
                  </div>
                );
              })}
              {providers.length === 0 && <div className="text-[9px] text-zinc-500">none</div>}
            </div>
          </section>

          <section className="col-span-12 md:col-span-4 ${panelCls} border rounded-xl p-2.5 ${borderCls}">
            <div className="flex items-center justify-between pb-1 border-b mb-1.5 text-[10px]">
              <span className="font-medium text-zinc-200 dark:text-white">Router jobs</span>
              <span className="text-[9px] font-mono {mutedCls}">{routerJobs.length}</span>
            </div>
            <div className="space-y-1.5 font-mono">
              {routerJobs.length === 0 && <div className="text-[9px] text-zinc-500">none configured</div>}
              {routerJobs.map((j) => (
                <div key={j.name} className="p-1.5 rounded-lg bg-zinc-900/30 dark:bg-white/[0.02] flex items-center justify-between gap-1">
                  <div className="min-w-0">
                    <div className="text-[10px] text-zinc-200 dark:text-white truncate">{j.name}</div>
                    <div className="text-[8.5px] text-zinc-500">{j.schedule} · {j.last ? ago(j.last) : 'never ran'}</div>
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    {onToggleJob && <button type="button" onClick={() => onToggleJob(j.name)} className="px-1 py-0.5 rounded text-[8.5px] text-zinc-400 bg-white/[0.04] border border-white/[0.06]">{j.paused ? 'resume' : 'pause'}</button>}
                    {onRunJob && <button type="button" onClick={() => onRunJob(j.name)} className="px-1 py-0.5 rounded text-[8.5px] text-zinc-400 bg-white/[0.04] border border-white/[0.06]">run</button>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* sessions: conversation-style list, caller-first */}
        <section className={`bg-zinc-900/20 dark:bg-white/[0.02] border rounded-xl p-2.5 space-y-2 font-mono ${borderCls}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
            <span className="font-medium text-zinc-200 dark:text-white font-sans">Sessions</span>
            <div className="flex items-center gap-0.5 bg-zinc-900/30 dark:bg-white/[0.03] p-0.5 rounded-lg border ${borderCls} text-[9px]">
              {([
                ['all', `all ${snap.sessions.length}`],
                ['active', `running ${running.length}`],
                ['blocked', `blocked ${blocked.length}`],
                ['done', `done ${done.length}`],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setFilter(key)} className={`px-1.5 py-0.5 rounded ${filter === key ? 'bg-white/[0.1] text-white dark:text-black' : mutedCls} hover:text-zinc-100 dark:hover:text-white`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {visibleSessions.length === 0 && <div className="text-[10px] text-zinc-500">no sessions in this view</div>}

          <ul className="space-y-1.5">
            {visibleSessions.map((s) => {
              const open = openId === s.id;
              const c = s.cooked;
              const attempts = (s.steps ?? []).filter((st) => st.stage === 'dispatched' || st.stage === 'failover').length;
              const runCls = `rounded-lg bg-zinc-900/30 dark:bg-white/[0.02] border ${isRunning(s) ? 'border-amber-400/30' : borderCls}`;
              return (
                <li key={s.id} className={runCls}>
                  <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : s.id)} className="w-full text-left p-2.5 flex items-start gap-2.5">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px]">
                        <span className="text-zinc-500">{clock(s.ts)}</span>
                        <span className={`text-[9.5px] font-semibold ${isRunning(s) ? 'text-amber-400' : 'text-zinc-200 dark:text-white'}`}>{s.caller ?? 'shell'}</span>
                        <span className="text-zinc-500">→</span>
                        <span className={`text-[9.5px] font-semibold text-emerald-400`}>{s.worker}</span>
                        {s.key && <span className="text-zinc-600">{s.key}</span>}
                      </div>
                      <p className="text-[11px] {textCls} font-sans leading-snug line-clamp-1">{s.prompt}</p>
                      {c && (
                        <div className="flex gap-x-2 gap-y-0.5 text-[9px] {mutedCls}">
                          <span>skill: {c.selected_skill}</span>
                          <span>·</span>
                          <span>gate: {c.gate_policy}</span>
                          {c.task_class && <span>· {c.task_class}</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <span className={`px-1.5 py-0.5 rounded border text-[8.5px] font-mono ${isRunning(s) ? 'text-amber-200 border-amber-400/40' : s.state === 'done' ? 'text-emerald-300 border-emerald-400/25' : ['blocked','escalated','failed'].includes(s.state) ? 'text-rose-300 border-rose-400/30' : 'text-zinc-300 border-white/[0.08]'}`}>{s.state}</span>
                      <span className="text-[9px] text-zinc-500">{s.duration_s.toFixed(1)}s · {ago(s.ts)}</span>
                      {attempts > 1 && <span className="text-[9px] text-zinc-400">{attempts} attempts</span>}
                    </div>
                  </button>

                  {open && (
                    <div className="px-2.5 pb-2.5 space-y-2.5 border-t pt-2.5">
                      {/* input */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-zinc-500">You (input)</div>
                        <p className="whitespace-pre-wrap break-words text-[11px] {textCls} leading-relaxed">{s.prompt}</p>
                      </div>

                      {/* router decision */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-zinc-500">Router (what it did)</div>
                        {c ? (
                          <dl className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5 text-[10px]">
                            <dt className="text-zinc-500">skill</dt><dd className="text-zinc-200 break-all">{c.selected_skill}</dd>
                            <dt className="text-zinc-500">command</dt><dd className="text-zinc-200 break-all">{c.selected_command}</dd>
                            <dt className="text-zinc-500">hook</dt><dd className="text-zinc-200">{c.selected_hook}</dd>
                            <dt className="text-zinc-500">gate</dt><dd className="text-zinc-200">{c.gate_policy}</dd>
                            <dt className="text-zinc-500">task class</dt><dd className="text-zinc-200">{c.task_class}</dd>
                            <dt className="text-zinc-500">context</dt><dd className="text-zinc-400 break-all">{c.retrieval_sources.join(' · ') || '—'}</dd>
                          </dl>
                        ) : (
                          <span className="text-[10px] text-zinc-500">not recorded for this run</span>
                        )}
                      </div>

                      {/* worker answer */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider {${
                          s.state === 'done' ? 'text-emerald-400' : isBlocked(s) ? 'text-rose-400' : 'text-zinc-500'
                        }}">{s.worker} (answer)</div>
                        <div className="relative">
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-950/60 dark:bg-white/[0.02] border border-white/[0.04] p-2 text-[10px] leading-relaxed text-zinc-200">
                            {s.output ?? s.reason ?? (isRunning(s) ? 'working…' : '—')}
                          </pre>
                          {s.output && (
                            <button type="button" onClick={() => copyText(s.output ?? '')} className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8.5px] text-zinc-400 bg-white/[0.05] border border-white/[0.08] hover:text-zinc-100">copy</button>
                          )}
                        </div>
                      </div>

                      {/* steps trace */}
                      {(s.steps ?? []).length > 0 && (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-zinc-500">Steps</div>
                          <ol className="space-y-0.5 pl-2 border-l border-white/[0.08] text-[10px]">
                            {(s.steps ?? []).map((st, i) => (
                              <li key={i} className="flex gap-1.5">
                                <span className="text-zinc-600 w-12 shrink-0">{clock(st.ts)}</span>
                                <span className={st.tone === 'warn' ? 'text-rose-300' : st.tone === 'done' ? 'text-emerald-300' : 'text-zinc-300'}>{st.title}</span>
                                {st.detail && <span className="text-zinc-500 truncate">{st.detail}</span>}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-zinc-500">
                        <span>receipt {s.receipt_id ?? '—'}</span>
                        <span>{s.tokens_in ?? 0} in · {s.tokens_out ?? 0} out</span>
                        {s.failover_from && <span>failover from {s.failover_from}</span>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {snap.sessions.length > 8 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[9.5px] text-zinc-400 hover:text-zinc-100">
              {showAll ? 'show fewer' : `show all ${snap.sessions.length}`}
            </button>
          )}
        </section>

        <footer className="flex items-center justify-between gap-3 pt-1 text-[9px] font-mono {mutedCls}">
          <span>~/.lingonberry/config.json · poll 2s</span>
          <span>{snap.system.app_ram_gb != null ? `app ${snap.system.app_ram_gb.toFixed(2)} GB` : ''}</span>
        </footer>
      </div>
    </section>
  );
};
