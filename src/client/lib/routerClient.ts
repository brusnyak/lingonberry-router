import type {
  CapabilitiesInfo,
  CookedPromptInfo,
  DiscoveredWorker,
  DiscoveryData,
  JobRow,
  LiveCronProcess,
  Receipt,
  Run,
  SelfConfigPlan,
  SessionStep,
  Snapshot,
  TelemetryPoint,
} from '../../types';

export interface DiscoverResponse extends DiscoveryData {
  workers: DiscoveredWorker[];
}

export interface RouterRuntimeState {
  mode: 'live-api' | 'static-preview';
  snapshot: Snapshot;
  discovery: DiscoverResponse;
  receipts: Receipt[];
  selfConfig: SelfConfigPlan;
  capabilities: CapabilitiesInfo;
}

class StaticSandbox {
  private discovery: DiscoverResponse = {
    agents: [
      { id: 'claude', path: '/usr/local/bin/claude' },
      { id: 'codex', path: '/usr/local/bin/codex' },
      { id: 'opencode', path: '/usr/local/bin/opencode' },
      { id: 'pi', path: '/usr/local/bin/pi' },
    ],
    keys: {
      nim: ['NIM_1', 'NIM_2'],
      groq: ['GROQ_API_KEY'],
      gemini: ['GEMINI_API_KEY'],
    },
    providers: {
      nim: { id: 'nim', base_url: 'https://integrate.api.nvidia.com/v1', style: 'openai' },
      groq: { id: 'groq', base_url: 'https://api.groq.com/openai/v1', style: 'openai' },
      gemini: {
        id: 'gemini',
        base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
        style: 'openai',
      },
    },
    library_dirs: ['~/.agent-skills', '~/.claude/skills', '~/.codex/skills'],
    ssh_hosts: ['mac-mini-worker'],
    git_projects: ['~/Developer/lingonberry-router'],
    browsers: [],
    workers: [
      {
        id: 'pi:NIM_1',
        agent: 'pi',
        key_name: 'NIM_1',
        provider: 'nim',
        base_url: 'https://integrate.api.nvidia.com/v1',
        model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
        write_access: true,
        path: null,
      },
      {
        id: 'pi:NIM_2',
        agent: 'pi',
        key_name: 'NIM_2',
        provider: 'nim',
        base_url: 'https://integrate.api.nvidia.com/v1',
        model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
        write_access: true,
        path: null,
      },
      {
        id: 'groq:GROQ_API_KEY',
        agent: 'groq',
        key_name: 'GROQ_API_KEY',
        provider: 'groq',
        base_url: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        write_access: true,
        path: null,
      },
      {
        id: 'gemini:GEMINI_API_KEY',
        agent: 'gemini',
        key_name: 'GEMINI_API_KEY',
        provider: 'gemini',
        base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-2.5-flash',
        write_access: true,
        path: null,
      },
      {
        id: 'claude',
        agent: 'claude',
        key_name: null,
        provider: 'claude',
        base_url: null,
        model: 'claude-sonnet-4',
        write_access: true,
        path: '/usr/local/bin/claude',
      },
      {
        id: 'codex',
        agent: 'codex',
        key_name: null,
        provider: 'codex',
        base_url: null,
        model: 'gpt-5-codex',
        write_access: true,
        path: '/usr/local/bin/codex',
      },
    ],
  };

