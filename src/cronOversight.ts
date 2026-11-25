import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JobRow, LiveCronProcess } from './types.js';

export function parseCrontabText(text: string): JobRow[] {
  const jobs: JobRow[] = [];
  let idx = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (
      !line ||
      line.startsWith('#') ||
      (line.includes('=') && !line.startsWith('@') && !/^[\d*]/.test(line))
    ) {
      continue;
    }

    let schedule = '';
    let command = '';
    if (line.startsWith('@')) {
      const m = line.match(/^(@\S+)\s+(.+)$/);
      if (!m) continue;
      schedule = m[1];
      command = m[2].trim();
    } else {
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;
      schedule = parts.slice(0, 5).join(' ');
      command = parts.slice(5).join(' ');
    }
    if (!command) continue;
    idx += 1;
    const head = command.split(/\s+/)[0]?.split('/').pop() || 'cron-task';
    jobs.push({
      name: `crontab-${head}-${idx}`,
      source: 'crontab',
      schedule,
      command,
      every_s: null,
      last: null,
      rc: 0,
      paused: false,
      next_in_s: 300,
      prompt: command,
      health: 'healthy',
      running_pid: null,
      crash_count: 0,
      restart_count: 0,
      auto_restart: true,
      last_error: null,
      log_tail: ['Discovered from user crontab'],
    });
  }
  return jobs;
}

function extractPlistString(xml: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<key>${escaped}</key>\\s*<string>([^<]+)</string>`);
  return xml.match(re)?.[1]?.trim() ?? null;
}

function extractPlistInt(xml: string, key: string): number | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<key>${escaped}</key>\\s*<integer>(\\d+)</integer>`);
  const val = xml.match(re)?.[1];
  return val ? Number(val) : null;
}

export function scanOsCronJobs(): JobRow[] {
  const found: JobRow[] = [];
  const home = os.homedir();

  // 1. User crontab (macOS / Linux)
  if (process.platform !== 'win32') {
    try {
      const out = execFileSync('crontab', ['-l'], {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      found.push(...parseCrontabText(out));
    } catch {
      // No crontab configured for user
    }
  }

  // 2. macOS LaunchAgents
  if (process.platform === 'darwin') {
    try {
      const launchDir = path.join(home, 'Library', 'LaunchAgents');
      if (fs.existsSync(launchDir)) {
        for (const entry of fs.readdirSync(launchDir)) {
          if (!entry.endsWith('.plist')) continue;
          const filePath = path.join(launchDir, entry);
          const xml = fs.readFileSync(filePath, 'utf8');
          const label = extractPlistString(xml, 'Label') || entry.replace(/\.plist$/, '');
          const interval = extractPlistInt(xml, 'StartInterval');
          const keepAlive = /<key>KeepAlive<\/key>/.test(xml);
          const disabled = /<key>Disabled<\/key>\s*<true\s*\/>/.test(xml);
          const command = extractPlistString(xml, 'Program') || `launchctl job ${label}`;
          found.push({
            name: label,
            source: 'launchd',
            schedule: interval ? `every ${interval}s` : 'calendar / launchd',
            command,
            every_s: interval,
            last: null,
            rc: 0,
            paused: disabled,
            next_in_s: disabled ? null : interval,
            prompt: command,
            health: disabled ? 'paused' : 'healthy',
            running_pid: null,
            crash_count: 0,
            restart_count: 0,
            auto_restart: keepAlive,
            last_error: null,
            log_tail: [`Discovered LaunchAgent: ${filePath}`],
          });
        }
      }
    } catch {
      // Ignore permission issues
    }
  }

  // 3. Linux systemd user timers
  if (process.platform === 'linux') {
    try {
      const sysDir = path.join(home, '.config', 'systemd', 'user');
      if (fs.existsSync(sysDir)) {
        for (const entry of fs.readdirSync(sysDir)) {
          if (!entry.endsWith('.timer')) continue;
          const filePath = path.join(sysDir, entry);
          const unit = fs.readFileSync(filePath, 'utf8');
          const name = entry.replace(/\.timer$/, '');
          const calMatch = unit.match(/^OnCalendar=(.+)$/m);
          const activeMatch = unit.match(/^OnUnitActiveSec=(.+)$/m);
          const schedule = calMatch?.[1]?.trim() || (activeMatch ? `every ${activeMatch[1].trim()}` : 'systemd timer');
          found.push({
            name,
            source: 'systemd',
            schedule,
            command: `systemctl --user start ${name}.service`,
            every_s: null,
            last: null,
            rc: 0,
            paused: false,
            next_in_s: 300,
            prompt: `systemd user unit ${name}`,
            health: 'healthy',
            running_pid: null,
            crash_count: 0,
            restart_count: 0,
            auto_restart: true,
            last_error: null,
            log_tail: [`Discovered systemd timer: ${filePath}`],
          });
        }
      }
    } catch {
      // Ignore permission issues
    }
  }

  return found;
}

export function scanLiveCronProcesses(jobs: JobRow[]): LiveCronProcess[] {
  if (process.platform === 'win32' || jobs.length === 0) return [];
  const live: LiveCronProcess[] = [];

  try {
    const out = execFileSync(
      'ps',
      ['-eo', 'pid=,pcpu=,rss=,etimes=,comm=,args='],
      {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );

    for (const raw of out.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
      const cpuPct = Math.round(Number(m[2]) * 10) / 10;
      const memMb = Math.round((Number(m[3]) / 1024) * 10) / 10;
      const elapsedS = Number(m[4]);
      const comm = m[5];
      const args = (m[6] || comm).trim();
      if (comm === 'curl' || comm === 'ps' || args.includes('/api/jobs/')) continue;

      for (const job of jobs) {
        const needle = job.command.split(/\s+/)[0] ?? '';
        const matchesCmd = needle.length > 3 && !needle.startsWith('lingonberry-core') && args.includes(needle);
        const matchesName = job.name.length > 4 && comm !== 'sh' && comm !== 'bash' && args.includes(job.name);
        if (matchesCmd || matchesName) {
          live.push({
            pid,
            job_name: job.name,
            source: job.source,
            command: args,
            cpu_pct: cpuPct,
            mem_mb: memMb,
            elapsed_s: elapsedS,
          });
          break;
        }
      }
    }
  } catch {
    // ps may be restricted in hardened sandboxes
  }

  return live;
}

export function killCronOsPid(pid: number, allowedPids: Set<number>): boolean {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;
  if (!allowedPids.has(pid)) return false;
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}
