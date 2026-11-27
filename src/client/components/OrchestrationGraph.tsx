import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LiveWorker, SessionRow, WorkerStatus } from '../../types';

interface OrchestrationGraphProps {
  workers: WorkerStatus[];
  workersLive: LiveWorker[];
  sessions: SessionRow[];
  activeSessionId: string | null;
  onSelectSession?: (sessionId: string) => void;
}

type Pt = { x: number; y: number };
type Edge = { id: string; d: string; live: boolean };

function curve(a: Pt, b: Pt): string {
  const dx = (b.x - a.x) / 2;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function sameEdges(a: Edge[], b: Edge[]): boolean {
  return (
    a.length === b.length &&
    a.every((e, i) => e.id === b[i].id && e.d === b[i].d && e.live === b[i].live)
  );
}

export const OrchestrationGraph: React.FC<OrchestrationGraphProps> = ({
  workers,
  workersLive,
  sessions,
  activeSessionId,
  onSelectSession,
}) => {
  const activeSessions = sessions.filter((s) => s.state === 'running' || s.state === 'leased');

  // Callers = who initiated work (left column). Derived from live data only.
  const callers = Array.from(
    new Set(
      [...activeSessions, ...workersLive]
        .map((x) => x.caller)
        .filter((c): c is string => Boolean(c) && c !== 'shell')
    )
  );
  if (callers.length === 0 && sessions.length > 0) {
    callers.push(sessions[0].caller ?? 'shell');
  }

  // Workers = who executes (right column). From live workers + active sessions.
  const liveWorkerIds = new Set(
    workersLive.flatMap((w) => [w.worker, w.key].filter((v): v is string => Boolean(v)))
  );
  const activeWorkerIds = new Set(activeSessions.map((s) => s.worker).filter(Boolean));
  const allWorkerIds = new Set([...liveWorkerIds, ...activeWorkerIds]);
  const displayWorkers = workers.filter((w) => allWorkerIds.has(w.name) || w.status === 'down');

  const passedCount = sessions.filter((s) => s.state === 'done').length;
  const blockedCount = sessions.filter(
    (s) => s.state === 'blocked' || s.state === 'escalated' || s.state === 'failed'
  ).length;
  const runningCount = workersLive.length;

  const boxRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const callerRefs = useRef(new Map<string, HTMLButtonElement>());
  const workerRefs = useRef(new Map<string, HTMLLIElement>());
  const [edges, setEdges] = useState<Edge[]>([]);

  const measure = () => {
    const box = boxRef.current;
    const hub = hubRef.current;
    if (!box || !hub) return;
    const origin = box.getBoundingClientRect();
    const rel = (r: DOMRect, x: number): Pt => ({ x: x - origin.left, y: r.top + r.height / 2 - origin.top });
    const hr = hub.getBoundingClientRect();
    const hubPt: Pt = { x: hr.left + hr.width / 2 - origin.left, y: hr.top + hr.height / 2 - origin.top };

    const next: Edge[] = [];
    for (const caller of callers) {
      const el = callerRefs.current.get(caller);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next.push({ id: `c-${caller}`, d: curve(rel(r, r.right), hubPt), live: true });
    }
    for (const w of displayWorkers) {
      const el = workerRefs.current.get(w.name);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const isLive = liveWorkerIds.has(w.name) || activeWorkerIds.has(w.name);
      next.push({ id: `w-${w.name}`, d: curve(hubPt, rel(r, r.left)), live: isLive });
    }
    setEdges((prev) => (sameEdges(prev, next) ? prev : next));
  };

  useLayoutEffect(() => {
    measure();
  });
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const hasFlow = callers.length > 0 || displayWorkers.length > 0;

  return (
    <section
      className={`rounded-xl border p-3.5 ${
        document.documentElement.classList.contains('dark')
          ? 'border-white/[0.08] bg-[#11131b]'
          : 'border-zinc-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-700 dark:text-slate-200">
          Orchestration Graph
        </h2>
        <span className="text-[10.5px] font-mono tabular-nums text-zinc-500 dark:text-slate-400">
          {passedCount} pass · {runningCount} active · {blockedCount} gate
        </span>
      </div>

      <div ref={boxRef} className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-x-6 min-h-[150px]">
        <svg
          className="pointer-events-none absolute inset-0 w-full h-full overflow-visible"
          aria-hidden="true"
        >
          {edges.map((e) => (
            <path
              key={e.id}
              d={e.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={e.live ? 1.5 : 1}
              strokeLinecap="round"
              className={`${
                e.live ? 'text-sky-500 dark:text-sky-400' : 'text-zinc-300 dark:text-white/[0.14]'
              }`}
              strokeDasharray={e.live ? '5 5' : undefined}
              style={e.live ? { animation: 'dash 1.1s linear infinite' } : undefined}
            />
          ))}
        </svg>

        {/* Callers: who initiated the work */}
        <ul className="relative flex flex-col gap-2 min-w-0">
          {callers.length === 0 && !hasFlow && (
            <li className="py-1 text-[11px] font-mono text-zinc-500 dark:text-slate-400">
              No active callers
            </li>
          )}
          {callers.map((caller) => {
            const linked = sessions.find((s) => s.caller === caller && s.state !== 'done');
            const isSelected = Boolean(linked && activeSessionId === linked.id);
            const btnCls = isSelected
              ? 'text-zinc-900 dark:text-white bg-amber-500/10 dark:bg-amber-500/20'
              : 'text-zinc-600 dark:text-slate-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/[0.04]';
            const dotCls = linked ? 'bg-sky-500' : 'bg-zinc-400 dark:bg-slate-500';
            const disabledCls = linked ? '' : 'cursor-default opacity-50';
            return (
              <li key={caller}>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) callerRefs.current.set(caller, el);
                    else callerRefs.current.delete(caller);
                  }}
                  onClick={() => linked && onSelectSession?.(linked.id)}
                  disabled={!linked}
                  className={`flex items-center gap-2 max-w-full rounded-md px-1 py-0.5 text-[11px] font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 transition-colors ${btnCls} ${disabledCls}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
                  <span className="truncate">{caller}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Router: single hub. Every dispatch passes through it. */}
        <div className="relative flex items-center justify-center">
          <div
            ref={hubRef}
            title="lingonberry-core · 127.0.0.1:8799"
            className={`w-3 h-3 rounded-full ring-4 transition-all ${
              runningCount > 0 ? 'bg-sky-500 ring-sky-500/25 animate-pulse' : 'bg-emerald-500 ring-emerald-500/20'
            }`}
          />
        </div>

        {/* Workers: who executes */}
        <ul className="relative flex flex-col min-w-0 divide-y divide-zinc-200/70 dark:divide-white/[0.06]">
          {displayWorkers.length === 0 && !hasFlow && (
            <li className="py-1 text-[11px] font-mono text-zinc-500 dark:text-slate-400">
              {workers.length === 0 ? 'No workers discovered' : 'All workers idle'}
            </li>
          )}
          {displayWorkers.map((w) => {
            const live = liveWorkerIds.has(w.name) || activeWorkerIds.has(w.name);
            const down = w.status === 'down';
            return (
              <li key={w.name} className="flex items-center justify-between gap-3 py-1">
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      down ? 'bg-amber-500' : live ? 'bg-sky-500' : 'bg-emerald-500'
                    }`}
                  />
                  <span className="text-[11px] font-mono truncate text-zinc-800 dark:text-slate-200">
                    {w.name}
                  </span>
                </span>
                <span
                  className={`text-[10.5px] font-mono tabular-nums shrink-0 ${
                    down ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-slate-400'
                  }`}
                >
                  {down ? `cooling ${w.cooling_remaining_s ?? 0}s` : live ? 'live' : 'idle'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {hasFlow && (
        <p className="mt-2 text-[10px] font-mono text-zinc-500 dark:text-slate-400 text-center">
          {callers.length} caller → router → {displayWorkers.filter((w) => w.status !== 'down').length} worker
        </p>
      )}
    </section>
  );
};
