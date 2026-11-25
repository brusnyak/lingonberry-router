import { scanLiveCronProcesses, scanOsCronJobs } from './cronOversight.js';
import type { JobRow, LiveCronProcess, Receipt, Run, RunState, SessionStep } from './types.js';

export class InMemoryRunStore {
  private readonly runs = new Map<string, Run>();

  insert(run: Run): void {
    this.runs.set(run.id, run);
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  list(): Run[] {
    return Array.from(this.runs.values()).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    );
  }

  appendStep(id: string, step: SessionStep): void {
    const existing = this.runs.get(id);
    if (!existing) return;
    if (!existing.steps) existing.steps = [];
    existing.steps.push(step);
  }

  updateDispatchTarget(
    id: string,
    worker: string,
    keySlot: string | null,
    provider: string | null,
    model: string | null,
    failoverFrom: string | null
  ): void {
    const existing = this.runs.get(id);
    if (!existing) return;
    existing.worker = worker;
    existing.key_slot = keySlot;
    existing.provider = provider;
    existing.model = model;
    existing.failover_from = failoverFrom;
  }

  markRunning(id: string, pid: number | null): void {
    const existing = this.runs.get(id);
    if (!existing) return;
    existing.state = 'running';
    if (pid !== null) existing.pid = pid;
  }

  finish(
    id: string,
    state: RunState,
    elapsedMs: number | null,
    gatePassed: boolean | null,
    error: string | null,
    output: string | null,
    tokensIn?: number | null,
    tokensOut?: number | null
  ): void {
    const existing = this.runs.get(id);
    if (!existing) return;
    existing.state = state;
    existing.elapsed_ms = elapsedMs;
    existing.gate_passed = gatePassed;
    if (error !== null) existing.error = error;
    if (output !== null) existing.output = output;
    if (tokensIn !== undefined) existing.tokens_in = tokensIn;
    if (tokensOut !== undefined) existing.tokens_out = tokensOut;
  }

  setState(
    id: string,
    state: RunState,
    gatePassed: boolean | null,
    error: string | null
  ): void {
    const existing = this.runs.get(id);
    if (!existing) return;
    existing.state = state;
    existing.gate_passed = gatePassed;
    existing.error = error;
  }
}

export class InMemoryReceiptStore {
  private readonly receipts = new Map<string, Receipt>();

  insert(receipt: Receipt): void {
    this.receipts.set(receipt.receipt_id, receipt);
  }

  get(receiptId: string): Receipt | undefined {
    return this.receipts.get(receiptId);
  }

  list(): Receipt[] {
    return Array.from(this.receipts.values()).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    );
  }
}

export class InMemoryJobStore {
  private readonly jobs = new Map<string, JobRow>();

  constructor() {
    const now = Date.now() / 1000;
    const defaults: JobRow[] = [
      {
        name: 'vault-ticket-digest',
        source: 'launchd',
        schedule: '0 */4 * * *',
        command: 'lingonberry-core run "Summarize open vault tickets"',
        every_s: 14400,
        last: now - 3920,
        rc: 0,
        paused: true,
        next_in_s: null,
        prompt: 'Summarize open vault tickets and sync state notes',
        health: 'paused',
        running_pid: null,
        crash_count: 0,
        restart_count: 0,
        auto_restart: true,
        last_error: null,
        log_tail: ['last exit=0 · paused by operator'],
      },
      {
        name: 'doctor-health-sweep',
        source: 'lingonberry',
        schedule: '*/5 * * * *',
        command: 'lingonberry-core doctor --quiet',
        every_s: 300,
        last: now - 140,
        rc: 0,
        paused: false,
        next_in_s: 160,
        prompt: 'Verify config, key-slot cooldowns, and worker reachability',
        health: 'healthy',
        running_pid: null,
        crash_count: 0,
        restart_count: 0,
        auto_restart: true,
        last_error: null,
        log_tail: ['all 4 worker slots reachable · 0 cooldowns active'],
      },
      {
        name: 'skill-index-refresh',
        source: 'global-skills',
        schedule: '*/30 * * * *',
        command: 'lingonberry-core discover --refresh-skills',
        every_s: 1800,
        last: now - 620,
        rc: 0,
        paused: false,
        next_in_s: 1180,
        prompt: 'Re-index ~/.agent-skills and global constitution directives',
        health: 'healthy',
        running_pid: null,
        crash_count: 0,
        restart_count: 0,
        auto_restart: true,
        last_error: null,
        log_tail: ['indexed ~/.agent-skills, ~/.claude/skills, ~/.codex/skills'],
      },
      {
        name: 'pr-gate-audit',
        source: 'crontab',
        schedule: '0 2 * * *',
        command: 'lingonberry-core run --worktree "Verify repository gate and tests"',
        every_s: 86400,
        last: now - 14200,
        rc: 0,
        paused: false,
        next_in_s: 72200,
        prompt: 'Run read-only security and test gate across git projects',
        health: 'healthy',
        running_pid: null,
        crash_count: 0,
        restart_count: 1,
        auto_restart: true,
        last_error: null,
        log_tail: ['gate clean · 0 secret findings'],
      },
    ];
    for (const job of defaults) {
      this.jobs.set(job.name, job);
    }
    this.rescanHostJobs();
  }

