import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_VERSION = 1;

export interface Config {
  version: number;
  port: number;
  default_worker: string;
  max_inflight_per_key: number;
  rpm_per_key: number;
  cooldown_s: number;
  lease_wait_s: number;
  excluded_agents: string[];
}

export function defaultConfig(): Config {
  const envPort = Number(process.env.PORT);
  return {
    version: CONFIG_VERSION,
    port: Number.isFinite(envPort) && envPort > 0 ? envPort : 3000,
    default_worker: 'pi',
    max_inflight_per_key: 3,
    rpm_per_key: 40,
    cooldown_s: 60.0,
    lease_wait_s: 30,
    excluded_agents: ['cline'],
  };
}

export function configProblems(cfg: Config): string[] {
  const out: string[] = [];
  if (cfg.version !== CONFIG_VERSION) {
    out.push(`config version ${cfg.version} is not ${CONFIG_VERSION}`);
  }
  if (!Number.isInteger(cfg.port) || cfg.port <= 0 || cfg.port > 65535) {
    out.push('port must be 1-65535');
  }
  if (!cfg.default_worker || !cfg.default_worker.trim()) {
    out.push('default_worker is empty');
  }
  if (cfg.max_inflight_per_key < 1) {
    out.push('max_inflight_per_key must be at least 1');
  }
  if (cfg.rpm_per_key < 1) {
    out.push('rpm_per_key must be at least 1');
  }
  if (!(cfg.cooldown_s >= 0)) {
    out.push('cooldown_s must be zero or more');
  }
  return out;
}

export function stateDir(): string {
  const override = process.env.LINGONBERRY_HOME;
  if (override && override.trim()) {
    return override;
  }
  return path.join(os.homedir(), '.lingonberry');
}

export function configPath(): string {
  return path.join(stateDir(), 'config.json');
}

export function loadConfigOrDefault(): Config {
  const p = configPath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Config>;
    const merged: Config = { ...defaultConfig(), ...parsed };
    const problems = configProblems(merged);
    if (problems.length === 0) {
      return merged;
    }
    console.warn(`config invalid (${p}): ${problems.join('; ')} — using defaults`);
  } catch {
    // Missing or unreadable config in ephemeral container; fall back cleanly to defaults.
  }
  return defaultConfig();
}
