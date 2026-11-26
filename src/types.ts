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
  stage: 'received' | 'cooked' | 'routed' | 'leased' | 'dispatched' | 'failover' | 'gate' | 'killed';
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
  elapsed_ms: number | null;
  gate_passed: boolean | null;
  error: string | null;
  output: string | null;
  task_class: string | null;
  receipt_id: string | null;
  cooked?: CookedPromptInfo | null;
  steps?: SessionStep[];
  fanout_group?: string | null;
  failover_from?: string | null;
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
}

export type JobHealth = 'healthy' | 'running' | 'crashed' | 'auto_healed' | 'paused';

export interface JobRow {
  name: string;
  source: string;
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
  /** This app only: core plus tray. CPU in percent of one core, RAM in GB. */
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
}

export interface DiscoveryData {
  agents: Agent[];
  keys: Record<string, string[]>;
  providers: Record<string, Provider>;
  library_dirs: string[];
  ssh_hosts: string[];
  git_projects: string[];
  browsers: string[];
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
