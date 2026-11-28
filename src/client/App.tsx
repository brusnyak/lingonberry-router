import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Download,
  GitFork,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Sun,
  Terminal,
  X,
} from 'lucide-react';
import { DocsCliPage } from './components/DocsCliPage';
import { MenuBarGiga } from './components/MenuBarGiga';
import { SpecsGatewayCronPage } from './components/SpecsGatewayCronPage';
import { SwarmSafetyPage } from './components/SwarmSafetyPage';
import { WebsiteLanding } from './components/WebsiteLanding';
import {
  appendMemoryNote,
  approveKiroSpec,
  createCronJob,
  createKiroSpec,
  dispatchFanoutRun,
  dispatchSwarmBatch,
  dispatchTestRun,
  healCronJob,
  killCronPid,
  killWorkerPid,
  loadRouterState,
  rescanCronJobs,
  resetKeyCooldown,
  routeDryRun,
  runApprovedSpec,
  setMenuBarIdlePreview,
  setProviderRpm,
  setSimulatedPressure,
  simulateCronCrash,
  toggleChannelBridge,
  toggleCronJob,
  toggleCronWatchdog,
  triggerCronJob,
  triggerGateEscalation,
  triggerRescan,
  type RouterRuntimeState,
} from './lib/routerClient';
import { useTheme, type ThemeMode } from './lib/theme';

type PageTab = 'overview' | 'menubar' | 'swarm' | 'specs' | 'docs';
type ArchTab = 'brain' | 'isolation' | 'specs';
type InstallOs = 'macos' | 'linux' | 'windows';