  private runs: Run[] = [];
  private receipts: Receipt[] = [];
  private jobs: JobRow[] = [
    {
      name: 'vault-ticket-digest',
      source: 'launchd',
      schedule: '0 */4 * * *',
      command: 'lingonberry-core run "Summarize open vault tickets"',
      every_s: 14400,
      last: Date.now() / 1000 - 3920,
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
      last: Date.now() / 1000 - 110,
      rc: 0,
      paused: false,
      next_in_s: 190,
      prompt: 'Verify config, key cooldowns, and worker reachability',
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
      last: Date.now() / 1000 - 540,
      rc: 0,
      paused: false,
      next_in_s: 1260,
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
      last: Date.now() / 1000 - 12400,
      rc: 0,
      paused: false,
      next_in_s: 74000,
      prompt: 'Run read-only security and dependency check across git projects',
      health: 'healthy',
      running_pid: null,
      crash_count: 0,
      restart_count: 1,
      auto_restart: true,
      last_error: null,
      log_tail: ['gate clean · 0 secret findings'],
    },
  ];
  private cronLive: LiveCronProcess[] = [
    {
      pid: 48210,
      job_name: 'doctor-health-sweep',
      source: 'lingonberry',
      command: 'lingonberry-core doctor --quiet',
      cpu_pct: 1.4,
      mem_mb: 14.2,
      elapsed_s: 42,
    },
  ];
  private applied = new Set<string>(['~/.agent-skills/lingonberry-router/SKILL.md']);
  private nextPid = 42100;
  private inflightByKey = new Map<string, number>();
  private coolingUntil = new Map<string, number>();
  private providerRpmCaps = new Map<string, number>([
    ['nim', 40],
    ['groq', 30],
    ['gemini', 40],
  ]);
  private okByKey = new Map<string, number>([
    ['NIM_1', 6],
    ['NIM_2', 4],
    ['GROQ_API_KEY', 3],
    ['GEMINI_API_KEY', 5],
  ]);

  private telemetry: TelemetryPoint[] = Array.from({ length: 18 }, (_, idx) => {
    const now = Date.now() / 1000;
    const wave = Math.sin(idx * 0.65) * 6 + Math.cos(idx * 0.35) * 3;
    return {
      ts: now - (17 - idx) * 60,
      cpu_pct: Math.round(Math.min(92, Math.max(12, 24 + wave)) * 10) / 10,
      ram_pct: Math.round((56 + wave * 0.3) * 10) / 10,
      disk_pct: 36.4,
      active_runs: idx % 4 === 0 ? 2 : 1,
      rpm: Math.max(1, Math.round(6 + Math.sin(idx * 0.5) * 3)),
    };
  });

  constructor() {
    const baseTs = Date.now() / 1000 - 120;
    const initialCook: CookedPromptInfo = {
      raw_prompt: 'sample: summarise the latest worker logs',
      cooked_prompt:
        '[Constitution: global-agentic-skills · systematic-debugging]\n[Hook: pre-apply-diff-preview · Gate: test-suite-exit-0]\nObjective: sample: summarise the latest worker logs',
      task_class: 'debug_fix',
      selected_skill: 'systematic-debugging',
      selected_command: 'lingonberry-core run --worktree --gate test',
      selected_hook: 'pre-apply-diff-preview',
      retrieval_sources: ['~/.agent-skills', '~/Developer/lingonberry-router'],
      gate_policy: 'test-suite-exit-0',
    };
    const receiptId = 'rcpt-seed-91a4';
    this.receipts.push({
      receipt_id: receiptId,
      context_hash: '7f2e8a1b9c4d3e0f1a2b3c4d5e6f7a8b',
      catalog_hash: '2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
      policy_hash: '9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b',
      pool_hash: '11223344556677889900aabbccddeeff',
      registry_hash: 'aabbccddeeff00112233445566778899',
      phase: 'execute',
      selected: {
        worker: 'pi:NIM_1',
        model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
        effort: 'standard',
        gate: 'test-suite-exit-0',
        reason: 'score=1.00 · skill=systematic-debugging',
      },
      alternatives: [
        {
          worker: 'gemini:GEMINI_API_KEY',
          model: 'gemini-2.5-flash',
          effort: 'standard',
          gate: 'test-suite-exit-0',
          reason: 'score=0.92 · skill=systematic-debugging',
        },
      ],
      exclusions: [],
      abstention: null,
      created_at: new Date(Date.now() - 45_000).toISOString(),
      caller: 'claude',
      cooked: initialCook,
    });
    this.runs.push({
      id: '91a4f02c',
      created_at: new Date(Date.now() - 45_000).toISOString(),
      worker: 'pi:NIM_1',
      caller: 'claude',
      key_name: 'NIM_1',
      model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      provider: 'nim',
      prompt: 'sample: summarise the latest worker logs',
      gate: 'test-suite-exit-0',
      state: 'done',
      pid: 41982,
      elapsed_ms: 2840,
      gate_passed: true,
      error: null,
      output: 'All 14 tests passed in worktree · receipt verified.',
      task_class: 'debug_fix',
      receipt_id: receiptId,
      cooked: initialCook,
      tokens_in: 1240,
      tokens_out: 1820,
      steps: [
        {
          ts: baseTs,
          stage: 'received',
          title: 'Prompt received',
          detail: 'claude · 1.2k context tokens',
          tone: 'info',
        },
        {
          ts: baseTs + 0.3,
          stage: 'cooked',
          title: 'Cooked with systematic-debugging',
          detail: 'Hook pre-apply-diff-preview · Gate test-suite-exit-0',
          tone: 'route',
        },
        {
          ts: baseTs + 0.9,
          stage: 'routed',
          title: 'Router selected pi:NIM_1',
          detail: 'Leased key NIM_1 (nim)',
          tone: 'route',
        },
        {
          ts: baseTs + 2.8,
          stage: 'gate',
          title: 'Execution completed',
          detail: 'Result verified · 14/14 assertions',
          tone: 'done',
        },
      ],
    });
  }

