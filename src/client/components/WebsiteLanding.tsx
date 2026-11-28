import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Copy,
  Download,
  GitFork,
  Terminal,
} from 'lucide-react';
import type { RouterRuntimeState } from '../lib/routerClient';
import { MenuBarGiga } from './MenuBarGiga';
import idleMockupImg from '../../assets/images/menubar_idle_preview_1795822249074.jpg';
import activeMockupImg from '../../assets/images/menubar_active_preview_1795822249329.jpg';

export type MatrixPlatform = 'all' | 'macos' | 'phase2';

interface WebsiteLandingProps {
  state: RouterRuntimeState;
  busy: boolean;
  onShowToast: (msg: string) => void;
  onOpenTelemetryModal: () => void;
  onOpenArchModal: () => void;
  onOpenDownloadModal: (os?: 'macos' | 'linux' | 'windows') => void;
  onNavigateTab: (tab: 'overview' | 'menubar' | 'swarm' | 'specs' | 'docs') => void;
  onRefresh: () => Promise<void> | void;
  onRoute: (params: { prompt: string; caller: string; worktree: boolean }) => Promise<void> | void;
  onRun: (params: {
    prompt: string;
    caller: string;
    worktree: boolean;
    simulate_fault: 'none' | '429' | 'truncated' | 'gate-escalate';
    live_api: boolean;
  }) => Promise<void> | void;
  onFanout: (params: { prompt: string; caller: string; worktree: boolean }) => Promise<void> | void;
  onSetIdle: () => Promise<void> | void;
  onApproveSpec: (specId: string) => Promise<void> | void;
  onRunSpec: (specId: string) => Promise<void> | void;
  onToggleChannel: (id: string) => Promise<void> | void;
  onKillWorker: (pid: number) => Promise<void> | void;
  onResetKey: (name: string) => Promise<void> | void;
  onAdjustProviderRpm: (provider: string, nextRpm: number) => Promise<void> | void;
  onToggleJob: (name: string) => Promise<void> | void;
  onRunJob: (name: string) => Promise<void> | void;
  onHealJob: (name: string) => Promise<void> | void;
}

const MATRIX_ROWS: Array<{
  id: string;
  phase: 'macos' | 'phase2';
  platform: 'macos' | 'linux' | 'windows';
  name: string;
  subtitle: string;
  arch: string;
  targetPath: string;
  command: string;
  stage: string;
}> = [
  {
    id: 'macos-rust-core',
    phase: 'macos',
    platform: 'macos',
    name: 'Rust Core Daemon (macOS Primary)',
    subtitle: 'axum HTTP API, SQLite WAL, KeyPool, Swarm PathLeases, Watchdog & Kiro Spec Engine',
    arch: 'arm64 / x86_64',
    targetPath: 'core/',
    command: 'cd core && cargo test && cargo install --path . && lingonberry-core init --yes',
    stage: 'Primary',
  },
  {
    id: 'macos-swift-bar',
    phase: 'macos',
    platform: 'macos',
    name: 'macOS SwiftUI MenuBarExtra',
    subtitle: 'Lightweight 5-second glance shell with idle graph collapse & active swarm controls',
    arch: 'arm64 / x86_64',
    targetPath: 'ui/macos-swift/',
    command: 'cd ui/macos-swift && swift run lingonberry-tray',
    stage: 'Primary',
  },
  {
    id: 'linux-gtk',
    phase: 'phase2',
    platform: 'linux',
    name: 'Linux GTK4 + ksni System Tray',
    subtitle: 'StatusNotifierItem tray + systemd/crontab watchdog monitor',
    arch: 'x86_64 / arm64',
    targetPath: 'ui/linux/',
    command: 'cd ui/linux && cargo run --release',
    stage: 'Phase 2',
  },
  {
    id: 'windows-wpf',
    phase: 'phase2',
    platform: 'windows',
    name: 'Windows 11 / 10 WPF Tray',
    subtitle: '.NET 8 NotifyIcon + schtasks cron supervision',
    arch: 'x64 / arm64',
    targetPath: 'ui/windows/',
    command: 'dotnet run --project ui/windows/LingonberryTray.csproj',
    stage: 'Phase 2',
  },
];

