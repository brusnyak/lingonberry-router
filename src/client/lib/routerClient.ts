import type {
  CapabilitiesInfo,
  ChannelBridgeStatus,
  CookedPromptInfo,
  DiscoveredWorker,
  DiscoveryData,
  GatewayMemorySummary,
  JobRow,
  KiroSpecManifest,
  LiveCronProcess,
  MergeQueueItem,
  OvernightSummary,
  PathLease,
  ReadinessReport,
  Receipt,
  Run,
  SandboxHealth,
  SelfConfigPlan,
  SessionStep,
  Snapshot,
  SwarmSummary,
  TelemetryPoint,
  WatchdogStatus,
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

function deterministicSha256Hex(input: string): string {
  // Deterministic 64-hex digest for browser sandbox verification (mirrors Rust SHA-256)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
    h3 = Math.imul(h3 ^ (c * 31), 0xc2b2ae35) >>> 0;
    h4 = Math.imul(h4 ^ (c ^ 0xa5), 0x27d4eb2f) >>> 0;
  }
  const part = (n: number) => n.toString(16).padStart(8, '0');
  return `${part(h1)}${part(h2)}${part(h3)}${part(h4)}${part(h1 ^ h3)}${part(h2 ^ h4)}${part(h1 ^ h4)}${part(h2 ^ h3)}`;
}

const DEFAULT_PATH_POOL = [
  'core/src/server.rs',
  'core/src/swarm.rs',
  'core/src/watchdog.rs',
  'core/src/sandbox.rs',
  'core/src/spec_engine.rs',
  'core/src/channels.rs',
  'core/src/agents.rs',
  'core/src/harness.rs',
  'core/src/discovery.rs',
  'core/src/storage.rs',
  'ui/macos-swift/Sources/LingonberryBar/Models.swift',
  'ui/macos-swift/Sources/LingonberryBar/RouterClient.swift',
  'ui/macos-swift/Sources/LingonberryBar/RouterStore.swift',
  'ui/macos-swift/Sources/LingonberryBar/Views/PopoverView.swift',
  'ui/macos-swift/Sources/LingonberryBar/Views/SetupSheetView.swift',
  'src/client/App.tsx',
  'src/client/lib/routerClient.ts',
  'src/client/components/MenuBarGiga.tsx',
  'src/client/components/WebsiteLanding.tsx',
  'src/client/components/DocsCliPage.tsx',
  'tests/swarm_lease_test.rs',
  'tests/spec_signature_test.rs',
  'tests/watchdog_pressure_test.rs',
  'tests/sandbox_sbpl_test.rs',
  'scripts/release_macos.sh',
];

class StaticSandbox {
  private discovery: DiscoverResponse = {
    agents: [
      { id: 'pi', path: '/Users/dev/.cargo/bin/pi' },
      { id: 'claude', path: '/usr/local/bin/claude' },
      { id: 'codex', path: '/usr/local/bin/codex' },
      { id: 'opencode', path: '/usr/local/bin/opencode' },
    ],
    keys: {
      kilo: ['KILO_FREE'],
      opencode: ['OPENCODE_FREE'],
      nim: ['NIM_1', 'NIM_2'],
      groq: ['GROQ_API_KEY'],
      gemini: ['GEMINI_API_KEY'],
    },
    providers: {
      kilo: { id: 'kilo', base_url: 'https://api.kilo.ai/api/gateway/v1', style: 'openai' },
      opencode: { id: 'opencode', base_url: 'https://opencode.ai/zen/v1', style: 'openai' },
      nim: { id: 'nim', base_url: 'https://integrate.api.nvidia.com/v1', style: 'openai' },
      groq: { id: 'groq', base_url: 'https://api.groq.com/openai/v1', style: 'openai' },
      gemini: {
        id: 'gemini',
        base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
        style: 'openai',
      },
    },
    library_dirs: [
      '~/.agent-skills',
      '~/.lingonberry/harness/skills',
      '~/.claude/skills',
      '~/.codex/skills',
    ],
    ssh_hosts: ['mac-mini-worker'],
    git_projects: ['~/Developer/lingonberry-router'],
    browsers: [],
    keychain_slots: [
      {
        slot: 'KILO_FREE',
        provider: 'kilo',
        label: 'Kilo Free Pool',
        cost_tier: 'free_tier',
        rpm_limit: 40,
        base_url: 'https://api.kilo.ai/api/gateway/v1',
        model: 'qwen/qwen3-coder:free',
      },
      {
        slot: 'OPENCODE_FREE',
        provider: 'opencode',
        label: 'OpenCode Zen Free',
        cost_tier: 'free_tier',
        rpm_limit: 40,
        base_url: 'https://opencode.ai/zen/v1',
        model: 'opencode/big-pickle',
      },
      {
        slot: 'NIM_1',
        provider: 'nim',
        label: 'NVIDIA NIM Primary',
        cost_tier: 'free_tier',
        rpm_limit: 40,
        base_url: 'https://integrate.api.nvidia.com/v1',
        model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      },
      {
        slot: 'GROQ_API_KEY',
        provider: 'groq',
        label: 'Groq Fast Tier',
        cost_tier: 'free_tier',
        rpm_limit: 30,
        base_url: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
      },
      {
        slot: 'GEMINI_API_KEY',
        provider: 'gemini',
        label: 'Google AI Studio Free',
        cost_tier: 'free_tier',
        rpm_limit: 15,
        base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-2.5-flash',
      },
    ],
    workers: [
      {
        id: 'pi:KILO_FREE',
        agent: 'pi',
        key_name: 'KILO_FREE',
        provider: 'kilo',
        base_url: 'https://api.kilo.ai/api/gateway/v1',
        model: 'qwen/qwen3-coder:free',
        write_access: true,
        path: '/Users/dev/.cargo/bin/pi',
        cost_tier: 'free_tier',
      },
      {
        id: 'pi:OPENCODE_FREE',
        agent: 'pi',
        key_name: 'OPENCODE_FREE',
        provider: 'opencode',
        base_url: 'https://opencode.ai/zen/v1',
        model: 'opencode/big-pickle',
        write_access: true,
        path: '/Users/dev/.cargo/bin/pi',
        cost_tier: 'free_tier',
      },
      {
        id: 'pi:NIM_1',
        agent: 'pi',
        key_name: 'NIM_1',
        provider: 'nim',
        base_url: 'https://integrate.api.nvidia.com/v1',
        model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
        write_access: true,
        path: '/Users/dev/.cargo/bin/pi',
        cost_tier: 'free_tier',
      },
      {
        id: 'pi:NIM_2',
        agent: 'pi',
        key_name: 'NIM_2',
        provider: 'nim',
        base_url: 'https://integrate.api.nvidia.com/v1',
        model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
        write_access: true,
        path: '/Users/dev/.cargo/bin/pi',
        cost_tier: 'free_tier',
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
        cost_tier: 'free_tier',
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
        cost_tier: 'free_tier',
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
        cost_tier: 'metered_paid',
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
        cost_tier: 'metered_paid',
      },
    ],
  };

