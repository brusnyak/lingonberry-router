import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Agent, DiscoveredWorker, DiscoveryData, Provider } from './types.js';

export const PI_NIM_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

const AGENT_BINS = [
  'claude',
  'codex',
  'opencode',
  'kilo',
  'pi',
  'cline',
  'jcode',
  'goose',
  'omp',
  'hermes',
  'crush',
  'qwen',
];

const PROVIDER_PREFIXES = [
  'NIM',
  'NVIDIA_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'MISTRAL_API_KEY',
  'DEEPSEEK_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'CEREBRAS_API_KEY',
  'XAI_API_KEY',
];

const KNOWN_PROVIDERS: Record<string, { url: string; style: string | null; defaultModel?: string }> = {
  nim: { url: 'https://integrate.api.nvidia.com/v1', style: 'openai', defaultModel: PI_NIM_MODEL },
  openrouter: { url: 'https://openrouter.ai/api/v1', style: 'openai', defaultModel: 'openrouter/auto' },
  groq: { url: 'https://api.groq.com/openai/v1', style: 'openai', defaultModel: 'llama-3.3-70b-versatile' },
  anthropic: { url: 'https://api.anthropic.com/v1', style: 'anthropic', defaultModel: 'claude-sonnet-4' },
  openai: { url: 'https://api.openai.com/v1', style: 'openai', defaultModel: 'gpt-4.1' },
  mistral: { url: 'https://api.mistral.ai/v1', style: 'openai', defaultModel: 'mistral-large-latest' },
  deepseek: { url: 'https://api.deepseek.com/v1', style: 'openai', defaultModel: 'deepseek-chat' },
  together: { url: 'https://api.together.xyz/v1', style: 'openai' },
  fireworks: { url: 'https://api.fireworks.ai/inference/v1', style: 'openai' },
  cerebras: { url: 'https://api.cerebras.ai/v1', style: 'openai' },
  xai: { url: 'https://api.x.ai/v1', style: 'openai', defaultModel: 'grok-3' },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    style: 'openai',
    defaultModel: 'gemini-2.5-flash',
  },
};

const WRITE_AGENTS = new Set(['claude', 'codex', 'opencode', 'kilo', 'cline', 'goose', 'omp']);

function which(cmd: string): string | null {
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, cmd);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        return full;
      }
    } catch {
      // ignore missing entry
    }
  }
  return null;
}

function scanAgents(): Agent[] {
  const out: Agent[] = [];
  for (const bin of AGENT_BINS) {
    const resolved = which(bin);
    if (resolved) {
      out.push({ id: bin, path: resolved });
    }
  }
  return out;
}

export function providerId(prefix: string): string {
  if (prefix.startsWith('NIM') || prefix === 'NVIDIA_API_KEY') return 'nim';
  switch (prefix) {
    case 'GROQ_API_KEY':
      return 'groq';
    case 'OPENROUTER_API_KEY':
      return 'openrouter';
    case 'ANTHROPIC_API_KEY':
      return 'anthropic';
    case 'OPENAI_API_KEY':
      return 'openai';
    case 'GEMINI_API_KEY':
      return 'gemini';
    case 'MISTRAL_API_KEY':
      return 'mistral';
    case 'DEEPSEEK_API_KEY':
      return 'deepseek';
    case 'TOGETHER_API_KEY':
      return 'together';
    case 'FIREWORKS_API_KEY':
      return 'fireworks';
    case 'CEREBRAS_API_KEY':
      return 'cerebras';
    case 'XAI_API_KEY':
      return 'xai';
    default:
      return prefix.toLowerCase();
  }
}

export function envFiles(home: string): string[] {
  return [
    path.join(home, '.env'),
    path.join(home, '.config', 'lingonberry', 'env'),
  ];
}

function scanKeys(): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  const seen = new Set<string>();
  const home = os.homedir();

  for (const envFile of envFiles(home)) {
    try {
      const text = fs.readFileSync(envFile, 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const eqIdx = line.indexOf('=');
        const rawName = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim();
        if (!val) continue;
        const name = rawName.startsWith('export ') ? rawName.slice(7).trim() : rawName;
        for (const prefix of PROVIDER_PREFIXES) {
          if (name.startsWith(prefix) && !seen.has(name)) {
            seen.add(name);
            const prov = providerId(prefix);
            if (!found[prov]) found[prov] = [];
            found[prov].push(name);
          }
        }
      }
    } catch {
      // ignore missing env files
    }
  }

  for (const [name, val] of Object.entries(process.env)) {
    if (!val) continue;
    for (const prefix of PROVIDER_PREFIXES) {
      if (name.startsWith(prefix) && !seen.has(name)) {
        seen.add(name);
        const prov = providerId(prefix);
        if (!found[prov]) found[prov] = [];
        found[prov].push(name);
      }
    }
  }

  for (const names of Object.values(found)) {
    names.sort();
  }
  return found;
}