const AGENT_BOOTSTRAP_PROMPT = `Clone https://github.com/brusnyak/lingonberry-router into ~/Code/lingonberry-router (or pull clean if present) and bootstrap Lingonberry Router for macOS:
1. Verify cargo, rustc, swift, git, and sandbox-exec.
2. Run ./scripts/install_mac.sh --install from the repo root so tests pass, pi-rust is verified/installed, ~/.lingonberry + api.token + mini-harness are initialized, self-config --apply indexes global skills & agent pointers, doctor passes, and /Applications/Lingonberry Router.app is built.
3. Run lingonberry-core discover and lingonberry-core route "Audit auth token guard" --worktree.
4. Open "/Applications/Lingonberry Router.app" and verify http://127.0.0.1:8799/health returns ok.
5. Follow Section 3 & Section 4 of docs/MAC_BOOTSTRAP.md to run real E2E + git worktree checks, then ask me ONLY for the API keys to store in macOS Keychain.`;

function previewSemanticBrain(prompt: string) {
  const lower = prompt.toLowerCase();
  const isComplex =
    /\b(architect|swarm|overnight|refactor|security|auth|migration|spec|sandbox)\b/.test(lower) ||
    prompt.length > 150;
  const isStd = /\b(fix|test|debug|route|endpoint|parse|build|add|update)\b/.test(lower);
  const tier = isComplex ? 'tier3_architect' : isStd ? 'tier2_standard' : 'tier1_trivial';
  const skill = /\b(security|secret|key|auth|sandbox|seatbelt|token)\b/.test(lower)
    ? 'secure-review-constitution'
    : /\b(swarm|parallel|fanout|worktree|50)\b/.test(lower)
      ? 'swarm-worktree-orchestrator'
      : /\b(bug|fix|error|fail|crash|debug)\b/.test(lower)
        ? 'systematic-debugging'
        : 'deep-retrieval-brief';
  const gate =
    skill === 'secure-review-constitution'
      ? 'zero-secret-leak'
      : skill === 'systematic-debugging'
        ? 'test-suite-exit-0'
        : 'compile-and-lint-pass';
  const loop = isComplex ? 'plan-worktree-gate-escalate' : 'fast-worktree-gate';
  const primaryWorker =
    tier === 'tier1_trivial' ? 'pi:GROQ_API_KEY (Llama 3.3)' : 'pi:KILO_FREE (Qwen3 Coder Free)';
  return { tier, skill, gate, loop, primaryWorker };
}

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
  onSetIdle,
  onApproveSpec,
  onRunSpec,
  onToggleChannel,
  onKillWorker,
  onResetKey,
  onAdjustProviderRpm,
  onToggleJob,
  onRunJob,
  onHealJob,
}) => {
  const [matrixFilter, setMatrixFilter] = useState<MatrixPlatform>('all');
  const [brainPrompt, setBrainPrompt] = useState(
    'Refactor auth token middleware in core/src/server.rs and run cargo test'
  );
  const [emblemFallback, setEmblemFallback] = useState(false);
  const [idleFallback, setIdleFallback] = useState(false);
  const [activeFallback, setActiveFallback] = useState(false);

  const installSnippet = './scripts/install_mac.sh --install';
  const wipeSnippet = 'rm -rf ~/.lingonberry "/Applications/Lingonberry Router.app"';

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onShowToast(label);
    } catch {
      onShowToast(text);
    }
  };

  const brainPreview = useMemo(() => previewSemanticBrain(brainPrompt), [brainPrompt]);

  const filteredMatrixRows = useMemo(
    () =>
      MATRIX_ROWS.filter((row) => matrixFilter === 'all' || row.phase === matrixFilter),
    [matrixFilter]
  );

  const watchdog = state.snapshot.watchdog;
  const specsCount = state.snapshot.specs?.length ?? 0;

  return (
    <div className="flex flex-col gap-20 pb-16">
      {/* HERO SECTION */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch pt-2">
        <div className="lg:col-span-6 flex flex-col justify-between gap-8">
          <div className="space-y-5">
            <div className="flex items-center gap-3.5">
              {!emblemFallback ? (
                <img
                  src="/assets/lingonberry-emblem.png"
                  alt="Lingonberry Router emblem"
                  referrerPolicy="no-referrer"
                  onError={() => setEmblemFallback(true)}
                  className="w-11 h-11 object-contain shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-zinc-900 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                  <GitFork className="w-5 h-5 text-zinc-100" />
                </div>
              )}
              <div className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                  macOS First · Rust Core + SwiftUI MenuBarExtra
                </span>
                <div className="text-zinc-400 dark:text-zinc-500 mt-0.5">
                  Loopback 127.0.0.1:8799 · Bearer Auth
                </div>
              </div>
            </div>

            <h1 className="text-3xl sm:text-[42px] font-semibold tracking-tight text-zinc-950 dark:text-white leading-[1.12] [text-wrap:balance]">
              Local reasoning router &amp; sandboxed swarm.
            </h1>

            <p className="text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-lg">
              Route prompts in under 5ms to <code className="font-mono text-xs">pi-rust</code> and
              free pools, isolate git worktrees under Seatbelt or Docker, and supervise runs from a
              calm menu bar.
            </p>

            {/* CLI Copy Box */}
            <div className="rounded-lg p-1.5 flex items-center justify-between gap-2 bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2 pl-3 font-mono text-xs text-zinc-700 dark:text-zinc-200 truncate">
                <span className="text-indigo-600 dark:text-indigo-400 select-none font-semibold">
                  $
                </span>
                <span className="truncate">{installSnippet}</span>
              </div>
              <button
                type="button"
                onClick={() => void copyText(installSnippet, 'Bootstrap command copied')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-white text-[11px] font-mono transition-colors shrink-0"
              >
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onOpenDownloadModal('macos')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 font-semibold text-[13px] transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Install macOS Build</span>
              </button>

              <button
                type="button"
                onClick={onOpenTelemetryModal}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-white text-[13px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors whitespace-nowrap shrink-0"
              >
                <Terminal className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                <span>Telemetry (⌘K)</span>
              </button>

              <button
                type="button"
                onClick={onOpenArchModal}
                className="inline-flex items-center gap-1 px-2 py-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white text-xs font-mono whitespace-nowrap shrink-0"
              >
                <span>Architecture</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 pt-3 border-t border-zinc-200 dark:border-zinc-800">
            <span>Seatbelt SBPL + Docker</span>
            <span aria-hidden="true">·</span>
            <span>Free Pools First</span>
            <span aria-hidden="true">·</span>
            <span>Kiro SHA-256 Spec Lock</span>
          </div>
        </div>

        {/* Right Column: Live Semantic Brain Playground with subtle tactile top-edge highlight */}
        <div className="lg:col-span-6 relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] p-6 flex flex-col justify-between gap-5 shadow-xs">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-white">
                <GitFork className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Semantic Router Playground</span>
              </div>
              <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                $0.00 API classifier
              </span>
            </div>

            <textarea
              rows={2}
              value={brainPrompt}
              onChange={(e) => setBrainPrompt(e.target.value)}
              placeholder="Enter any engineering task to preview tier, BM25 skill, gate, and worker…"
              className="w-full p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090B] text-xs font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none focus:border-indigo-500"
            />

            <dl className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800/80">
                <dt className="text-[10.5px] text-zinc-400">1. Complexity</dt>
                <dd className="font-semibold text-zinc-950 dark:text-white mt-0.5">
                  {brainPreview.tier}
                </dd>
              </div>
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800/80">
                <dt className="text-[10.5px] text-zinc-400">2. BM25 Skill</dt>
                <dd className="font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5 truncate">
                  {brainPreview.skill}
                </dd>
              </div>
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800/80">
                <dt className="text-[10.5px] text-zinc-400">3. Gate · Loop</dt>
                <dd className="text-zinc-800 dark:text-zinc-200 mt-0.5 truncate">
                  {brainPreview.gate} · {brainPreview.loop}
                </dd>
              </div>
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800/80">
                <dt className="text-[10.5px] text-zinc-400">4. Free Worker</dt>
                <dd className="text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5 truncate">
                  {brainPreview.primaryWorker}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-zinc-200 dark:border-zinc-800 text-xs font-mono">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || !brainPrompt.trim()}
                onClick={() =>
                  void onRun({
                    prompt: brainPrompt.trim(),
                    caller: 'web:playground',
                    worktree: true,
                    simulate_fault: 'none',
                    live_api: false,
                  })
                }
                className="px-3.5 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 font-semibold whitespace-nowrap shrink-0 transition-colors"
              >
                Dispatch Free
              </button>
              <button
                type="button"
                disabled={busy || !brainPrompt.trim()}
                onClick={() =>
                  void onRun({
                    prompt: brainPrompt.trim(),
                    caller: 'web:playground',
                    worktree: true,
                    simulate_fault: 'gate-escalate',
                    live_api: false,
                  })
                }
                className="px-3.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                Test Escalation
              </button>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('swarm')}
              className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <span>50-Agent Swarm</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </section>

      {/* 4-COLUMN LIVE STATUS STRIP */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-zinc-200 dark:divide-zinc-800 font-mono tabular-nums">
        <div className="p-5">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Active / Semaphore</div>
          <div className="text-xl font-semibold text-zinc-950 dark:text-white mt-1">
            {state.snapshot.overview.running} / {watchdog?.max_concurrent_workers ?? 8}
          </div>
        </div>
        <div className="p-5">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Host RAM · Disk Free</div>
          <div className="text-xl font-semibold text-zinc-950 dark:text-white mt-1">
            {watchdog
              ? `${watchdog.ram_used_pct.toFixed(0)}% · ${watchdog.free_disk_gb.toFixed(0)} GB`
              : '54% · 325 GB'}
          </div>
        </div>
        <div className="p-5">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">5h Sub Burst Guard</div>
          <div className="text-xl font-semibold text-zinc-950 dark:text-white mt-1">
            {watchdog
              ? `${watchdog.subscription_burst_used} / ${watchdog.subscription_burst_cap}`
              : '2 / 45'}
          </div>
        </div>
        <div className="p-5">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Kiro Specs · Channels</div>
          <div className="text-xl font-semibold text-zinc-950 dark:text-white mt-1">
            {specsCount} specs ·{' '}
            {(state.snapshot.gateway?.channels ?? []).filter((c) => c.enabled).length} active
          </div>
        </div>
      </section>

      {/* INTERACTIVE MENU BAR SIMULATOR + IDLE/ACTIVE NATIVE MOCKUPS */}
      <section className="space-y-6" id="menubar-preview">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="text-xs font-mono text-indigo-600 dark:text-indigo-400 font-medium">
              Zero-Build SwiftUI Simulator
            </div>
            <h2 className="text-2xl sm:text-3xl font-semibold text-zinc-950 dark:text-white tracking-tight">
              macOS Menu Bar: Idle vs Active Swarm
            </h2>
            <p className="text-[13.5px] text-zinc-600 dark:text-zinc-400 max-w-xl">
              Collapses cleanly when idle. Expands live Caller → Router → Worker curves and PID kill
              controls on dispatch.
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs shrink-0">
            <button
              type="button"
              onClick={() => onNavigateTab('menubar')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 whitespace-nowrap shrink-0"
            >
              <span>Workbench</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('specs')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 whitespace-nowrap shrink-0"
            >
              <span>Specs &amp; Channels</span>
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
          onSetIdle={onSetIdle}
          onApproveSpec={onApproveSpec}
          onRunSpec={onRunSpec}
          onToggleChannel={onToggleChannel}
          onKillWorker={onKillWorker}
          onResetKey={onResetKey}
          onAdjustProviderRpm={onAdjustProviderRpm}
          onToggleJob={onToggleJob}
          onRunJob={onRunJob}
          onHealJob={onHealJob}
        />

        {/* Side-by-Side Idle & Active Visual Mockups */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs font-mono">
              <span className="font-semibold text-zinc-950 dark:text-white">
                01. Idle Menu Bar
              </span>
              <span className="text-zinc-500 dark:text-zinc-400">
                Collapsed graph · hidden cards
              </span>
            </div>
            {!idleFallback ? (
              <img
                src={idleMockupImg}
                alt="macOS Lingonberry Menu Bar Idle State"
                referrerPolicy="no-referrer"
                onError={() => setIdleFallback(true)}
                className="w-full h-64 object-cover"
              />
            ) : (
              <div className="h-64 flex items-center justify-center bg-zinc-900 font-mono text-xs text-zinc-400 p-4 text-center">
                Idle macOS Menu Bar Preview (collapsed graph · watchdog normal)
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs font-mono">
              <span className="font-semibold text-zinc-950 dark:text-white">
                02. Active Swarm Menu Bar
              </span>
              <span className="text-emerald-600 dark:text-emerald-400">
                Live curves · PathLeases · Kill PID
              </span>
            </div>
            {!activeFallback ? (
              <img
                src={activeMockupImg}
                alt="macOS Lingonberry Menu Bar Active Swarm State"
                referrerPolicy="no-referrer"
                onError={() => setActiveFallback(true)}
                className="w-full h-64 object-cover"
              />
            ) : (
              <div className="h-64 flex items-center justify-center bg-zinc-900 font-mono text-xs text-zinc-400 p-4 text-center">
                Active macOS Menu Bar Preview (Caller → Router → Worker curves + PID kill)
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ASYMMETRIC BENTO ARCHITECTURE */}
      <section className="space-y-6" id="architecture">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-mono text-indigo-600 dark:text-indigo-400 font-medium">
              Core Architecture
            </div>
            <h2 className="text-2xl sm:text-3xl font-semibold text-zinc-950 dark:text-white tracking-tight">
              Deterministic routing &amp; bank-grade isolation
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('docs')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] text-xs font-mono text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 whitespace-nowrap shrink-0"
          >
            <span>CLI &amp; HTTP API</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] p-6 flex flex-col justify-between gap-5">
            <div className="space-y-2.5">
              <div className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                01. Execution Layer
              </div>
              <h3 className="text-lg font-semibold text-zinc-950 dark:text-white">
                Free-first <code className="font-mono text-base">pi-rust</code> brain &amp; gate
                escalation
              </h3>
              <p className="text-[13.5px] text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-xl">
                Starts every task on free pools (Kilo, OpenCode, NIM, Groq, Gemini) via{' '}
                <code className="font-mono text-xs">pi-rust</code>. Escalates to Claude or Codex
                strictly when a verification gate fails and 5h burst limits permit.
              </p>
            </div>
            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap gap-x-5 gap-y-1 text-xs font-mono text-zinc-500 dark:text-zinc-400">
              <span>BM25 SKILL.md index</span>
              <span>·</span>
              <span>$0.00 routing overhead</span>
              <span>·</span>
              <span>RAII KeyPool failover</span>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] p-6 flex flex-col justify-between gap-5">
            <div className="space-y-2.5">
              <div className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                02. Sandbox &amp; Keychain
              </div>
              <h3 className="text-lg font-semibold text-zinc-950 dark:text-white">
                Seatbelt SBPL, Docker &amp; Bearer Proxy
              </h3>
              <p className="text-[13.5px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Workers never touch raw API keys, <code className="font-mono text-xs">~/.ssh</code>
                , or <code className="font-mono text-xs">.env</code>. Keys stay in macOS Keychain;
                traffic flows through <code className="font-mono text-xs">api.token</code>.
              </p>
            </div>
            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-500 dark:text-zinc-400">
              Read-only cap-dropped Docker for overnight runs
            </div>
          </div>

          <div className="lg:col-span-12 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                03. Multi-Agent Coordination &amp; Persistence
              </div>
              <h3 className="text-lg font-semibold text-zinc-950 dark:text-white">
                50-agent worktree leases, SHA-256 Kiro specs &amp; zero-hosting channels
              </h3>
              <p className="text-[13.5px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Non-overlapping file globs, serial rebase-then-test merges, and outbound Telegram /
                Slack / Discord / MCP memory persistence across sessions.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs shrink-0">
              <button
                type="button"
                onClick={() => onNavigateTab('swarm')}
                className="px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Inspect Swarm
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('specs')}
                className="px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Inspect Kiro Specs
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* CLEAN-SLATE MAC AGENT BOOTSTRAP */}
      <section className="space-y-5" id="bootstrap">
        <div className="space-y-1">
          <div className="text-xs font-mono text-indigo-600 dark:text-indigo-400 font-medium">
            Clean-Slate Mac Deployment
          </div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-zinc-950 dark:text-white tracking-tight">
            Hand your GitHub URL to your Mac agent
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] p-6 space-y-4">
            <div className="text-sm font-semibold text-zinc-950 dark:text-white">
              1. Reset old local state (optional)
            </div>
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 font-mono text-[11px]">
              <code className="text-zinc-700 dark:text-zinc-300 truncate">{wipeSnippet}</code>
              <button
                type="button"
                onClick={() => void copyText(wipeSnippet, 'Clean-slate wipe command copied')}
                className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="text-sm font-semibold text-zinc-950 dark:text-white pt-1">
              2. Build core, index skills &amp; bundle .app
            </div>
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 font-mono text-[11px]">
              <code className="text-zinc-700 dark:text-zinc-300 truncate">{installSnippet}</code>
              <button
                type="button"
                onClick={() => void copyText(installSnippet, 'Install script copied')}
                className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] p-6 flex flex-col justify-between gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-zinc-950 dark:text-white">
                Mac Agent Setup Prompt
              </div>
              <button
                type="button"
                onClick={() =>
                  void copyText(AGENT_BOOTSTRAP_PROMPT, 'Mac Agent Setup Prompt copied')
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 text-xs font-mono font-semibold shrink-0 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Agent Prompt</span>
              </button>
            </div>
            <pre className="p-3.5 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 font-mono text-[11px] text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
              {AGENT_BOOTSTRAP_PROMPT}
            </pre>
          </div>
        </div>
      </section>

      {/* TARGET PLATFORMS TABLE */}
      <section className="space-y-5" id="matrix">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-mono text-indigo-600 dark:text-indigo-400 font-medium">
              macOS Primary · Phase 2 Roadmap
            </div>
            <h2 className="text-2xl sm:text-3xl font-semibold text-zinc-950 dark:text-white tracking-tight">
              Build Targets
            </h2>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800 self-start md:self-end">
            {(
              [
                { id: 'all', label: 'All Targets' },
                { id: 'macos', label: 'macOS Primary' },
                { id: 'phase2', label: 'Phase 2 (Linux/Win)' },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setMatrixFilter(btn.id)}
                className={`px-3 py-1 rounded-md text-xs font-mono transition-colors whitespace-nowrap shrink-0 ${
                  matrixFilter === btn.id
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white font-semibold'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-50 dark:bg-[#18181B]/70 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 font-mono text-[11px]">
                  <th className="py-3.5 px-5 font-medium">Target</th>
                  <th className="py-3.5 px-4 font-medium">Stage</th>
                  <th className="py-3.5 px-4 font-medium">Arch</th>
                  <th className="py-3.5 px-4 font-medium">Directory</th>
                  <th className="py-3.5 px-4 font-medium">Command</th>
                  <th className="py-3.5 px-5 font-medium text-right">Setup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredMatrixRows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <td className="py-3.5 px-5">
                      <div className="font-semibold text-zinc-950 dark:text-white">{row.name}</div>
                      <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                        {row.subtitle}
                      </div>
                    </td>
                    <td
                      className={`py-3.5 px-4 font-mono whitespace-nowrap ${
                        row.stage === 'Primary'
                          ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {row.stage}
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
                        className="inline-flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white text-[11px] max-w-[300px]"
                      >
                        <span className="truncate">{row.command}</span>
                        <Copy className="w-3 h-3 shrink-0 text-zinc-400" />
                      </button>
                    </td>
                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenDownloadModal(row.platform)}
                        className="px-3 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        Guide
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
};
