import React, { useState } from 'react';
import { Copy, Terminal } from 'lucide-react';

interface DocsCliPageProps {
  onShowToast: (msg: string) => void;
}

const CLI_ROWS = [
  {
    cmd: 'init [--force] [--yes]',
    desc: 'Create ~/.lingonberry, api.token (0600), mini-harness, and install/configure pi-rust.',
  },
  {
    cmd: 'doctor',
    desc: 'Read-only check verifying config, token, mini-harness, pi-rust, and worker count.',
  },
  {
    cmd: 'discover',
    desc: 'Scan PATH for CLIs, Keychain slots, free-tier pools, and shared ~/.agent-skills dirs.',
  },
  {
    cmd: 'route "<prompt>" [--worktree]',
    desc: 'Run 2-stage complexity + BM25 skill router (<5ms) and print cryptographic receipt.',
  },
  {
    cmd: 'run "<prompt>" [--worker <id>] [--sandbox seatbelt|docker] [--spec <id>] [--gate <cmd>] [--worktree]',
    desc: 'Lease free-first slot, isolate in Seatbelt/Docker worktree, enforce diff scope, and escalate on gate failure.',
  },
  {
    cmd: 'fanout "<p1>" "<p2>" …',
    desc: 'Dispatch concurrent worktree waves gated by Watchdog semaphore and PathLeases.',
  },
  {
    cmd: 'serve [127.0.0.1:8799]',
    desc: 'Start loopback axum API (bearer-authenticated mutating routes), SQLite WAL, and 5s Watchdog ticker.',
  },
  {
    cmd: 'self-config [--apply]',
    desc: 'Write canonical SKILL.md, MEMORY.md, and MCP config plus 2-line light pointers.',
  },
  {
    cmd: 'mcp',
    desc: 'Run JSON-RPC 2.0 MCP stdio bridge for day-to-day Claude/Codex chat continuity.',
  },
];

const HTTP_ROWS = [
  {
    method: 'GET',
    path: '/api/snapshot',
    desc: 'Sessions, live workers, KeyPool, Watchdog RAM/disk/burst, Swarm leases, Channels, and Kiro specs.',
  },
  {
    method: 'POST',
    path: '/api/run',
    desc: 'Bearer-protected dispatch supporting worktree, sandbox_tier, path_globs, and spec_id locking.',
  },
  {
    method: 'GET/POST',
    path: '/api/specs',
    desc: 'List or author 3-artifact Kiro Spec Manifests with allowed_path_globs and SHA-256 digest.',
  },
  {
    method: 'POST',
    path: '/api/specs/{id}/approve',
    desc: 'Cryptographically sign and unlock a Kiro spec for overnight or autonomous execution.',
  },
  {
    method: 'POST',
    path: '/api/specs/{id}/run',
    desc: 'Verify SHA-256 signature and execute approved spec waves under Seatbelt or Docker.',
  },
  {
    method: 'GET',
    path: '/api/watchdog',
    desc: 'Read host memory pressure, APFS free disk GB, dynamic concurrency cap, and 5h burst usage.',
  },
  {
    method: 'GET',
    path: '/api/swarm',
    desc: 'Inspect semaphore slots, non-overlapping file-path leases, and serial merge queue.',
  },
  {
    method: 'GET',
    path: '/api/channels',
    desc: 'Inspect outbound Telegram/Slack/Discord/MCP bridge status and shared MEMORY.md.',
  },
  {
    method: 'POST',
    path: '/api/kill/{pid}',
    desc: 'Bearer-authenticated SIGTERM strictly for router-owned worker process groups.',
  },
  {
    method: 'GET',
    path: '/api/jobs',
    desc: 'List read-only host launchd/crontab jobs and managed router schedules.',
  },
];

