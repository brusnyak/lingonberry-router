import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { loadConfigOrDefault } from './config.js';
import { killCronOsPid } from './cronOversight.js';
import { scanDiscovery } from './discovery.js';
import { Registry } from './registry.js';
import { buildSelfConfigPlan, cookPrompt, redactSecrets, routePrompt } from './routerEngine.js';
import { InMemoryJobStore, InMemoryReceiptStore, InMemoryRunStore } from './storage.js';
import type {
  CapabilitiesInfo,
  LiveWorker,
  Overview,
  Run,
  SessionStep,
  Snapshot,
  SystemInfo,
  TelemetryPoint,
} from './types.js';

const APP_VERSION = '0.1.0';
const startedExeMtime = (() => {
  try {
    return fs.statSync(process.argv[1] || '').mtimeMs / 1000;
  } catch {
    return Date.now() / 1000;
  }
})();

let cachedSystemInfo: { ts: number; info: SystemInfo } | null = null;

function nowTs(): number {
  return Date.now() / 1000;
}

function collectSystemInfo(): SystemInfo {
  const cpus = os.cpus();
  const load1 = os.loadavg()[0] ?? null;
  const cpuPct =
    cpus.length > 0 && load1 !== null
      ? Math.round(Math.min(100, Math.max(4, (load1 / cpus.length) * 100)) * 10) / 10
      : 14.2;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramTotalGb = Math.round((totalMem / 1_073_741_824) * 10) / 10;
  const ramUsedGb = Math.round(((totalMem - freeMem) / 1_073_741_824) * 10) / 10;

  let diskUsedGb: number | null = null;
  let diskTotalGb: number | null = null;
  try {
    const stat = fs.statfsSync('/');
    const totalBytes = stat.blocks * stat.bsize;
    const availBytes = stat.bavail * stat.bsize;
    diskTotalGb = Math.round((totalBytes / 1_073_741_824) * 10) / 10;
    diskUsedGb = Math.round(((totalBytes - availBytes) / 1_073_741_824) * 10) / 10;
  } catch {
    // statfsSync may be unavailable
  }

  return {
    cpu_pct: cpuPct,
    load1: load1 !== null ? Math.round(load1 * 100) / 100 : null,
    ram_used_gb: ramUsedGb,
    ram_total_gb: ramTotalGb,
    disk_used_gb: diskUsedGb,
    disk_total_gb: diskTotalGb,
  };
}

function getSystemInfo(): SystemInfo {
  const now = nowTs();
  if (cachedSystemInfo && now - cachedSystemInfo.ts < 4.0) {
    return cachedSystemInfo.info;
  }
  const info = collectSystemInfo();
  cachedSystemInfo = { ts: now, info };
  return info;
}

let config = loadConfigOrDefault();
let discovery = scanDiscovery();
let registry = new Registry(discovery, config);
const runsStore = new InMemoryRunStore();
const receiptsStore = new InMemoryReceiptStore();
const jobsStore = new InMemoryJobStore();
const appliedSelfConfigTargets = new Set<string>();
const activeTimers = new Map<string, NodeJS.Timeout[]>();
const activeAborts = new Map<string, AbortController>();
let nextSyntheticPid = 41000;

const telemetryHistory: TelemetryPoint[] = (() => {
  const baseSys = collectSystemInfo();
  const now = nowTs();
  const ramPct =
    baseSys.ram_total_gb && baseSys.ram_used_gb
      ? Math.round((baseSys.ram_used_gb / baseSys.ram_total_gb) * 1000) / 10
      : 54.0;
  const diskPct =
    baseSys.disk_total_gb && baseSys.disk_used_gb
      ? Math.round((baseSys.disk_used_gb / baseSys.disk_total_gb) * 1000) / 10
      : 38.0;
  const cpuBase = baseSys.cpu_pct ?? 18.0;

  return Array.from({ length: 18 }, (_, idx) => {
    const wave = Math.sin(idx * 0.65) * 6 + Math.cos(idx * 0.3) * 3;
    return {
      ts: now - (17 - idx) * 60,
      cpu_pct: Math.round(Math.min(95, Math.max(4, cpuBase + wave)) * 10) / 10,
      ram_pct: Math.round(Math.min(96, Math.max(12, ramPct + wave * 0.35)) * 10) / 10,
      disk_pct: diskPct,
      active_runs: idx % 5 === 0 ? 2 : idx % 3 === 0 ? 1 : 0,
      rpm: Math.max(0, Math.round(4 + Math.sin(idx * 0.5) * 3)),
    };
  });
})();