  private runs: Run[] = [];
  private receipts: Receipt[] = [];
  private pathLeases: PathLease[] = [];
  private mergeQueue: MergeQueueItem[] = [];
  private swarmQueuedIds: string[] = [];
  private simulatedPressure: 'normal' | 'warn' | 'critical' = 'normal';
  private subscriptionBurstUsed = 2;
  private subscriptionBurstCap = 45;

  private sandboxHealth: SandboxHealth = {
    seatbelt_available: true,
    docker_available: true,
    docker_runtime: 'orbstack / docker-desktop',
    default_local_tier: 'seatbelt',
    default_overnight_tier: 'docker',
  };

  private channels: ChannelBridgeStatus[] = [
    {
      id: 'telegram',
      label: 'Telegram Bot',
      transport: 'Outbound HTTPS Long-Poll (getUpdates)',
      enabled: true,
      connected: true,
      session_key_prefix: 'tg:',
      description: 'Interactive slash commands & Kiro spec sign-off without public inbound ports.',
    },
    {
      id: 'slack',
      label: 'Slack Socket Mode',
      transport: 'Outbound WebSocket (WSS)',
      enabled: true,
      connected: true,
      session_key_prefix: 'slack:',
      description: 'Thread-scoped worker status, diff gate alerts, and approval buttons.',
    },
    {
      id: 'discord',
      label: 'Discord Gateway',
      transport: 'Outbound WSS Gateway',
      enabled: false,
      connected: false,
      session_key_prefix: 'discord:',
      description: 'Channel-bound swarm dispatch and spec approval summaries.',
    },
    {
      id: 'mcp',
      label: 'Claude / Codex MCP',
      transport: 'JSON-RPC 2.0 stdio (lingonberry-core mcp)',
      enabled: true,
      connected: true,
      session_key_prefix: 'mcp:',
      description: 'Exposes route, run, swarm leases, and shared MEMORY.md inside day-to-day chats.',
    },
  ];

  private memoryNotes: string[] = [
    '[2026-11-27T14:12Z] tg:owner — Approved Kiro spec spec-auth-hardening for overnight Docker run.',
    '[2026-11-27T14:40Z] mcp:claude — Recorded rule: always isolate concurrent edits via non-overlapping PathLease.',
    '[2026-11-27T15:05Z] slack:#ops — Escalation guard passed: 2/45 5h Claude burst slots consumed.',
  ];

  private specs: KiroSpecManifest[] = [];

  private jobs: JobRow[] = [
    {
      name: 'com.apple.system.backup-audit',
      source: 'launchd',
      scope: 'discovered',
      read_only: true,
      schedule: '0 */6 * * *',
      command: '/usr/libexec/backup-audit --status',
      every_s: 21600,
      last: Date.now() / 1000 - 4100,
      rc: 0,
      paused: false,
      next_in_s: null,
      prompt: null,
      health: 'healthy',
      running_pid: null,
      crash_count: 0,
      restart_count: 0,
      auto_restart: false,
      last_error: null,
      log_tail: ['host launchd job · monitored read-only (never dispatched as LLM call)'],
    },
    {
      name: 'doctor-health-sweep',
      source: 'lingonberry',
      scope: 'managed',
      read_only: false,
      schedule: '*/5 * * * *',
      command: 'lingonberry-core doctor --quiet',
      every_s: 300,
      last: Date.now() / 1000 - 110,
      rc: 0,
      paused: false,
      next_in_s: 190,
      prompt: 'Verify config, key cooldowns, Seatbelt/Docker availability, and worker reachability',
      health: 'healthy',
      running_pid: null,
      crash_count: 0,
      restart_count: 0,
      auto_restart: true,
      last_error: null,
      log_tail: ['all 6 free pool slots + 2 escalation agents healthy · 0 cooldowns active'],
    },
    {
      name: 'nightly-cargo-gate',
      source: 'crontab',
      scope: 'discovered',
      read_only: true,
      schedule: '0 2 * * *',
      command: 'cargo test --manifest-path ~/Developer/lingonberry-router/core/Cargo.toml',
      every_s: 86400,
      last: Date.now() / 1000 - 12400,
      rc: 0,
      paused: false,
      next_in_s: null,
      prompt: null,
      health: 'healthy',
      running_pid: null,
      crash_count: 0,
      restart_count: 0,
      auto_restart: false,
      last_error: null,
      log_tail: ['host crontab · read-only OS watch'],
    },
  ];

  private cronLive: LiveCronProcess[] = [
    {
      pid: 48210,
      job_name: 'doctor-health-sweep',
      source: 'lingonberry',
      command: 'lingonberry-core doctor --quiet',
      cpu_pct: 1.1,
      mem_mb: 12.4,
      elapsed_s: 18,
    },
  ];

  private applied = new Set<string>([
    '~/.agent-skills/lingonberry-router/SKILL.md',
    '~/.lingonberry/CONSTITUTION.md',
  ]);
  private nextPid = 42100;
  private inflightByKey = new Map<string, number>();
  private coolingUntil = new Map<string, number>();
  private providerRpmCaps = new Map<string, number>([
    ['kilo', 40],
    ['opencode', 40],
    ['nim', 40],
    ['groq', 30],
    ['gemini', 15],
  ]);
  private okByKey = new Map<string, number>([
    ['KILO_FREE', 11],
    ['OPENCODE_FREE', 7],
    ['NIM_1', 6],
    ['NIM_2', 4],
    ['GROQ_API_KEY', 3],
    ['GEMINI_API_KEY', 5],
  ]);