const CONFIG_KEYS = [
  { key: 'port', def: '8799', meaning: 'Loopback port for serve (127.0.0.1 only).' },
  { key: 'default_worker', def: 'pi', meaning: 'Primary fast execution layer (auto-installed if missing).' },
  { key: 'sandbox_local_tier', def: 'seatbelt', meaning: 'Default macOS sandbox-exec SBPL isolation for local runs.' },
  { key: 'sandbox_overnight_tier', def: 'docker', meaning: 'Read-only, cap-dropped container tier for overnight specs.' },
  { key: 'max_inflight_per_key', def: '3', meaning: 'Concurrent runs allowed per provider key slot.' },
  { key: 'rpm_per_key', def: '30', meaning: 'Calls allowed per key per 60s (provider_rpm.nim = 40).' },
  { key: 'subscription_burst_cap', def: '45', meaning: '5-hour escalation cap for paid Claude/Codex subscriptions.' },
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
    <div className="space-y-10 pb-16">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 text-xs font-mono font-medium">
            <Terminal className="w-3.5 h-3.5" />
            <span>CLI &amp; Loopback HTTP Reference</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-950 dark:text-white tracking-tight">
            CLI Commands, Auth-Protected API &amp; Config
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-[13.5px] max-w-xl">
            Mutating routes require <code className="font-mono text-xs">~/.lingonberry/api.token</code>.
            Keys live encrypted in macOS Keychain.
          </p>
        </div>

        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter CLI or endpoints…"
          className="h-9 w-full md:w-64 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#111114] text-xs font-mono text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* CLI Table */}
      <section className="rounded-xl overflow-hidden bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between font-mono text-[11px]">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">
            CLI Commands (lingonberry-core)
          </span>
          <span className="text-zinc-500 dark:text-zinc-400">ROUTER_CALLER overrides caller</span>
        </div>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {CLI_ROWS.filter(
            (r) => !q || r.cmd.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q)
          ).map((r) => (
            <div
              key={r.cmd}
              className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
            >
              <button
                type="button"
                onClick={() => void copyCmd(`lingonberry-core ${r.cmd}`)}
                className="inline-flex items-center gap-1.5 text-left font-mono text-[11.5px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                <span>lingonberry-core {r.cmd}</span>
                <Copy className="w-3 h-3 opacity-60 shrink-0" />
              </button>
              <span className="text-xs text-zinc-600 dark:text-zinc-400 sm:text-right max-w-xl">
                {r.desc}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* HTTP API Table */}
      <section className="rounded-xl overflow-hidden bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between font-mono text-[11px]">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">
            Loopback HTTP API (127.0.0.1:8799)
          </span>
          <span className="text-emerald-600 dark:text-emerald-400">
            Bearer token enforced on POST
          </span>
        </div>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {HTTP_ROWS.filter(
            (r) => !q || r.path.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q)
          ).map((r) => (
            <div
              key={`${r.method}-${r.path}`}
              className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
            >
              <div className="flex items-center gap-2 font-mono text-[11.5px]">
                <span
                  className={
                    r.method.startsWith('GET')
                      ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                      : 'text-indigo-600 dark:text-indigo-400 font-semibold'
                  }
                >
                  {r.method}
                </span>
                <span className="text-zinc-950 dark:text-zinc-200">{r.path}</span>
              </div>
              <span className="text-xs text-zinc-600 dark:text-zinc-400 sm:text-right max-w-xl">
                {r.desc}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Config Keys */}
      <section className="rounded-xl overflow-hidden bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 font-mono text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">
          Config Keys (~/.lingonberry/config.json)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-50 dark:bg-[#18181B]/70 border-b border-zinc-200 dark:border-zinc-800 font-mono text-[10.5px] text-zinc-500 dark:text-zinc-400">
                <th className="py-3 px-5 font-medium">Key</th>
                <th className="py-3 px-4 font-medium">Default</th>
                <th className="py-3 px-5 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {CONFIG_KEYS.map((c) => (
                <tr key={c.key}>
                  <td className="py-3 px-5 font-mono text-zinc-950 dark:text-zinc-200">
                    {c.key}
                  </td>
                  <td className="py-3 px-4 font-mono text-indigo-600 dark:text-indigo-400">
                    {c.def}
                  </td>
                  <td className="py-3 px-5 text-zinc-600 dark:text-zinc-400">{c.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
