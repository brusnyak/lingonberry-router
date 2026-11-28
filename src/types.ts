export interface Provider {
  id: string;
  base_url: string;
  style: string | null;
}

export interface Agent {
  id: string;
  path: string | null;
}

export type RunState =
  | 'queued'
  | 'leased'
  | 'running'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'escalated';

export type StepTone = 'info' | 'route' | 'active' | 'warn' | 'done';

export interface SessionStep {
  ts: number;
  stage:
    | 'received'
    | 'cooked'
    | 'routed'
    | 'leased'
    | 'dispatched'
    | 'failover'
    | 'escalated'
    | 'gate'
    | 'killed';
  title: string;
  detail: string;
  tone: StepTone;
}

export interface CookedPromptInfo {
  raw_prompt: string;
  cooked_prompt: string;
  task_class: string;
  selected_skill: string;
  selected_command: string;
  selected_hook: string;
  retrieval_sources: string[];
  gate_policy: string;
  workflow_loop?: string | null;
  skills?: string[];
}

export interface Run {
  id: string;
  created_at: string;
  worker: string;
  caller: string | null;
  key_name: string | null;
  model: string | null;
  provider: string | null;
  prompt: string;
  gate: string | null;
  state: RunState;
  pid: number | null;
  os_pid?: number | null;
  elapsed_ms: number | null;
  gate_passed: boolean | null;
  gate_status?: string | null;
  worktree_path?: string | null;
  cost_tier?: string | null;
  budget_approved?: boolean | null;
  error: string | null;
  output: string | null;
  task_class: string | null;
  receipt_id: string | null;
  cooked?: CookedPromptInfo | null;
  steps?: SessionStep[];
  fanout_group?: string | null;
  failover_from?: string | null;
  escalation_from?: string | null;
  sandbox_tier?: string | null;
  complexity_tier?: string | null;
  spec_id?: string | null;
  live_api?: boolean;
  tokens_in?: number | null;
  tokens_out?: number | null;
}

export interface Overview {
  running: number;
  live_workers: number;
  completed_24h: number;
  failed_24h: number;
  avg_duration_s: number | null;
  cost_24h_usd: number | null;
  calls_24h: number | null;
  cpu_pct: number | null;
}

export interface WorkerStatus {
  name: string;
  status: 'active' | 'idle' | 'down' | 'unchecked';
  calls_24h: number;
  ok_24h: number;
  key: string | null;
  provider?: string;
  cooling_remaining_s?: number;
  rpm_limit?: number;
  inflight?: number;
  cost_tier?: string | null;
  source?: string | null;
  fail_count?: number;
}

export interface LiveWorker {
  pid: number;
  worker: string;
  caller: string | null;
  key: string | null;
  model: string | null;
  provider: string | null;
  run_id: string | null;
  task: string;
  started: number;
  elapsed_s: number;
  fanout_group?: string | null;
}

export interface SessionRow {
  id: string;
  ts: number;
  prompt: string;
  worker: string;
  caller: string | null;
  key: string | null;
  model?: string | null;
  state: string;
  duration_s: number;
  reason: string | null;
  output: string | null;
  receipt_id?: string | null;
  cooked?: CookedPromptInfo | null;
  steps?: SessionStep[];
  fanout_group?: string | null;
  failover_from?: string | null;
  live_api?: boolean;
  tokens_in?: number | null;
  tokens_out?: number | null;
  gate_status?: string | null;
  cost_tier?: string | null;
  escalation_from?: string | null;
  sandbox_tier?: string | null;
  complexity_tier?: string | null;
  spec_id?: string | null;
}

export type JobHealth = 'healthy' | 'running' | 'crashed' | 'auto_healed' | 'paused';

export interface JobRow {
  name: string;
  source: string;
  scope?: string;
  read_only?: boolean;
  schedule: string;
  command: string;
  every_s: number | null;
  last: number | null;
  rc: number | null;
  paused: boolean | null;
  next_in_s: number | null;
  prompt: string | null;
  health: JobHealth;
  running_pid: number | null;
  crash_count: number;
  restart_count: number;
  auto_restart: boolean;
  last_error: string | null;
  log_tail: string[];
}

export interface LiveCronProcess {
  pid: number;
  job_name: string;
  source: string;
  command: string;
  cpu_pct: number;
  mem_mb: number;
  elapsed_s: number;
}

export interface RouterState {
  up: boolean;
  serve: boolean;
  proxy: boolean;
}

export interface SystemInfo {
  cpu_pct: number | null;
  load1: number | null;
  ram_used_gb: number | null;
  ram_total_gb: number | null;
  disk_used_gb: number | null;
  disk_total_gb: number | null;
  app_cpu_pct?: number | null;
  app_ram_gb?: number | null;
}

export interface TelemetryPoint {
  ts: number;
  cpu_pct: number;
  ram_pct: number;
  disk_pct: number;
  active_runs: number;
  rpm: number;
}

export interface ReadinessReport {
  pi_installed: boolean;
  pi_path: string | null;
  mini_harness_ready: boolean;
  agents_count: number;
  free_keys_count: number;
  paid_keys_count: number;
  external_skills_count: number;
  mode: string;
  recommendations: string[];
}

