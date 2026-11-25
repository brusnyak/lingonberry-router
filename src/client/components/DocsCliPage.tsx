import React, { useState } from 'react';
import { Copy, Terminal } from 'lucide-react';

interface DocsCliPageProps {
  onShowToast: (msg: string) => void;
}

const CLI_ROWS = [
  { cmd: 'init [--force]', desc: 'Create ~/.lingonberry, config.json, and plan global self-config (idempotent).' },
  { cmd: 'doctor', desc: 'Read-only health check outputting JSON; exits 1 on invalid config or missing state.' },
  { cmd: 'discover', desc: 'Scan PATH for agent CLIs, env key names, providers, workers, and shared skill dirs.' },
  { cmd: 'route "<prompt>"', desc: 'Cook prompt with matching skill/command/hook and print cryptographic receipt; runs nothing.' },
  { cmd: 'run "<prompt>" [--worker <id>] [--caller <name>] [--gate <cmd>] [--worktree]', desc: 'Lease a provider-scoped key slot, execute CLI or API worker, and verify gate.' },
  { cmd: 'fanout "<p1>" "<p2>" …', desc: 'Dispatch one run per prompt round-robin over discovered workers.' },
  { cmd: 'serve [127.0.0.1:8799]', desc: 'Start the loopback HTTP API, SQLite WAL store, and background cron watchdog.' },
  { cmd: 'self-config [--apply]', desc: 'Inspect or apply global-first skill/constitution files plus 2-line light pointers.' },
  { cmd: 'mcp', desc: 'Run JSON-RPC 2.0 MCP stdio bridge (lingonberry_route, discover, snapshot, self_config).' },
];

const HTTP_ROWS = [
  { method: 'GET', path: '/snapshot', desc: 'Running workers, sessions, key slots, cron jobs & live OS cron PIDs, overview, CPU/RAM metrics.' },
  { method: 'GET', path: '/keys', desc: 'Key-slot status including active inflight, cooldown countdown, and RPM cap.' },
  { method: 'POST', path: '/api/keys/{name}/rpm', desc: 'Live-adjust per-provider RPM ceiling (5..300) by provider or key slot name.' },
  { method: 'POST', path: '/keys/{name}/reset', desc: 'Clear active cooldown lock on a key slot immediately.' },
  { method: 'POST', path: '/kill/{pid}', desc: 'Send SIGTERM to one live router-owned worker process group; refuses external PIDs.' },
  { method: 'GET', path: '/api/jobs', desc: 'List crontab, launchd, systemd, schtasks & router jobs plus live OS cron PIDs.' },
  { method: 'POST', path: '/api/jobs/rescan', desc: 'Rescan host OS schedules and matching live cron child processes.' },
  { method: 'POST', path: '/api/jobs/kill/{pid}', desc: 'Send SIGTERM to a running host cron child PID.' },
  { method: 'POST', path: '/api/jobs/{name}/heal', desc: 'Clear crash lock and reset a crashed cron job to supervised scheduling.' },
  { method: 'POST', path: '/api/jobs/{name}/watchdog', desc: 'Toggle KeepAlive auto-restart policy for a supervised cron job.' },
  { method: 'GET', path: '/version', desc: 'Binary executable modification timestamp for daemon restart detection.' },
];

const CONFIG_KEYS = [
  { key: 'port', def: '8799', meaning: 'Loopback port for serve when no bind address is passed.' },
  { key: 'default_worker', def: 'pi', meaning: 'Worker used when a run names none (validated routable).' },
  { key: 'max_inflight_per_key', def: '3', meaning: 'Concurrent runs allowed per key slot.' },
  { key: 'rpm_per_key', def: '40', meaning: 'Calls allowed per key slot per 60 seconds (live adjustable).' },
  { key: 'cooldown_s', def: '60', meaning: 'Rest seconds placed after a rate-limit or truncated failure.' },
  { key: 'lease_wait_s', def: '30', meaning: 'Seconds a dispatch waits for a free key before failing cleanly.' },
  { key: 'excluded_agents', def: '["cline"]', meaning: 'Discovered agents that stay visible but are never routed to.' },
];

