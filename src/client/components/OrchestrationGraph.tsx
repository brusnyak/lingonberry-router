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

// Horizontal S-curve between two points, in px relative to the graph box.
function curve(a: Pt, b: Pt): string {
  const dx = (b.x - a.x) / 2;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function sameEdges(a: Edge[], b: Edge[]): boolean {
  return a.length === b.length && a.every((e, i) => e.id === b[i].id && e.d === b[i].d && e.live === b[i].live);
}

export const OrchestrationGraph: React.FC<OrchestrationGraphProps> = ({
  workers,
  workersLive,
  sessions,
  activeSessionId,
  onSelectSession,
}) => {
  const recentSessions = sessions.slice(0, 6);
  const callers = Array.from(
    new Set(recentSessions.map((s) => s.caller || 'claude').filter(Boolean))
  ).slice(0, 3);
  if (callers.length === 0) callers.push('claude');

  const sortedWorkers = [...workers].sort((a, b) => {
    const rank = (s: WorkerStatus['status']) => (s === 'active' ? 0 : s === 'down' ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });

  const selectedSession =
    sessions.find((s) => s.id === activeSessionId) ??
    sessions.find((s) => s.state === 'running') ??
    sessions[0] ??
    null;

  const liveCallers = new Set(workersLive.map((w) => w.caller || 'claude'));
  const liveWorkerIds = new Set(
    workersLive.flatMap((w) => [w.worker, w.key].filter((v): v is string => Boolean(v)))
  );
  const isWorkerLive = (w: WorkerStatus) => w.status === 'active' || liveWorkerIds.has(w.name);
  // Idle workers are not drawn: the graph shows only what is running or cooling down.
  const displayWorkers = sortedWorkers.filter((w) => isWorkerLive(w) || w.status === 'down');

  const passedCount = sessions.filter((s) => s.state === 'done').length;
  const blockedCount = sessions.filter(
    (s) => s.state === 'blocked' || s.state === 'escalated' || s.state === 'failed'
  ).length;
  const runningCount = workersLive.length;

  // Edges are measured from the rendered nodes, so every line starts and ends on a real element.
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
      next.push({ id: `c-${caller}`, d: curve(rel(r, r.right), hubPt), live: liveCallers.has(caller) });
    }
    for (const w of displayWorkers) {
      const el = workerRefs.current.get(w.name);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next.push({ id: `w-${w.name}`, d: curve(hubPt, rel(r, r.left)), live: isWorkerLive(w) });
    }
    setEdges((prev) => (sameEdges(prev, next) ? prev : next));
  };

  // Re-measure after each render (setEdges bails out when nothing moved) and on resize.
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

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] p-3.5">
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
          className="hidden sm:block pointer-events-none absolute inset-0 w-full h-full overflow-visible"
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
              className={e.live ? 'text-sky-500 dark:text-sky-400' : 'text-zinc-300 dark:text-white/[0.14]'}
            />
          ))}
        </svg>

        {/* Callers */}
        <ul className="relative flex flex-col gap-2.5 min-w-0">
          {callers.map((caller) => {
            const linked = recentSessions.find((s) => (s.caller || 'claude') === caller);
            const isSelected = Boolean(linked && selectedSession?.id === linked.id);
            const isLive = liveCallers.has(caller);
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
                  className={`flex items-center gap-2 max-w-full rounded-md px-1 py-0.5 text-[11.5px] font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${
                    isSelected ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-slate-300'
                  } ${linked ? 'hover:text-zinc-900 dark:hover:text-white' : 'cursor-default'}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isLive ? 'bg-sky-500' : isSelected ? 'bg-amber-500' : 'bg-zinc-400 dark:bg-slate-500'
                    }`}
                  />
                  <span className="truncate">{caller}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Router: one dot. Every dispatch passes through it. */}
        <div className="relative flex items-center justify-center">
          <div
            ref={hubRef}
            title="lingonberry-core · 127.0.0.1:8799"
            className={`w-2.5 h-2.5 rounded-full ring-4 ${
              runningCount > 0
                ? 'bg-sky-500 ring-sky-500/15'
                : 'bg-emerald-500 ring-emerald-500/15'
            }`}
          />
        </div>

        {/* Workers */}
        <ul className="relative flex flex-col min-w-0 divide-y divide-zinc-200/70 dark:divide-white/[0.06]">
          {displayWorkers.length === 0 && (
            <li className="py-1 text-[11.5px] font-mono text-zinc-500 dark:text-slate-400">
              {workers.length === 0 ? 'No workers discovered' : `All ${workers.length} idle`}
            </li>
          )}
          {displayWorkers.map((w) => {
            const live = isWorkerLive(w);
            const down = w.status === 'down';
            return (
              <li
                key={w.name}
                ref={(el) => {
                  if (el) workerRefs.current.set(w.name, el);
                  else workerRefs.current.delete(w.name);
                }}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      down ? 'bg-amber-500' : live ? 'bg-sky-500' : 'bg-emerald-500'
                    }`}
                  />
                  <span className="text-[11.5px] font-mono truncate text-zinc-800 dark:text-slate-200">{w.name}</span>
                </span>
                <span
                  className={`text-[10.5px] font-mono tabular-nums shrink-0 ${
                    down ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-slate-400'
                  }`}
                >
                  {down ? `cooling ${w.cooling_remaining_s ?? 0}s` : 'running'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};