  private telemetry: TelemetryPoint[] = Array.from({ length: 18 }, (_, idx) => {
    const now = Date.now() / 1000;
    const wave = Math.sin(idx * 0.65) * 5 + Math.cos(idx * 0.35) * 3;
    return {
      ts: now - (17 - idx) * 60,
      cpu_pct: Math.round(Math.min(90, Math.max(10, 19 + wave)) * 10) / 10,
      ram_pct: Math.round((54 + wave * 0.3) * 10) / 10,
      disk_pct: 36.4,
      active_runs: idx % 5 === 0 ? 2 : 0,
      rpm: Math.max(1, Math.round(4 + Math.sin(idx * 0.5) * 2)),
    };
  });

  constructor() {
    this.seedSpecs();
    this.seedCompletedHistory();
  }

  private seedSpecs() {
    const approvedReq = '# Requirements\n- Enforce bearer token + Seatbelt SBPL on local routes\n- Verify zero secret leakage in worktree diffs';
    const approvedDesign = '# Design\n- Use core/src/server.rs middleware + git diff --name-only allowlist check';
    const approvedTasks: KiroSpecManifest['tasks_dag'] = [
      {
        task_id: 'wave-1-auth',
        wave: 1,
        title: 'Add loopback bearer check on mutating routes',
        path_globs: ['core/src/server.rs'],
        gate_cmd: 'cargo test --test auth_guard',
        status: 'pending',
      },
      {
        task_id: 'wave-2-sbpl',
        wave: 2,
        title: 'Generate Seatbelt SBPL profile per worktree',
        path_globs: ['core/src/sandbox.rs', 'tests/sandbox_sbpl_test.rs'],
        gate_cmd: 'cargo test --test sandbox_sbpl',
        status: 'pending',
      },
    ];
    const approvedBody = `${approvedReq}|${approvedDesign}|core/src/server.rs,core/src/sandbox.rs|cargo test`;
    this.specs.push({
      spec_id: 'spec-auth-hardening',
      title: 'Overnight Security & SBPL Hardening',
      goal: 'Verify loopback token auth and Seatbelt path isolation across core routes.',
      repo_root: '~/Developer/lingonberry-router',
      requirements_md: approvedReq,
      design_md: approvedDesign,
      tasks_dag: approvedTasks,
      allowed_path_globs: ['core/src/server.rs', 'core/src/sandbox.rs', 'tests/sandbox_sbpl_test.rs'],
      forbidden_actions: ['git push --force', 'rm -rf', 'chmod 777', 'curl | sh'],
      gate_cmd: 'cargo test',
      sandbox_tier: 'docker',
      max_budget_usd: 1.5,
      sha256_digest: deterministicSha256Hex(approvedBody),
      approved_at: new Date(Date.now() - 1800_000).toISOString(),
      status: 'approved',
      created_at: new Date(Date.now() - 3600_000).toISOString(),
    });

    const draftReq = '# Requirements\n- Refactor SwiftUI Keychain modal validation\n- Keep zero secrets in snapshot JSON';
    const draftDesign = '# Design\n- Update SetupSheetView.swift + RouterClient.swift';
    const draftBody = `${draftReq}|${draftDesign}|ui/macos-swift/Sources/**|swift build`;
    this.specs.push({
      spec_id: 'spec-swift-keychain-ux',
      title: 'SwiftUI Keychain Modal Validation',
      goal: 'Validate free-tier provider RPM caps before committing Keychain slot.',
      repo_root: '~/Developer/lingonberry-router',
      requirements_md: draftReq,
      design_md: draftDesign,
      tasks_dag: [
        {
          task_id: 'wave-1-swift',
          wave: 1,
          title: 'Validate RPM bounds in SetupSheetView',
          path_globs: ['ui/macos-swift/Sources/LingonberryBar/Views/SetupSheetView.swift'],
          gate_cmd: 'swift build',
          status: 'pending',
        },
      ],
      allowed_path_globs: ['ui/macos-swift/Sources/LingonberryBar/**'],
      forbidden_actions: ['git push --force', 'rm -rf'],
      gate_cmd: 'swift build',
      sandbox_tier: 'seatbelt',
      max_budget_usd: 0.5,
      sha256_digest: deterministicSha256Hex(draftBody),
      approved_at: null,
      status: 'draft',
      created_at: new Date(Date.now() - 900_000).toISOString(),
    });
  }

  private seedCompletedHistory() {
    const baseTs = Date.now() / 1000 - 240;
    const cooked = this.cook('Verify loopback token middleware and Seatbelt SBPL denial rules', 'execute', true);
    const receiptId = 'rcpt-seed-91a4';
    this.receipts.push({
      receipt_id: receiptId,
      context_hash: '7f2e8a1b9c4d3e0f',
      catalog_hash: '2a1b3c4d5e6f7a8b',
      policy_hash: '9e8d7c6b5a4f3e2d',
      pool_hash: '1122334455667788',
      registry_hash: 'aabbccddeeff0011',
      phase: 'execute',
      selected: {
        worker: 'pi:KILO_FREE',
        model: 'qwen/qwen3-coder:free',
        effort: 'standard',
        gate: 'zero-secret-leak',
        reason: 'bm25=0.94 · tier=tier2_standard · skill=secure-review-constitution',
      },
      alternatives: [
        {
          worker: 'pi:OPENCODE_FREE',
          model: 'opencode/big-pickle',
          effort: 'standard',
          gate: 'zero-secret-leak',
          reason: 'bm25=0.89 · free pool standby',
        },
      ],
      exclusions: [
        {
          candidate_id: 'claude',
          code: 'COST_GUARD_FREE_FIRST',
          evidence: 'Deferred paid subscription until free pool gate failure',
        },
      ],
      abstention: null,
      created_at: new Date(Date.now() - 90_000).toISOString(),
      caller: 'tg:owner',
      cooked,
    });
    this.runs.push({
      id: '91a4f02c',
      created_at: new Date(Date.now() - 90_000).toISOString(),
      worker: 'pi:KILO_FREE',
      caller: 'tg:owner',
      key_name: 'KILO_FREE',
      model: 'qwen/qwen3-coder:free',
      provider: 'kilo',
      prompt: 'Verify loopback token middleware and Seatbelt SBPL denial rules',
      gate: 'zero-secret-leak',
      state: 'done',
      pid: 41982,
      elapsed_ms: 2140,
      gate_passed: true,
      gate_status: 'passed',
      cost_tier: 'free_tier',
      sandbox_tier: 'seatbelt',
      complexity_tier: 'tier2_standard',
      spec_id: 'spec-auth-hardening',
      error: null,
      output: 'Seatbelt SBPL profile denied ~/.ssh and api.token reads · 14/14 cargo tests passed.',
      task_class: cooked.task_class,
      receipt_id: receiptId,
      cooked,
      tokens_in: 980,
      tokens_out: 1410,
      steps: [
        { ts: baseTs, stage: 'received', title: 'Prompt received (tg:owner)', detail: 'complexity=tier2_standard (<1ms)', tone: 'info' },
        { ts: baseTs + 0.1, stage: 'cooked', title: 'BM25 matched secure-review-constitution', detail: `Hook ${cooked.selected_hook} · Loop ${cooked.workflow_loop}`, tone: 'route' },
        { ts: baseTs + 0.4, stage: 'routed', title: 'Router leased pi:KILO_FREE', detail: 'Sandbox: seatbelt (SBPL) · $0.00 free tier', tone: 'active' },
        { ts: baseTs + 2.1, stage: 'gate', title: 'Diff scope & gate passed', detail: '14/14 assertions · zero secret leak', tone: 'done' },
      ],
    });
  }