  getState(): RouterRuntimeState {
    const now = Date.now() / 1000;
    const workersLive = this.runs
      .filter((r) => r.state === 'running' || r.state === 'leased')
      .map((r) => ({
        pid: r.pid ?? 0,
        worker: r.worker,
        caller: r.caller,
        key: r.key_name,
        model: r.model,
        provider: r.provider,
        run_id: r.id,
        task: r.prompt,
        started: Date.parse(r.created_at) / 1000,
        elapsed_s: Math.max(0, now - Date.parse(r.created_at) / 1000),
        fanout_group: r.fanout_group ?? null,
      }));

    const done = this.runs.filter((r) => r.state === 'done').length;
    const failed = this.runs.filter((r) => r.state === 'failed' || r.state === 'escalated').length;
    const durations = this.runs
      .map((r) => r.elapsed_ms)
      .filter((m): m is number => typeof m === 'number');

    const snapshot: Snapshot = {
      ts: now,
      overview: {
        running: workersLive.length,
        live_workers: workersLive.length,
        completed_24h: done,
        failed_24h: failed,
        avg_duration_s:
          durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length / 1000
            : null,
        cost_24h_usd: 0.0,
        calls_24h: this.runs.length,
        cpu_pct: this.telemetry[this.telemetry.length - 1]?.cpu_pct ?? 22.4,
      },
      workers: Object.entries(this.discovery.keys).flatMap(([prov, keys]) =>
        keys.map((k) => {
          const cool = Math.max(0, Math.ceil((this.coolingUntil.get(k) ?? 0) - now));
          const inflight = this.inflightByKey.get(k) ?? 0;
          const status =
            cool > 0
              ? ('down' as const)
              : inflight > 0
                ? ('active' as const)
                : ('idle' as const);
          return {
            name: k,
            status,
            calls_24h: (this.okByKey.get(k) ?? 0) + inflight,
            ok_24h: this.okByKey.get(k) ?? 0,
            key: k,
            provider: prov,
            cooling_remaining_s: cool,
            rpm_limit: this.providerRpmCaps.get(prov) ?? 40,
            inflight,
          };
        })
      ),
      workers_live: workersLive,
      sessions: this.runs.map((r) => ({
        id: r.id,
        ts: Date.parse(r.created_at) / 1000,
        prompt: r.prompt,
        worker: r.worker,
        caller: r.caller,
        key: r.key_name,
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
        tokens_in: r.tokens_in ?? null,
        tokens_out: r.tokens_out ?? null,
      })),
      jobs: this.jobs.map((j) => {
        const live = this.cronLive.find((p) => p.job_name === j.name);
        return {
          ...j,
          running_pid: live?.pid ?? null,
          health: live ? 'running' : j.health,
        };
      }),
      cron_live: [...this.cronLive],
      router: { up: true, serve: true, proxy: true },
      system: {
        cpu_pct: this.telemetry[this.telemetry.length - 1]?.cpu_pct ?? 22.4,
        load1: 1.42,
        ram_used_gb: 13.4,
        ram_total_gb: 24.0,
        disk_used_gb: 186.4,
        disk_total_gb: 512.0,
      },
      telemetry: [...this.telemetry],
    };

    return {
      mode: 'static-preview',
      snapshot,
      discovery: this.discovery,
      receipts: [...this.receipts],
      selfConfig: this.getSelfConfig(),
      capabilities: {
        live_gemini_available: false,
        discovered_providers: ['nim', 'groq', 'gemini'],
        rust_core_present: true,
        runtime: 'static-sandbox',
      },
    };
  }

