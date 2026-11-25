import type { Config } from './config.js';
import { buildWorkers } from './discovery.js';
import type { DiscoveredWorker, DiscoveryData, WorkerStatus } from './types.js';

interface KeyState {
  name: string;
  provider: string;
  cooling_until: number;
  inflight: number;
  ok: number;
  fail: number;
  window: number[];
}

function nowSec(): number {
  return Date.now() / 1000;
}

export class Registry {
  public readonly workers: DiscoveredWorker[];
  private readonly keys: Map<string, KeyState>;
  private readonly downWorkers = new Set<string>();
  private readonly providerRpmCaps = new Map<string, number>();
  private readonly rpmLimit: number;
  private readonly cooldownS: number;
  private readonly maxInflight: number;
  private readonly defaultWorker: string;

  constructor(discovery: DiscoveryData, cfg: Config) {
    const excluded = new Set(cfg.excluded_agents);
    this.workers = buildWorkers(discovery)
      .filter((w) => !excluded.has(w.agent))
      .sort((a, b) => a.id.localeCompare(b.id));

    this.keys = new Map();
    for (const [provider, names] of Object.entries(discovery.keys)) {
      for (const name of names) {
        this.keys.set(name, {
          name,
          provider,
          cooling_until: 0,
          inflight: 0,
          ok: 0,
          fail: 0,
          window: [],
        });
      }
    }

    this.rpmLimit = cfg.rpm_per_key;
    this.cooldownS = cfg.cooldown_s;
    this.maxInflight = cfg.max_inflight_per_key;
    this.defaultWorker = cfg.default_worker;
  }

  setRpmLimit(target: string, rpm: number): boolean {
    const clamped = Math.max(5, Math.min(300, Math.round(rpm)));
    const key = this.keys.get(target);
    if (key) {
      this.providerRpmCaps.set(key.provider, clamped);
      return true;
    }
    const hasProv = Array.from(this.keys.values()).some((k) => k.provider === target);
    if (hasProv) {
      this.providerRpmCaps.set(target, clamped);
      return true;
    }
    return false;
  }

  listWorkers(): DiscoveredWorker[] {
    return [...this.workers];
  }

  findWorker(id: string): DiscoveredWorker | undefined {
    return this.workers.find((w) => w.id === id);
  }

  markWorkerDown(workerId: string, down: boolean): void {
    if (down) {
      this.downWorkers.add(workerId);
    } else {
      this.downWorkers.delete(workerId);
    }
  }

  isWorkerDown(workerId: string): boolean {
    return this.downWorkers.has(workerId);
  }

  selectBestWorker(): DiscoveredWorker | undefined {
    const available = this.workers.filter((w) => !this.downWorkers.has(w.id));
    return (
      available.find(
        (w) => w.id === this.defaultWorker && (w.key_slot === null || w.agent === 'pi')
      ) ??
      available.find((w) => w.agent === 'pi' && w.key_slot === null) ??
      available.find((w) => w.key_slot === null) ??
      available[0]
    );
  }

  /**
   * Finds an alternative routable worker whose key slot is healthy and not in the excluded set.
   */
  findFallbackWorker(excludeKeys: Set<string>, preferProvider?: string): DiscoveredWorker | undefined {
    const now = nowSec();
    const routable = this.workers.filter((w) => {
      if (this.downWorkers.has(w.id)) return false;
      if (w.key_slot === null) return false;
      if (excludeKeys.has(w.key_slot)) return false;
      const ks = this.keys.get(w.key_slot);
      if (!ks) return false;
      return now >= ks.cooling_until && ks.inflight < this.maxInflight;
    });

    if (preferProvider) {
      const sameProvider = routable.find((w) => w.provider === preferProvider);
      if (sameProvider) return sameProvider;
    }
    return routable[0];
  }

  leaseKeyIn(prefer?: string, provider?: string): string {
    const now = nowSec();
    const candidates = Array.from(this.keys.values()).filter(
      (k) => !provider || k.provider === provider
    );

    candidates.sort((a, b) => {
      const aPref = prefer && a.name === prefer ? 1 : 0;
      const bPref = prefer && b.name === prefer ? 1 : 0;
      if (bPref !== aPref) return bPref - aPref;
      if (a.inflight !== b.inflight) return a.inflight - b.inflight;
      return a.window.length - b.window.length;
    });

    for (const k of candidates) {
      if (now < k.cooling_until) continue;
      const effectiveRpm = this.providerRpmCaps.get(k.provider) ?? this.rpmLimit;
      k.window = k.window.filter((t) => now - t <= 60.0);
      if (k.window.length >= effectiveRpm) continue;
      if (k.inflight >= this.maxInflight) continue;
      k.inflight += 1;
      k.window.push(now);
      return k.name;
    }

    const effective = (provider ? this.providerRpmCaps.get(provider) : undefined) ?? this.rpmLimit;
    throw new Error(
      `no free key (provider=${provider ?? 'any'}, max_inflight=${this.maxInflight}, rpm_limit=${effective})`
    );
  }

  releaseKey(name: string, ok: boolean, customCooldownS?: number): void {
    const k = this.keys.get(name);
    if (!k) return;
    k.inflight = Math.max(0, k.inflight - 1);
    if (ok) {
      k.ok += 1;
    } else {
      k.fail += 1;
      k.cooling_until = nowSec() + (customCooldownS ?? this.cooldownS);
    }
  }

  clearCooldown(name: string): boolean {
    const k = this.keys.get(name);
    if (!k) return false;
    k.cooling_until = 0;
    return true;
  }

  totalRpm(): number {
    const now = nowSec();
    let total = 0;
    for (const k of this.keys.values()) {
      k.window = k.window.filter((t) => now - t <= 60.0);
      total += k.window.length;
    }
    return total;
  }

  keyStatus(): WorkerStatus[] {
    const now = nowSec();
    return Array.from(this.keys.values()).map((k) => {
      const activeCalls = k.window.filter((t) => now - t <= 60.0).length;
      const coolingLeft = Math.max(0, Math.ceil(k.cooling_until - now));
      const status: WorkerStatus['status'] =
        coolingLeft > 0 ? 'down' : k.inflight > 0 ? 'active' : 'idle';
      return {
        name: k.name,
        status,
        calls_24h: activeCalls,
        ok_24h: k.ok,
        key: k.name,
        provider: k.provider,
        cooling_remaining_s: coolingLeft,
        rpm_limit: this.providerRpmCaps.get(k.provider) ?? this.rpmLimit,
        inflight: k.inflight,
      };
    });
  }
}