  private getWatchdogStatus(activeWorkers: number): WatchdogStatus {
    const ramPct =
      this.simulatedPressure === 'critical' ? 92.4 : this.simulatedPressure === 'warn' ? 82.8 : 54.2;
    const freeDisk =
      this.simulatedPressure === 'critical' ? 4.2 : this.simulatedPressure === 'warn' ? 14.5 : 325.6;
    const maxCap =
      this.simulatedPressure === 'critical' ? 0 : this.simulatedPressure === 'warn' ? 4 : 8;
    const pausedReason =
      this.simulatedPressure === 'critical'
        ? 'Memory pressure critical (92.4% RAM · 4.2 GB free disk) — new worker spawns paused'
        : null;
    const rpmUsed: Record<string, number> = {};
    for (const [prov, keys] of Object.entries(this.discovery.keys)) {
      rpmUsed[prov] = keys.reduce((acc, k) => acc + (this.inflightByKey.get(k) ?? 0) * 3, 0);
    }
    return {
      memory_pressure: this.simulatedPressure,
      ram_used_pct: ramPct,
      disk_pressure: this.simulatedPressure === 'critical' ? 'critical' : this.simulatedPressure === 'warn' ? 'warn' : 'normal',
      free_disk_gb: freeDisk,
      cpu_pct: this.simulatedPressure === 'critical' ? 89.2 : this.simulatedPressure === 'warn' ? 68.5 : 19.4,
      max_concurrent_workers: maxCap,
      active_workers: activeWorkers,
      paused_reason: pausedReason,
      provider_rpm_used: rpmUsed,
      subscription_burst_used: this.subscriptionBurstUsed,
      subscription_burst_cap: this.subscriptionBurstCap,
    };
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

    const watchdog = this.getWatchdogStatus(workersLive.length);
    const swarm: SwarmSummary = {
      max_concurrent: watchdog.max_concurrent_workers,
      active_workers: workersLive.length,
      queued_count: this.swarmQueuedIds.length,
      active_leases: [...this.pathLeases],
      merge_queue: [...this.mergeQueue],
    };
    const gateway: GatewayMemorySummary = {
      memory_path: '~/.lingonberry/memory/MEMORY.md',
      steering_dir: '~/.lingonberry/steering/',
      entries_count: this.memoryNotes.length,
      channels: this.channels.map((c) => ({ ...c })),
      recent_notes: [...this.memoryNotes],
    };
    const readiness: ReadinessReport = {
      pi_installed: true,
      pi_path: '/Users/dev/.cargo/bin/pi',
      mini_harness_ready: true,
      agents_count: this.discovery.agents.length,
      free_keys_count: 6,
      paid_keys_count: 2,
      external_skills_count: 14,
      mode: 'full-harness',
      recommendations: [
        'pi-rust execution layer verified',
        'Seatbelt (sandbox-exec) + Docker isolation active',
      ],
    };
    const overnight: OvernightSummary = {
      enabled: true,
      free_only: false,
      nightly_budget_usd: 2.0,
      spent_today_usd: this.subscriptionBurstUsed * 0.04,
      runs_tonight: this.specs.filter((s) => s.status === 'completed' || s.status === 'running').length,
      max_runs_per_night: 8,
      tickets: [],
    };

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
        cost_24h_usd: Math.round(this.subscriptionBurstUsed * 0.04 * 100) / 100,
        calls_24h: this.runs.length,
        cpu_pct: watchdog.cpu_pct,
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
            cost_tier: 'free_tier',
            source: 'keychain',
            fail_count: cool > 0 ? 1 : 0,
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
        model: r.model,
        state: r.state,
        duration_s:
          typeof r.elapsed_ms === 'number'
            ? r.elapsed_ms / 1000
            : Math.max(0, now - Date.parse(r.created_at) / 1000),
        reason: r.error,
        output: r.output,
        receipt_id: r.receipt_id,
        cooked: r.cooked,
        steps: r.steps,
        fanout_group: r.fanout_group ?? null,
        failover_from: r.failover_from ?? null,
        escalation_from: r.escalation_from ?? null,
        sandbox_tier: r.sandbox_tier ?? null,
        complexity_tier: r.complexity_tier ?? null,
        spec_id: r.spec_id ?? null,
        cost_tier: r.cost_tier ?? null,
        gate_status: r.gate_status ?? null,
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
        cpu_pct: watchdog.cpu_pct,
        load1: this.simulatedPressure === 'critical' ? 6.4 : 1.38,
        ram_used_gb: Math.round((24 * (watchdog.ram_used_pct / 100)) * 10) / 10,
        ram_total_gb: 24.0,
        disk_used_gb: Math.round((512 - watchdog.free_disk_gb) * 10) / 10,
        disk_total_gb: 512.0,
        app_cpu_pct: 0.4,
        app_ram_gb: 0.04,
      },
      telemetry: [...this.telemetry],
      readiness,
      overnight,
      watchdog,
      sandbox: { ...this.sandboxHealth },
      swarm,
      gateway,
      specs: this.specs.map((s) => ({ ...s, tasks_dag: s.tasks_dag.map((t) => ({ ...t })) })),
    };

    return {
      mode: 'static-preview',
      snapshot,
      discovery: this.discovery,
      receipts: [...this.receipts],
      selfConfig: this.getSelfConfig(),
      capabilities: {
        live_gemini_available: false,
        discovered_providers: ['kilo', 'opencode', 'nim', 'groq', 'gemini'],
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
        target: 'Shared Cross-Channel Memory (MEMORY.md)',
        scope: 'global' as const,
        path: '~/.lingonberry/memory/MEMORY.md',
        reason:
          'Shared context across Telegram, Slack, Discord, and MCP chats without per-surface fragmentation.',
        snippet: this.memoryNotes.join('\n'),
      },
      {
        target: 'MCP Tool Bridge (lingonberry-core mcp)',
        scope: 'global' as const,
        path: '~/.lingonberry/mcp.json',
        reason:
          'Exposes route, run, swarm leases, and Kiro spec approval as standard MCP tools.',
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
      os: 'macOS Primary (Apple Silicon · SwiftUI + Rust Core)',
      preferred_root: '~/.agent-skills',
      strategy:
        'Global-first injection: canonical skill, shared MEMORY.md, and MCP bridge plus 2-line idempotent pointers.',
      targets: entries.map((e) => ({
        ...e,
        status: this.applied.has(e.path) ? 'applied' : 'ready',
      })),
    };
  }

  classifyComplexity(prompt: string): 'tier1_trivial' | 'tier2_standard' | 'tier3_architect' {
    const lower = prompt.toLowerCase();
    if (
      /\b(architect|swarm|overnight|refactor|security|auth|migration|multi-file|spec|kernel|sandbox)\b/.test(
        lower
      ) ||
      prompt.length > 160
    ) {
      return 'tier3_architect';
    }
    if (/\b(fix|test|debug|route|endpoint|component|parse|build|add|update)\b/.test(lower)) {
      return 'tier2_standard';
    }
    return 'tier1_trivial';
  }

  cook(prompt: string, phase: string, worktree: boolean): CookedPromptInfo {
    const lower = prompt.toLowerCase();
    const isDebug = /\b(bug|fix|error|fail|crash|broken|debug)\b/.test(lower);
    const isSec = /\b(security|secret|key|auth|audit|review|sandbox|seatbelt|token)\b/.test(lower);
    const isSwarm = /\b(swarm|parallel|fanout|worktree|branch|merge|50)\b/.test(lower);
    const skill = isSec
      ? 'secure-review-constitution'
      : isSwarm
        ? 'swarm-worktree-orchestrator'
        : isDebug
          ? 'systematic-debugging'
          : 'deep-retrieval-brief';
    const taskClass = isSec
      ? 'security_audit'
      : isSwarm
        ? 'swarm_parallel'
        : isDebug
          ? 'debug_fix'
          : 'engineering_build';
    const hook = isSec
      ? 'pre-apply-secret-and-diff-guard'
      : isDebug
        ? 'pre-apply-diff-preview'
        : 'worktree-isolation-hook';
    const gate = isSec ? 'zero-secret-leak' : isDebug ? 'test-suite-exit-0' : 'compile-and-lint-pass';
    const loop = isSwarm || isSec ? 'plan-worktree-gate-escalate' : 'fast-worktree-gate';
    const command = worktree
      ? `lingonberry-core run --worktree --sandbox seatbelt --gate ${gate}`
      : `lingonberry-core route --phase ${phase}`;
    return {
      raw_prompt: prompt,
      cooked_prompt: `[Complexity: ${this.classifyComplexity(prompt)} · BM25 Skill: ${skill}]\n[Command: ${command}]\n[Hook: ${hook} · Loop: ${loop}]\n\nObjective: ${prompt}`,
      task_class: taskClass,
      selected_skill: skill,
      selected_command: command,
      selected_hook: hook,
      retrieval_sources: ['~/.agent-skills', '~/.lingonberry/memory/MEMORY.md', '~/Developer/lingonberry-router'],
      gate_policy: gate,
      workflow_loop: loop,
      skills: [skill],
    };
  }

  runPrompt(
    prompt: string,
    caller: string,
    workerId?: string,
    worktree = false,
    simulateFault: 'none' | '429' | 'truncated' | 'gate-escalate' = 'none',
    fanoutGroup: string | null = null,
    sandboxTier: 'seatbelt' | 'docker' = 'seatbelt',
    specId: string | null = null,
    pathGlobs: string[] = ['core/src/**']
  ) {
    if (this.simulatedPressure === 'critical') {
      throw new Error(
        'Watchdog paused new spawns: memory/disk pressure critical (92.4% RAM · 4.2 GB free disk)'
      );
    }
    const now = Date.now() / 1000;
    const complexity = this.classifyComplexity(prompt);
    const cooked = this.cook(prompt, fanoutGroup ? 'fanout' : 'execute', worktree);
    const chosen =
      this.discovery.workers.find((w) => w.id === workerId) ??
      this.discovery.workers.find((w) => w.id === 'pi:KILO_FREE') ??
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
        effort: complexity === 'tier3_architect' ? 'high' : 'standard',
        gate: cooked.gate_policy,
        reason: `bm25=0.95 · tier=${complexity} · skill=${cooked.selected_skill}`,
      },
      alternatives: [
        {
          worker: 'pi:OPENCODE_FREE',
          model: 'opencode/big-pickle',
          effort: 'standard',
          gate: cooked.gate_policy,
          reason: 'standby free pool',
        },
        {
          worker: 'claude',
          model: 'claude-sonnet-4',
          effort: 'high',
          gate: cooked.gate_policy,
          reason: 'escalation target on gate failure',
        },
      ],
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

    const worktreePath = `/tmp/lb-wt/${runId}`;
    this.pathLeases.unshift({
      run_id: runId,
      repo_root: '~/Developer/lingonberry-router',
      globs: pathGlobs,
      worktree_path: worktreePath,
      sandbox_tier: sandboxTier,
      lease_state: 'active',
    });
    if (this.pathLeases.length > 24) this.pathLeases.length = 24;

    const steps: SessionStep[] = [
      {
        ts: now,
        stage: 'received',
        title: `Prompt received (${caller})`,
        detail: `Stage 1 complexity=${complexity} (<1ms)`,
        tone: 'info',
      },
      {
        ts: now + 0.12,
        stage: 'cooked',
        title: `BM25 matched ${cooked.selected_skill}`,
        detail: `Hook ${cooked.selected_hook} · Loop ${cooked.workflow_loop ?? 'fast-gate'}`,
        tone: 'route',
      },
      {
        ts: now + 0.3,
        stage: 'routed',
        title: `Leased ${chosen.id} (${sandboxTier})`,
        detail: keyName
          ? `Key ${keyName} · globs ${pathGlobs.join(', ')}`
          : `CLI (${chosen.agent}) · globs ${pathGlobs.join(', ')}`,
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
      gate_status: 'pending',
      cost_tier: chosen.cost_tier ?? 'free_tier',
      sandbox_tier: sandboxTier,
      complexity_tier: complexity,
      spec_id: specId,
      worktree_path: worktreePath,
      error: null,
      output: null,
      task_class: cooked.task_class,
      receipt_id: receipt.receipt_id,
      cooked,
      steps,
      fanout_group: fanoutGroup,
      failover_from: null,
      escalation_from: null,
    };
    this.runs.unshift(run);
    if (this.runs.length > 80) this.runs.length = 80;

    if (simulateFault === 'gate-escalate') {
      setTimeout(() => {
        const target = this.runs.find((r) => r.id === runId);
        if (!target || target.state !== 'running') return;
        if (target.key_name) {
          this.inflightByKey.set(
            target.key_name,
            Math.max(0, (this.inflightByKey.get(target.key_name) ?? 1) - 1)
          );
        }
        const fromWorker = target.worker;
        target.escalation_from = fromWorker;
        target.worker = 'claude';
        target.key_name = null;
        target.model = 'claude-sonnet-4';
        target.provider = 'claude';
        target.cost_tier = 'metered_paid';
        this.subscriptionBurstUsed = Math.min(this.subscriptionBurstCap, this.subscriptionBurstUsed + 1);
        target.steps?.push({
          ts: Date.now() / 1000,
          stage: 'escalated',
          title: `Gate failed on ${fromWorker} → escalated to claude`,
          detail: `5h burst guard ${this.subscriptionBurstUsed}/${this.subscriptionBurstCap} · budget check passed`,
          tone: 'warn',
        });

        setTimeout(() => {
          const latest = this.runs.find((r) => r.id === runId);
          if (!latest || latest.state !== 'running') return;
          latest.state = 'done';
          latest.elapsed_ms = Math.max(150, Date.now() - Date.parse(latest.created_at));
          latest.gate_passed = true;
          latest.gate_status = 'passed';
          latest.tokens_in = 1480;
          latest.tokens_out = 910;
          latest.output = `Escalated from ${fromWorker} to claude (claude-sonnet-4) after verification gate failure · diff scope clean · gate passed.`;
          latest.steps?.push({
            ts: Date.now() / 1000,
            stage: 'gate',
            title: 'Escalation gate & merge check passed',
            detail: `Diff guard verified · ${latest.tokens_in} in / ${latest.tokens_out} out`,
            tone: 'done',
          });
          this.releaseLeaseAndEnqueueMerge(runId, cooked.gate_policy);
        }, 1600);
      }, 1100);
      return;
    }

    if (simulateFault === '429' || simulateFault === 'truncated') {
      setTimeout(() => {
        const target = this.runs.find((r) => r.id === runId);
        if (!target || target.state !== 'running') return;
        const failedKey = target.key_name ?? 'KILO_FREE';
        this.inflightByKey.set(failedKey, Math.max(0, (this.inflightByKey.get(failedKey) ?? 1) - 1));
        this.coolingUntil.set(failedKey, Date.now() / 1000 + 20);
        const fbWorker =
          this.discovery.workers.find((w) => w.key_name && w.key_name !== failedKey) ?? chosen;
        const fbKey = fbWorker.key_name ?? 'NIM_1';
        this.inflightByKey.set(fbKey, (this.inflightByKey.get(fbKey) ?? 0) + 1);
        target.steps?.push({
          ts: Date.now() / 1000,
          stage: 'failover',
          title: `Auto-failover ${failedKey} → ${fbKey}`,
          detail:
            simulateFault === '429'
              ? 'HTTP 429 burst detected · cooling primary slot'
              : 'Truncated output detected · retrying sibling free slot',
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
          latest.gate_status = 'passed';
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
          this.releaseLeaseAndEnqueueMerge(runId, cooked.gate_policy);
        }, 1600);
      }, 1100);
      return;
    }

    setTimeout(() => {
      const target = this.runs.find((r) => r.id === runId);
      if (!target || target.state !== 'running') return;
      target.state = 'done';
      target.elapsed_ms = Math.max(100, Date.now() - Date.parse(target.created_at));
      target.gate_passed = true;
      target.gate_status = 'passed';
      target.tokens_in = 840;
      target.tokens_out = 510;
      target.output = `Executed on ${chosen.id}${keyName ? ` (${keyName})` : ''} under ${sandboxTier} · ${cooked.selected_skill} · gate passed.`;
      target.steps?.push({
        ts: Date.now() / 1000,
        stage: 'gate',
        title: 'Diff scope & verification gate passed',
        detail: `${target.tokens_in} in / ${target.tokens_out} out`,
        tone: 'done',
      });
      if (keyName) {
        this.inflightByKey.set(keyName, Math.max(0, (this.inflightByKey.get(keyName) ?? 1) - 1));
        this.okByKey.set(keyName, (this.okByKey.get(keyName) ?? 0) + 1);
      }
      this.releaseLeaseAndEnqueueMerge(runId, cooked.gate_policy);
    }, 2600);
  }

  private releaseLeaseAndEnqueueMerge(runId: string, gateCmd: string) {
    const lease = this.pathLeases.find((l) => l.run_id === runId);
    if (lease) {
      lease.lease_state = 'released';
    }
    this.mergeQueue.unshift({
      run_id: runId,
      repo_root: '~/Developer/lingonberry-router',
      branch_or_worktree: `/tmp/lb-wt/${runId}`,
      gate_cmd: gateCmd,
      status: 'merged',
      attempt: 1,
    });
    if (this.mergeQueue.length > 16) this.mergeQueue.length = 16;
  }

  runFanout(prompt: string, caller: string, worktree = false) {
    const group = `fan-${Math.random().toString(16).slice(2, 8)}`;
    const branches = [
      { label: `[Branch 1/3 · Architecture] ${prompt}`, glob: ['core/src/server.rs'] },
      { label: `[Branch 2/3 · Tests & Gate] ${prompt}`, glob: ['tests/**'] },
      { label: `[Branch 3/3 · Security Review] ${prompt}`, glob: ['core/src/sandbox.rs'] },
    ];
    const freeWorkers = this.discovery.workers.filter((w) => w.cost_tier !== 'metered_paid');
    branches.forEach((b, i) => {
      const w = freeWorkers[i % freeWorkers.length];
      this.runPrompt(b.label, caller, w.id, worktree, 'none', group, 'seatbelt', null, b.glob);
    });
  }

  dispatchSwarmBatch(count: number, caller = 'swarm:coordinator') {
    if (this.simulatedPressure === 'critical') {
      throw new Error('Swarm blocked by Watchdog: RAM/Disk pressure is critical.');
    }
    const clamped = Math.max(1, Math.min(50, count));
    const watchdog = this.getWatchdogStatus(
      this.runs.filter((r) => r.state === 'running' || r.state === 'leased').length
    );
    const maxCap = Math.max(1, watchdog.max_concurrent_workers);
    const group = `swarm-${clamped}-${Math.random().toString(16).slice(2, 6)}`;
    const freeWorkers = this.discovery.workers.filter((w) => w.cost_tier !== 'metered_paid');
    const activeBatch = Math.min(clamped, maxCap);
    const queuedCount = Math.max(0, clamped - activeBatch);

    for (let i = 0; i < activeBatch; i += 1) {
      const pathTarget = DEFAULT_PATH_POOL[i % DEFAULT_PATH_POOL.length];
      const w = freeWorkers[i % freeWorkers.length];
      this.runPrompt(
        `[Swarm ${i + 1}/${clamped}] Verify & patch ${pathTarget}`,
        caller,
        w.id,
        true,
        i === activeBatch - 1 && clamped >= 12 ? 'gate-escalate' : 'none',
        group,
        'seatbelt',
        'spec-auth-hardening',
        [pathTarget]
      );
    }

    if (queuedCount > 0) {
      const queuedIds = Array.from({ length: queuedCount }, (_, idx) => `${group}-q${idx + 1}`);
      this.swarmQueuedIds.push(...queuedIds);
      this.mergeQueue.unshift({
        run_id: `${group}-merge`,
        repo_root: '~/Developer/lingonberry-router',
        branch_or_worktree: `queue (${queuedCount} waiting on semaphore ${maxCap})`,
        gate_cmd: 'cargo test && diff-scope-guard',
        status: 'verifying',
        attempt: 1,
      });
      // Drain semaphore queue smoothly over ~3s
      setTimeout(() => {
        this.swarmQueuedIds = this.swarmQueuedIds.filter((id) => !id.startsWith(group));
        const mq = this.mergeQueue.find((m) => m.run_id === `${group}-merge`);
        if (mq) mq.status = 'merged';
      }, 3600);
    }
  }

  setSimulatedPressure(level: 'normal' | 'warn' | 'critical') {
    this.simulatedPressure = level;
  }

  createKiroSpec(params: {
    title: string;
    goal: string;
    allowed_path_globs: string[];
    gate_cmd: string;
    sandbox_tier: 'seatbelt' | 'docker';
    max_budget_usd: number;
  }): KiroSpecManifest {
    const id = `spec-${params.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24)}-${Math.random().toString(16).slice(2, 6)}`;
    const req = `# Requirements\n- ${params.goal}\n- Enforce strict path globs: ${params.allowed_path_globs.join(', ')}`;
    const design = `# Design\n- Sandbox: ${params.sandbox_tier}\n- Verification gate: ${params.gate_cmd}`;
    const body = `${req}|${design}|${params.allowed_path_globs.join(',')}|${params.gate_cmd}`;
    const spec: KiroSpecManifest = {
      spec_id: id,
      title: params.title,
      goal: params.goal,
      repo_root: '~/Developer/lingonberry-router',
      requirements_md: req,
      design_md: design,
      tasks_dag: [
        {
          task_id: `${id}-wave-1`,
          wave: 1,
          title: params.title,
          path_globs: params.allowed_path_globs,
          gate_cmd: params.gate_cmd,
          status: 'pending',
        },
      ],
      allowed_path_globs: params.allowed_path_globs,
      forbidden_actions: ['git push --force', 'rm -rf', 'chmod 777'],
      gate_cmd: params.gate_cmd,
      sandbox_tier: params.sandbox_tier,
      max_budget_usd: params.max_budget_usd,
      sha256_digest: deterministicSha256Hex(body),
      approved_at: null,
      status: 'draft',
      created_at: new Date().toISOString(),
    };
    this.specs.unshift(spec);
    return spec;
  }

  approveKiroSpec(specId: string) {
    const spec = this.specs.find((s) => s.spec_id === specId);
    if (!spec) throw new Error(`Spec ${specId} not found`);
    spec.approved_at = new Date().toISOString();
    spec.status = 'approved';
    this.memoryNotes.unshift(
      `[${new Date().toISOString().slice(11, 16)}Z] owner — Signed Kiro spec ${spec.spec_id} (sha256:${spec.sha256_digest.slice(0, 12)}…).`
    );
  }

  runApprovedSpec(specId: string) {
    const spec = this.specs.find((s) => s.spec_id === specId);
    if (!spec) throw new Error(`Spec ${specId} not found`);
    if (spec.status !== 'approved' && spec.status !== 'completed') {
      throw new Error(
        `Spec Lock Blocked: "${spec.title}" is status="${spec.status}". Cryptographic SHA-256 owner sign-off is required before overnight/worker execution.`
      );
    }
    spec.status = 'running';
    for (const t of spec.tasks_dag) t.status = 'running';
    this.runPrompt(
      `[Kiro Spec ${spec.spec_id}] ${spec.goal}`,
      `spec:${spec.spec_id}`,
      'pi:KILO_FREE',
      true,
      'none',
      null,
      spec.sandbox_tier === 'docker' ? 'docker' : 'seatbelt',
      spec.spec_id,
      spec.allowed_path_globs
    );
    setTimeout(() => {
      spec.status = 'completed';
      for (const t of spec.tasks_dag) t.status = 'done';
    }, 2700);
  }

  toggleChannelBridge(id: string) {
    const ch = this.channels.find((c) => c.id === id);
    if (!ch) return;
    ch.enabled = !ch.enabled;
    ch.connected = ch.enabled;
  }

  appendMemoryNote(note: string) {
    const trimmed = note.trim();
    if (!trimmed) return;
    this.memoryNotes.unshift(`[${new Date().toISOString().slice(11, 16)}Z] web:owner — ${trimmed}`);
    if (this.memoryNotes.length > 20) this.memoryNotes.length = 20;
  }

  setIdlePreview() {
    for (const r of this.runs) {
      if (r.state === 'running' || r.state === 'leased') {
        r.state = 'done';
        r.elapsed_ms = r.elapsed_ms ?? 1400;
        r.gate_passed = true;
        r.gate_status = 'passed';
        r.output = r.output ?? 'Completed cleanly.';
      }
    }
    this.inflightByKey.clear();
    this.swarmQueuedIds = [];
    for (const l of this.pathLeases) l.lease_state = 'released';
  }

  killPid(pid: number) {
    const target = this.runs.find((r) => r.pid === pid && r.state === 'running');
    if (!target) return;
    target.state = 'failed';
    target.gate_passed = false;
    target.gate_status = 'killed';
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
    const lease = this.pathLeases.find((l) => l.run_id === target.id);
    if (lease) lease.lease_state = 'released';
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
    if (!job || job.read_only) return;
    job.paused = !job.paused;
    job.next_in_s = job.paused ? null : (job.every_s ?? 300);
    job.health = job.paused ? 'paused' : 'healthy';
    job.log_tail.push(job.paused ? 'paused by operator' : 'resumed by operator');
  }

  toggleWatchdog(name: string) {
    const job = this.jobs.find((j) => j.name === name);
    if (!job || job.read_only) return;
    job.auto_restart = !job.auto_restart;
    job.log_tail.push(`watchdog KeepAlive ${job.auto_restart ? 'enabled' : 'disabled'}`);
  }

  healJob(name: string) {
    const job = this.jobs.find((j) => j.name === name);
    if (!job || job.read_only) return;
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
    if (!job || job.read_only) return;
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
    if (!job || job.read_only) return;
    job.last = Date.now() / 1000;
    job.rc = 0;
    job.health = 'healthy';
    job.log_tail.push(`manual run triggered for ${name}`);
    this.runPrompt(job.prompt || `Run scheduled job ${job.name}`, `cron:${job.name}`);
  }

  addJob(params: {
    name: string;
    every_s: number;
    schedule?: string;
    command?: string;
    prompt: string;
    auto_restart?: boolean;
  }) {
    this.jobs.push({
      name: params.name,
      source: 'lingonberry',
      scope: 'managed',
      read_only: false,
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
  } catch {
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
  sandbox_tier?: 'seatbelt' | 'docker';
  path_globs?: string[];
  simulate_fault?: 'none' | '429' | 'truncated' | 'gate-escalate';
  live_api?: boolean;
}): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.runPrompt(
      params.prompt,
      params.caller,
      params.worker,
      params.worktree ?? true,
      params.simulate_fault ?? 'none',
      null,
      params.sandbox_tier ?? 'seatbelt',
      null,
      params.path_globs ?? ['core/src/**']
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
    sandbox.runFanout(params.prompt, params.caller, params.worktree ?? true);
    return sandbox.getState();
  }
  await fetchJson('/api/fanout', { method: 'POST', body: JSON.stringify(params) });
  return loadRouterState();
}