  getSelfConfig(): SelfConfigPlan {
    const entries = [
      {
        target: 'Global Agentic Skills + Constitution',
        scope: 'global' as const,
        path: '~/.agent-skills/lingonberry-router/SKILL.md',
        reason:
          'Single shared source of truth: every agent reading global skills inherits Lingonberry routing without per-agent duplication.',
        snippet:
          '---\nname: lingonberry-router\ndescription: Delegate heavy, parallel, or multi-provider work via lingonberry-core.\n---\nRun `lingonberry-core route "<prompt>"` before dispatch.',
      },
      {
        target: 'Shared Router Directive',
        scope: 'global' as const,
        path: '~/.lingonberry/CONSTITUTION.md',
        reason:
          'Defines prompt-cooking rules, destructive-keyword gates, and key isolation across all callers.',
        snippet:
          '# Lingonberry Constitution Pointer\nUse `ROUTER_CALLER=<agent>` and loopback `127.0.0.1:8799`.',
      },
      {
        target: 'MCP Tool Bridge (lingonberry-core mcp)',
        scope: 'global' as const,
        path: '~/.lingonberry/mcp.json',
        reason:
          'Exposes route, run, fanout, and snapshot as standard MCP tools so IDE agents discover the router automatically.',
        snippet: JSON.stringify(
          { mcpServers: { 'lingonberry-router': { command: 'lingonberry-core', args: ['mcp'] } } },
          null,
          2
        ),
      },
      {
        target: 'claude (light pointer)',
        scope: 'light-pointer' as const,
        path: '~/.claude/CLAUDE.md',
        reason: 'Discovered Claude Code: 2-line pointer to shared global skill.',
        snippet:
          '<!-- lingonberry:start -->\nRead `~/.agent-skills/lingonberry-router/SKILL.md` for subagent dispatch.\n<!-- lingonberry:end -->',
      },
      {
        target: 'codex (light pointer)',
        scope: 'light-pointer' as const,
        path: '~/.codex/AGENTS.md',
        reason: 'Discovered Codex CLI: 2-line pointer to shared global skill.',
        snippet:
          '<!-- lingonberry:start -->\nUse `lingonberry-core` per `~/.agent-skills/lingonberry-router/SKILL.md`.\n<!-- lingonberry:end -->',
      },
    ];
    return {
      os: 'Cross-OS (macOS · Linux · Windows)',
      preferred_root: '~/.agent-skills',
      strategy:
        'Global-first injection: write one canonical skill, constitution & MCP bridge in your shared global folder, plus 2-line idempotent pointers per agent.',
      targets: entries.map((e) => ({
        ...e,
        status: this.applied.has(e.path) ? 'applied' : 'ready',
      })),
    };
  }

  cook(prompt: string, phase: string, worktree: boolean): CookedPromptInfo {
    const lower = prompt.toLowerCase();
    const isDebug = /\b(bug|fix|error|fail|crash|broken|debug)\b/.test(lower);
    const isSec = /\b(security|secret|key|auth|audit|review)\b/.test(lower);
    const skill = isDebug
      ? 'systematic-debugging'
      : isSec
        ? 'secure-review-constitution'
        : 'deep-retrieval-brief';
    const taskClass = isDebug ? 'debug_fix' : isSec ? 'security_audit' : 'engineering_build';
    const hook = isDebug ? 'pre-apply-diff-preview' : 'worktree-isolation-hook';
    const gate = isDebug ? 'test-suite-exit-0' : isSec ? 'zero-secret-leak' : 'compile-and-lint-pass';
    const command = worktree
      ? `lingonberry-core run --worktree --gate ${gate}`
      : `lingonberry-core route --phase ${phase}`;
    return {
      raw_prompt: prompt,
      cooked_prompt: `[Constitution: global-agentic-skills · ${skill}]\n[Command: ${command}]\n[Hook: ${hook} · Gate: ${gate}]\n\nObjective: ${prompt}`,
      task_class: taskClass,
      selected_skill: skill,
      selected_command: command,
      selected_hook: hook,
      retrieval_sources: ['~/.agent-skills', '~/Developer/lingonberry-router'],
      gate_policy: gate,
    };
  }

