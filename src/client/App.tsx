import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  GitFork,
  Monitor,
  Moon,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sun,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import { DocsCliPage } from './components/DocsCliPage';
import { MenuBarGiga } from './components/MenuBarGiga';
import { WebsiteLanding } from './components/WebsiteLanding';
import {
  applySelfConfigTargets,
  createCronJob,
  dispatchFanoutRun,
  dispatchTestRun,
  healCronJob,
  killCronPid,
  killWorkerPid,
  loadRouterState,
  rescanCronJobs,
  resetKeyCooldown,
  routeDryRun,
  setProviderRpm,
  simulateCronCrash,
  toggleCronJob,
  toggleCronWatchdog,
  triggerCronJob,
  triggerRescan,
  type RouterRuntimeState,
} from './lib/routerClient';
import { useTheme, type ThemeMode } from './lib/theme';

type PageTab = 'overview' | 'menubar' | 'cron' | 'agents' | 'docs';
type ArchTab = 'cook' | 'keypool' | 'watchdog';
type InstallOs = 'macos' | 'linux' | 'windows';

export default function App() {
  const { mode, setMode } = useTheme();
  const [state, setState] = useState<RouterRuntimeState | null>(null);
  const [tab, setTab] = useState<PageTab>(() => {
    if (typeof window !== 'undefined') {
      const h = window.location.hash.replace('#', '');
      if (h === 'menubar' || h === 'cron' || h === 'agents' || h === 'docs' || h === 'overview') {
        return h;
      }
    }
    return 'overview';
  });
  const [busy, setBusy] = useState(false);

  // Modals & Toast
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [telemetryQuery, setTelemetryQuery] = useState('');
  const [archOpen, setArchOpen] = useState(false);
  const [archTab, setArchTab] = useState<ArchTab>('cook');
  const [installOpen, setInstallOpen] = useState(false);
  const [installOs, setInstallOs] = useState<InstallOs>('macos');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Cron Oversight page state
  const [expandedJobLogs, setExpandedJobLogs] = useState<string | null>(null);
  const [jobName, setJobName] = useState('');
  const [jobSchedule, setJobSchedule] = useState('*/15 * * * *');
  const [jobEveryS, setJobEveryS] = useState('900');
  const [jobCommand, setJobCommand] = useState('');
  const [jobAutoRestart, setJobAutoRestart] = useState(true);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2400);
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

  const runAction = useCallback(async (fn: () => Promise<RouterRuntimeState>) => {
    setBusy(true);
    try {
      const next = await fn();
      setState(next);
    } finally {
      setBusy(false);
    }
  }, []);

  const snap = state?.snapshot;

  const crashedJobsCount = useMemo(
    () => (snap ? snap.jobs.filter((j) => j.health === 'crashed').length : 0),
    [snap]
  );

  const healthyKeysCount = useMemo(
    () => (snap ? snap.workers.filter((w) => w.status !== 'down').length : 0),
    [snap]
  );

  const copyCommand = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      showToast(`Copied: ${cmd}`);
    } catch {
      showToast(cmd);
    }
  };

  if (!state || !snap) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2 bg-[#f4f5f7] dark:bg-[#090a0d] text-xs font-mono text-zinc-500 dark:text-slate-400 p-6 text-center">
        {coreOffline ? (
          <>
            <span className="text-zinc-800 dark:text-slate-200">Core offline</span>
            <span>Nothing is listening on 127.0.0.1:8799. Quit and reopen the app to start it.</span>
          </>
        ) : (
          'Connecting to Lingonberry Router…'
        )}
      </div>
    );
  }

  // Tray popover window (tray/tauri.conf.json loads index.html#popover): the giga menu bar only.
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
    { id: 'light', label: 'Day', Icon: Sun },
    { id: 'dark', label: 'Night', Icon: Moon },
    { id: 'system', label: 'System', Icon: Monitor },
  ];

  const navItems: Array<{ id: PageTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'menubar', label: 'Menu Bar' },
    {
      id: 'cron',
      label:
        crashedJobsCount > 0
          ? `Cron (${crashedJobsCount}!)`
          : `Cron (${snap.jobs.length})`,
    },
    { id: 'agents', label: 'Agents' },
    { id: 'docs', label: 'Docs & CLI' },
  ];

  const installData: Record<
    InstallOs,
    { title: string; spec: string; cmd: string; trayCmd: string }
  > = {
    macos: {
      title: 'macOS Core CLI + SwiftUI Menu Bar',
      spec: 'Apple Silicon (arm64) & Intel (x86_64) · Cargo + Swift 5.9+',
      cmd: 'git clone https://github.com/brusnyak/lingonberry-router.git && cd lingonberry-router/core && cargo install --path . && lingonberry-core init && lingonberry-core doctor',
      trayCmd: 'cd ui/macos-swift && swift run LingonberryBar',
    },
    linux: {
      title: 'Linux Core CLI + GTK4 & ksni Tray',
      spec: 'x86_64 / arm64 · systemd & crontab watchdog',
      cmd: 'git clone https://github.com/brusnyak/lingonberry-router.git && cd lingonberry-router/core && cargo install --path . && lingonberry-core init && lingonberry-core doctor',
      trayCmd: 'cd ui/linux && cargo run --release',
    },
    windows: {
      title: 'Windows 11 / 10 Core CLI + WPF Tray',
      spec: 'x64 / arm64 · PowerShell + .NET 8 NotifyIcon & schtasks',
      cmd: 'git clone https://github.com/brusnyak/lingonberry-router.git; cd lingonberry-router\\core; cargo install --path .; lingonberry-core init; lingonberry-core doctor',
      trayCmd: 'dotnet run --project ui/windows/LingonberryTray.csproj',
    },
  };

  const quickRoutes = [
    { path: 'GET /snapshot', target: `${snap.workers_live.length} active · ${snap.jobs.length} jobs`, meta: '127.0.0.1:8799' },
    { path: 'GET /keys', target: `${healthyKeysCount}/${snap.workers.length} keys healthy`, meta: 'RAII KeyPool' },
    { path: 'GET /api/jobs', target: `${snap.cron_live.length} live OS cron PIDs`, meta: 'crontab/launchd/systemd' },
    { path: 'POST /api/rescan', target: `${state.discovery.agents.length} CLIs · ${state.discovery.library_dirs.length} skill dirs`, meta: 'discovery' },
  ].filter(
    (r) =>
      !telemetryQuery.trim() ||
      r.path.toLowerCase().includes(telemetryQuery.toLowerCase()) ||
      r.target.toLowerCase().includes(telemetryQuery.toLowerCase())
  );

  return (
    <div className="relative min-h-screen bg-[#f4f5f7] dark:bg-[#090a0d] text-zinc-900 dark:text-[#f1f2f6] pb-16 selection:bg-amber-500/20">
      {/* Ambient Luxury Spotlights (Dark Mode) */}
      <div className="hidden dark:block fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[1100px] h-[520px]"
          style={{
            background:
              'radial-gradient(circle at 50% 0%, rgba(229, 169, 80, 0.14) 0%, rgba(16, 185, 129, 0.03) 42%, rgba(9, 10, 13, 0) 75%)',
          }}
        />
        <div className="absolute top-[380px] right-[10%] w-[420px] h-[420px] bg-emerald-500/[0.04] rounded-full blur-[140px]" />
        <div className="absolute top-[820px] left-[5%] w-[500px] h-[500px] bg-amber-500/[0.04] rounded-full blur-[150px]" />
      </div>

      {/* FLOATING PILL TOP NAVIGATION */}
      <header className="sticky top-4 z-40 px-4 w-full flex justify-center">
        <nav
          aria-label="Primary navigation"
          className="bg-white/85 dark:bg-[#11131b]/80 backdrop-blur-xl rounded-full px-3.5 sm:px-4 py-2 flex items-center justify-between gap-3 md:gap-6 max-w-5xl w-full mx-auto border border-zinc-200 dark:border-white/[0.09] shadow-md dark:shadow-[0_20px_45px_-10px_rgba(0,0,0,0.8)]"
        >
          {/* Brand */}
          <button
            type="button"
            onClick={() => navigateTab('overview')}
            className="flex items-center gap-2.5 group shrink-0 text-left"
          >
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-xs p-0.5">
              <div className="w-3 h-3 rounded-full bg-white dark:bg-[#090a0d] flex items-center justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-[#fabb60]" />
              </div>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[13px] font-semibold tracking-tight text-zinc-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-[#fabb60] transition-colors">
                Lingonberry
              </span>
              <span className="hidden sm:inline text-[10px] font-mono text-zinc-500 dark:text-[#9ba1b4] font-medium px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/[0.05] border border-zinc-200 dark:border-white/[0.06]">
                router
              </span>
            </div>
          </button>

          {/* Center Nav Links */}
          <div className="hidden md:flex items-center gap-1 text-[12px] font-medium">
            {navItems.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTab(item.id)}
                  className={`px-2.5 py-1 rounded-full transition-colors ${
                    active
                      ? 'bg-zinc-900 text-white dark:bg-white/[0.1] dark:text-[#fabb60]'
                      : 'text-zinc-600 dark:text-[#9ba1b4] hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Theme Mode Compact Switcher */}
            <div
              role="group"
              aria-label="Theme mode"
              className="inline-flex rounded-full border border-zinc-200 dark:border-white/[0.08] bg-zinc-100/80 dark:bg-white/[0.04] p-0.5"
            >
              {themeButtons.map(({ id, label, Icon }) => {
                const active = mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    title={`Theme: ${label}`}
                    onClick={() => setMode(id)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10.5px] font-mono transition ${
                      active
                        ? 'bg-white dark:bg-[#1c1f2b] text-zinc-900 dark:text-white shadow-2xs'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span className="hidden lg:inline">{label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setTelemetryOpen(true)}
              title="Command & Telemetry Inspector (Cmd+K)"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.05] dark:hover:bg-white/[0.1] border border-zinc-200 dark:border-white/[0.08] text-zinc-600 dark:text-[#9ba1b4] hover:text-zinc-900 dark:hover:text-white text-[11px] font-mono transition"
            >
              <Terminal className="w-3 h-3" />
              <span>⌘K</span>
            </button>

            <a
              href="https://github.com/brusnyak/lingonberry-router"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] border border-zinc-200 dark:border-white/[0.08] text-zinc-800 dark:text-white text-[11px] font-mono transition"
            >
              <span>GitHub</span>
              <ArrowUpRight className="w-3 h-3 text-amber-600 dark:text-[#fabb60]" />
            </a>
          </div>
        </nav>
      </header>

      {/* Mobile Nav Bar (visible < md) */}
      <div className="md:hidden sticky top-[68px] z-30 px-4 mt-2 flex justify-center">
        <div className="flex items-center gap-1 overflow-x-auto max-w-full p-1 rounded-full bg-white/90 dark:bg-[#11131b]/90 backdrop-blur border border-zinc-200 dark:border-white/[0.08]">
          {navItems.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTab(item.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-mono whitespace-nowrap transition ${
                  active
                    ? 'bg-zinc-900 text-white dark:bg-white/[0.12] dark:text-[#fabb60]'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* MAIN PAGE CONTAINER */}
      <main className="relative z-10 max-w-5xl mx-auto px-4 md:px-6 pt-8 md:pt-12">
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
            onKillWorker={(pid) => runAction(() => killWorkerPid(pid))}
            onResetKey={(name) => runAction(() => resetKeyCooldown(name))}
            onAdjustProviderRpm={(prov, rpm) => runAction(() => setProviderRpm(prov, rpm))}
            onToggleJob={(name) => runAction(() => toggleCronJob(name))}
            onRunJob={(name) => runAction(() => triggerCronJob(name))}
            onHealJob={(name) => runAction(() => healCronJob(name))}
          />
        )}

        {tab === 'menubar' && (
          <div className="space-y-5 pb-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-amber-600 dark:text-[#fabb60] font-semibold">
                  Menu Bar Workbench
                </div>
                <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white tracking-tight">
                  Live Orchestration, Worker Kill &amp; KeyPool Caps
                </h1>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runAction(() => triggerRescan())}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] text-xs font-mono hover:bg-zinc-50 dark:hover:bg-[#1a1d26]"
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
              onKillWorker={(pid) => runAction(() => killWorkerPid(pid))}
              onResetKey={(name) => runAction(() => resetKeyCooldown(name))}
              onAdjustProviderRpm={(prov, rpm) => runAction(() => setProviderRpm(prov, rpm))}
              onToggleJob={(name) => runAction(() => toggleCronJob(name))}
              onRunJob={(name) => runAction(() => triggerCronJob(name))}
              onHealJob={(name) => runAction(() => healCronJob(name))}
              onOpenCronTab={() => navigateTab('cron')}
              onOpenAgentsTab={() => navigateTab('agents')}
            />
          </div>
        )}

        {tab === 'cron' && (
          <div className="space-y-4 pb-10 max-w-4xl mx-auto">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-amber-600 dark:text-[#fabb60] font-semibold">
                  Host Scheduler &amp; Watchdog Supervision
                </div>
                <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white tracking-tight">
                  Cron Jobs Oversight ({snap.jobs.length})
                </h1>
                <p className="text-[12.5px] text-zinc-600 dark:text-[#9ba1b4] mt-0.5">
                  Oversee active host processes matched from crontab, launchd, systemd, schtasks &amp;
                  router schedules.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runAction(() => rescanCronJobs())}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] text-xs font-mono font-medium hover:bg-zinc-50 dark:hover:bg-[#1a1d26]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                <span>Rescan Host Crons</span>
              </button>
            </div>

            {/* Live Running Cron Processes */}
            <section className="rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-zinc-700 dark:text-slate-200">
                  Live OS Cron Processes ({snap.cron_live.length})
                </h2>
                <span className="text-[11px] font-mono text-zinc-400">
                  sysinfo process monitor
                </span>
              </div>

              {snap.cron_live.length === 0 ? (
                <div className="px-3 py-3 rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-[#f8f9fb] dark:bg-[#0c0e14] text-xs font-mono text-zinc-500 dark:text-slate-400">
                  No active cron child processes executing at this instant.
                </div>
              ) : (
                <div className="space-y-2">
                  {snap.cron_live.map((proc) => (
                    <div
                      key={proc.pid}
                      className="px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-[#f8f9fb] dark:bg-[#0c0e14] flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-900 dark:text-slate-100 font-mono">
                          pid {proc.pid} · {proc.job_name}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500 dark:text-slate-400 truncate max-w-[460px]">
                          {proc.command}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
                        <span className="text-zinc-500 dark:text-slate-400">
                          {proc.cpu_pct.toFixed(1)}% cpu · {proc.mem_mb.toFixed(1)} MB ·{' '}
                          {proc.elapsed_s}s
                        </span>
                        <button
                          type="button"
                          onClick={() => void runAction(() => killCronPid(proc.pid))}
                          className="px-2.5 py-1 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[11px] font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-500/20"
                        >
                          Kill PID
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Scheduled Jobs + Watchdog Maintenance */}
            <section className="rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] p-4">
              <div className="text-xs font-mono uppercase tracking-wider font-semibold text-zinc-700 dark:text-slate-200 mb-3">
                Scheduled Jobs &amp; Watchdog Health ({snap.jobs.length})
              </div>

              <div className="space-y-2.5">
                {snap.jobs.map((job) => {
                  const logsOpen = expandedJobLogs === job.name;
                  const isCrashed = job.health === 'crashed';
                  return (
                    <div
                      key={job.name}
                      className="rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-[#f8f9fb] dark:bg-[#0c0e14] overflow-hidden"
                    >
                      <div className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isCrashed
                                  ? 'bg-rose-500'
                                  : job.health === 'running'
                                    ? 'bg-sky-500'
                                    : job.paused
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-500'
                              }`}
                            />
                            <span className="text-xs font-semibold text-zinc-900 dark:text-slate-100">
                              {job.name}
                            </span>
                            <span className="text-[10.5px] font-mono text-zinc-400 dark:text-slate-500">
                              [{job.source}]
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-zinc-500 dark:text-slate-400">
                            {job.schedule} · health: {job.health} · crashes: {job.crash_count} ·
                            restarts: {job.restart_count}
                          </div>
                          <div className="text-[10.5px] font-mono text-zinc-400 dark:text-slate-500 truncate max-w-xl">
                            {job.command}
                          </div>
                          {job.last_error && (
                            <div className="text-[10.5px] font-mono text-rose-600 dark:text-rose-400">
                              error: {job.last_error}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0 font-mono">
                          <button
                            type="button"
                            onClick={() => void runAction(() => toggleCronWatchdog(job.name))}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10.5px] ${
                              job.auto_restart
                                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'border-zinc-200 dark:border-white/[0.08] text-zinc-500 dark:text-slate-400'
                            }`}
                          >
                            <ShieldCheck className="w-3 h-3" />
                            KeepAlive {job.auto_restart ? 'ON' : 'OFF'}
                          </button>

                          <button
                            type="button"
                            onClick={() => void runAction(() => toggleCronJob(job.name))}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] text-[10.5px] text-zinc-700 dark:text-slate-200 hover:bg-zinc-100 dark:hover:bg-[#1a1d26]"
                          >
                            {job.paused ? (
                              <>
                                <Play className="w-2.5 h-2.5" /> Resume
                              </>
                            ) : (
                              <>
                                <Pause className="w-2.5 h-2.5" /> Pause
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => void runAction(() => triggerCronJob(job.name))}
                            className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] text-[10.5px] text-zinc-700 dark:text-slate-200 hover:bg-zinc-100 dark:hover:bg-[#1a1d26]"
                          >
                            Run
                          </button>

                          <button
                            type="button"
                            onClick={() => void runAction(() => simulateCronCrash(job.name))}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] text-[10.5px] text-zinc-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                            title="Simulate rc=137 crash to verify watchdog recovery or manual Heal"
                          >
                            <XCircle className="w-2.5 h-2.5" />
                            Test Crash
                          </button>

                          {isCrashed && (
                            <button
                              type="button"
                              onClick={() => void runAction(() => healCronJob(job.name))}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[10.5px] font-semibold hover:opacity-90"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              Heal
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setExpandedJobLogs(logsOpen ? null : job.name)}
                            className="px-2 py-1 rounded-lg text-[10.5px] text-zinc-500 dark:text-slate-400 hover:text-zinc-900 dark:hover:text-white"
                          >
                            {logsOpen ? 'Hide logs' : 'Logs'}
                          </button>
                        </div>
                      </div>

                      {logsOpen && (
                        <div className="px-3 py-2.5 border-t border-zinc-200 dark:border-white/[0.05] bg-white dark:bg-[#090b0e] text-[10.5px] font-mono space-y-1 text-zinc-600 dark:text-slate-400">
                          {job.log_tail.map((line, i) => (
                            <div key={i}>&gt; {line}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Register Supervised Cron Job */}
            <section className="rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] p-4">
              <div className="text-xs font-mono uppercase tracking-wider font-semibold text-zinc-700 dark:text-slate-200 mb-3">
                Add Supervised Cron Job
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="text"
                  placeholder="job-name"
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  className="sm:col-span-3 h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-[#f8f9fb] dark:bg-[#0c0e14] text-xs font-mono"
                />
                <input
                  type="text"
                  placeholder="*/15 * * * *"
                  value={jobSchedule}
                  onChange={(e) => setJobSchedule(e.target.value)}
                  className="sm:col-span-2 h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-[#f8f9fb] dark:bg-[#0c0e14] text-xs font-mono"
                />
                <input
                  type="number"
                  min={30}
                  placeholder="every_s"
                  value={jobEveryS}
                  onChange={(e) => setJobEveryS(e.target.value)}
                  className="sm:col-span-2 h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-[#f8f9fb] dark:bg-[#0c0e14] text-xs font-mono"
                />
                <input
                  type="text"
                  placeholder="command or prompt to execute"
                  value={jobCommand}
                  onChange={(e) => setJobCommand(e.target.value)}
                  className="sm:col-span-3 h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-[#f8f9fb] dark:bg-[#0c0e14] text-xs"
                />
                <button
                  type="button"
                  disabled={busy || !jobName.trim()}
                  onClick={() => {
                    const cleanName = jobName.trim();
                    const cmd = jobCommand.trim() || `lingonberry-core run "${cleanName}"`;
                    void runAction(async () => {
                      const res = await createCronJob({
                        name: cleanName,
                        every_s: Math.max(30, Number(jobEveryS) || 300),
                        schedule: jobSchedule.trim() || 'every 300s',
                        command: cmd,
                        prompt: cmd,
                        auto_restart: jobAutoRestart,
                      });
                      setJobName('');
                      setJobCommand('');
                      showToast(`Scheduled ${cleanName}`);
                      return res;
                    });
                  }}
                  className="sm:col-span-2 h-9 rounded-lg bg-zinc-900 dark:bg-[#fabb60] text-white dark:text-[#1b1200] text-xs font-semibold disabled:opacity-45"
                >
                  Schedule
                </button>
              </div>
              <label className="mt-2.5 inline-flex items-center gap-2 text-[11px] font-mono text-zinc-500 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={jobAutoRestart}
                  onChange={(e) => setJobAutoRestart(e.target.checked)}
                />
                Enable KeepAlive watchdog auto-restart on non-zero exit
              </label>
            </section>
          </div>
        )}

        {tab === 'agents' && (
          <div className="space-y-4 pb-10 max-w-4xl mx-auto">
            <section className="rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-amber-600 dark:text-[#fabb60] font-semibold">
                    Plug-and-Play Injection
                  </div>
                  <h1 className="text-xl font-semibold text-zinc-900 dark:text-white tracking-tight">
                    Global-First Self-Configuration
                  </h1>
                  <p className="text-xs text-zinc-600 dark:text-[#9ba1b4] mt-0.5">
                    {state.selfConfig.strategy}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAction(() =>
                      applySelfConfigTargets(state.selfConfig.targets.map((t) => t.path))
                    )
                  }
                  className="px-3.5 py-2 rounded-xl bg-zinc-900 dark:bg-[#fabb60] text-white dark:text-[#1b1200] text-xs font-semibold"
                >
                  Inject All Targets
                </button>
              </div>

              <div className="space-y-2">
                {state.selfConfig.targets.map((t) => (
                  <div
                    key={t.path}
                    className="p-3 rounded-xl border border-zinc-200 dark:border-white/[0.06] bg-[#f8f9fb] dark:bg-[#0c0e14]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-zinc-900 dark:text-slate-100">
                          {t.target}
                        </div>
                        <div className="text-[10.5px] font-mono text-zinc-500 dark:text-slate-400">
                          {t.path} · {t.scope}
                        </div>
                      </div>
                      {t.status === 'applied' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                          <Check className="w-3.5 h-3.5" /> applied
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void runAction(() => applySelfConfigTargets([t.path]))}
                          className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] text-[11px] font-mono hover:bg-zinc-100 dark:hover:bg-[#1a1d26]"
                        >
                          Apply
                        </button>
                      )}
                    </div>
                    <pre className="mt-2 p-2.5 rounded-lg bg-white dark:bg-[#06070a] border border-zinc-200/80 dark:border-white/[0.05] text-[10.5px] font-mono overflow-x-auto text-zinc-700 dark:text-slate-300">
                      {t.snippet}
                    </pre>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <section className="rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 dark:text-slate-400 mb-2.5">
                  Discovered Workers ({state.discovery.workers.length})
                </div>
                <div className="space-y-1.5">
                  {state.discovery.workers.map((w) => (
                    <div
                      key={w.id}
                      className="px-2.5 py-2 rounded-lg border border-zinc-200 dark:border-white/[0.06] bg-[#f8f9fb] dark:bg-[#0c0e14] flex items-center justify-between text-[11px] font-mono"
                    >
                      <span className="truncate text-zinc-800 dark:text-slate-200">{w.id}</span>
                      <span className="text-zinc-500 dark:text-slate-400 truncate max-w-[160px]">
                        {w.model ?? w.provider}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 dark:text-slate-400 mb-2.5">
                  Shared Skill &amp; Key Discovery
                </div>
                <div className="space-y-2 text-[11px] font-mono">
                  <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-white/[0.06] bg-[#f8f9fb] dark:bg-[#0c0e14]">
                    <div className="text-zinc-500 dark:text-slate-400 text-[10px]">Skill Library Dirs</div>
                    <div className="text-zinc-900 dark:text-slate-200 mt-0.5">
                      {state.discovery.library_dirs.join(', ')}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-white/[0.06] bg-[#f8f9fb] dark:bg-[#0c0e14]">
                    <div className="text-zinc-500 dark:text-slate-400 text-[10px]">
                      Provider Key Names (values never read in UI)
                    </div>
                    <div className="text-zinc-900 dark:text-slate-200 mt-0.5">
                      {Object.entries(state.discovery.keys)
                        .map(([p, keys]) => `${p}: ${keys.join(', ')}`)
                        .join(' · ')}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {tab === 'docs' && <DocsCliPage onShowToast={showToast} />}
      </main>

      {/* SITE FOOTER */}
      <footer className="relative z-10 mt-8 border-t border-zinc-200 dark:border-white/[0.06] pt-7 max-w-5xl mx-auto px-4 md:px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-[12px] text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>LOOPBACK 127.0.0.1:8799</span>
            </span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span>Lingonberry Router</span>
          </div>

          <div className="flex flex-wrap items-center gap-5 font-mono text-[11px]">
            <button
              type="button"
              onClick={() => setArchOpen(true)}
              className="hover:text-zinc-900 dark:hover:text-white transition"
            >
              Architecture Spec
            </button>
            <button
              type="button"
              onClick={() => setTelemetryOpen(true)}
              className="hover:text-zinc-900 dark:hover:text-white transition"
            >
              Telemetry (⌘K)
            </button>
            <button
              type="button"
              onClick={() => navigateTab('docs')}
              className="hover:text-zinc-900 dark:hover:text-white transition"
            >
              CLI &amp; HTTP API
            </button>
            <a
              href="https://github.com/brusnyak/lingonberry-router"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-900 dark:hover:text-white transition"
            >
              GitHub Source
            </a>
          </div>
        </div>
      </footer>

      {/* MODAL 1: COMMAND & TELEMETRY INSPECTOR (⌘K) */}
      {telemetryOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Lingonberry Telemetry and Command Inspector"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/50 dark:bg-black/75 backdrop-blur-md"
            onClick={() => setTelemetryOpen(false)}
          />
          <div className="relative w-full max-w-2xl rounded-2xl bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.12] shadow-2xl p-5 z-10">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-white/[0.07]">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-amber-600 dark:text-[#fabb60]" />
                <h3 className="text-zinc-900 dark:text-white text-[14px] font-semibold tracking-tight">
                  Lingonberry Telemetry &amp; Endpoint Inspector
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-zinc-500 bg-zinc-100 dark:bg-white/[0.04] px-1.5 py-0.5 rounded border border-zinc-200 dark:border-white/[0.06]">
                  ESC to close
                </span>
                <button
                  type="button"
                  onClick={() => setTelemetryOpen(false)}
                  className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 relative">
              <Search className="w-4 h-4 text-amber-600 dark:text-[#fabb60] absolute left-3 top-2.5" />
              <input
                type="text"
                value={telemetryQuery}
                onChange={(e) => setTelemetryQuery(e.target.value)}
                placeholder="Filter routes, keys, or host cron telemetry..."
                className="w-full bg-[#f8f9fb] dark:bg-[#06070a] border border-zinc-200 dark:border-white/[0.08] rounded-xl pl-9 pr-4 py-2 text-zinc-900 dark:text-zinc-200 placeholder-zinc-400 font-mono text-[12px] focus:outline-none focus:border-amber-500/60"
              />
            </div>

            <div className="grid grid-cols-3 gap-3 my-4">
              <div className="bg-[#f8f9fb] dark:bg-[#06070a]/80 p-3 rounded-xl border border-zinc-200 dark:border-white/[0.06]">
                <span className="text-[10px] font-mono text-zinc-500">Live Workers</span>
                <div className="text-[18px] font-mono font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 tabular-nums">
                  {snap.workers_live.length} active
                </div>
                <span className="text-[9.5px] font-mono text-zinc-400">
                  {snap.overview.completed_24h} completed (24h)
                </span>
              </div>

              <div className="bg-[#f8f9fb] dark:bg-[#06070a]/80 p-3 rounded-xl border border-zinc-200 dark:border-white/[0.06]">
                <span className="text-[10px] font-mono text-zinc-500">Healthy Keys</span>
                <div className="text-[18px] font-mono font-semibold text-amber-600 dark:text-[#fabb60] mt-0.5 tabular-nums">
                  {healthyKeysCount}/{snap.workers.length}
                </div>
                <span className="text-[9.5px] font-mono text-zinc-400">provider-scoped pool</span>
              </div>

              <div className="bg-[#f8f9fb] dark:bg-[#06070a]/80 p-3 rounded-xl border border-zinc-200 dark:border-white/[0.06]">
                <span className="text-[10px] font-mono text-zinc-500">Cron Watchdog</span>
                <div className="text-[18px] font-mono font-semibold text-sky-600 dark:text-sky-400 mt-0.5 tabular-nums">
                  {snap.cron_live.length} PIDs
                </div>
                <span className="text-[9.5px] font-mono text-zinc-400">
                  {snap.jobs.length} host + router jobs
                </span>
              </div>
            </div>

            <div className="border border-zinc-200 dark:border-white/[0.06] rounded-xl overflow-hidden bg-[#f8f9fb] dark:bg-[#06070a]/80 mb-4">
              <div className="px-3 py-2 bg-zinc-100/80 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/[0.05] text-[11px] font-mono text-zinc-500 flex justify-between">
                <span>Loopback HTTP Bindings</span>
                <span className="text-amber-600 dark:text-[#fabb60]">127.0.0.1:8799</span>
              </div>
              <div className="divide-y divide-zinc-200/80 dark:divide-white/[0.04] font-mono text-[11px]">
                {quickRoutes.map((r) => (
                  <div key={r.path} className="p-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="font-semibold text-zinc-900 dark:text-white">{r.path}</span>
                      <span className="text-zinc-400">→</span>
                      <span className="text-amber-600 dark:text-[#fabb60] truncate">{r.target}</span>
                    </div>
                    <span className="text-[10px] text-zinc-400 shrink-0">{r.meta}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono pt-1 text-zinc-500">
              <span>mode: {state.mode === 'live-api' ? 'local-api' : 'static-sandbox'}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTelemetryOpen(false);
                    navigateTab('menubar');
                  }}
                  className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.08]"
                >
                  Open Menu Bar
                </button>
                <button
                  type="button"
                  onClick={() => setTelemetryOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white/[0.08] text-white"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: ARCHITECTURE SPEC DRAWER / MODAL */}
      {archOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Lingonberry Architecture Specification"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/50 dark:bg-black/75 backdrop-blur-md"
            onClick={() => setArchOpen(false)}
          />
          <div className="relative w-full max-w-2xl rounded-2xl bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.12] shadow-2xl p-6 z-10">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-white/[0.07]">
              <div className="flex items-center gap-2">
                <GitFork className="w-4 h-4 text-amber-600 dark:text-[#fabb60]" />
                <h3 className="text-zinc-900 dark:text-white text-[15px] font-semibold tracking-tight">
                  Lingonberry Core &amp; Routing Architecture
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setArchOpen(false)}
                className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 my-4 border-b border-zinc-200 dark:border-white/[0.06] pb-2.5">
              {(
                [
                  { id: 'cook', label: '1. Cook & Self-Config' },
                  { id: 'keypool', label: '2. KeyPool & Failover' },
                  { id: 'watchdog', label: '3. Cron Watchdog & Gates' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setArchTab(t.id)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-mono font-medium transition ${
                    archTab === t.id
                      ? 'bg-zinc-900 text-white dark:bg-white/[0.1] dark:text-white'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="text-[13px] text-zinc-700 dark:text-zinc-300 leading-relaxed min-h-[150px] space-y-2">
              {archTab === 'cook' && (
                <>
                  <p>
                    <strong className="text-zinc-900 dark:text-white">
                      Global-First Self-Configuration &amp; Cooking:
                    </strong>{' '}
                    <code className="font-mono text-xs text-amber-600 dark:text-[#fabb60]">
                      lingonberry-core init
                    </code>{' '}
                    scans PATH for CLIs and shared skill directories (<code>~/.agent-skills</code>,{' '}
                    <code>~/.claude/skills</code>, <code>~/.codex/skills</code>), installs one
                    shared skill + constitution, and writes 2-line idempotent pointers per agent.
                  </p>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    When a raw prompt arrives, the router selects the matching skill, command, hook,
                    and retrieval context, filters workers by write-access constraints, and mints a
                    receipt before any token is spent.
                  </p>
                </>
              )}
              {archTab === 'keypool' && (
                <>
                  <p>
                    <strong className="text-zinc-900 dark:text-white">
                      Provider-Scoped KeyPool &amp; RAII LeaseGuard:
                    </strong>{' '}
                    Keys are isolated per provider (NVIDIA NIM, Groq, Gemini). Each slot
                    enforces 3 concurrent runs and 40 calls/min by default, adjustable live via{' '}
                    <code>POST /api/keys/:name/rpm</code>.
                  </p>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    HTTP 429 bursts or truncated outputs place the failing key on cooldown and
                    automatically retry on a healthy other key via{' '}
                    <code>find_fallback_worker</code>. Panics or cancellations always release the
                    slot through RAII <code>Drop</code>.
                  </p>
                </>
              )}
              {archTab === 'watchdog' && (
                <>
                  <p>
                    <strong className="text-zinc-900 dark:text-white">
                      OS Cron Watchdog &amp; Verification Gates:
                    </strong>{' '}
                    <code>core/src/cron.rs</code> discovers host schedules across{' '}
                    <code>crontab</code>, <code>launchd</code>, <code>systemd</code>, and{' '}
                    <code>schtasks</code>, tracks active PIDs via <code>sysinfo</code>, and restarts
                    non-zero exits automatically when KeepAlive is active.
                  </p>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    Verification gates (<code>--worktree</code>, <code>--gate</code>) run assertions
                    before accepting work, while <code>POST /kill/:pid</code> sends{' '}
                    <code>SIGTERM</code> strictly to router-owned workers.
                  </p>
                </>
              )}
            </div>

            <div className="mt-5 pt-3 border-t border-zinc-200 dark:border-white/[0.06] flex items-center justify-between font-mono text-[11px]">
              <span className="text-zinc-500">Source: core/src/*.rs · README.md</span>
              <button
                type="button"
                onClick={() => setArchOpen(false)}
                className="px-3.5 py-1.5 rounded-lg bg-zinc-900 dark:bg-[#fabb60] text-white dark:text-[#1b1200] font-semibold"
              >
                Close Spec
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: INSTALL & BUILD GUIDE MODAL */}
      {installOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install Lingonberry Router"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/50 dark:bg-black/75 backdrop-blur-md"
            onClick={() => setInstallOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.12] shadow-2xl p-6 z-10">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-white/[0.07]">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-amber-600 dark:text-[#fabb60]" />
                <h3 className="text-zinc-900 dark:text-white text-[15px] font-semibold tracking-tight">
                  Install &amp; Run Lingonberry Router
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInstallOpen(false)}
                className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.06] my-4">
              {(['macos', 'linux', 'windows'] as const).map((os) => (
                <button
                  key={os}
                  type="button"
                  onClick={() => setInstallOs(os)}
                  className={`flex-1 py-1.5 rounded-lg text-center font-mono text-[11px] font-semibold capitalize transition ${
                    installOs === os
                      ? 'bg-white dark:bg-white/[0.1] text-zinc-900 dark:text-white shadow-2xs'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  {os === 'macos' ? 'macOS' : os === 'linux' ? 'Linux' : 'Windows'}
                </button>
              ))}
            </div>

            <div className="bg-[#f8f9fb] dark:bg-[#06070a] p-4 rounded-xl border border-zinc-200 dark:border-white/[0.06] flex flex-col gap-3">
              <div>
                <div className="text-zinc-900 dark:text-white text-[13px] font-semibold">
                  {installData[installOs].title}
                </div>
                <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                  {installData[installOs].spec}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-mono uppercase text-zinc-400">
                  1. Install Rust Core &amp; Initialize
                </div>
                <div className="p-2.5 rounded-lg bg-white dark:bg-black/60 border border-zinc-200 dark:border-white/[0.05] flex items-center justify-between gap-2">
                  <code className="font-mono text-[10.5px] text-zinc-800 dark:text-zinc-300 break-all">
                    {installData[installOs].cmd}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyCommand(installData[installOs].cmd)}
                    className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-mono uppercase text-zinc-400">
                  2. Launch Native Tray / Menu Bar
                </div>
                <div className="p-2.5 rounded-lg bg-white dark:bg-black/60 border border-zinc-200 dark:border-white/[0.05] flex items-center justify-between gap-2">
                  <code className="font-mono text-[10.5px] text-zinc-800 dark:text-zinc-300 break-all">
                    {installData[installOs].trayCmd}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyCommand(installData[installOs].trayCmd)}
                    className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-[10px] font-mono text-zinc-500">
                Keys stay in ~/.env or ~/.config/lingonberry/env
              </span>
              <button
                type="button"
                onClick={() => setInstallOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.08] dark:hover:bg-white/[0.14] text-zinc-900 dark:text-white font-mono text-[11px]"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-6 right-6 z-50 transition-all duration-200 px-4 py-2.5 rounded-xl bg-white/95 dark:bg-[#11131b]/95 backdrop-blur-lg border border-amber-500/35 text-zinc-900 dark:text-white font-mono text-[11px] flex items-center gap-2 shadow-xl ${
          toastMsg
            ? 'translate-y-0 opacity-100'
            : 'translate-y-8 opacity-0 pointer-events-none'
        }`}
      >
        <CheckCircle2 className="w-4 h-4 text-amber-600 dark:text-[#fabb60] shrink-0" />
        <span>{toastMsg ?? ''}</span>
      </div>
    </div>
  );
}