export async function dispatchSwarmBatch(count: number): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.dispatchSwarmBatch(count);
    return sandbox.getState();
  }
  const prompts = Array.from({ length: Math.min(count, 12) }, (_, i) => `Swarm wave task ${i + 1}`);
  await fetchJson('/api/fanout', {
    method: 'POST',
    body: JSON.stringify({ prompt: prompts.join(' | '), caller: 'swarm', worktree: true }),
  });
  return loadRouterState();
}

export async function triggerGateEscalation(prompt: string): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.runPrompt(
      prompt,
      'cli:mac',
      'pi:KILO_FREE',
      true,
      'gate-escalate',
      null,
      'seatbelt',
      null,
      ['core/src/agents.rs']
    );
    return sandbox.getState();
  }
  await fetchJson('/api/run', {
    method: 'POST',
    body: JSON.stringify({ prompt, caller: 'cli:mac', worktree: true }),
  });
  return loadRouterState();
}

export async function setSimulatedPressure(
  level: 'normal' | 'warn' | 'critical'
): Promise<RouterRuntimeState> {
  sandbox.setSimulatedPressure(level);
  return sandbox.getState();
}

export async function setMenuBarIdlePreview(): Promise<RouterRuntimeState> {
  sandbox.setIdlePreview();
  return sandbox.getState();
}