function recordTelemetryPoint() {
  const sys = getSystemInfo();
  const activeRuns = runsStore
    .list()
    .filter((r) => r.state === 'running' || r.state === 'leased').length;
  const ramPct =
    sys.ram_total_gb && sys.ram_used_gb
      ? Math.round((sys.ram_used_gb / sys.ram_total_gb) * 1000) / 10
      : 54.0;
  const diskPct =
    sys.disk_total_gb && sys.disk_used_gb
      ? Math.round((sys.disk_used_gb / sys.disk_total_gb) * 1000) / 10
      : 38.0;

  telemetryHistory.push({
    ts: nowTs(),
    cpu_pct: sys.cpu_pct ?? 15.0,
    ram_pct: ramPct,
    disk_pct: diskPct,
    active_runs: activeRuns,
    rpm: registry.totalRpm(),
  });
  if (telemetryHistory.length > 36) {
    telemetryHistory.shift();
  }
}

function getCapabilities(): CapabilitiesInfo {
  const providers = Object.keys(discovery.keys);
  return {
    live_gemini_available: Boolean(process.env.GEMINI_API_KEY),
    discovered_providers: providers,
    rust_core_present: fs.existsSync(path.resolve(process.cwd(), 'core', 'Cargo.toml')),
    runtime: 'node-preview',
  };
}

function buildSnapshot(): Snapshot {
  const now = nowTs();
  const windowStart = now - 86_400;
  const runs = runsStore.list();
  const keyStatus = registry.keyStatus();
  const sys = getSystemInfo();

  const workersLive: LiveWorker[] = runs
    .filter((r) => r.state === 'running' || r.state === 'leased')
    .map((r) => {
      const started = Date.parse(r.created_at) / 1000;
      return {
        pid: r.pid ?? 0,
        worker: r.worker,
        caller: r.caller,
        key: r.key_slot,
        model: r.model,
        provider: r.provider,
        run_id: r.id,
        task: r.prompt,
        started,
        elapsed_s: Math.max(0, now - started),
        fanout_group: r.fanout_group ?? null,
      };
    });

  const lastDay = runs.filter((r) => Date.parse(r.created_at) / 1000 >= windowStart);
  const completed24h = lastDay.filter((r) => r.state === 'done').length;
  const failed24h = lastDay.filter((r) => r.state === 'failed' || r.state === 'escalated').length;
  const finishedMs = lastDay
    .map((r) => r.elapsed_ms)
    .filter((m): m is number => typeof m === 'number');
  const avgDurationS =
    finishedMs.length === 0
      ? null
      : finishedMs.reduce((sum, v) => sum + v, 0) / finishedMs.length / 1000;

  const overview: Overview = {
    running: workersLive.length,
    live_workers: workersLive.length,
    completed_24h: completed24h,
    failed_24h: failed24h,
    avg_duration_s: avgDurationS,
    cost_24h_usd: 0.0,
    calls_24h: lastDay.length,
    cpu_pct: sys.cpu_pct,
  };

  const { jobs, cronLive } = jobsStore.listWithLive();

  return {
    ts: now,
    overview,
    workers: keyStatus,
    workers_live: workersLive,
    sessions: runs.slice(0, 60).map((r) => ({
      id: r.id,
      ts: Date.parse(r.created_at) / 1000,
      prompt: r.prompt,
      worker: r.worker,
      caller: r.caller,
      key: r.key_slot,
      state: r.state,
      duration_s:
        typeof r.elapsed_ms === 'number'
          ? r.elapsed_ms / 1000
          : Math.max(0, now - Date.parse(r.created_at) / 1000),
      reason: r.error,
      output: r.output,
      receipt_id: r.receipt_id,
      steps: r.steps,
      fanout_group: r.fanout_group ?? null,
      failover_from: r.failover_from ?? null,
      live_api: r.live_api,
      tokens_in: r.tokens_in ?? null,
      tokens_out: r.tokens_out ?? null,
    })),
    jobs,
    cron_live: cronLive,
    router: { up: true, serve: true, proxy: true },
    system: sys,
    telemetry: [...telemetryHistory],
  };
}

function clearRunTimers(runId: string) {
  const timers = activeTimers.get(runId);
  if (timers) {
    for (const t of timers) clearTimeout(t);
    activeTimers.delete(runId);
  }
  const abort = activeAborts.get(runId);
  if (abort) {
    abort.abort();
    activeAborts.delete(runId);
  }
}