  runPrompt(
    prompt: string,
    caller: string,
    workerId?: string,
    worktree = false,
    simulateFault: 'none' | '429' | 'truncated' = 'none',
    fanoutGroup: string | null = null
  ) {
    const now = Date.now() / 1000;
    const cooked = this.cook(prompt, fanoutGroup ? 'fanout' : 'execute', worktree);
    const chosen =
      this.discovery.workers.find((w) => w.id === workerId) ??
      this.discovery.workers.find((w) => w.id === 'pi:NIM_1') ??
      this.discovery.workers[0];

    const keyName = chosen.key_name ?? null;
    const receipt: Receipt = {
      receipt_id: `rcpt-${Math.random().toString(16).slice(2, 10)}`,
      context_hash: Math.random().toString(16).slice(2, 18),
      catalog_hash: '2a1b3c4d5e6f7a8b',
      policy_hash: '9e8d7c6b5a4f3e2d',
      pool_hash: '1122334455667788',
      registry_hash: 'aabbccddeeff0011',
      phase: fanoutGroup ? 'fanout' : 'execute',
      selected: {
        worker: chosen.id,
        model: chosen.model,
        effort: 'standard',
        gate: cooked.gate_policy,
        reason: `score=1.00 · skill=${cooked.selected_skill}`,
      },
      alternatives: [],
      exclusions: [],
      abstention: null,
      created_at: new Date().toISOString(),
      caller,
      cooked,
    };
    this.receipts.unshift(receipt);

    const runId = Math.random().toString(16).slice(2, 10);
    const pid = this.nextPid++;
    if (keyName) {
      this.inflightByKey.set(keyName, (this.inflightByKey.get(keyName) ?? 0) + 1);
    }

    const steps: SessionStep[] = [
      {
        ts: now,
        stage: 'received',
        title: 'Prompt received',
        detail: `${caller} · ${prompt.slice(0, 70)}`,
        tone: 'info',
      },
      {
        ts: now + 0.15,
        stage: 'cooked',
        title: `Cooked with ${cooked.selected_skill}`,
        detail: `Hook ${cooked.selected_hook} · Gate ${cooked.gate_policy}`,
        tone: 'route',
      },
      {
        ts: now + 0.35,
        stage: 'routed',
        title: `Router selected ${chosen.id}`,
        detail: keyName ? `Leased key ${keyName}` : `Local CLI (${chosen.agent})`,
        tone: 'active',
      },
    ];

    const run: Run = {
      id: runId,
      created_at: new Date().toISOString(),
      worker: chosen.id,
      caller,
      key_name: keyName,
      model: chosen.model,
      provider: chosen.provider,
      prompt,
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
      steps,
      fanout_group: fanoutGroup,
      failover_from: null,
    };
    this.runs.unshift(run);

    if (simulateFault === '429' || simulateFault === 'truncated') {
      setTimeout(() => {
        const target = this.runs.find((r) => r.id === runId);
        if (!target || target.state !== 'running') return;
        const failedKey = target.key_name ?? 'NIM_1';
        this.inflightByKey.set(failedKey, Math.max(0, (this.inflightByKey.get(failedKey) ?? 1) - 1));
        this.coolingUntil.set(failedKey, Date.now() / 1000 + 20);
        const fbWorker = this.discovery.workers.find((w) => w.key_name && w.key_name !== failedKey) ?? chosen;
        const fbKey = fbWorker.key_name ?? 'NIM_2';
        this.inflightByKey.set(fbKey, (this.inflightByKey.get(fbKey) ?? 0) + 1);
        target.steps?.push({
          ts: Date.now() / 1000,
          stage: 'failover',
          title: `Auto-failover ${failedKey} → ${fbKey}`,
          detail:
            simulateFault === '429'
              ? 'HTTP 429 burst detected · placed primary on cooldown'
              : 'Truncated output detected · retrying on sibling key',
          tone: 'warn',
        });
        target.worker = fbWorker.id;
        target.key_name = fbKey;
        target.failover_from = failedKey;
        setTimeout(() => {
          const latest = this.runs.find((r) => r.id === runId);
          if (!latest || latest.state !== 'running') return;
          latest.state = 'done';
          latest.elapsed_ms = Math.max(100, Date.now() - Date.parse(latest.created_at));
          latest.gate_passed = true;
          latest.tokens_in = 1120;
          latest.tokens_out = 680;
          latest.output = `Recovered on ${fbWorker.id} (${fbKey}) after ${simulateFault} · gate passed.`;
          latest.steps?.push({
            ts: Date.now() / 1000,
            stage: 'gate',
            title: 'Execution completed after retry',
            detail: `Gate ${cooked.gate_policy} passed`,
            tone: 'done',
          });
          this.inflightByKey.set(fbKey, Math.max(0, (this.inflightByKey.get(fbKey) ?? 1) - 1));
          this.okByKey.set(fbKey, (this.okByKey.get(fbKey) ?? 0) + 1);
        }, 1600);
      }, 1200);
      return;
    }

    setTimeout(() => {
      const target = this.runs.find((r) => r.id === runId);
      if (!target || target.state !== 'running') return;
      target.state = 'done';
      target.elapsed_ms = Math.max(100, Date.now() - Date.parse(target.created_at));
      target.gate_passed = true;
      target.tokens_in = 840;
      target.tokens_out = 510;
      target.output = `Executed on ${chosen.id}${keyName ? ` (${keyName})` : ''} · ${cooked.selected_skill} · gate passed.`;
      target.steps?.push({
        ts: Date.now() / 1000,
        stage: 'gate',
        title: 'Execution completed',
        detail: `Result verified · ${target.tokens_in} in / ${target.tokens_out} out`,
        tone: 'done',
      });
      if (keyName) {
        this.inflightByKey.set(keyName, Math.max(0, (this.inflightByKey.get(keyName) ?? 1) - 1));
        this.okByKey.set(keyName, (this.okByKey.get(keyName) ?? 0) + 1);
      }
    }, 3200);
  }