function scanProviders(keys: Record<string, string[]>): Record<string, Provider> {
  const out: Record<string, Provider> = {};
  for (const prov of Object.keys(keys)) {
    const known = KNOWN_PROVIDERS[prov];
    if (known) {
      out[prov] = { id: prov, base_url: known.url, style: known.style };
    } else {
      out[prov] = { id: prov, base_url: '', style: null };
    }
  }
  return out;
}

function scanLibraryDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.claude', 'skills'),
    path.join(home, '.agent-skills'),
    path.join(home, '.codex', 'skills'),
    path.join(home, '.config', 'opencode', 'skills'),
  ].filter((p) => fs.existsSync(p));
}

function scanSshHosts(): string[] {
  const sshConfig = path.join(os.homedir(), '.ssh', 'config');
  const out: string[] = [];
  try {
    const text = fs.readFileSync(sshConfig, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('Host ')) {
        const rest = trimmed.slice(5);
        for (const host of rest.split(/\s+/)) {
          if (host && !/[*?!]/.test(host)) {
            out.push(host);
          }
        }
      }
    }
  } catch {
    // ignore missing ssh config
  }
  return out;
}

function scanGitProjects(): string[] {
  const home = os.homedir();
  const roots = [
    path.join(home, 'Developer'),
    path.join(home, 'Projects'),
    path.join(home, 'code'),
    path.join(home, 'src'),
  ];
  const out: string[] = [];
  for (const root of roots) {
    try {
      if (!fs.statSync(root).isDirectory()) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const p = path.join(root, entry.name);
        if (fs.existsSync(path.join(p, '.git'))) {
          out.push(p);
        }
      }
    } catch {
      // ignore unreadable dirs
    }
  }
  return out;
}

export function scanDiscovery(): DiscoveryData {
  const agents = scanAgents();
  const keys = scanKeys();
  const providers = scanProviders(keys);
  return {
    agents,
    keys,
    providers,
    library_dirs: scanLibraryDirs(),
    ssh_hosts: scanSshHosts(),
    git_projects: scanGitProjects(),
    browsers: [],
  };
}

export function buildWorkers(d: DiscoveryData): DiscoveredWorker[] {
  const out: DiscoveredWorker[] = [];
  const nimKeys = d.keys.nim ?? [];

  if (nimKeys.length > 0) {
    out.push({
      id: 'pi',
      agent: 'pi',
      key_slot: null,
      provider: 'nim',
      base_url: d.providers.nim?.base_url ?? null,
      model: PI_NIM_MODEL,
      write_access: true,
      path: null,
    });
  }

  for (const agent of d.agents) {
    if (agent.id === 'pi') {
      for (const key of nimKeys) {
        out.push({
          id: `pi:${key}`,
          agent: 'pi',
          key_slot: key,
          provider: 'nim',
          base_url: d.providers.nim?.base_url ?? null,
          model: PI_NIM_MODEL,
          write_access: true,
          path: null,
        });
      }
    }
  }

  for (const [prov, keys] of Object.entries(d.keys)) {
    if (prov === 'nim') continue;
    for (const key of keys) {
      out.push({
        id: `${prov}:${key}`,
        agent: prov,
        key_slot: key,
        provider: prov,
        base_url: d.providers[prov]?.base_url ?? null,
        model: KNOWN_PROVIDERS[prov]?.defaultModel ?? null,
        write_access: true,
        path: null,
      });
    }
  }

  for (const agent of d.agents) {
    if (agent.id !== 'pi' && agent.id !== 'nim-chat') {
      out.push({
        id: agent.id,
        agent: agent.id,
        key_slot: null,
        provider: agent.id,
        base_url: null,
        model: null,
        write_access: WRITE_AGENTS.has(agent.id),
        path: agent.path,
      });
    }
  }

  for (const key of nimKeys) {
    out.push({
      id: `nim-chat:${key}`,
      agent: 'nim-chat',
      key_slot: key,
      provider: 'nim',
      base_url: d.providers.nim?.base_url ?? null,
      model: PI_NIM_MODEL,
      write_access: false,
      path: null,
    });
  }

  return out;
}