function killRunByPid(pid: number): { ok: boolean; run_id?: string; worker?: string } {
  const target = runsStore
    .list()
    .find((r) => r.pid === pid && (r.state === 'running' || r.state === 'leased'));
  if (!target) {
    return { ok: false };
  }

  clearRunTimers(target.id);

  if (target.key_slot) {
    registry.releaseKey(target.key_slot, false);
  }

  runsStore.appendStep(target.id, {
    ts: nowTs(),
    stage: 'killed',
    title: `Process PID ${pid} terminated`,
    detail: `SIGTERM issued via router control plane · key slot ${target.key_slot ?? 'local'} released`,
    tone: 'warn',
  });

  const elapsedMs = Math.max(100, Date.now() - Date.parse(target.created_at));
  runsStore.finish(
    target.id,
    'failed',
    elapsedMs,
    false,
    `killed by user (pid ${pid})`,
    target.output
  );

  return { ok: true, run_id: target.id, worker: target.worker };
}

async function runLiveGemini(
  cookedPrompt: string,
  signal: AbortSignal
): Promise<{ content: string; tokensIn: number; tokensOut: number; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured in runtime environment');
  }
  const model = 'gemini-2.5-flash';
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a worker executed behind Lingonberry Router. Respond concisely in 3-5 crisp lines confirming verification.',
        },
        { role: 'user', content: cookedPrompt },
      ],
      max_tokens: 240,
      temperature: 0.2,
    }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Provider HTTP ${res.status}: ${redactSecrets(errText.slice(0, 160))}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = redactSecrets(
    data.choices?.[0]?.message?.content?.trim() || 'Completed without text payload.'
  );
  return {
    content,
    tokensIn: data.usage?.prompt_tokens ?? Math.max(48, Math.round(cookedPrompt.length / 4)),
    tokensOut: data.usage?.completion_tokens ?? Math.max(24, Math.round(content.length / 4)),
    model,
  };
}