  runFanout(prompt: string, caller: string, worktree = false) {
    const group = `fan-${Math.random().toString(16).slice(2, 8)}`;
    const branches = [
      `[Branch 1/3 · Architecture] ${prompt}`,
      `[Branch 2/3 · Tests & Gate] ${prompt}`,
      `[Branch 3/3 · Security Review] ${prompt}`,
    ];
    branches.forEach((b, i) => {
      const w = this.discovery.workers[i % this.discovery.workers.length];
      this.runPrompt(b, caller, w.id, worktree, 'none', group);
    });
  }

  killPid(pid: number) {
    const target = this.runs.find((r) => r.pid === pid && r.state === 'running');
    if (!target) return;
    target.state = 'failed';
    target.gate_passed = false;
    target.elapsed_ms = Math.max(100, Date.now() - Date.parse(target.created_at));
    target.error = `killed by user (pid ${pid})`;
    target.steps?.push({
      ts: Date.now() / 1000,
      stage: 'killed',
      title: `Process PID ${pid} terminated`,
      detail: 'SIGTERM issued via router · lease released',
      tone: 'warn',
    });
    if (target.key_name) {
      this.inflightByKey.set(
        target.key_name,
        Math.max(0, (this.inflightByKey.get(target.key_name) ?? 1) - 1)
      );
    }
  }

  killCronPid(pid: number) {
    this.cronLive = this.cronLive.filter((p) => p.pid !== pid);
  }

  resetKey(name: string) {
    this.coolingUntil.delete(name);
  }

  setRpmLimit(target: string, rpm: number) {
    const clamped = Math.max(5, Math.min(300, Math.round(rpm)));
    for (const [prov, keys] of Object.entries(this.discovery.keys)) {
      if (prov === target || keys.includes(target)) {
        this.providerRpmCaps.set(prov, clamped);
        return;
      }
    }
  }

