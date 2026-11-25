import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bolt,
  Check,
  Copy,
  Download,
  Filter,
  GitFork,
  LineChart,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';
import type { RouterRuntimeState } from '../lib/routerClient';
import { MenuBarGiga } from './MenuBarGiga';

export type MatrixPlatform = 'all' | 'macos' | 'linux' | 'windows';

interface WebsiteLandingProps {
  state: RouterRuntimeState;
  busy: boolean;
  onShowToast: (msg: string) => void;
  onOpenTelemetryModal: () => void;
  onOpenArchModal: () => void;
  onOpenDownloadModal: (os?: 'macos' | 'linux' | 'windows') => void;
  onNavigateTab: (tab: 'overview' | 'menubar' | 'cron' | 'agents' | 'docs') => void;
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
}

interface HudCallerNode {
  id: string;
  label: string;
  sub: string;
  startY: number;
  targetWorker: string;
  endY: number;
  dotClass: string;
}

const HUD_CALLERS: HudCallerNode[] = [
  {
    id: 'claude',
    label: 'claude',
    sub: 'skill · systematic',
    startY: 34,
    targetWorker: 'pi:NIM_1',
    endY: 34,
    dotClass: 'bg-emerald-400',
  },
  {
    id: 'codex',
    label: 'codex',
    sub: 'gate · worktree',
    startY: 94,
    targetWorker: 'groq:GROQ_API_KEY',
    endY: 94,
    dotClass: 'bg-amber-400',
  },
  {
    id: 'opencode',
    label: 'opencode',
    sub: 'lease · 40 RPM',
    startY: 154,
    targetWorker: 'gemini:GEMINI_API_KEY',
    endY: 154,
    dotClass: 'bg-sky-400',
  },
];

const MATRIX_ROWS: Array<{
  id: string;
  platform: 'macos' | 'linux' | 'windows';
  name: string;
  subtitle: string;
  dotClass: string;
  arch: string;
  targetPath: string;
  command: string;
  ctaLabel: string;
}> = [
  {
    id: 'macos-swift',
    platform: 'macos',
    name: 'macOS SwiftUI Menu Bar',
    subtitle: 'Native MenuBarExtra popover + process kill & cron oversight',
    dotClass: 'bg-[#e5a950]',
    arch: 'arm64 / x86_64',
    targetPath: 'ui/macos-swift/',
    command: 'cd ui/macos-swift && swift run LingonberryBar',
    ctaLabel: 'SwiftUI',
  },
  {
    id: 'rust-core-unix',
    platform: 'macos',
    name: 'Rust Core Daemon (macOS & POSIX)',
    subtitle: 'axum HTTP API (127.0.0.1:8799), SQLite WAL, KeyPool & CLI',
    dotClass: 'bg-emerald-400',
    arch: 'arm64 / x86_64',
    targetPath: 'core/',
    command: 'cd core && cargo install --path . && lingonberry-core init',
    ctaLabel: 'cargo',
  },
  {
    id: 'linux-gtk',
    platform: 'linux',
    name: 'Linux GTK4 + ksni System Tray',
    subtitle: 'StatusNotifierItem tray + systemd/crontab watchdog panel',
    dotClass: 'bg-sky-400',
    arch: 'x86_64 / arm64',
    targetPath: 'ui/linux/',
    command: 'cd ui/linux && cargo run --release',
    ctaLabel: 'GTK4',
  },
  {
    id: 'linux-daemon',
    platform: 'linux',
    name: 'Linux Core CLI & MCP Bridge',
    subtitle: 'Headless loopback server, systemd unit scan & MCP stdio',
    dotClass: 'bg-emerald-400',
    arch: 'x86_64 / arm64',
    targetPath: 'core/',
    command: 'cd core && cargo test && cargo install --path .',
    ctaLabel: 'CLI',
  },
  {
    id: 'windows-wpf',
    platform: 'windows',
    name: 'Windows 11 / 10 WPF Tray',
    subtitle: '.NET 8 NotifyIcon + schtasks cron supervision & PID kill',
    dotClass: 'bg-blue-400',
    arch: 'x64 / arm64',
    targetPath: 'ui/windows/',
    command: 'dotnet run --project ui/windows/LingonberryTray.csproj',
    ctaLabel: '.NET 8',
  },
];