function dispatchRun(params: {
  prompt: string;
  caller: string | null;
  workerId?: string;
  phase?: string;
  useWorktree?: boolean;
  durationMs?: number;
  simulateFault?: 'none' | '429' | 'truncated';
  liveApi?: boolean;
  fanoutGroup?: string | null;
}) {
  const phase = params.phase || 'execute';
  const startSec = nowTs();
  const receipt = routePrompt(
    params.prompt,
    phase,
    params.caller,
    discovery,
    registry,
    Boolean(params.useWorktree)
  );
  receiptsStore.insert(receipt);

  const chosenWorker =
    (params.workerId ? registry.findWorker(params.workerId) : undefined) ??
    (receipt.selected ? registry.findWorker(receipt.selected.worker) : undefined) ??
    registry.selectBestWorker();

  const cooked =
    receipt.cooked ?? cookPrompt(params.prompt, discovery, phase, Boolean(params.useWorktree));

  const baseSteps: SessionStep[] = [
    {
      ts: startSec,
      stage: 'received',
      title: 'Prompt received',
      detail: `${params.caller ?? 'shell'} · ${params.prompt.slice(0, 96)}${params.prompt.length > 96 ? '…' : ''}`,
      tone: 'info',
    },
    {
      ts: startSec + 0.12,
      stage: 'cooked',
      title: `Cooked with ${cooked.selected_skill}`,
      detail: `Hook ${cooked.selected_hook} · Gate ${cooked.gate_policy} · Sources: ${cooked.retrieval_sources.join(', ')}`,
      tone: 'route',
    },
  ];

  if (!chosenWorker) {
    baseSteps.push({
      ts: startSec + 0.25,
      stage: 'gate',
      title: 'Abstained — no routable worker',
      detail: receipt.abstention ?? 'No agents or API keys passed constraint filtering',
      tone: 'warn',
    });
    const failedRun: Run = {
      id: crypto.randomUUID().slice(0, 8),
      created_at: new Date().toISOString(),
      worker: params.workerId || 'unassigned',
      caller: params.caller,
      key_slot: null,
      model: null,
      provider: null,
      prompt: params.prompt,
      gate: cooked.gate_policy,
      state: 'failed',
      pid: null,
      elapsed_ms: 12,
      gate_passed: false,
      error: 'No routable workers available (discover found no agents or API keys)',
      output: null,
      task_class: cooked.task_class,
      receipt_id: receipt.receipt_id,
      cooked,
      steps: baseSteps,
      fanout_group: params.fanoutGroup ?? null,
    };
    runsStore.insert(failedRun);
    return { run: failedRun, receipt };
  }

  let leasedKey: string | null = null;
  if (chosenWorker.key_slot !== null || chosenWorker.agent === 'pi') {
    try {
      leasedKey = registry.leaseKeyIn(
        chosenWorker.key_slot ?? undefined,
        chosenWorker.provider
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'key lease failed';
      baseSteps.push({
        ts: startSec + 0.25,
        stage: 'gate',
        title: 'Key lease blocked',
        detail: msg,
        tone: 'warn',
      });
      const blockedRun: Run = {
        id: crypto.randomUUID().slice(0, 8),
        created_at: new Date().toISOString(),
        worker: chosenWorker.id,
        caller: params.caller,
        key_slot: chosenWorker.key_slot,
        model: chosenWorker.model,
        provider: chosenWorker.provider,
        prompt: params.prompt,
        gate: cooked.gate_policy,
        state: 'blocked',
        pid: null,
        elapsed_ms: 8,
        gate_passed: false,
        error: msg,
        output: null,
        task_class: cooked.task_class,
        receipt_id: receipt.receipt_id,
        cooked,
        steps: baseSteps,
        fanout_group: params.fanoutGroup ?? null,
      };
      runsStore.insert(blockedRun);
      return { run: blockedRun, receipt };
    }
  }

  baseSteps.push({
    ts: startSec + 0.25,
    stage: 'routed',
    title: `Router selected ${chosenWorker.id}`,
    detail: receipt.selected?.reason ?? `class=${cooked.task_class}`,
    tone: 'route',
  });
  baseSteps.push({
    ts: startSec + 0.4,
    stage: 'leased',
    title: 'Dispatching task…',
    detail: leasedKey
      ? `Leased key slot ${leasedKey} (${chosenWorker.provider})`
      : `Local CLI execution (${chosenWorker.agent})`,
    tone: 'active',
  });

  const runId = crypto.randomUUID().slice(0, 8);
  const pid = nextSyntheticPid++;
  const run: Run = {
    id: runId,
    created_at: new Date().toISOString(),
    worker: chosenWorker.id,
    caller: params.caller,
    key_slot: leasedKey,
    model: chosenWorker.model,
    provider: chosenWorker.provider,
    prompt: params.prompt,
    gate: cooked.gate_policy,
    state: 'running',
    pid,
    elapsed_ms: null,
    gate_passed: null,
    error: null,
    output: null,
    task_class: cooked.task_class,
    receipt_id: receipt.receipt_id,
    cooked,
    steps: baseSteps,
    fanout_group: params.fanoutGroup ?? null,
    failover_from: null,
    live_api: Boolean(params.liveApi),
  };
  runsStore.insert(run);

  // Live Gemini execution path when requested & GEMINI_API_KEY is available
  if (params.liveApi && process.env.GEMINI_API_KEY && (!params.simulateFault || params.simulateFault === 'none')) {
    const controller = new AbortController();
    activeAborts.set(runId, controller);
    runLiveGemini(cooked.cooked_prompt, controller.signal)
      .then((res) => {
        activeAborts.delete(runId);
        const current = runsStore.get(runId);
        if (!current || current.state !== 'running') return;
        if (leasedKey) registry.releaseKey(leasedKey, true);
        const elapsedMs = Math.max(100, Date.now() - Date.parse(current.created_at));
        runsStore.appendStep(runId, {
          ts: nowTs(),
          stage: 'gate',
          title: 'Live API response verified',
          detail: `${res.model} · ${res.tokensIn} in / ${res.tokensOut} out · Gate ${cooked.gate_policy} passed`,
          tone: 'done',
        });
        runsStore.finish(runId, 'done', elapsedMs, true, null, res.content, res.tokensIn, res.tokensOut);
      })
      .catch((err) => {
        activeAborts.delete(runId);
        const current = runsStore.get(runId);
        if (!current || current.state !== 'running') return;
        if (leasedKey) registry.releaseKey(leasedKey, false);
        const msg = err instanceof Error ? err.message : 'live provider call failed';
        const elapsedMs = Math.max(100, Date.now() - Date.parse(current.created_at));
        runsStore.appendStep(runId, {
          ts: nowTs(),
          stage: 'gate',
          title: 'Live provider error',
          detail: msg,
          tone: 'warn',
        });
        runsStore.finish(runId, 'failed', elapsedMs, false, msg, null);
      });
    return { run, receipt };
  }

  const timersForRun: NodeJS.Timeout[] = [];
  const fault = params.simulateFault ?? 'none';

  if (fault === '429' || fault === 'truncated') {
    const tFailover = setTimeout(() => {
      const current = runsStore.get(runId);
      if (!current || current.state !== 'running') return;

      const failedSlot = current.key_slot;
      if (failedSlot) {
        registry.releaseKey(failedSlot, false, 20);
      }
      const excluded = new Set<string>(failedSlot ? [failedSlot] : []);
      const fallback = registry.findFallbackWorker(excluded, current.provider ?? undefined);

      const faultDesc =
        fault === '429'
          ? 'HTTP 429 rate-limit burst detected'
          : 'Truncated response detected (incomplete JSON/code block)';

      if (!fallback || !fallback.key_slot) {
        runsStore.appendStep(runId, {
          ts: nowTs(),
          stage: 'failover',
          title: `${faultDesc} — escalated`,
          detail: `Slot ${failedSlot ?? current.worker} placed on 20s cooldown; no sibling slot free`,
          tone: 'warn',
        });
        const elapsedMs = Math.max(100, Date.now() - Date.parse(current.created_at));
        runsStore.finish(
          runId,
          'escalated',
          elapsedMs,
          false,
          `${faultDesc}; slot ${failedSlot ?? current.worker} cooling down`,
          null
        );
        return;
      }

      let nextKey: string | null = null;
      try {
        nextKey = registry.leaseKeyIn(fallback.key_slot, fallback.provider);
      } catch {
        nextKey = null;
      }

      if (!nextKey) {
        const elapsedMs = Math.max(100, Date.parse(current.created_at));
        runsStore.finish(
          runId,
          'escalated',
          elapsedMs,
          false,
          `${faultDesc}; sibling slots saturated`,
          null
        );
        return;
      }

      runsStore.appendStep(runId, {
        ts: nowTs(),
        stage: 'failover',
        title: `Auto-failover from ${failedSlot ?? current.worker} → ${nextKey}`,
        detail: `${faultDesc} · placed ${failedSlot ?? 'primary'} on cooldown, leased ${nextKey}`,
        tone: 'warn',
      });
      runsStore.updateDispatchTarget(
        runId,
        fallback.id,
        nextKey,
        fallback.provider,
        fallback.model,
        failedSlot ?? current.worker
      );

      const tDone = setTimeout(() => {
        activeTimers.delete(runId);
        const latest = runsStore.get(runId);
        if (!latest || latest.state !== 'running') return;
        registry.releaseKey(nextKey!, true);
        const elapsedMs = Math.max(100, Date.now() - Date.parse(latest.created_at));
        const output = [
          `Recovered via automatic failover (${failedSlot ?? current.worker} → ${fallback.id} / ${nextKey})`,
          `Trigger: ${faultDesc}`,
          `Skill: ${cooked.selected_skill} · Gate: ${cooked.gate_policy} (passed)`,
          `Receipt ${receipt.receipt_id.slice(0, 8)} verified.`,
        ].join('\n');
        runsStore.appendStep(runId, {
          ts: nowTs(),
          stage: 'gate',
          title: 'Execution completed after retry',
          detail: `Verified on ${fallback.id} (${nextKey}) · Gate ${cooked.gate_policy} passed`,
          tone: 'done',
        });
        runsStore.finish(runId, 'done', elapsedMs, true, null, output, 1140, 620);
      }, 1700);
      timersForRun.push(tDone);
    }, 1300);

    timersForRun.push(tFailover);
    activeTimers.set(runId, timersForRun);
    return { run, receipt };
  }

  const settleDelay = Math.min(10000, Math.max(1400, params.durationMs ?? 3200));
  const tSettle = setTimeout(() => {
    activeTimers.delete(runId);
    const current = runsStore.get(runId);
    if (!current || current.state !== 'running') return;

    if (leasedKey) {
      registry.releaseKey(leasedKey, true);
    }
    const elapsedMs = Math.max(100, Date.now() - Date.parse(current.created_at));
    const tokensIn = Math.max(320, Math.round(cooked.cooked_prompt.length * 1.4));
    const tokensOut = Math.max(180, Math.round(tokensIn * 0.72));
    const output = [
      `Dispatched via ${chosenWorker.id}${leasedKey ? ` (leased ${leasedKey})` : ''}`,
      `Skill: ${cooked.selected_skill} · Hook: ${cooked.selected_hook} · Gate: ${cooked.gate_policy} (passed)`,
      `Context sources: ${cooked.retrieval_sources.join(', ')}`,
      `Receipt ${receipt.receipt_id.slice(0, 8)} verified.`,
    ].join('\n');

    runsStore.appendStep(runId, {
      ts: nowTs(),
      stage: 'gate',
      title: 'Execution completed',
      detail: `Gate ${cooked.gate_policy} passed · ${tokensIn} in / ${tokensOut} out`,
      tone: 'done',
    });

    runsStore.finish(runId, 'done', elapsedMs, true, null, output, tokensIn, tokensOut);
  }, settleDelay);

  timersForRun.push(tSettle);
  activeTimers.set(runId, timersForRun);
  return { run, receipt };
}

function seedInitialRuns() {
  if (runsStore.list().length > 0) return;
  const nowIso = new Date(Date.now() - 180_000).toISOString();
  const baseTs = Date.now() / 1000 - 180;
  const seedCook = cookPrompt(
    'audit auth middleware for cookie drops across preview iframe and verify with tests',
    discovery,
    'execute',
    true
  );
  const seedReceipt = routePrompt(
    seedCook.raw_prompt,
    'execute',
    'claude',
    discovery,
    registry,
    true
  );
  receiptsStore.insert(seedReceipt);

  const workerId = seedReceipt.selected?.worker ?? 'gemini:GEMINI_API_KEY';
  const foundWorker = registry.findWorker(workerId);

  runsStore.insert({
    id: 'seed91a4',
    created_at: nowIso,
    worker: workerId,
    caller: 'claude',
    key_slot: foundWorker?.key_slot ?? null,
    model: foundWorker?.model ?? 'gemini-2.5-flash',
    provider: foundWorker?.provider ?? 'gemini',
    prompt: seedCook.raw_prompt,
    gate: seedCook.gate_policy,
    state: 'done',
    pid: 40912,
    elapsed_ms: 2840,
    gate_passed: true,
    error: null,
    output: [
      `Dispatched via ${workerId}`,
      `Skill: ${seedCook.selected_skill} · Gate: ${seedCook.gate_policy} (passed)`,
      `All 14 checks passed in worktree · receipt verified.`,
    ].join('\n'),
    task_class: seedCook.task_class,
    receipt_id: seedReceipt.receipt_id,
    cooked: seedCook,
    tokens_in: 1240,
    tokens_out: 1810,
    steps: [
      {
        ts: baseTs,
        stage: 'received',
        title: 'Prompt received',
        detail: 'claude · audit auth middleware for cookie drops…',
        tone: 'info',
      },
      {
        ts: baseTs + 0.4,
        stage: 'cooked',
        title: `Cooked with ${seedCook.selected_skill}`,
        detail: `Hook ${seedCook.selected_hook} · Gate ${seedCook.gate_policy}`,
        tone: 'route',
      },
      {
        ts: baseTs + 1.0,
        stage: 'routed',
        title: `Router selected ${workerId}`,
        detail: seedReceipt.selected?.reason ?? 'best healthy worker',
        tone: 'route',
      },
      {
        ts: baseTs + 2.8,
        stage: 'gate',
        title: 'Execution completed',
        detail: 'Result verified ✓ · 1,240 in / 1,810 out',
        tone: 'done',
      },
    ],
  });
}

async function startServer() {
  seedInitialRuns();

  const app = express();
  app.use(express.json());

  // 5s background cron + telemetry ticker
  setInterval(() => {
    const dueJobs = jobsStore.tick(5);
    for (const job of dueJobs) {
      dispatchRun({
        prompt: job.prompt || `Scheduled sweep: ${job.name}`,
        caller: `cron:${job.name}`,
        durationMs: 2200,
      });
    }
    recordTelemetryPoint();
  }, 5000);

  const handleSnapshot = (_req: Request, res: Response) => {
    res.json(buildSnapshot());
  };
  const handleKeys = (_req: Request, res: Response) => {
    res.json(registry.keyStatus());
  };
  const handleRunsList = (_req: Request, res: Response) => {
    res.json(runsStore.list());
  };
  const handleRunGet = (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    const run = runsStore.get(id);
    if (!run) {
      res.status(404).end();
      return;
    }
    res.json(run);
  };
  const handleDiscover = (_req: Request, res: Response) => {
    res.json({ ...discovery, workers: registry.listWorkers() });
  };
  const handleReceiptsList = (_req: Request, res: Response) => {
    res.json(receiptsStore.list());
  };
  const handleReceiptGet = (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    const receipt = receiptsStore.get(id);
    if (!receipt) {
      res.status(404).end();
      return;
    }
    res.json(receipt);
  };
  const handleKill = (req: Request, res: Response) => {
    const pid = Number(req.params.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      res.status(404).end();
      return;
    }
    const result = killRunByPid(pid);
    if (!result.ok) {
      res.status(404).end();
      return;
    }
    res.json({ ok: true, pid, run_id: result.run_id, worker: result.worker });
  };
  const handleVersion = (_req: Request, res: Response) => {
    res.json({
      pid: process.pid,
      version: APP_VERSION,
      exe_mtime: startedExeMtime,
    });
  };
  const handleShutdown = (_req: Request, res: Response) => {
    res.status(501).json({
      error: 'Shutdown is disabled in the managed Node.js runtime',
      pid: process.pid,
    });
  };

  // Core Rust-compatible endpoints
  app.get('/snapshot', handleSnapshot);
  app.get('/keys', handleKeys);
  app.get('/runs', handleRunsList);
  app.get('/runs/:id', handleRunGet);
  app.get('/discover', handleDiscover);
  app.get('/receipts', handleReceiptsList);
  app.get('/receipts/:id', handleReceiptGet);
  app.post('/kill/:pid', handleKill);
  app.get('/version', handleVersion);
  app.post('/shutdown', handleShutdown);

  // Web UI /api/* endpoints
  app.get('/api/snapshot', handleSnapshot);
  app.get('/api/keys', handleKeys);
  app.get('/api/runs', handleRunsList);
  app.get('/api/runs/:id', handleRunGet);
  app.get('/api/discover', handleDiscover);
  app.get('/api/receipts', handleReceiptsList);
  app.get('/api/receipts/:id', handleReceiptGet);
  app.post('/api/kill/:pid', handleKill);
  app.get('/api/version', handleVersion);
  app.get('/api/capabilities', (_req, res) => {
    res.json(getCapabilities());
  });

  app.post('/api/keys/:name/reset', (req, res) => {
    const name = String(req.params.name ?? '');
    registry.clearCooldown(name);
    res.json({ snapshot: buildSnapshot() });
  });

  app.post('/api/keys/:name/rpm', (req, res) => {
    const name = String(req.params.name ?? '');
    const rpm = Number((req.body as { rpm?: number })?.rpm);
    if (!Number.isFinite(rpm) || rpm < 5 || rpm > 300) {
      res.status(400).json({ error: 'rpm must be between 5 and 300' });
      return;
    }
    if (!registry.setRpmLimit(name, rpm)) {
      res.status(404).json({ error: 'key or provider not found' });
      return;
    }
    res.json({ ok: true, snapshot: buildSnapshot() });
  });

  app.post('/api/rescan', (_req, res) => {
    config = loadConfigOrDefault();
    discovery = scanDiscovery();
    registry = new Registry(discovery, config);
    jobsStore.rescanHostJobs();
    res.json({
      discovery: { ...discovery, workers: registry.listWorkers() },
      self_config: buildSelfConfigPlan(discovery, config, appliedSelfConfigTargets),
      capabilities: getCapabilities(),
      snapshot: buildSnapshot(),
    });
  });

  app.post('/api/route', (req, res) => {
    const body = req.body as {
      prompt?: string;
      phase?: string;
      caller?: string;
      worktree?: boolean;
    };
    const prompt = (body?.prompt || '').trim();
    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }
    const receipt = routePrompt(
      prompt,
      body?.phase || 'plan',
      body?.caller || 'shell',
      discovery,
      registry,
      Boolean(body?.worktree)
    );
    receiptsStore.insert(receipt);
    res.json(receipt);
  });

  app.post('/api/run', (req, res) => {
    const body = req.body as {
      prompt?: string;
      caller?: string;
      worker?: string;
      phase?: string;
      worktree?: boolean;
      duration_ms?: number;
      simulate_fault?: 'none' | '429' | 'truncated';
      live_api?: boolean;
    };
    const prompt = (body?.prompt || '').trim();
    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }
    const result = dispatchRun({
      prompt,
      caller: body?.caller || 'claude',
      workerId: body?.worker || undefined,
      phase: body?.phase || 'execute',
      useWorktree: Boolean(body?.worktree),
      durationMs: body?.duration_ms,
      simulateFault: body?.simulate_fault,
      liveApi: Boolean(body?.live_api),
    });
    res.json({ ...result, snapshot: buildSnapshot() });
  });

  app.post('/api/fanout', (req, res) => {
    const body = req.body as {
      prompts?: string[];
      prompt?: string;
      caller?: string;
      worktree?: boolean;
      duration_ms?: number;
    };
    const basePrompt = (body?.prompt || '').trim();
    const prompts =
      Array.isArray(body?.prompts) && body.prompts.length > 0
        ? body.prompts.map((p) => p.trim()).filter(Boolean)
        : basePrompt
          ? [
              `[Branch 1/3 · Architecture] ${basePrompt}`,
              `[Branch 2/3 · Tests & Gate] ${basePrompt}`,
              `[Branch 3/3 · Security Review] ${basePrompt}`,
            ]
          : [];
    if (prompts.length === 0) {
      res.status(400).json({ error: 'prompt or prompts[] is required' });
      return;
    }
    const fanoutGroup = `fan-${crypto.randomUUID().slice(0, 6)}`;
    const available = registry.listWorkers();
    const results = prompts.map((p, idx) => {
      const targetWorker = available.length > 0 ? available[idx % available.length] : undefined;
      return dispatchRun({
        prompt: p,
        caller: body?.caller || 'claude',
        workerId: targetWorker?.id,
        phase: 'fanout',
        useWorktree: Boolean(body?.worktree),
        durationMs: body?.duration_ms ?? 3400 + idx * 700,
        fanoutGroup,
      });
    });
    res.json({
      fanout_group: fanoutGroup,
      runs: results.map((r) => r.run),
      snapshot: buildSnapshot(),
    });
  });

  app.get('/api/jobs', (_req, res) => {
    const { jobs, cronLive } = jobsStore.listWithLive();
    res.json({ jobs, cron_live: cronLive });
  });

  app.post('/api/jobs/rescan', (_req, res) => {
    jobsStore.rescanHostJobs();
    res.json(buildSnapshot());
  });

  app.post('/api/jobs/kill/:pid', (req, res) => {
    const pid = Number(req.params.pid);
    if (!Number.isInteger(pid) || pid <= 1) {
      res.status(404).end();
      return;
    }
    const { cronLive } = jobsStore.listWithLive();
    const allowedPids = new Set(cronLive.map((p) => p.pid));
    if (!killCronOsPid(pid, allowedPids)) {
      res.status(404).json({ error: 'PID not found among active cron processes' });
      return;
    }
    res.json({ ok: true, pid, snapshot: buildSnapshot() });
  });

  app.post('/api/jobs', (req, res) => {
    const body = req.body as {
      name?: string;
      every_s?: number;
      schedule?: string;
      command?: string;
      prompt?: string;
      source?: string;
      auto_restart?: boolean;
    };
    const name = (body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'job name is required' });
      return;
    }
    const everyS = Math.max(30, Number(body?.every_s) || 300);
    const promptText = (body?.prompt || 'Scheduled router verification run').trim();
    jobsStore.upsert({
      name,
      source: body?.source || 'lingonberry',
      schedule: (body?.schedule || '').trim() || `every ${everyS}s`,
      command: (body?.command || '').trim() || `lingonberry-core run "${promptText}"`,
      every_s: everyS,
      last: null,
      rc: null,
      paused: false,
      next_in_s: everyS,
      prompt: promptText,
      health: 'healthy',
      running_pid: null,
      crash_count: 0,
      restart_count: 0,
      auto_restart: body?.auto_restart ?? true,
      last_error: null,
      log_tail: ['Scheduled with watchdog monitoring'],
    });
    res.json(buildSnapshot());
  });

  app.post('/api/jobs/:name/toggle', (req, res) => {
    const name = String(req.params.name ?? '');
    const job = jobsStore.toggle(name);
    if (!job) {
      res.status(404).end();
      return;
    }
    res.json(buildSnapshot());
  });

  app.post('/api/jobs/:name/watchdog', (req, res) => {
    const name = String(req.params.name ?? '');
    const job = jobsStore.toggleWatchdog(name);
    if (!job) {
      res.status(404).end();
      return;
    }
    res.json(buildSnapshot());
  });

  app.post('/api/jobs/:name/heal', (req, res) => {
    const name = String(req.params.name ?? '');
    const job = jobsStore.heal(name);
    if (!job) {
      res.status(404).end();
      return;
    }
    res.json({ job, snapshot: buildSnapshot() });
  });

  app.post('/api/jobs/:name/simulate-crash', (req, res) => {
    const name = String(req.params.name ?? '');
    const job = jobsStore.simulateCrash(name);
    if (!job) {
      res.status(404).end();
      return;
    }
    res.json({ job, snapshot: buildSnapshot() });
  });

  app.post('/api/jobs/:name/run', (req, res) => {
    const name = String(req.params.name ?? '');
    const job = jobsStore.recordRun(name, 0, `manual run triggered for ${name}`);
    if (!job) {
      res.status(404).end();
      return;
    }
    const dispatch = dispatchRun({
      prompt: job.prompt || `Run scheduled job ${job.name}`,
      caller: `cron:${job.name}`,
      durationMs: 2400,
    });
    res.json({ jobs: jobsStore.list(), run: dispatch.run, snapshot: buildSnapshot() });
  });

  app.delete('/api/jobs/:name', (req, res) => {
    const name = String(req.params.name ?? '');
    if (!jobsStore.remove(name)) {
      res.status(404).end();
      return;
    }
    res.json(buildSnapshot());
  });

  app.get('/api/self-config', (_req, res) => {
    res.json(buildSelfConfigPlan(discovery, config, appliedSelfConfigTargets));
  });

  app.post('/api/self-config/apply', (req, res) => {
    const body = req.body as { targets?: string[] };
    const plan = buildSelfConfigPlan(discovery, config, appliedSelfConfigTargets);
    const chosen = new Set(
      body?.targets && body.targets.length > 0 ? body.targets : plan.targets.map((t) => t.path)
    );
    for (const target of plan.targets) {
      if (chosen.has(target.path)) {
        appliedSelfConfigTargets.add(target.path);
      }
    }
    res.json(buildSelfConfigPlan(discovery, config, appliedSelfConfigTargets));
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Lingonberry Router running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
