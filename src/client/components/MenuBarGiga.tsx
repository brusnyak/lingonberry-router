import React, { useMemo, useState } from 'react';
import type { RouterRuntimeState } from '../lib/routerClient';
import type { SessionRow, SessionStep, WorkerStatus } from '../../types';

/*
 * Menu bar (Giga reference layout). Idle by default: with nothing running the graph shows only the
 * router. Callers, workers and gates appear when work is running. Live data throughout.
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

  // Callers of work that is running now (idle graph shows none).
  const activeCallers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of running) {
      const c = s.caller ?? 'shell';
      seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    return Array.from(seen.entries());
  }, [running]);

  // Providers, with every key listed (no slicing).
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

  return (
    <section className="w-[900px] max-w-full rounded-2xl bg-[#0f1118] text-slate-200 border border-white/[0.08] shadow-popover overflow-hidden flex flex-col">
      <style>{`
        @keyframes lb-flow { to { stroke-dashoffset: -20; } }
        .lb-flow { stroke-dasharray: 5 5; animation: lb-flow 1.1s linear infinite; }
      `}</style>

      {/* header */}
      <header className="px-4 py-3 bg-[#13151f] border-b border-white/[0.07] flex items-center justify-between select-none">
        <div className="flex items-center space-x-3">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="2.5"></circle>
              <path d="M12 2v3m0 14v3M2 12h3m14 0h3m-3.8-6.8l-2.1 2.1m-6.4 6.4l-2.1 2.1m0-10.6l2.1 2.1m6.4 6.4l2.1 2.1"></path>
            </svg>
          </div>
          <h1 className="text-[13px] font-semibold tracking-tight text-white font-mono">Lingonberry Router</h1>
        </div>
        <div className="flex items-center space-x-2.5">
          <span className="hidden sm:inline text-[10px] font-mono text-zinc-500">127.0.0.1:8799</span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${hasActive ? 'text-amber-300 border-amber-400/30 bg-amber-400/10' : 'text-zinc-400 border-white/[0.08] bg-white/[0.03]'}`}>
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

      <div className="p-3.5 space-y-3.5 overflow-y-auto max-h-[88vh]">
        {/* summary: plain text, no bars */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 font-mono text-[11px] text-zinc-400">
          <span>running <span className={hasActive ? 'text-amber-300' : 'text-zinc-200'}>{running.length}</span></span>
          <span>avg <span className="text-zinc-200">{snap.overview.avg_duration_s == null ? '—' : dur(snap.overview.avg_duration_s)}</span></span>
          <span>cost <span className="text-zinc-500">not measured</span></span>
          <span>success <span className="text-zinc-200">{successPct == null ? '—' : `${successPct.toFixed(0)}%`}</span></span>
          <span className="ml-auto text-zinc-500">{snap.sessions.length} tasks · 24h</span>
        </div>

        {/* graph */}
        <section className="bg-[#11131b] border border-white/[0.07] rounded-xl p-4">
          {!hasActive ? (
            <div className="flex flex-col items-center justify-center py-5 gap-2">
              <div className="px-5 py-2.5 rounded-xl border border-white/[0.1] bg-[#0c0e14] text-[12px] font-mono text-zinc-300">Router</div>
              <span className="text-[10px] font-mono text-zinc-600">idle · nothing running</span>
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
              <Wire />
              <div className="px-4 py-3 rounded-xl border border-amber-400/40 bg-amber-400/[0.07] text-center">
                <div className="text-[12px] font-mono font-semibold text-amber-200">Router</div>
                <div className="text-[10px] font-mono text-amber-300/70 mt-0.5">{running.length} dispatching</div>
              </div>
              <Wire />
              <div className="space-y-2">
                {snap.workers_live.map((w) => (
                  <div key={w.pid} className="px-3 py-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] flex items-center justify-between text-[11px] font-mono">
                    <span className="text-amber-200 truncate">{w.worker}</span>
                    <span className="text-amber-300/70 truncate ml-2">{w.key ?? ''}</span>
                  </div>
                ))}
                {activeProviders.length === 0 && snap.workers_live.length === 0 && <div className="text-[10px] font-mono text-zinc-600">no worker yet</div>}
                <div className="pt-1 space-y-1">
                  {gateFail + gatePass > 0 && (
                    <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                      <span>gates</span>
                      <span><span className="text-emerald-300">{gatePass} pass</span> · <span className={gateFail ? 'text-rose-300' : 'text-zinc-600'}>{gateFail} fail</span></span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* workers, providers, router jobs */}
        <div className="grid grid-cols-12 gap-3">
          <section className="col-span-12 md:col-span-4 bg-[#11131b] border border-white/[0.07] rounded-xl p-3">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06] mb-2.5 text-xs">
              <span className="font-medium text-zinc-200">Workers</span>
              <span className="text-[10px] text-zinc-500 font-mono">{snap.workers_live.length} running · {snap.workers.length} keys</span>
            </div>
            <div className="space-y-2 font-mono">
              {snap.workers_live.map((w) => (
                <div key={w.pid} className="p-2 rounded-lg bg-[#0c0e14] border border-amber-400/25 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-amber-200">{w.worker}</span>
                    <button type="button" onClick={() => onKillWorker(w.pid)} className="px-1.5 py-0.5 rounded text-[9px] text-zinc-400 hover:text-rose-300 bg-white/[0.04] border border-white/[0.06]">stop</button>
                  </div>
                  <p className="text-[10px] text-zinc-400 truncate">{w.task}</p>
                </div>
              ))}
              {snap.workers.map((w) => (
                <div key={w.name} className="px-2 py-1.5 rounded-lg bg-[#0c0e14] flex items-center justify-between text-[10.5px]">
                  <span className="text-zinc-300 truncate" title={w.name}>{w.key ?? w.name}</span>
                  <span className={`text-[9.5px] shrink-0 ml-2 ${w.status === 'down' ? 'text-rose-300' : 'text-zinc-500'}`}>
                    {w.status === 'down' ? `cooldown ${Math.round(w.cooling_remaining_s ?? 0)}s` : `${w.ok_24h} ok`}
                  </span>
                </div>
              ))}
              {snap.workers.length === 0 && <div className="text-[10px] text-zinc-600">none discovered</div>}
            </div>
          </section>

          <section className="col-span-12 md:col-span-4 bg-[#11131b] border border-white/[0.07] rounded-xl p-3">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06] mb-2.5 text-xs">
              <span className="font-medium text-zinc-200">Providers</span>
              <span className="text-[10px] text-zinc-500 font-mono">{providers.length} · calls / min</span>
            </div>
            <div className="space-y-2 font-mono">
              {providers.map((p) => {
                const pct = p.rpm ? Math.min(100, Math.round((p.inflight / p.rpm) * 100)) : 0;
                return (
                  <div key={p.provider} className="p-2 rounded-lg bg-[#0c0e14] space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-200">{p.provider}</span>
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-300">
                        <button type="button" aria-label={`lower ${p.provider} limit`} onClick={() => onAdjustProviderRpm(p.provider, Math.max(5, p.rpm - 5))} className="w-4 h-4 rounded border border-white/[0.08] hover:bg-white/[0.06]">−</button>
                        <span className="w-14 text-center">{p.rpm}/min</span>
                        <button type="button" aria-label={`raise ${p.provider} limit`} onClick={() => onAdjustProviderRpm(p.provider, Math.min(300, p.rpm + 5))} className="w-4 h-4 rounded border border-white/[0.08] hover:bg-white/[0.06]">+</button>
                      </div>
                    </div>
                    <div className="h-px w-full bg-white/[0.06]">
                      <div className="h-px bg-amber-400/70" style={{ width: `${pct}%` }}></div>
                    </div>
                    <div className="text-[9.5px] text-zinc-500">{p.workers.length} key{p.workers.length === 1 ? '' : 's'} · {p.calls} calls 24h</div>
                  </div>
                );
              })}
              {providers.length === 0 && <div className="text-[10px] text-zinc-600">none</div>}
            </div>
          </section>

          <section className="col-span-12 md:col-span-4 bg-[#11131b] border border-white/[0.07] rounded-xl p-3">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06] mb-2.5 text-xs">
              <span className="font-medium text-zinc-200">Router jobs</span>
              <span className="text-[10px] text-zinc-500 font-mono">{routerJobs.length}</span>
            </div>
            <div className="space-y-2 font-mono">
              {routerJobs.length === 0 && <div className="text-[10px] text-zinc-600">none configured</div>}
              {routerJobs.map((j) => (
                <div key={j.name} className="p-2 rounded-lg bg-[#0c0e14] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-zinc-200 truncate">{j.name}</div>
                    <div className="text-[9.5px] text-zinc-500">{j.schedule} · {j.last ? ago(j.last) : 'never ran'}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {onToggleJob && <button type="button" onClick={() => onToggleJob(j.name)} className="px-1.5 py-0.5 rounded text-[9px] text-zinc-400 bg-white/[0.04] border border-white/[0.06]">{j.paused ? 'resume' : 'pause'}</button>}
                    {onRunJob && <button type="button" onClick={() => onRunJob(j.name)} className="px-1.5 py-0.5 rounded text-[9px] text-zinc-400 bg-white/[0.04] border border-white/[0.06]">run</button>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* sessions: conversation view */}
        <section className="bg-[#11131b] border border-white/[0.07] rounded-xl p-3.5 space-y-3 font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-zinc-200 font-sans">Sessions</span>
            <div className="flex items-center gap-0.5 bg-[#0c0e14] p-0.5 rounded-lg border border-white/[0.06] text-[10px]">
              {([
                ['all', `all ${snap.sessions.length}`],
                ['active', `running ${running.length}`],
                ['blocked', `blocked ${blocked.length}`],
                ['done', `done ${done.length}`],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setFilter(key)} className={`px-2 py-0.5 rounded ${filter === key ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-100'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {visibleSessions.length === 0 && <div className="text-[11px] text-zinc-600">no sessions in this view</div>}

          <ul className="space-y-2">
            {visibleSessions.map((s) => {
              const open = openId === s.id;
              const c = s.cooked;
              const attempts = (s.steps ?? []).filter((st) => st.stage === 'dispatched' || st.stage === 'failover').length;
              return (
                <li key={s.id} className={`rounded-lg bg-[#0c0e14] border ${isRunning(s) ? 'border-amber-400/30' : 'border-white/[0.06]'}`}>
                  <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : s.id)} className="w-full text-left p-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]">
                        <span className="text-zinc-500">{clock(s.ts)}</span>
                        <span className="text-zinc-100">{s.worker}</span>
                        <span className="text-zinc-500">via {s.caller ?? 'shell'}</span>
                        {s.key && <span className="text-zinc-600">{s.key}</span>}
                      </div>
                      <p className="text-[12px] text-zinc-200 font-sans leading-snug line-clamp-1">{s.prompt}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StateTag state={s.state} />
                      <span className="text-[10px] text-zinc-500">{s.duration_s.toFixed(1)}s · {ago(s.ts)}</span>
                      {attempts > 1 && <span className="text-[10px] text-zinc-400">{attempts} attempts</span>}
                    </div>
                  </button>

                  {open && (
                    <div className="px-3 pb-3 space-y-3 border-t border-white/[0.05] pt-3">
                      {/* the prompt the user sent */}
                      <Turn label="You">
                        <p className="whitespace-pre-wrap break-words font-sans text-[12px] text-zinc-200 leading-relaxed">{s.prompt}</p>
                      </Turn>

                      {/* what the router did with it */}
                      <Turn label="Router">
                        {c ? (
                          <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-[11px]">
                            <dt className="text-zinc-500">class</dt><dd className="text-zinc-200">{c.task_class}</dd>
                            <dt className="text-zinc-500">skill</dt><dd className="text-zinc-200">{c.selected_skill}</dd>
                            <dt className="text-zinc-500">command</dt><dd className="text-zinc-200 break-all">{c.selected_command}</dd>
                            <dt className="text-zinc-500">hook</dt><dd className="text-zinc-200">{c.selected_hook}</dd>
                            <dt className="text-zinc-500">gate</dt><dd className="text-zinc-200">{c.gate_policy}</dd>
                            <dt className="text-zinc-500">loop</dt><dd className="text-zinc-200">{attempts || 1} attempt{attempts > 1 ? 's' : ''}</dd>
                            <dt className="text-zinc-500">context</dt><dd className="text-zinc-400 break-all">{c.retrieval_sources.join(' · ') || '—'}</dd>
                          </dl>
                        ) : (
                          <span className="text-[11px] text-zinc-500">not recorded for this run</span>
                        )}
                      </Turn>

                      {/* what the worker answered */}
                      <Turn label={s.worker} tone={s.state === 'done' ? 'ok' : isBlocked(s) ? 'bad' : 'idle'}>
                        <div className="relative">
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#090b0e] border border-white/[0.04] p-2.5 text-[11px] leading-relaxed text-zinc-200">
                            {s.output ?? s.reason ?? (isRunning(s) ? 'working…' : '—')}
                          </pre>
                          {s.output && (
                            <button type="button" onClick={() => copyText(s.output ?? '')} className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] text-zinc-400 bg-white/[0.05] border border-white/[0.08] hover:text-zinc-100">copy</button>
                          )}
                        </div>
                      </Turn>

                      {/* steps */}
                      {(s.steps ?? []).length > 0 && (
                        <ol className="space-y-1 pl-3 border-l border-white/[0.08] text-[10.5px]">
                          {(s.steps ?? []).map((st, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-zinc-600 w-14 shrink-0">{clock(st.ts)}</span>
                              <span className={st.tone === 'warn' ? 'text-rose-300' : st.tone === 'done' ? 'text-emerald-300' : 'text-zinc-300'}>{st.title}</span>
                              {st.detail && <span className="text-zinc-500 truncate">{st.detail}</span>}
                            </li>
                          ))}
                        </ol>
                      )}

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
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
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[10.5px] text-zinc-400 hover:text-zinc-100">
              {showAll ? 'show fewer' : `show all ${snap.sessions.length}`}
            </button>
          )}
        </section>

        <footer className="flex items-center justify-between gap-3 pt-1 text-[10px] font-mono text-zinc-600">
          <span>~/.lingonberry/config.json · poll 2s</span>
          <span>{snap.system.app_ram_gb != null ? `app ${snap.system.app_ram_gb.toFixed(2)} GB` : ''}</span>
        </footer>
      </div>
    </section>
  );
};

function Wire() {
  return (
    <svg width="44" height="14" viewBox="0 0 44 14" aria-hidden="true" className="justify-self-center">
      <path d="M0 7 H44" stroke="#fabb60" strokeOpacity={0.6} strokeWidth={1.25} fill="none" className="lb-flow" />
    </svg>
  );
}

function StateTag({ state }: { state: string }) {
  const cls =
    state === 'running' || state === 'leased'
      ? 'text-amber-200 border-amber-400/40'
      : state === 'done'
        ? 'text-emerald-300 border-emerald-400/25'
        : ['blocked', 'escalated', 'failed'].includes(state)
          ? 'text-rose-300 border-rose-400/30'
          : 'text-zinc-300 border-white/[0.08]';
  return <span className={`px-2 py-0.5 rounded border text-[10px] font-mono ${cls}`}>{state}</span>;
}

function Turn({ label, tone = 'idle', children }: { label: string; tone?: 'ok' | 'bad' | 'idle'; children: React.ReactNode }) {
  const labelTone = tone === 'ok' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-zinc-500';
  return (
    <div className="space-y-1">
      <div className={`text-[9.5px] font-mono uppercase tracking-[0.14em] ${labelTone}`}>{label}</div>
      {children}
    </div>
  );
}