export const WebsiteLanding: React.FC<WebsiteLandingProps> = ({
  state,
  busy,
  onShowToast,
  onOpenTelemetryModal,
  onOpenArchModal,
  onOpenDownloadModal,
  onNavigateTab,
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
}) => {
  const [matrixFilter, setMatrixFilter] = useState<MatrixPlatform>('all');
  const [worktreeGateOn, setWorktreeGateOn] = useState(true);
  const [activeCable, setActiveCable] = useState<{
    d: string;
    visible: boolean;
    caller: string;
    worker: string;
  }>({
    d: 'M 120 34 C 185 34, 185 94, 230 94 C 275 94, 275 34, 340 34',
    visible: false,
    caller: 'claude',
    worker: 'pi:NIM_1',
  });
  const [hudLogs, setHudLogs] = useState<
    Array<{ id: string; time: string; caller: string; worker: string; detail: string }>
  >(() => [
    {
      id: 'seed-1',
      time: new Date().toTimeString().slice(0, 8),
      caller: 'claude',
      worker: 'pi:NIM_1',
      detail: 'cooked · systematic-debugging · gate ready',
    },
    {
      id: 'seed-2',
      time: new Date().toTimeString().slice(0, 8),
      caller: 'codex',
      worker: 'groq:GROQ_API_KEY',
      detail: 'leased key slot · 3 max inflight / 40 RPM',
    },
  ]);

  const installSnippet = 'cargo install --path core && lingonberry-core init';

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onShowToast(label);
    } catch {
      onShowToast(text);
    }
  };

  const pulseRoute = (caller: string, worker: string, startY: number, endY: number, detail: string) => {
    const d = `M 120 ${startY} C 185 ${startY}, 185 94, 230 94 C 275 94, 275 ${endY}, 340 ${endY}`;
    setActiveCable({ d, visible: true, caller, worker });
    const now = new Date().toTimeString().slice(0, 8);
    setHudLogs((prev) => [
      { id: `${Date.now()}-${Math.random()}`, time: now, caller, worker, detail },
      ...prev.slice(0, 2),
    ]);
    setTimeout(() => {
      setActiveCable((prev) => ({ ...prev, visible: false }));
    }, 750);
  };

  const handleSimulateBurst = () => {
    HUD_CALLERS.forEach((item, idx) => {
      setTimeout(() => {
        pulseRoute(
          item.label,
          item.targetWorker,
          item.startY,
          item.endY,
          worktreeGateOn ? 'fanout branch · --worktree gate' : 'fanout branch · leased'
        );
      }, idx * 200);
    });
    void onFanout({
      prompt: 'Parallel audit: verify routes, key-pool leases, and cron watchdogs',
      caller: 'claude',
      worktree: worktreeGateOn,
    });
  };

  const filteredMatrixRows = useMemo(
    () =>
      MATRIX_ROWS.filter(
        (row) => matrixFilter === 'all' || row.platform === matrixFilter
      ),
    [matrixFilter]
  );

  const workerDisplayCards = useMemo(() => {
    const slots = state.snapshot.workers;
    const findSlot = (prov: string, fallbackName: string) =>
      slots.find((w) => (w.provider || '').toLowerCase() === prov) ?? {
        name: fallbackName,
        status: 'idle' as const,
        rpm_limit: 40,
        ok_24h: 0,
      };
    const nim = findSlot('nim', 'pi:NIM_1');
    const groq = findSlot('groq', 'groq:GROQ_API_KEY');
    const gemini = findSlot('gemini', 'gemini:GEMINI_API_KEY');
    return [
      {
        title: 'pi:NIM_1',
        sub: `${nim.rpm_limit ?? 40} RPM · ${nim.ok_24h} ok`,
        dot: nim.status === 'down' ? 'bg-amber-400' : 'bg-emerald-400',
      },
      {
        title: 'groq:GROQ_API_KEY',
        sub: `${groq.rpm_limit ?? 30} RPM · ${groq.ok_24h} ok`,
        dot: groq.status === 'down' ? 'bg-amber-400' : 'bg-amber-400',
      },
      {
        title: 'gemini:GEMINI_API_KEY',
        sub: `${gemini.rpm_limit ?? 40} RPM · ${gemini.ok_24h} ok`,
        dot: gemini.status === 'down' ? 'bg-amber-400' : 'bg-sky-400',
      },
    ];
  }, [state.snapshot.workers]);

  return (
    <div className="flex flex-col gap-16 pb-12">
      {/* HERO SECTION: STITCH TITANIUM / LUXURY MINIMALISM */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center pt-2" id="overview">
        {/* Left Column: Confident Pitch & Direct CLI Ergonomics */}
        <div className="lg:col-span-5 flex flex-col gap-5 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/[0.1] border border-amber-500/25 text-amber-700 dark:text-[#fabb60] font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-[#fabb60]" />
              <span>Loopback Rust Core · 127.0.0.1:8799</span>
            </div>
            <span className="text-[11px] font-mono text-zinc-500 dark:text-[#9ba1b4] px-2 py-0.5 rounded bg-zinc-200/70 dark:bg-white/[0.04] border border-zinc-300/70 dark:border-white/[0.06]">
              macOS · Linux · Windows
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-[40px] font-semibold tracking-[-0.035em] text-zinc-900 dark:text-white leading-[1.12] [text-wrap:balance]">
            One local router for every AI agent on your machine.
          </h1>

          <p className="text-[14px] text-zinc-600 dark:text-[#9ba1b4] leading-relaxed max-w-md font-normal">
            Scan once, self-configure globally through shared skills and your constitution, cook raw
            prompts into verified dispatches, lease keys safely, and oversee live workers and cron
            jobs.
          </p>

          {/* Command Line Copy Box */}
          <div className="rounded-xl p-1.5 flex items-center justify-between gap-2 bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08] shadow-xs">
            <div className="flex items-center gap-2 pl-3 font-mono text-[12px] text-zinc-700 dark:text-zinc-200 truncate">
              <span className="text-amber-600 dark:text-[#fabb60] select-none font-bold">$</span>
              <span className="truncate font-medium">{installSnippet}</span>
            </div>
            <button
              type="button"
              onClick={() => void copyText(installSnippet, 'Install command copied')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] text-zinc-800 dark:text-white text-[11px] font-mono transition border border-zinc-200 dark:border-white/[0.06] shrink-0"
            >
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </button>
          </div>

          {/* Primary CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => onOpenDownloadModal('macos')}
              className="relative group overflow-hidden rounded-xl p-px font-medium focus:outline-none focus:ring-2 focus:ring-amber-400/40 shadow-sm dark:shadow-[0_0_30px_-5px_rgba(229,169,80,0.22)] transition transform active:scale-[0.98]"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-amber-400 via-[#fabb60] to-amber-600 rounded-xl" />
              <span className="relative flex items-center justify-center gap-2 px-5 py-2.5 rounded-[11px] bg-zinc-900 dark:bg-gradient-to-b dark:from-[#1b1915] dark:to-[#11100e] text-amber-200 font-semibold text-[13px] border border-amber-300/30 group-hover:border-amber-300/60 transition">
                <Download className="w-4 h-4 text-amber-400" />
                <span>Install &amp; Setup</span>
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenTelemetryModal}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-zinc-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border border-zinc-200 dark:border-white/[0.08] text-zinc-900 dark:text-white text-[13px] font-medium transition"
            >
              <LineChart className="w-4 h-4 text-amber-600 dark:text-[#fabb60]" />
              <span>Telemetry (⌘K)</span>
            </button>

            <button
              type="button"
              onClick={onOpenArchModal}
              className="flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl text-zinc-500 hover:text-zinc-900 dark:text-[#9ba1b4] dark:hover:text-white text-[12px] font-mono transition-colors"
            >
              <span>Spec</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Factual Feature Tickers */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 pt-1">
            <span className="flex items-center gap-1">
              <span className="text-emerald-600 dark:text-emerald-400">✓</span> Rust + axum + SQLite WAL
            </span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span className="flex items-center gap-1">
              <span className="text-emerald-600 dark:text-emerald-400">✓</span> KeyPool RAII Lease
            </span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span className="flex items-center gap-1">
              <span className="text-emerald-600 dark:text-emerald-400">✓</span> No Secrets Logged
            </span>
          </div>
        </div>

        {/* Right Column: Precision Titanium Hardware & Interactive Orchestration HUD */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div className="w-full max-w-[530px] rounded-2xl border border-zinc-200 dark:border-white/[0.1] bg-white dark:bg-[#11131b] shadow-lg dark:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.7)] p-4 relative overflow-hidden">
            {/* Subtle top bezel light strip */}
            <div className="hidden dark:block absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-[#fabb60]/50 to-transparent" />

            {/* Native Window Header Strip */}
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-200 dark:border-white/[0.06]">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400/80 border border-rose-500/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 border border-amber-500/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 border border-emerald-500/70" />
                </div>
                <span className="font-mono text-[11px] font-semibold text-zinc-800 dark:text-zinc-200 ml-1 truncate">
                  lingonberry-core serve
                </span>
                <span className="hidden sm:inline text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/[0.05] text-zinc-500 dark:text-[#9ba1b4]">
                  127.0.0.1:8799
                </span>
              </div>

              <span className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                {state.snapshot.workers_live.length > 0 ? 'ROUTING' : 'READY'}
              </span>
            </div>

            {/* Dynamic SVG Routing HUD */}
            <div className="bg-[#f8f9fb] dark:bg-[#06070a]/90 rounded-xl p-3 border border-zinc-200 dark:border-white/[0.06] relative flex flex-col">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
                  <GitFork className="w-3.5 h-3.5 text-amber-600 dark:text-[#fabb60]" />
                  Live Routing Mesh
                </span>
                <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
                  Click callers to pulse
                </span>
              </div>

              {/* Visual Flow Canvas */}
              <div className="relative w-full h-[188px] bg-white dark:bg-black/45 rounded-lg overflow-hidden flex items-center justify-between px-3 py-2 border border-zinc-200 dark:border-white/[0.04]">
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none z-0"
                  preserveAspectRatio="none"
                  viewBox="0 0 460 188"
                >
                  <path
                    d="M 120 34 C 185 34, 185 94, 230 94"
                    fill="none"
                    stroke="currentColor"
                    className="text-zinc-300 dark:text-white/[0.09]"
                    strokeDasharray="2 3"
                    strokeWidth="1.2"
                  />
                  <path
                    d="M 120 94 C 185 94, 185 94, 230 94"
                    fill="none"
                    stroke="currentColor"
                    className="text-zinc-300 dark:text-white/[0.09]"
                    strokeWidth="1.2"
                  />
                  <path
                    d="M 120 154 C 185 154, 185 94, 230 94"
                    fill="none"
                    stroke="currentColor"
                    className="text-zinc-300 dark:text-white/[0.09]"
                    strokeDasharray="2 3"
                    strokeWidth="1.2"
                  />
                  <path
                    d="M 230 94 C 275 94, 275 34, 340 34"
                    fill="none"
                    stroke="currentColor"
                    className="text-zinc-300 dark:text-white/[0.09]"
                    strokeWidth="1.2"
                  />
                  <path
                    d="M 230 94 C 275 94, 275 94, 340 94"
                    fill="none"
                    stroke="currentColor"
                    className="text-zinc-300 dark:text-white/[0.09]"
                    strokeWidth="1.2"
                  />
                  <path
                    d="M 230 94 C 275 94, 275 154, 340 154"
                    fill="none"
                    stroke="currentColor"
                    className="text-zinc-300 dark:text-white/[0.09]"
                    strokeDasharray="2 3"
                    strokeWidth="1.2"
                  />

                  <path
                    d={activeCable.d}
                    fill="none"
                    stroke="#e5a950"
                    strokeLinecap="round"
                    strokeWidth="2.2"
                    className={`transition-opacity duration-300 ${
                      activeCable.visible ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </svg>

                {/* Left: Callers */}
                <div className="z-10 flex flex-col gap-2 w-[112px]">
                  {HUD_CALLERS.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        pulseRoute(
                          node.label,
                          node.targetWorker,
                          node.startY,
                          node.endY,
                          `cook + key lease -> ${node.targetWorker}`
                        );
                        void onRoute({
                          prompt: `Route check from ${node.label}`,
                          caller: node.label,
                          worktree: worktreeGateOn,
                        });
                      }}
                      className="text-left px-2 py-1.5 rounded-lg bg-[#f8f9fb] dark:bg-[#151821]/95 hover:bg-zinc-100 dark:hover:bg-[#1c1f2b] border border-zinc-200 dark:border-white/[0.08] hover:border-amber-500/45 transition group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-amber-600 dark:group-hover:text-[#fabb60]">
                          {node.label}
                        </span>
                        <span className={`w-1.5 h-1.5 rounded-full ${node.dotClass}`} />
                      </div>
                      <span className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 block mt-0.5 truncate">
                        {node.sub}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Center: Core Router */}
                <div className="z-10 flex flex-col items-center justify-center">
                  <button
                    type="button"
                    onClick={handleSimulateBurst}
                    className={`w-14 h-14 rounded-2xl bg-white dark:bg-[#1c1f2b] border flex flex-col items-center justify-center shadow-md transition-transform duration-300 ${
                      activeCable.visible
                        ? 'scale-105 border-amber-500 dark:border-[#fabb60]'
                        : 'border-amber-500/35 dark:border-[#fabb60]/30'
                    }`}
                    title="Trigger fanout burst"
                  >
                    <GitFork className="w-5 h-5 text-amber-600 dark:text-[#fabb60]" />
                    <span className="font-mono text-[8px] font-bold tracking-wider text-amber-700 dark:text-amber-200 mt-0.5">
                      ROUTER
                    </span>
                  </button>
                  <div className="mt-1.5 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-white/[0.05] border border-zinc-200 dark:border-white/[0.07] font-mono text-[9px] text-zinc-600 dark:text-zinc-300 tabular-nums">
                    {state.snapshot.overview.running} active · {state.snapshot.workers.length} slots
                  </div>
                </div>

                {/* Right: Workers */}
                <div className="z-10 flex flex-col gap-2 w-[124px]">
                  {workerDisplayCards.map((w) => (
                    <div
                      key={w.title}
                      className="text-left px-2 py-1.5 rounded-lg bg-[#f8f9fb] dark:bg-[#151821]/95 border border-zinc-200 dark:border-white/[0.07]"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-[9.5px] font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                          {w.title}
                        </span>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${w.dot}`} />
                      </div>
                      <span className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 block mt-0.5 truncate">
                        {w.sub}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* HUD Tactile Controls */}
              <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-zinc-200/80 dark:border-white/[0.05]">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSimulateBurst}
                  className="flex-1 py-1.5 px-2.5 rounded-lg bg-white dark:bg-white/[0.04] hover:bg-zinc-100 dark:hover:bg-white/[0.08] text-zinc-800 dark:text-white font-mono text-[10px] flex items-center justify-center gap-1.5 transition border border-zinc-200 dark:border-white/[0.07]"
                >
                  <Bolt className="w-3.5 h-3.5 text-amber-600 dark:text-[#fabb60]" />
                  <span>Simulate Burst</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenArchModal}
                  className="py-1.5 px-2.5 rounded-lg bg-white dark:bg-white/[0.04] hover:bg-zinc-100 dark:hover:bg-white/[0.08] text-zinc-600 dark:text-[#9ba1b4] hover:text-zinc-900 dark:hover:text-white font-mono text-[10px] flex items-center gap-1 transition border border-zinc-200 dark:border-white/[0.07]"
                >
                  <Filter className="w-3 h-3" />
                  <span>Inspect Gate</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !worktreeGateOn;
                    setWorktreeGateOn(next);
                    onShowToast(next ? 'Worktree gate enabled' : 'Worktree gate disabled');
                  }}
                  className="py-1.5 px-2.5 rounded-lg bg-white dark:bg-white/[0.04] hover:bg-zinc-100 dark:hover:bg-white/[0.08] text-zinc-600 dark:text-[#9ba1b4] font-mono text-[10px] flex items-center gap-1 transition border border-zinc-200 dark:border-white/[0.07]"
                >
                  <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span>Worktree Gate: {worktreeGateOn ? 'ON' : 'OFF'}</span>
                </button>
              </div>
            </div>

            {/* Micro Trace Stream */}
            <div className="mt-2.5 p-2.5 rounded-xl bg-[#f8f9fb] dark:bg-[#06070a]/90 border border-zinc-200 dark:border-white/[0.05] font-mono text-[10px]">
              <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 mb-1">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>events.jsonl decision log</span>
                </span>
                <span>{state.mode === 'live-api' ? 'live loopback' : 'static preview'}</span>
              </div>
              <div className="flex flex-col gap-0.5 text-zinc-700 dark:text-zinc-300">
                {hudLogs.map((log) => (
                  <div key={log.id} className="truncate">
                    [{log.time}] ROUTE{' '}
                    <span className="text-amber-600 dark:text-[#fabb60] font-semibold">
                      {log.caller}
                    </span>{' '}
                    →{' '}
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      {log.worker}
                    </span>{' '}
                    <span className="text-zinc-500 dark:text-zinc-400">({log.detail})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* EMBEDDED LIVE MENU BAR PREVIEW */}
      <section className="flex flex-col gap-5" id="menubar-preview">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-amber-600 dark:text-[#fabb60] text-[11px] font-mono uppercase tracking-wider mb-1 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-[#fabb60]" />
              Interactive Popover Preview
            </div>
            <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white tracking-tight">
              Menu bar command center &amp; live worker kill
            </h2>
            <p className="text-zinc-600 dark:text-[#9ba1b4] text-[13px] mt-1 max-w-2xl">
              Try routing a prompt, simulating 429 or truncated failover, tuning provider RPM caps,
              or inspecting session traces directly below.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigateTab('menubar')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border border-zinc-200 dark:border-white/[0.08] text-zinc-800 dark:text-zinc-200 text-[12px] font-mono transition"
            >
              <span>Full Workbench</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('cron')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border border-zinc-200 dark:border-white/[0.08] text-zinc-800 dark:text-zinc-200 text-[12px] font-mono transition"
            >
              <span>Cron Oversight</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <MenuBarGiga
          state={state}
          busy={busy}
          onRefresh={onRefresh}
          onRoute={onRoute}
          onRun={onRun}
          onFanout={onFanout}
          onKillWorker={onKillWorker}
          onResetKey={onResetKey}
          onAdjustProviderRpm={onAdjustProviderRpm}
          onToggleJob={onToggleJob}
          onRunJob={onRunJob}
          onHealJob={onHealJob}
          onOpenCronTab={() => onNavigateTab('cron')}
          onOpenAgentsTab={() => onNavigateTab('agents')}
        />
      </section>

      {/* ARCHITECTURE SPEC SECTION: CRAFTED 3-CARD BENTO GRID */}
      <section className="flex flex-col gap-6 pt-2" id="architecture">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-amber-600 dark:text-[#fabb60] text-[11px] font-mono uppercase tracking-wider mb-1 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-[#fabb60]" />
              Engineering Specification
            </div>
            <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white tracking-tight">
              Built as a deterministic local harness
            </h2>
            <p className="text-zinc-600 dark:text-[#9ba1b4] text-[13px] mt-1 max-w-xl">
              Single Rust core (`core/`) with native macOS SwiftUI, Windows WPF, and Linux GTK4
              trays. Zero Electron overhead and zero key leakage.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('docs')}
            className="self-start md:self-end flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border border-zinc-200 dark:border-white/[0.08] text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white text-[12px] font-mono transition"
          >
            <span>Read CLI &amp; HTTP Docs</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1 */}
          <div className="rounded-2xl p-5 flex flex-col justify-between bg-white dark:bg-gradient-to-b dark:from-[#151821]/90 dark:to-[#0e1017] border border-zinc-200 dark:border-white/[0.07] hover:border-zinc-300 dark:hover:border-white/[0.15] transition shadow-xs">
            <div>
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-600 dark:text-[#fabb60] mb-4">
                <Sparkles className="w-4.5 h-4.5" />
              </div>
              <h3 className="text-zinc-900 dark:text-white font-semibold text-[15px] tracking-tight">
                Prompt Cooking &amp; Global Self-Config
              </h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-[13px] leading-relaxed mt-2">
                Enriches raw prompts with your matching global skill, command, hook, and repository
                context. Writes one canonical skill in <code className="font-mono text-xs">~/.agent-skills</code> plus
                idempotent 2-line per-agent pointers.
              </p>
            </div>
            <div className="mt-6 pt-3 border-t border-zinc-200 dark:border-white/[0.06] flex items-center justify-between text-[11px] font-mono">
              <span className="text-zinc-500 dark:text-zinc-400">Strategy: Global-first</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">idempotent</span>
            </div>
          </div>

          {/* Card 2 */}
          <div className="rounded-2xl p-5 flex flex-col justify-between bg-white dark:bg-gradient-to-b dark:from-[#151821]/90 dark:to-[#0e1017] border border-zinc-200 dark:border-white/[0.07] hover:border-zinc-300 dark:hover:border-white/[0.15] transition shadow-xs">
            <div>
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4">
                <Zap className="w-4.5 h-4.5" />
              </div>
              <h3 className="text-zinc-900 dark:text-white font-semibold text-[15px] tracking-tight">
                Provider-Scoped KeyPool &amp; Failover
              </h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-[13px] leading-relaxed mt-2">
                RAII <code className="font-mono text-xs">LeaseGuard</code> isolates keys per provider
                (NIM never leaks to Groq or Gemini), caps concurrency at 3 runs and live-tunable RPM,
                and auto-retries 429 or truncated output on sibling keys.
              </p>
            </div>
            <div className="mt-6 pt-3 border-t border-zinc-200 dark:border-white/[0.06] flex items-center justify-between text-[11px] font-mono">
              <span className="text-zinc-500 dark:text-zinc-400">Defaults: 3 concurrent · 40 RPM</span>
              <span className="text-amber-600 dark:text-[#fabb60] font-medium">auto-failover</span>
            </div>
          </div>

          {/* Card 3 */}
          <div className="rounded-2xl p-5 flex flex-col justify-between bg-white dark:bg-gradient-to-b dark:from-[#151821]/90 dark:to-[#0e1017] border border-zinc-200 dark:border-white/[0.07] hover:border-zinc-300 dark:hover:border-white/[0.15] transition shadow-xs">
            <div>
              <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/25 flex items-center justify-center text-sky-600 dark:text-sky-400 mb-4">
                <Terminal className="w-4.5 h-4.5" />
              </div>
              <h3 className="text-zinc-900 dark:text-white font-semibold text-[15px] tracking-tight">
                Host Cron Watchdog &amp; PID Kill
              </h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-[13px] leading-relaxed mt-2">
                Discovers live <code className="font-mono text-xs">crontab</code>,{' '}
                <code className="font-mono text-xs">launchd</code>,{' '}
                <code className="font-mono text-xs">systemd</code>, and{' '}
                <code className="font-mono text-xs">schtasks</code> processes via sysinfo, recovers
                crashed schedules with KeepAlive, and terminates runaway PIDs safely.
              </p>
            </div>
            <div className="mt-6 pt-3 border-t border-zinc-200 dark:border-white/[0.06] flex items-center justify-between text-[11px] font-mono">
              <span className="text-zinc-500 dark:text-zinc-400">Loopback 127.0.0.1:8799</span>
              <span className="text-sky-600 dark:text-sky-400 font-medium">SIGTERM guarded</span>
            </div>
          </div>
        </div>
      </section>

      {/* CROSS-OS TARGETS & NATIVE UI MATRIX */}
      <section className="flex flex-col gap-5 pt-2" id="matrix">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 mb-1">
              <span className="text-amber-600 dark:text-[#fabb60] font-mono text-[11px] uppercase tracking-wider font-semibold">
                Cross-OS Targets
              </span>
              <span className="px-2 py-0.5 rounded bg-zinc-200/70 dark:bg-white/[0.04] border border-zinc-300/70 dark:border-white/[0.07] text-zinc-700 dark:text-zinc-300 font-mono text-[10px]">
                Core + 3 Native Trays
              </span>
            </div>
            <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white tracking-tight">
              Build from source on every desktop OS
            </h2>
            <p className="text-zinc-600 dark:text-[#9ba1b4] text-[13px] mt-1">
              One Rust core engine powering native macOS, Linux, and Windows menu bar / system tray
              applications.
            </p>
          </div>

          {/* Filter Buttons */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-200/60 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.07] self-start md:self-end">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'macos', label: 'macOS' },
                { id: 'linux', label: 'Linux' },
                { id: 'windows', label: 'Windows' },
              ] as const
            ).map((btn) => {
              const active = matrixFilter === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setMatrixFilter(btn.id)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-mono font-medium transition ${
                    active
                      ? 'bg-white dark:bg-white/[0.1] text-zinc-900 dark:text-white shadow-2xs'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f8f9fb] dark:bg-[#06070a]/90 border-b border-zinc-200 dark:border-white/[0.06] text-zinc-500 dark:text-zinc-400 font-mono text-[10px] uppercase tracking-wider">
                  <th className="py-3 px-4 font-semibold">Platform &amp; Target</th>
                  <th className="py-3 px-4 font-semibold">Arch</th>
                  <th className="py-3 px-4 font-semibold">Directory</th>
                  <th className="py-3 px-4 font-semibold">Build / Run Command</th>
                  <th className="py-3 px-4 font-semibold text-right">Setup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/80 dark:divide-white/[0.04] text-[12px]">
                {filteredMatrixRows.map((row) => (
                  <tr
                    key={row.id}
                    className="group hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${row.dotClass}`} />
                        <div>
                          <div className="font-medium text-zinc-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-[#fabb60] transition-colors">
                            {row.name}
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                            {row.subtitle}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                      {row.arch}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                      {row.targetPath}
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      <button
                        type="button"
                        onClick={() => void copyText(row.command, `Copied: ${row.command}`)}
                        className="px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.1] text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition text-[11px] inline-flex items-center gap-1.5 max-w-[340px]"
                      >
                        <span className="truncate">{row.command}</span>
                        <Copy className="w-3 h-3 shrink-0 text-zinc-400" />
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenDownloadModal(row.platform)}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-zinc-100 hover:bg-amber-500 hover:text-white dark:bg-white/[0.06] dark:hover:bg-[#fabb60] dark:hover:text-[#1b1200] text-zinc-800 dark:text-zinc-200 font-mono text-[11px] font-medium transition border border-zinc-200 dark:border-white/[0.08]"
                      >
                        <Check className="w-3 h-3" />
                        <span>{row.ctaLabel}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-[#f8f9fb] dark:bg-[#06070a]/90 px-4 py-3 border-t border-zinc-200 dark:border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-3 text-zinc-500 dark:text-zinc-400 font-mono text-[11px]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-[#fabb60]" />
              <span>
                CI runs <code className="text-zinc-800 dark:text-zinc-200">cargo test</code> &amp;
                gitleaks secret scan on every push
              </span>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigateTab('docs')}
                className="hover:text-zinc-900 dark:hover:text-white transition"
              >
                CLI &amp; HTTP Reference
              </button>
              <span className="text-zinc-300 dark:text-zinc-700">|</span>
              <a
                href="https://github.com/brusnyak/lingonberry-router"
                target="_blank"
                rel="noreferrer"
                className="text-amber-600 dark:text-[#fabb60] hover:underline flex items-center gap-1"
              >
                <span>GitHub Repository</span>
                <ArrowUpRight className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