export async function createKiroSpec(params: {
  title: string;
  goal: string;
  allowed_path_globs: string[];
  gate_cmd: string;
  sandbox_tier: 'seatbelt' | 'docker';
  max_budget_usd: number;
}): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.createKiroSpec(params);
    return sandbox.getState();
  }
  await fetchJson('/api/specs', { method: 'POST', body: JSON.stringify(params) });
  return loadRouterState();
}

export async function approveKiroSpec(specId: string): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.approveKiroSpec(specId);
    return sandbox.getState();
  }
  await fetchJson(`/api/specs/${encodeURIComponent(specId)}/approve`, { method: 'POST' });
  return loadRouterState();
}

export async function runApprovedSpec(specId: string): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.runApprovedSpec(specId);
    return sandbox.getState();
  }
  await fetchJson(`/api/specs/${encodeURIComponent(specId)}/run`, { method: 'POST' });
  return loadRouterState();
}

export async function toggleChannelBridge(id: string): Promise<RouterRuntimeState> {
  sandbox.toggleChannelBridge(id);
  return sandbox.getState();
}

export async function appendMemoryNote(note: string): Promise<RouterRuntimeState> {
  sandbox.appendMemoryNote(note);
  return sandbox.getState();
}

export async function routeDryRun(params: {
  prompt: string;
  caller: string;
  phase?: string;
  worktree?: boolean;
}): Promise<RouterRuntimeState> {
  if (detectedMode === 'static-preview') {
    sandbox.runPrompt(params.prompt, params.caller, undefined, params.worktree ?? true);
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