export interface OvernightTicket {
  id: string;
  title: string;
  prompt: string;
  repo_path: string | null;
  status: string;
  cost_tier: string;
  estimated_tokens: number;
  created_at: string;
  run_id: string | null;
  gate_status: string | null;
  summary: string | null;
}

export interface OvernightSummary {
  enabled: boolean;
  free_only: boolean;
  nightly_budget_usd: number;
  spent_today_usd: number;
  runs_tonight: number;
  max_runs_per_night: number;
  tickets: OvernightTicket[];
}

export interface WatchdogStatus {
  memory_pressure: 'normal' | 'warn' | 'critical' | string;
  ram_used_pct: number;
  disk_pressure: 'normal' | 'warn' | 'critical' | string;
  free_disk_gb: number;
  cpu_pct: number;
  max_concurrent_workers: number;
  active_workers: number;
  paused_reason: string | null;
  provider_rpm_used: Record<string, number>;
  subscription_burst_used: number;
  subscription_burst_cap: number;
}

export interface SandboxHealth {
  seatbelt_available: boolean;
  docker_available: boolean;
  docker_runtime: string | null;
  default_local_tier: string;
  default_overnight_tier: string;
}

export interface PathLease {
  run_id: string;
  repo_root: string;
  globs: string[];
  worktree_path: string;
  sandbox_tier: string;
  lease_state: string;
}

export interface MergeQueueItem {
  run_id: string;
  repo_root: string;
  branch_or_worktree: string;
  gate_cmd: string;
  status: string;
  attempt: number;
}

export interface SwarmSummary {
  max_concurrent: number;
  active_workers: number;
  queued_count: number;
  active_leases: PathLease[];
  merge_queue: MergeQueueItem[];
}

export interface ChannelBridgeStatus {
  id: string;
  label: string;
  transport: string;
  enabled: boolean;
  connected: boolean;
  session_key_prefix: string;
  description: string;
}

export interface GatewayMemorySummary {
  memory_path: string;
  steering_dir: string;
  entries_count: number;
  channels: ChannelBridgeStatus[];
  recent_notes?: string[];
}

export interface SpecWaveTask {
  task_id: string;
  wave: number;
  title: string;
  path_globs: string[];
  gate_cmd: string;
  status: string;
}

export interface KiroSpecManifest {
  spec_id: string;
  title: string;
  goal: string;
  repo_root: string;
  requirements_md: string;
  design_md: string;
  tasks_dag: SpecWaveTask[];
  allowed_path_globs: string[];
  forbidden_actions: string[];
  gate_cmd: string;
  sandbox_tier: string;
  max_budget_usd: number;
  sha256_digest: string;
  approved_at: string | null;
  status: 'draft' | 'approved' | 'running' | 'completed' | 'blocked' | string;
  created_at: string;
}

export interface Snapshot {
  ts: number;
  overview: Overview;
  workers: WorkerStatus[];
  workers_live: LiveWorker[];
  sessions: SessionRow[];
  jobs: JobRow[];
  cron_live: LiveCronProcess[];
  router: RouterState;
  system: SystemInfo;
  telemetry?: TelemetryPoint[];
  readiness?: ReadinessReport;
  overnight?: OvernightSummary;
  watchdog?: WatchdogStatus;
  sandbox?: SandboxHealth;
  swarm?: SwarmSummary;
  gateway?: GatewayMemorySummary;
  specs?: KiroSpecManifest[];
}

export interface ReceiptSelection {
  worker: string;
  model: string | null;
  effort: string | null;
  gate: string | null;
  reason: string;
}

export interface ReceiptExclusion {
  candidate_id: string;
  code: string;
  evidence: string;
}

export interface Receipt {
  receipt_id: string;
  context_hash: string;
  catalog_hash: string;
  policy_hash: string;
  pool_hash: string;
  registry_hash: string;
  phase: string;
  selected: ReceiptSelection | null;
  alternatives: ReceiptSelection[];
  exclusions: ReceiptExclusion[];
  abstention: string | null;
  created_at: string;
  caller?: string | null;
  cooked?: CookedPromptInfo | null;
}

export interface DiscoveredWorker {
  id: string;
  agent: string;
  key_name: string | null;
  provider: string;
  base_url: string | null;
  model: string | null;
  write_access: boolean;
  path: string | null;
  cost_tier?: string;
}

export interface KeychainSlotMeta {
  slot: string;
  provider: string;
  label: string;
  cost_tier: string;
  rpm_limit: number | null;
  base_url: string | null;
  model: string | null;
}

export interface DiscoveryData {
  agents: Agent[];
  keys: Record<string, string[]>;
  providers: Record<string, Provider>;
  library_dirs: string[];
  ssh_hosts: string[];
  git_projects: string[];
  browsers: string[];
  keychain_slots?: KeychainSlotMeta[];
}

export interface SelfConfigTarget {
  target: string;
  scope: 'global' | 'light-pointer';
  path: string;
  status: 'ready' | 'applied' | 'skipped';
  reason: string;
  snippet: string;
}

export interface SelfConfigPlan {
  os: string;
  preferred_root: string;
  strategy: string;
  targets: SelfConfigTarget[];
}

export interface CapabilitiesInfo {
  live_gemini_available: boolean;
  discovered_providers: string[];
  rust_core_present: boolean;
  runtime: 'node-preview' | 'rust-core' | 'static-sandbox';
}