export const DocsCliPage: React.FC<DocsCliPageProps> = ({ onShowToast }) => {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();

  const copyCmd = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onShowToast(`Copied: ${text}`);
    } catch {
      onShowToast(text);
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-amber-600 dark:text-[#fabb60] text-[11px] font-mono uppercase tracking-wider mb-1 font-semibold">
            <Terminal className="w-3.5 h-3.5" />
            Single Source of Truth · README.md
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-900 dark:text-white tracking-tight">
            CLI, Loopback HTTP API &amp; Configuration
          </h1>
          <p className="text-zinc-600 dark:text-[#9ba1b4] text-[13px] mt-1 max-w-2xl">
            Every command, config key, and HTTP endpoint exposed by{' '}
            <code className="font-mono text-xs">lingonberry-core</code>. State lives in{' '}
            <code className="font-mono text-xs">~/.lingonberry</code>; API keys stay in{' '}
            <code className="font-mono text-xs">~/.env</code> or{' '}
            <code className="font-mono text-xs">~/.config/lingonberry/env</code>.
          </p>
        </div>

        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter CLI or endpoints…"
          className="h-9 w-full md:w-64 px-3 rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#11131b] text-xs font-mono text-zinc-800 dark:text-slate-200 placeholder:text-zinc-400 focus:outline-none focus:border-amber-500/60"
        />
      </div>

      {/* Why Comparison Table */}
      <section className="rounded-2xl overflow-hidden bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08]">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/[0.06] font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
          Why Lingonberry Router
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-200 dark:divide-white/[0.06] text-[12.5px]">
          <div className="p-4 space-y-2.5 text-zinc-600 dark:text-zinc-400">
            <div className="font-mono text-[10.5px] uppercase tracking-wider text-zinc-500">
              Without Lingonberry
            </div>
            <p>• Each agent manages its own API keys and copies prompts blindly.</p>
            <p>• Updating routing rules across 5+ CLI agents takes repetitive manual edits.</p>
            <p>• Long raw prompts execute without matching global skills or pre-apply hooks.</p>
            <p>• Runaway agents burn shared quotas and stuck cron PIDs stay invisible.</p>
          </div>
          <div className="p-4 space-y-2.5 text-zinc-800 dark:text-zinc-200">
            <div className="font-mono text-[10.5px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              With Lingonberry Router
            </div>
            <p>• Keys stay in ~/.env; the router leases provider-scoped slot names only.</p>
            <p>• Global-first self-config writes one skill + constitution and light 2-line pointers.</p>
            <p>• Raw prompts are cooked with skills, commands, hooks, and repo retrieval first.</p>
            <p>• Menu bar &amp; tray track live PIDs, Kill controls, RPM caps, and host cron watchdogs.</p>
          </div>
        </div>
      </section>

      {/* CLI Table */}
      <section className="rounded-2xl overflow-hidden bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08]">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/[0.06] flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
            CLI Commands (`lingonberry-core`)
          </span>
          <span className="font-mono text-[10.5px] text-zinc-400">ROUTER_CALLER overrides caller</span>
        </div>
        <div className="divide-y divide-zinc-200/80 dark:divide-white/[0.04]">
          {CLI_ROWS.filter(
            (r) => !q || r.cmd.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q)
          ).map((r) => (
            <div
              key={r.cmd}
              className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-zinc-50 dark:hover:bg-white/[0.02]"
            >
              <button
                type="button"
                onClick={() => void copyCmd(`lingonberry-core ${r.cmd}`)}
                className="inline-flex items-center gap-1.5 text-left font-mono text-[11.5px] font-medium text-amber-700 dark:text-[#fabb60] hover:underline"
              >
                <span>lingonberry-core {r.cmd}</span>
                <Copy className="w-3 h-3 opacity-60 shrink-0" />
              </button>
              <span className="text-[12px] text-zinc-600 dark:text-zinc-400 sm:text-right max-w-xl">
                {r.desc}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* HTTP API Table */}
      <section className="rounded-2xl overflow-hidden bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08]">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/[0.06] flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
            Loopback HTTP API (`127.0.0.1:8799`)
          </span>
          <span className="font-mono text-[10.5px] text-emerald-600 dark:text-emerald-400">
            loopback only
          </span>
        </div>
        <div className="divide-y divide-zinc-200/80 dark:divide-white/[0.04]">
          {HTTP_ROWS.filter(
            (r) => !q || r.path.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q)
          ).map((r) => (
            <div
              key={`${r.method}-${r.path}`}
              className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-zinc-50 dark:hover:bg-white/[0.02]"
            >
              <div className="flex items-center gap-2 font-mono text-[11.5px]">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    r.method === 'GET'
                      ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                      : 'bg-amber-500/12 text-amber-700 dark:text-[#fabb60]'
                  }`}
                >
                  {r.method}
                </span>
                <span className="text-zinc-900 dark:text-zinc-200">{r.path}</span>
              </div>
              <span className="text-[12px] text-zinc-600 dark:text-zinc-400 sm:text-right max-w-xl">
                {r.desc}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Config Keys */}
      <section className="rounded-2xl overflow-hidden bg-white dark:bg-[#11131b] border border-zinc-200 dark:border-white/[0.08]">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/[0.06] font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
          Config Keys (`~/.lingonberry/config.json`)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#f8f9fb] dark:bg-[#06070a]/80 border-b border-zinc-200 dark:border-white/[0.06] font-mono text-[10px] uppercase text-zinc-500">
                <th className="py-2.5 px-4">Key</th>
                <th className="py-2.5 px-4">Default</th>
                <th className="py-2.5 px-4">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/80 dark:divide-white/[0.04]">
              {CONFIG_KEYS.map((c) => (
                <tr key={c.key}>
                  <td className="py-2.5 px-4 font-mono text-zinc-900 dark:text-zinc-200">{c.key}</td>
                  <td className="py-2.5 px-4 font-mono text-amber-600 dark:text-[#fabb60]">{c.def}</td>
                  <td className="py-2.5 px-4 text-zinc-600 dark:text-zinc-400">{c.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