  toggleJob(name: string) {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) return;
    job.paused = !job.paused;
    job.next_in_s = job.paused ? null : (job.every_s ?? 300);
    job.health = job.paused ? 'paused' : 'healthy';
    job.log_tail.push(job.paused ? 'paused by operator' : 'resumed by operator');
  }

  toggleWatchdog(name: string) {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) return;
    job.auto_restart = !job.auto_restart;
    job.log_tail.push(`watchdog KeepAlive ${job.auto_restart ? 'enabled' : 'disabled'}`);
  }

  healJob(name: string) {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) return;
    job.paused = false;
    job.rc = 0;
    job.crash_count = 0;
    job.restart_count += 1;
    job.last_error = null;
    job.health = 'auto_healed';
    job.next_in_s = job.every_s ?? 300;
    job.log_tail.push('watchdog healed job state & cleared crash lock');
  }

  simulateCrash(name: string) {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) return;
    job.last = Date.now() / 1000;
    job.rc = 137;
    job.crash_count += 1;
    job.last_error = 'SIGKILL OOM / unhandled timeout (simulated)';
    if (job.auto_restart) {
      job.restart_count += 1;
      job.health = 'auto_healed';
      job.log_tail.push('crash detected (rc=137) -> KeepAlive auto-restarted');
    } else {
      job.health = 'crashed';
      job.log_tail.push('crashed (rc=137): SIGKILL OOM');
    }
  }

  runJob(name: string) {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) return;
    job.last = Date.now() / 1000;
    job.rc = 0;
    job.health = 'healthy';
    job.log_tail.push(`manual run triggered for ${name}`);
    this.runPrompt(job.prompt || `Run scheduled job ${job.name}`, `cron:${job.name}`);
  }

  addJob(params: { name: string; every_s: number; schedule?: string; command?: string; prompt: string; auto_restart?: boolean }) {
    this.jobs.push({
      name: params.name,
      source: 'lingonberry',
      schedule: params.schedule || `every ${params.every_s}s`,
      command: params.command || `lingonberry-core run "${params.prompt}"`,
      every_s: params.every_s,
      last: null,
      rc: null,
      paused: false,
      next_in_s: params.every_s,
      prompt: params.prompt,
      health: 'healthy',
      running_pid: null,
      crash_count: 0,
      restart_count: 0,
      auto_restart: params.auto_restart ?? true,
      last_error: null,
      log_tail: ['Scheduled with watchdog monitoring'],
    });
  }

  applySelfConfig(paths: string[]) {
    for (const p of paths) this.applied.add(p);
  }
}

const sandbox = new StaticSandbox();
let detectedMode: 'live-api' | 'static-preview' | null = null;

// Inside the Tauri tray the page is served from the app origin, so the core must be addressed explicitly.
const inTray = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const CORE_BASE = inTray ? 'http://127.0.0.1:8799' : '';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CORE_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || !contentType.includes('application/json')) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function loadRouterState(): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    return sandbox.getState();
  }
  try {
    const [snapshot, discovery, receipts, selfConfig, capabilities] = await Promise.all([
      fetchJson<Snapshot>('/api/snapshot'),
      fetchJson<DiscoverResponse>('/api/discover'),
      fetchJson<Receipt[]>('/api/receipts'),
      fetchJson<SelfConfigPlan>('/api/self-config'),
      fetchJson<CapabilitiesInfo>('/api/capabilities'),
    ]);
    detectedMode = 'live-api';
    return { mode: 'live-api', snapshot, discovery, receipts, selfConfig, capabilities };
  } catch (err) {
    // The tray must never show sample data as if it were the machine's state.
    if (inTray) throw new Error('core offline');
    detectedMode = 'static-preview';
    return sandbox.getState();
  }
}

