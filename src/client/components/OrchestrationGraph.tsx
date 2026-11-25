import React from 'react';
import { AlertTriangle, Check, GitFork, ShieldAlert, Terminal } from 'lucide-react';
import type { LiveWorker, SessionRow, WorkerStatus } from '../../types';

interface OrchestrationGraphProps {
  workers: WorkerStatus[];
  workersLive: LiveWorker[];
  sessions: SessionRow[];
  activeSessionId: string | null;
  onSelectSession?: (sessionId: string) => void;
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
  if (callers.length === 0) callers.push('claude', 'codex');

  // Show distinct worker slots up to 4 (prefer active/down slots first)
  const sortedWorkers = [...workers].sort((a, b) => {
    const rank = (s: WorkerStatus['status']) => (s === 'active' ? 0 : s === 'down' ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });
  const displayWorkers = sortedWorkers.slice(0, 4);

  const selectedSession =
    sessions.find((s) => s.id === activeSessionId) ??
    sessions.find((s) => s.state === 'running') ??
    sessions[0] ??
    null;

  const activeWorkerKeys = new Set(workersLive.map((w) => w.key || w.worker));
  const passedCount = sessions.filter((s) => s.state === 'done').length;
  const blockedCount = sessions.filter(
    (s) => s.state === 'blocked' || s.state === 'escalated' || s.state === 'failed'
  ).length;
  const runningCount = workersLive.length;

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-3 border-b border-zinc-200/80 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              runningCount > 0 ? 'bg-sky-500' : 'bg-emerald-500'
            }`}
          />
          <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-700 dark:text-slate-200">
            Orchestration Graph
          </span>
        </div>
        <span className="text-[10.5px] font-mono tabular-nums text-zinc-500 dark:text-slate-400">
          Callers → Cook &amp; Lease → Workers ({runningCount} active) → Gates
        </span>
      </div>

      {/* 4-Column Concurrent Routing Matrix */}
      <div className="relative grid grid-cols-12 items-center gap-2.5 min-h-[164px]">
        {/* Crisp SVG Bezier Connectors behind nodes (desktop/tablet) */}
        <svg
          className="hidden sm:block pointer-events-none absolute inset-0 w-full h-full"
          viewBox="0 0 800 164"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Col 1 Callers -> Col 2 Router Core */}
          {callers.map((caller, idx) => {
            const count = callers.length;
            const y1 = count === 1 ? 90 : 48 + (idx * 84) / Math.max(1, count - 1);
            const linked = recentSessions.find((s) => (s.caller || 'claude') === caller);
            const isSelected = Boolean(linked && selectedSession?.id === linked.id);
            const isLiveCaller = workersLive.some((w) => (w.caller || 'claude') === caller);
            const strokeColor = isLiveCaller
              ? '#0284c7'
              : isSelected
                ? '#d97706'
                : undefined;

            return (
              <path
                key={`c-${caller}`}
                d={`M 185 ${y1} C 235 ${y1}, 250 90, 290 90`}
                fill="none"
                stroke={strokeColor ?? 'currentColor'}
                className={
                  strokeColor
                    ? isLiveCaller
                      ? 'flow-stream-active'
                      : ''
                    : 'text-zinc-300 dark:text-white/[0.12]'
                }
                strokeWidth={isLiveCaller || isSelected ? '1.75' : '1.15'}
              />
            );
          })}

          {/* Col 2 Router Core -> Col 3 Worker Slots */}
          {displayWorkers.map((w, idx) => {
            const count = Math.max(1, displayWorkers.length);
            const y2 = count === 1 ? 90 : 38 + (idx * 104) / Math.max(1, count - 1);
            const isLive = w.status === 'active' || activeWorkerKeys.has(w.name);
            const isSelected =
              selectedSession?.key === w.name || selectedSession?.worker === w.name;
            const strokeColor =
              w.status === 'down'
                ? '#d97706'
                : isLive
                  ? '#0284c7'
                  : isSelected
                    ? '#10b981'
                    : undefined;

            return (
              <path
                key={`w-${w.name}`}
                d={`M 412 90 C 446 90, 456 ${y2}, 488 ${y2}`}
                fill="none"
                stroke={strokeColor ?? 'currentColor'}
                className={
                  strokeColor
                    ? isLive
                      ? 'flow-stream-active'
                      : ''
                    : 'text-zinc-300 dark:text-white/[0.12]'
                }
                strokeWidth={isLive || isSelected ? '1.75' : '1.15'}
              />
            );
          })}

          {/* Col 3 Worker Slots -> Col 4 Gates */}
          {displayWorkers.map((w, idx) => {
            const count = Math.max(1, displayWorkers.length);
            const y1 = count === 1 ? 90 : 38 + (idx * 104) / Math.max(1, count - 1);
            const targetY = w.status === 'down' ? 124 : w.status === 'active' ? 88 : 52;
            const isLive = w.status === 'active' || activeWorkerKeys.has(w.name);
            const strokeColor =
              w.status === 'down'
                ? '#d97706'
                : isLive
                  ? '#0284c7'
                  : undefined;

            return (
              <path
                key={`g-${w.name}`}
                d={`M 656 ${y1} C 674 ${y1}, 678 ${targetY}, 696 ${targetY}`}
                fill="none"
                stroke={strokeColor ?? 'currentColor'}
                className={
                  strokeColor
                    ? isLive
                      ? 'flow-stream-active'
                      : ''
                    : 'text-zinc-300 dark:text-white/[0.12]'
                }
                strokeWidth={isLive ? '1.6' : '1.1'}
              />
            );
          })}
        </svg>

        {/* Col 1: Callers */}
        <div className="col-span-12 sm:col-span-3 flex flex-col gap-1.5 z-10">
          <div className="text-[9.5px] font-mono uppercase tracking-wider text-zinc-400 dark:text-slate-500 pb-0.5">
            Callers
          </div>
          {callers.map((caller) => {
            const linked = recentSessions.find((s) => (s.caller || 'claude') === caller);
            const isSelected = Boolean(linked && selectedSession?.id === linked.id);
            const isLiveCaller = workersLive.some((w) => (w.caller || 'claude') === caller);
            return (
              <button
                key={caller}
                type="button"
                onClick={() => linked && onSelectSession?.(linked.id)}
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
                  isSelected
                    ? 'border-amber-500/50 bg-amber-50/70 dark:bg-amber-500/[0.08] dark:border-amber-400/40'
                    : 'border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#0c0e14] hover:border-zinc-300 dark:hover:border-white/[0.16]'
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <Terminal className="w-3 h-3 shrink-0 text-zinc-400 dark:text-slate-500" />
                  <span className="text-[11px] font-mono font-medium truncate text-zinc-800 dark:text-slate-200">
                    {caller}
                  </span>
                </span>
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isLiveCaller
                      ? 'bg-sky-500'
                      : isSelected
                        ? 'bg-amber-500'
                        : 'bg-emerald-500/75'
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* Col 2: Core Router */}
        <div className="col-span-12 sm:col-span-3 flex flex-col items-center justify-center z-10">
          <div className="text-[9.5px] font-mono uppercase tracking-wider text-zinc-400 dark:text-slate-500 pb-0.5 mb-1.5">
            Core Router
          </div>
          <div className="w-full max-w-[164px] p-3 rounded-xl border border-emerald-500/35 bg-zinc-50 dark:bg-[#0c0e14] text-center shadow-xs">
            <div className="flex items-center justify-center gap-1.5">
              <GitFork className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-zinc-900 dark:text-white">
                Cook · Lease
              </span>
            </div>
            <div className="text-[10px] font-mono text-zinc-500 dark:text-slate-400 mt-1">
              skill · keypool · gate
            </div>
            <div className="mt-1 text-[10px] font-mono font-medium text-emerald-700 dark:text-emerald-400">
              127.0.0.1:8799
            </div>
          </div>
        </div>

        {/* Col 3: Workers / Provider Slots */}
        <div className="col-span-12 sm:col-span-4 flex flex-col gap-1.5 z-10">
          <div className="text-[9.5px] font-mono uppercase tracking-wider text-zinc-400 dark:text-slate-500 pb-0.5">
            Workers / Key Slots
          </div>
          {displayWorkers.map((w) => {
            const isLive = w.status === 'active' || activeWorkerKeys.has(w.name);
            const isDown = w.status === 'down';
            return (
              <div
                key={w.name}
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
                  isLive
                    ? 'border-sky-500/40 bg-sky-50/60 dark:bg-sky-500/[0.08]'
                    : isDown
                      ? 'border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/[0.08]'
                      : 'border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#0c0e14]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isDown ? 'bg-amber-500' : isLive ? 'bg-sky-500' : 'bg-emerald-500'
                    }`}
                  />
                  <span className="text-[11px] font-mono font-medium truncate text-zinc-800 dark:text-slate-200">
                    {w.name}
                  </span>
                </div>
                <span className="text-[10px] font-mono tabular-nums shrink-0 text-zinc-500 dark:text-slate-400">
                  {isDown
                    ? `cool ${w.cooling_remaining_s ?? 0}s`
                    : `${w.rpm_limit ?? 40} RPM`}
                </span>
              </div>
            );
          })}
        </div>

        {/* Col 4: Gates & Outcomes */}
        <div className="col-span-12 sm:col-span-2 flex sm:flex-col gap-1.5 z-10">
          <div className="hidden sm:block text-[9.5px] font-mono uppercase tracking-wider text-zinc-400 dark:text-slate-500 pb-0.5">
            Gates &amp; Outcome
          </div>
          <div
            title={`Passed runs: ${passedCount}`}
            className="flex-1 flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300"
          >
            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold">
              <Check className="w-3 h-3" /> PASS
            </span>
            <span className="text-[10.5px] font-mono tabular-nums font-semibold">
              {passedCount}
            </span>
          </div>

          <div
            title={`In-flight workers: ${runningCount}`}
            className="flex-1 flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border border-sky-500/25 bg-sky-500/[0.08] text-sky-700 dark:text-sky-300"
          >
            <span className="text-[10px] font-mono font-medium">ACTIVE</span>
            <span className="text-[10.5px] font-mono tabular-nums font-semibold">
              {runningCount}
            </span>
          </div>

          <div
            title={`Blocked / Failed / Escalated runs: ${blockedCount}`}
            className="flex-1 flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300"
          >
            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium">
              {blockedCount > 0 ? (
                <ShieldAlert className="w-3 h-3" />
              ) : (
                <AlertTriangle className="w-3 h-3" />
              )}
              GATE
            </span>
            <span className="text-[10.5px] font-mono tabular-nums font-semibold">
              {blockedCount}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