export default function App() {
  const { mode, setMode } = useTheme();
  const [state, setState] = useState<RouterRuntimeState | null>(null);
  const [tab, setTab] = useState<PageTab>(() => {
    if (typeof window !== 'undefined') {
      const h = window.location.hash.replace('#', '');
      if (h === 'menubar' || h === 'swarm' || h === 'specs' || h === 'docs' || h === 'overview') {
        return h;
      }
      if (h === 'cron' || h === 'agents') return 'specs';
    }
    return 'overview';
  });
  const [busy, setBusy] = useState(false);

  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchPrompt, setDispatchPrompt] = useState(
    'Audit core/src/sandbox.rs SBPL deny rules and verify cargo test'
  );
  const [dispatchSandbox, setDispatchSandbox] = useState<'seatbelt' | 'docker'>('seatbelt');
  const [dispatchGlobs, setDispatchGlobs] = useState('core/src/sandbox.rs');
  const [dispatchFault, setDispatchFault] = useState<
    'none' | '429' | 'truncated' | 'gate-escalate'
  >('none');

  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [telemetryQuery, setTelemetryQuery] = useState('');
  const [archOpen, setArchOpen] = useState(false);
  const [archTab, setArchTab] = useState<ArchTab>('brain');
  const [installOpen, setInstallOpen] = useState(false);
  const [installOs, setInstallOs] = useState<InstallOs>('macos');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  const [coreOffline, setCoreOffline] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setState(await loadRouterState());
      setCoreOffline(false);
    } catch {
      setCoreOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2200);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setTelemetryOpen((o) => !o);
      }
      if (e.key === 'Escape') {
        setDispatchOpen(false);
        setTelemetryOpen(false);
        setArchOpen(false);
        setInstallOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navigateTab = useCallback((next: PageTab) => {
    setTab(next);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${next}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const runAction = useCallback(
    async (fn: () => Promise<RouterRuntimeState>) => {
      setBusy(true);
      try {
        const next = await fn();
        setState(next);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Action failed';
        showToast(msg);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [showToast]
  );

  const snap = state?.snapshot;

  const healthyKeysCount = useMemo(
    () => (snap ? snap.workers.filter((w) => w.status !== 'down').length : 0),
    [snap]
  );

  const copyCommand = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      showToast('Copied to clipboard');
    } catch {
      showToast(cmd);
    }
  };

  if (!state || !snap) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2 bg-[#FAFAFA] dark:bg-[#09090B] text-xs font-mono text-zinc-600 dark:text-zinc-400 p-6 text-center">
        {coreOffline ? (
          <>
            <span className="text-zinc-950 dark:text-zinc-100 font-semibold">Core offline</span>
            <span>Nothing is listening on 127.0.0.1:8799. Launch LingonberryBar to start it.</span>
          </>
        ) : (
          'Connecting to Lingonberry Router…'
        )}
      </div>
    );
  }

  // Native tray popover view (#popover)
  if (window.location.hash === '#popover') {
    return (
      <div className="min-h-screen p-2 bg-transparent">
        <MenuBarGiga
          state={state}
          busy={busy}
          onRefresh={() => runAction(() => triggerRescan())}
          onRoute={(p) => runAction(() => routeDryRun(p))}
          onRun={(p) => runAction(() => dispatchTestRun(p))}
          onFanout={(p) => runAction(() => dispatchFanoutRun(p))}
          onSetIdle={() => runAction(() => setMenuBarIdlePreview())}
          onApproveSpec={(id) => runAction(() => approveKiroSpec(id))}
          onRunSpec={(id) => runAction(() => runApprovedSpec(id))}
          onToggleChannel={(id) => runAction(() => toggleChannelBridge(id))}
          onKillWorker={(pid) => runAction(() => killWorkerPid(pid))}
          onResetKey={(name) => runAction(() => resetKeyCooldown(name))}
          onAdjustProviderRpm={(prov, rpm) => runAction(() => setProviderRpm(prov, rpm))}
          onToggleJob={(name) => runAction(() => toggleCronJob(name))}
          onRunJob={(name) => runAction(() => triggerCronJob(name))}
          onHealJob={(name) => runAction(() => healCronJob(name))}
        />
      </div>
    );
  }

  const themeButtons: Array<{ id: ThemeMode; label: string; Icon: typeof Sun }> = [
    { id: 'light', label: 'Light', Icon: Sun },
    { id: 'dark', label: 'Dark', Icon: Moon },
    { id: 'system', label: 'System', Icon: Monitor },
  ];

  const navItems: Array<{ id: PageTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'menubar', label: 'Menu Bar' },
    { id: 'swarm', label: 'Swarm' },
    { id: 'specs', label: 'Specs' },
    { id: 'docs', label: 'CLI & API' },
  ];

  const installData: Record<
    InstallOs,
    { title: string; spec: string; cmd: string; trayCmd: string }
  > = {
    macos: {
      title: 'macOS Core + SwiftUI MenuBarExtra (Primary)',
      spec: 'Apple Silicon (arm64) & Intel · Rust + Swift 5.9+',
      cmd: 'git clone https://github.com/brusnyak/lingonberry-router.git && cd lingonberry-router && ./scripts/install_mac.sh --install',
      trayCmd: 'open "/Applications/Lingonberry Router.app"   # or: cd ui/macos-swift && swift run lingonberry-tray',
    },
    linux: {
      title: 'Linux Core CLI + GTK4 & ksni Tray (Phase 2)',
      spec: 'x86_64 / arm64 · systemd & crontab monitor',
      cmd: 'git clone https://github.com/brusnyak/lingonberry-router.git && cd lingonberry-router/core && cargo install --path . && lingonberry-core init --yes',
      trayCmd: 'cd ui/linux && cargo run --release',
    },
    windows: {
      title: 'Windows 11 / 10 Core CLI + WPF Tray (Phase 2)',
      spec: 'x64 / arm64 · PowerShell + .NET 8 NotifyIcon',
      cmd: 'git clone https://github.com/brusnyak/lingonberry-router.git; cd lingonberry-router\\core; cargo install --path .; lingonberry-core init --yes',
      trayCmd: 'dotnet run --project ui/windows/LingonberryTray.csproj',
    },
  };

  const quickRoutes = [
    {
      path: 'GET /api/snapshot',
      target: `${snap.workers_live.length} live · ${snap.specs?.length ?? 0} specs`,
      meta: '127.0.0.1:8799',
    },
    {
      path: 'GET /api/watchdog',
      target: `${snap.watchdog?.memory_pressure ?? 'normal'} · ${snap.watchdog?.ram_used_pct.toFixed(0) ?? '54'}% RAM`,
      meta: 'RAM / Disk',
    },
    {
      path: 'GET /api/swarm',
      target: `${snap.swarm?.active_leases.length ?? 0} leases · ${snap.swarm?.merge_queue.length ?? 0} merges`,
      meta: 'Worktree Mutex',
    },
    {
      path: 'GET /api/channels',
      target: `${(snap.gateway?.channels ?? []).filter((c) => c.enabled).length} connected`,
      meta: 'Telegram / Slack / MCP',
    },
  ].filter(
    (r) =>
      !telemetryQuery.trim() ||
      r.path.toLowerCase().includes(telemetryQuery.toLowerCase()) ||
      r.target.toLowerCase().includes(telemetryQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#09090B] text-zinc-950 dark:text-zinc-100 flex flex-col selection:bg-indigo-500/20">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="sticky top-0 z-40 border-b border-zinc-200 dark:border-zinc-800/80 bg-white/90 dark:bg-[#09090B]/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element clean wordmark */}
          <button
            type="button"
            onClick={() => navigateTab('overview')}
            className="text-lg font-bold tracking-tight text-zinc-950 dark:text-white whitespace-nowrap shrink-0 hover:opacity-75 transition-opacity"
          >
            Lingonberry
          </button>

          {/* Zone 2: 5 concise single-line text nav links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-[13px] font-medium"
          >
            {navItems.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTab(item.id)}
                  className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-zinc-950 dark:border-white text-zinc-950 dark:text-white font-semibold'
                      : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Monochrome Primary CTA */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setDispatchOpen(true)}
              className="px-4 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Dispatch Run
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Nav Strip (< md) */}
      <div className="md:hidden border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] px-5 py-2.5 flex items-center gap-4 overflow-x-auto">
        {navItems.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateTab(item.id)}
              className={`text-xs font-medium whitespace-nowrap shrink-0 py-1 ${
                active
                  ? 'text-zinc-950 dark:text-white font-semibold'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* MAIN CONTENT */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-5 md:px-8 pt-10">
        {tab === 'overview' && (
          <WebsiteLanding
            state={state}
            busy={busy}
            onShowToast={showToast}
            onOpenTelemetryModal={() => setTelemetryOpen(true)}
            onOpenArchModal={() => setArchOpen(true)}
            onOpenDownloadModal={(os = 'macos') => {
              setInstallOs(os);
              setInstallOpen(true);
            }}
            onNavigateTab={navigateTab}
            onRefresh={() => runAction(() => triggerRescan())}
            onRoute={(p) => runAction(() => routeDryRun(p))}
            onRun={(p) => runAction(() => dispatchTestRun(p))}
            onFanout={(p) => runAction(() => dispatchFanoutRun(p))}
            onSetIdle={() => runAction(() => setMenuBarIdlePreview())}
            onApproveSpec={(id) => runAction(() => approveKiroSpec(id))}
            onRunSpec={(id) => runAction(() => runApprovedSpec(id))}
            onToggleChannel={(id) => runAction(() => toggleChannelBridge(id))}
            onKillWorker={(pid) => runAction(() => killWorkerPid(pid))}
            onResetKey={(name) => runAction(() => resetKeyCooldown(name))}
            onAdjustProviderRpm={(prov, rpm) => runAction(() => setProviderRpm(prov, rpm))}
            onToggleJob={(name) => runAction(() => toggleCronJob(name))}
            onRunJob={(name) => runAction(() => triggerCronJob(name))}
            onHealJob={(name) => runAction(() => healCronJob(name))}
          />
        )}

        {tab === 'menubar' && (
          <div className="space-y-8 pb-16">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-6">
              <div className="space-y-1.5">
                <div className="text-xs font-mono text-indigo-600 dark:text-indigo-400 font-medium">
                  SwiftUI MenuBarExtra Workbench
                </div>
                <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-950 dark:text-white tracking-tight">
                  macOS Menu Bar: Simulator &amp; Mockups
                </h1>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runAction(() => triggerRescan())}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#111114] text-xs font-mono hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                <span>Rescan Host &amp; Keys</span>
              </button>
            </div>

            <MenuBarGiga
              state={state}
              busy={busy}
              onRefresh={() => runAction(() => triggerRescan())}
              onRoute={(p) => runAction(() => routeDryRun(p))}
              onRun={(p) => runAction(() => dispatchTestRun(p))}
              onFanout={(p) => runAction(() => dispatchFanoutRun(p))}
              onSetIdle={() => runAction(() => setMenuBarIdlePreview())}
              onApproveSpec={(id) => runAction(() => approveKiroSpec(id))}
              onRunSpec={(id) => runAction(() => runApprovedSpec(id))}
              onToggleChannel={(id) => runAction(() => toggleChannelBridge(id))}
              onKillWorker={(pid) => runAction(() => killWorkerPid(pid))}
              onResetKey={(name) => runAction(() => resetKeyCooldown(name))}
              onAdjustProviderRpm={(prov, rpm) => runAction(() => setProviderRpm(prov, rpm))}
              onToggleJob={(name) => runAction(() => toggleCronJob(name))}
              onRunJob={(name) => runAction(() => triggerCronJob(name))}
              onHealJob={(name) => runAction(() => healCronJob(name))}
            />
          </div>
        )}

        {tab === 'swarm' && (
          <SwarmSafetyPage
            state={state}
            busy={busy}
            onDispatchSwarm={(count) => runAction(() => dispatchSwarmBatch(count))}
            onSetPressure={(level) => runAction(() => setSimulatedPressure(level))}
            onTriggerEscalation={(prompt) => runAction(() => triggerGateEscalation(prompt))}
            onKillWorker={(pid) => runAction(() => killWorkerPid(pid))}
          />
        )}

        {tab === 'specs' && (
          <SpecsGatewayCronPage
            state={state}
            busy={busy}
            onShowToast={showToast}
            onCreateSpec={(params) => runAction(() => createKiroSpec(params))}
            onApproveSpec={(specId) => runAction(() => approveKiroSpec(specId))}
            onRunSpec={(specId) => runAction(() => runApprovedSpec(specId))}
            onToggleChannel={(id) => runAction(() => toggleChannelBridge(id))}
            onAppendMemory={(note) => runAction(() => appendMemoryNote(note))}
            onRescanCron={() => runAction(() => rescanCronJobs())}
            onKillCronPid={(pid) => runAction(() => killCronPid(pid))}
            onToggleJob={(name) => runAction(() => toggleCronJob(name))}
            onToggleWatchdog={(name) => runAction(() => toggleCronWatchdog(name))}
            onRunJob={(name) => runAction(() => triggerCronJob(name))}
            onHealJob={(name) => runAction(() => healCronJob(name))}
            onSimulateCrash={(name) => runAction(() => simulateCronCrash(name))}
            onCreateJob={(params) => runAction(() => createCronJob(params))}
          />
        )}

        {tab === 'docs' && <DocsCliPage onShowToast={showToast} />}
      </main>

      {/* CLEAN FOOTER WITH THEME SWITCHER & ACTIONS */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] py-7">
        <div className="max-w-6xl mx-auto px-5 md:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono">
            <span className="font-semibold text-zinc-950 dark:text-white">Lingonberry Router</span>
            <button
              type="button"
              onClick={() => setArchOpen(true)}
              className="hover:text-zinc-950 dark:hover:text-white"
            >
              Architecture
            </button>
            <button
              type="button"
              onClick={() => setTelemetryOpen(true)}
              className="hover:text-zinc-950 dark:hover:text-white"
            >
              Inspector (⌘K)
            </button>
            <button
              type="button"
              onClick={() => navigateTab('docs')}
              className="hover:text-zinc-950 dark:hover:text-white"
            >
              CLI &amp; API
            </button>
            <a
              href="https://github.com/brusnyak/lingonberry-router"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-950 dark:hover:text-white"
            >
              GitHub
            </a>
          </div>

          <div
            role="group"
            aria-label="Theme mode"
            className="inline-flex items-center gap-1 p-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B]"
          >
            {themeButtons.map(({ id, label, Icon }) => {
              const active = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
                    active
                      ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white font-semibold'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </footer>

      {/* MODAL 1: DISPATCH RUN */}
      {dispatchOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Dispatch Worker Run"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-zinc-950/60 backdrop-blur-xs"
            onClick={() => setDispatchOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800 shadow-2xl p-6 z-10 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
                Dispatch Sandboxed Worker Run
              </h3>
              <button
                type="button"
                onClick={() => setDispatchOpen(false)}
                className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block font-mono text-zinc-500 dark:text-zinc-400 mb-1.5">
                  Prompt
                </label>
                <textarea
                  rows={3}
                  value={dispatchPrompt}
                  onChange={(e) => setDispatchPrompt(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] font-mono text-zinc-950 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-zinc-500 dark:text-zinc-400 mb-1.5">
                    Sandbox Tier
                  </label>
                  <select
                    value={dispatchSandbox}
                    onChange={(e) => setDispatchSandbox(e.target.value as 'seatbelt' | 'docker')}
                    className="w-full h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] font-mono"
                  >
                    <option value="seatbelt">Seatbelt (sandbox-exec)</option>
                    <option value="docker">Docker (cap-drop)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-mono text-zinc-500 dark:text-zinc-400 mb-1.5">
                    Execution Outcome
                  </label>
                  <select
                    value={dispatchFault}
                    onChange={(e) =>
                      setDispatchFault(
                        e.target.value as 'none' | '429' | 'truncated' | 'gate-escalate'
                      )
                    }
                    className="w-full h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] font-mono"
                  >
                    <option value="none">Clean Free-Pool Pass</option>
                    <option value="gate-escalate">Gate Fail → Escalate Claude</option>
                    <option value="429">429 Burst → Sibling Failover</option>
                    <option value="truncated">Truncated → Sibling Retry</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-mono text-zinc-500 dark:text-zinc-400 mb-1.5">
                  PathLease Globs
                </label>
                <input
                  type="text"
                  value={dispatchGlobs}
                  onChange={(e) => setDispatchGlobs(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#09090B] font-mono"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDispatchOpen(false)}
                className="px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !dispatchPrompt.trim()}
                onClick={() => {
                  const globs = dispatchGlobs
                    .split(',')
                    .map((g) => g.trim())
                    .filter(Boolean);
                  void runAction(() =>
                    dispatchTestRun({
                      prompt: dispatchPrompt.trim(),
                      caller: 'web:dispatch',
                      worktree: true,
                      sandbox_tier: dispatchSandbox,
                      path_globs: globs.length > 0 ? globs : ['core/src/**'],
                      simulate_fault: dispatchFault,
                      live_api: false,
                    })
                  );
                  setDispatchOpen(false);
                  showToast(`Dispatched under ${dispatchSandbox}`);
                }}
                className="px-4 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 text-xs font-semibold"
              >
                Start Worker
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: TELEMETRY INSPECTOR (⌘K) */}
      {telemetryOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Lingonberry Telemetry Inspector"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-zinc-950/60 backdrop-blur-xs"
            onClick={() => setTelemetryOpen(false)}
          />
          <div className="relative w-full max-w-2xl rounded-xl bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800 shadow-2xl p-6 z-10 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
                  Lingonberry Telemetry &amp; Endpoint Inspector
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setTelemetryOpen(false)}
                className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={telemetryQuery}
                onChange={(e) => setTelemetryQuery(e.target.value)}
                placeholder="Filter routes, watchdog, swarm leases, or channels…"
                className="w-full h-9 bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-700 rounded-lg pl-9 pr-4 font-mono text-xs"
              />
            </div>

            <div className="grid grid-cols-3 gap-3 font-mono tabular-nums">
              <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800">
                <div className="text-[11px] text-zinc-500">Live Workers</div>
                <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {snap.workers_live.length} active
                </div>
              </div>
              <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800">
                <div className="text-[11px] text-zinc-500">Healthy Key Slots</div>
                <div className="text-lg font-semibold text-zinc-950 dark:text-white mt-0.5">
                  {healthyKeysCount}/{snap.workers.length}
                </div>
              </div>
              <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800">
                <div className="text-[11px] text-zinc-500">RAM · Disk Free</div>
                <div className="text-lg font-semibold text-zinc-950 dark:text-white mt-0.5">
                  {snap.watchdog
                    ? `${snap.watchdog.ram_used_pct.toFixed(0)}% · ${snap.watchdog.free_disk_gb.toFixed(0)}G`
                    : '54% · 325G'}
                </div>
              </div>
            </div>

            <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg divide-y divide-zinc-200 dark:divide-zinc-800 font-mono text-xs">
              {quickRoutes.map((r) => (
                <div key={r.path} className="p-3 flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-950 dark:text-white">{r.path}</span>
                  <span className="text-indigo-600 dark:text-indigo-400 truncate">{r.target}</span>
                  <span className="text-[10.5px] text-zinc-400 shrink-0">{r.meta}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: ARCHITECTURE SPEC */}
      {archOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Lingonberry Architecture Specification"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-zinc-950/60 backdrop-blur-xs"
            onClick={() => setArchOpen(false)}
          />
          <div className="relative w-full max-w-2xl rounded-xl bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800 shadow-2xl p-6 z-10 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <GitFork className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
                  Lingonberry Core &amp; Safety Architecture
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setArchOpen(false)}
                className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-2.5 font-mono text-xs">
              {(
                [
                  { id: 'brain', label: '1. Semantic Brain' },
                  { id: 'isolation', label: '2. Seatbelt & Docker' },
                  { id: 'specs', label: '3. Kiro Specs & Channels' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setArchTab(t.id)}
                  className={`px-3 py-1 rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    archTab === t.id
                      ? 'bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 font-semibold'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="text-[13px] text-zinc-700 dark:text-zinc-300 leading-relaxed space-y-2 min-h-[110px]">
              {archTab === 'brain' && (
                <p>
                  Requests run through a zero-API-cost 2-stage pipeline: structural complexity
                  tiering followed by BM25 matching across global and mini-harness{' '}
                  <code>SKILL.md</code> files. Runs start on <code>pi-rust</code> + free pools
                  (Kilo, OpenCode, NIM, Groq, Gemini) and auto-escalate to Claude or Codex only on
                  gate failure within budget and 5h burst caps.
                </p>
              )}
              {archTab === 'isolation' && (
                <p>
                  Every mutating HTTP route enforces bearer auth from{' '}
                  <code>~/.lingonberry/api.token</code>. Local workers run inside dynamic macOS
                  Seatbelt (<code>sandbox-exec</code>) confining writes to git worktrees and denying{' '}
                  <code>~/.ssh</code>, Keychains, and <code>.env</code>. Heavy/overnight specs run
                  in read-only capability-dropped Docker containers while the Watchdog monitors RAM,
                  APFS free disk, and RPM limits.
                </p>
              )}
              {archTab === 'specs' && (
                <p>
                  Overnight runs execute strictly from owner-signed SHA-256 Kiro specs verified with
                  deterministic <code>git diff --name-only</code> path checks. Outbound-only
                  Telegram, Slack Socket Mode, Discord Gateway, and MCP adapters share one SQLite
                  session store and <code>~/.lingonberry/memory/MEMORY.md</code> without public web
                  hosting.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: INSTALL & BUILD GUIDE */}
      {installOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install Lingonberry Router"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-zinc-950/60 backdrop-blur-xs"
            onClick={() => setInstallOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800 shadow-2xl p-6 z-10 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
                  Install &amp; Run Lingonberry Router
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInstallOpen(false)}
                className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800">
              {(['macos', 'linux', 'windows'] as const).map((os) => (
                <button
                  key={os}
                  type="button"
                  onClick={() => setInstallOs(os)}
                  className={`flex-1 py-1.5 rounded-md font-mono text-xs transition-colors whitespace-nowrap shrink-0 ${
                    installOs === os
                      ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white font-semibold'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {os === 'macos' ? 'macOS' : os === 'linux' ? 'Linux' : 'Windows'}
                </button>
              ))}
            </div>

            <div className="p-4 rounded-lg bg-zinc-50 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 space-y-3.5">
              <div>
                <div className="text-xs font-semibold text-zinc-950 dark:text-white">
                  {installData[installOs].title}
                </div>
                <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {installData[installOs].spec}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-mono text-zinc-400">
                  1. Install Core, Self-Config &amp; App Bundle
                </div>
                <div className="p-2.5 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                  <code className="font-mono text-[11px] text-zinc-800 dark:text-zinc-300 break-all">
                    {installData[installOs].cmd}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyCommand(installData[installOs].cmd)}
                    className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-mono text-zinc-400">
                  2. Launch Menu Bar / Tray
                </div>
                <div className="p-2.5 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                  <code className="font-mono text-[11px] text-zinc-800 dark:text-zinc-300 break-all">
                    {installData[installOs].trayCmd}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyCommand(installData[installOs].trayCmd)}
                    className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-6 right-6 z-50 transition-all duration-200 px-4 py-2.5 rounded-lg bg-zinc-900 dark:bg-zinc-800 border border-zinc-700 text-white font-mono text-xs shadow-xl ${
          toastMsg ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0 pointer-events-none'
        }`}
      >
        {toastMsg ?? ''}
      </div>
    </div>
  );
}