export async function dispatchTestRun(params: {
  prompt: string;
  caller: string;
  worker?: string;
  worktree?: boolean;
  simulate_fault?: 'none' | '429' | 'truncated';
  live_api?: boolean;
}): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.runPrompt(
      params.prompt,
      params.caller,
      params.worker,
      params.worktree,
      params.simulate_fault
    );
    return sandbox.getState();
  }
  await fetchJson('/api/run', { method: 'POST', body: JSON.stringify(params) });
  return loadRouterState();
}

export async function dispatchFanoutRun(params: {
  prompt: string;
  caller: string;
  worktree?: boolean;
}): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.runFanout(params.prompt, params.caller, params.worktree);
    return sandbox.getState();
  }
  await fetchJson('/api/fanout', { method: 'POST', body: JSON.stringify(params) });
  return loadRouterState();
}

export async function routeDryRun(params: {
  prompt: string;
  caller: string;
  phase?: string;
  worktree?: boolean;
}): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.runPrompt(params.prompt, params.caller, undefined, params.worktree);
    return sandbox.getState();
  }
  await fetchJson('/api/route', { method: 'POST', body: JSON.stringify(params) });
  return loadRouterState();
}

export async function killWorkerPid(pid: number): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.killPid(pid);
    return sandbox.getState();
  }
  await fetchJson(`/api/kill/${pid}`, { method: 'POST' });
  return loadRouterState();
}

export async function killCronPid(pid: number): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.killCronPid(pid);
    return sandbox.getState();
  }
  await fetchJson(`/api/jobs/kill/${pid}`, { method: 'POST' });
  return loadRouterState();
}

export async function resetKeyCooldown(name: string): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.resetKey(name);
    return sandbox.getState();
  }
  await fetchJson(`/api/keys/${encodeURIComponent(name)}/reset`, { method: 'POST' });
  return loadRouterState();
}

export async function setProviderRpm(target: string, rpm: number): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.setRpmLimit(target, rpm);
    return sandbox.getState();
  }
  await fetchJson(`/api/keys/${encodeURIComponent(target)}/rpm`, {
    method: 'POST',
    body: JSON.stringify({ rpm }),
  });
  return loadRouterState();
}

export async function toggleCronJob(name: string): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.toggleJob(name);
    return sandbox.getState();
  }
  await fetchJson(`/api/jobs/${encodeURIComponent(name)}/toggle`, { method: 'POST' });
  return loadRouterState();
}

export async function toggleCronWatchdog(name: string): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.toggleWatchdog(name);
    return sandbox.getState();
  }
  await fetchJson(`/api/jobs/${encodeURIComponent(name)}/watchdog`, { method: 'POST' });
  return loadRouterState();
}

export async function healCronJob(name: string): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.healJob(name);
    return sandbox.getState();
  }
  await fetchJson(`/api/jobs/${encodeURIComponent(name)}/heal`, { method: 'POST' });
  return loadRouterState();
}

export async function simulateCronCrash(name: string): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.simulateCrash(name);
    return sandbox.getState();
  }
  await fetchJson(`/api/jobs/${encodeURIComponent(name)}/simulate-crash`, { method: 'POST' });
  return loadRouterState();
}

export async function triggerCronJob(name: string): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.runJob(name);
    return sandbox.getState();
  }
  await fetchJson(`/api/jobs/${encodeURIComponent(name)}/run`, { method: 'POST' });
  return loadRouterState();
}

export async function createCronJob(params: {
  name: string;
  every_s: number;
  schedule?: string;
  command?: string;
  prompt: string;
  auto_restart?: boolean;
}): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.addJob(params);
    return sandbox.getState();
  }
  await fetchJson('/api/jobs', { method: 'POST', body: JSON.stringify(params) });
  return loadRouterState();
}

export async function rescanCronJobs(): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    return sandbox.getState();
  }
  await fetchJson('/api/jobs/rescan', { method: 'POST' });
  return loadRouterState();
}

export async function applySelfConfigTargets(targets: string[]): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.applySelfConfig(targets);
    return sandbox.getState();
  }
  await fetchJson('/api/self-config/apply', {
    method: 'POST',
    body: JSON.stringify({ targets }),
  });
  return loadRouterState();
}

export async function triggerRescan(): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    return sandbox.getState();
  }
  await fetchJson('/api/rescan', { method: 'POST' });
  return loadRouterState();
}