  rescanHostJobs(): JobRow[] {
    const scanned = scanOsCronJobs();
    for (const job of scanned) {
      if (!this.jobs.has(job.name)) {
        this.jobs.set(job.name, job);
      }
    }
    return this.list();
  }

  list(): JobRow[] {
    return Array.from(this.jobs.values());
  }

  listWithLive(): { jobs: JobRow[]; cronLive: LiveCronProcess[] } {
    const allJobs = this.list();
    const cronLive = scanLiveCronProcesses(allJobs);

    for (const job of allJobs) {
      const matching = cronLive.find((p) => p.job_name === job.name);
      job.running_pid = matching?.pid ?? null;
      if (job.running_pid !== null) {
        job.health = 'running';
      } else if (job.paused) {
        job.health = 'paused';
      } else if (job.crash_count > 0 && job.rc !== 0) {
        job.health = 'crashed';
      } else if (job.restart_count > 0 && job.crash_count > 0) {
        job.health = 'auto_healed';
      } else {
        job.health = 'healthy';
      }
    }

    return { jobs: allJobs, cronLive };
  }

  tick(elapsedS: number): JobRow[] {
    const due: JobRow[] = [];
    for (const job of this.jobs.values()) {
      if (job.paused || job.next_in_s === null) continue;
      job.next_in_s = Math.max(0, job.next_in_s - elapsedS);
      if (job.next_in_s === 0) {
        job.last = Date.now() / 1000;
        job.rc = 0;
        job.next_in_s = job.every_s ?? 300;
        due.push(job);
      }
    }
    return due;
  }

  upsert(job: JobRow): void {
    this.jobs.set(job.name, job);
  }

  toggle(name: string): JobRow | undefined {
    const job = this.jobs.get(name);
    if (!job) return undefined;
    job.paused = !job.paused;
    job.next_in_s = job.paused ? null : (job.every_s ?? 300);
    job.health = job.paused ? 'paused' : 'healthy';
    this.appendLog(job, job.paused ? 'paused by operator' : 'resumed by operator');
    return job;
  }

  toggleWatchdog(name: string): JobRow | undefined {
    const job = this.jobs.get(name);
    if (!job) return undefined;
    job.auto_restart = !job.auto_restart;
    this.appendLog(job, `watchdog KeepAlive ${job.auto_restart ? 'enabled' : 'disabled'}`);
    return job;
  }

  heal(name: string): JobRow | undefined {
    const job = this.jobs.get(name);
    if (!job) return undefined;
    job.paused = false;
    job.rc = 0;
    job.crash_count = 0;
    job.restart_count += 1;
    job.last_error = null;
    job.health = 'auto_healed';
    job.next_in_s = job.every_s ?? 300;
    this.appendLog(job, 'watchdog healed job state & cleared crash lock');
    return job;
  }

  recordRun(name: string, rc: number, logLine?: string): JobRow | undefined {
    const job = this.jobs.get(name);
    if (!job) return undefined;
    job.last = Date.now() / 1000;
    job.rc = rc;
    if (rc !== 0) {
      job.crash_count += 1;
      job.last_error = logLine || `exited with rc=${rc}`;
      if (job.auto_restart) {
        job.restart_count += 1;
        job.health = 'auto_healed';
        this.appendLog(job, `crash detected (rc=${rc}) -> KeepAlive auto-restarted`);
      } else {
        job.health = 'crashed';
        this.appendLog(job, `crashed (rc=${rc}): ${job.last_error}`);
      }
    } else {
      job.last_error = null;
      job.health = job.paused ? 'paused' : 'healthy';
      if (logLine) this.appendLog(job, logLine);
    }
    if (!job.paused) {
      job.next_in_s = job.every_s ?? 300;
    }
    return job;
  }

  simulateCrash(name: string): JobRow | undefined {
    const job = this.jobs.get(name);
    if (!job) return undefined;
    return this.recordRun(name, 137, 'SIGKILL OOM / unhandled timeout (simulated)');
  }

  remove(name: string): boolean {
    return this.jobs.delete(name);
  }

  private appendLog(job: JobRow, entry: string) {
    job.log_tail.push(entry);
    if (job.log_tail.length > 8) {
      job.log_tail.shift();
    }
  }
}
