import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from './config.js';
import type { Registry } from './registry.js';
import type {
  CookedPromptInfo,
  DiscoveredWorker,
  DiscoveryData,
  Receipt,
  ReceiptExclusion,
  ReceiptSelection,
  SelfConfigPlan,
  SelfConfigTarget,
} from './types.js';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

interface DiscoveredSkill {
  name: string;
  description: string;
  sourcePath: string;
}

function scanLocalSkills(libraryDirs: string[]): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  for (const dir of libraryDirs) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillFile = path.join(dir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        try {
          const text = fs.readFileSync(skillFile, 'utf8').slice(0, 1200);
          const nameMatch = text.match(/^name:\s*["']?([^"'\n]+)["']?/m);
          const descMatch = text.match(/^description:\s*["']?([^"'\n]+)["']?/m);
          skills.push({
            name: (nameMatch?.[1] ?? entry.name).trim(),
            description: (descMatch?.[1] ?? '').trim(),
            sourcePath: skillFile,
          });
        } catch {
          // ignore unreadable skill file
        }
      }
    } catch {
      // ignore missing dir
    }
  }
  return skills;
}

export function redactSecrets(text: string): string {
  let clean = text;
  for (const [k, v] of Object.entries(process.env)) {
    if (
      v &&
      v.length >= 8 &&
      /(KEY|TOKEN|SECRET|PASSWORD|NIM)/i.test(k) &&
      clean.includes(v)
    ) {
      clean = clean.split(v).join(`[REDACTED:${k}]`);
    }
  }
  return clean;
}

export function cookPrompt(
  rawPrompt: string,
  discovery: DiscoveryData,
  phase: string,
  useWorktree: boolean
): CookedPromptInfo {
  const lower = rawPrompt.toLowerCase();
  const tokens = new Set(lower.split(/[^a-z0-9_-]+/).filter((t) => t.length > 2));

  let taskClass = 'general_synthesis';
  let selectedSkill = 'context-retrieval-core';
  let selectedCommand = `lingonberry-core route --phase ${phase}`;
  let selectedHook = 'receipt-audit-log';
  let gatePolicy = 'structured-output-check';

  if (/\b(bug|fix|error|fail|crash|stack|broken|debug)\b/.test(lower)) {
    taskClass = 'debug_fix';
    selectedSkill = 'systematic-debugging';
    selectedCommand = useWorktree
      ? 'lingonberry-core run --worktree --gate test'
      : 'lingonberry-core run --gate test';
    selectedHook = 'pre-apply-diff-preview';
    gatePolicy = 'test-suite-exit-0';
  } else if (/\b(security|secret|key|auth|audit|vuln|review)\b/.test(lower)) {
    taskClass = 'security_audit';
    selectedSkill = 'secure-review-constitution';
    selectedCommand = 'lingonberry-core run --gate gitleaks';
    selectedHook = 'key-redaction-guard';
    gatePolicy = 'zero-secret-leak';
  } else if (/\b(refactor|migrate|port|rewrite|build|create|implement)\b/.test(lower)) {
    taskClass = 'engineering_build';
    selectedSkill = 'architecture-first-build';
    selectedCommand = useWorktree
      ? 'lingonberry-core run --worktree --approve'
      : 'lingonberry-core run --gate build';
    selectedHook = 'worktree-isolation-hook';
    gatePolicy = 'compile-and-lint-pass';
  } else if (/\b(summarize|explain|compare|research|plan|check)\b/.test(lower)) {
    taskClass = 'research_plan';
    selectedSkill = 'deep-retrieval-brief';
    selectedCommand = 'lingonberry-core route --phase plan';
    selectedHook = 'source-grounding-hook';
    gatePolicy = 'citation-grounded';
  }

  const localSkills = scanLocalSkills(discovery.library_dirs);
  if (localSkills.length > 0) {
    let bestScore = 0;
    let bestSkill: DiscoveredSkill | null = null;
    for (const sk of localSkills) {
      const hay = `${sk.name} ${sk.description}`.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (hay.includes(tok)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestSkill = sk;
      }
    }
    if (bestSkill && bestScore > 0) {
      selectedSkill = bestSkill.name;
    }
  }

  const retrievalSources: string[] = [];
  if (discovery.library_dirs.length > 0) {
    retrievalSources.push(...discovery.library_dirs.slice(0, 2));
  } else {
    retrievalSources.push('~/.agent-skills (global constitution)');
  }
  if (discovery.git_projects.length > 0) {
    retrievalSources.push(...discovery.git_projects.slice(0, 2));
  } else {
    retrievalSources.push('workspace-context-index');
  }

  const sanitizedPrompt = redactSecrets(rawPrompt.trim());
  const cookedPrompt = [
    `[Constitution: global-agentic-skills · ${selectedSkill}]`,
    `[Task Class: ${taskClass} · Command: ${selectedCommand}]`,
    `[Hook: ${selectedHook} · Gate: ${gatePolicy}]`,
    `[Retrieved Context: ${retrievalSources.join(', ')}]`,
    '',
    `Objective: ${sanitizedPrompt}`,
  ].join('\n');

  return {
    raw_prompt: sanitizedPrompt,
    cooked_prompt: cookedPrompt,
    task_class: taskClass,
    selected_skill: selectedSkill,
    selected_command: selectedCommand,
    selected_hook: selectedHook,
    retrieval_sources: retrievalSources,
    gate_policy: gatePolicy,
  };
}

export function routePrompt(
  prompt: string,
  phase: string,
  caller: string | null,
  discovery: DiscoveryData,
  registry: Registry,
  useWorktree = false
): Receipt {
  const workers = registry.listWorkers();
  const exclusions: ReceiptExclusion[] = [];
  let candidates: DiscoveredWorker[] = [...workers];

  // Exclude workers flagged down by doctor health check
  const downWorkers = candidates.filter((w) => registry.isWorkerDown(w.id));
  if (downWorkers.length > 0) {
    exclusions.push({
      candidate_id: downWorkers.map((w) => w.id).join(', '),
      code: 'DOCTOR_DOWN',
      evidence: 'worker flagged unhealthy by doctor check',
    });
    candidates = candidates.filter((w) => !registry.isWorkerDown(w.id));
  }

  const destructive = ['delete', 'rm ', 'drop', 'truncate', 'destroy', 'wipe', 'format'];
  const lower = prompt.toLowerCase();
  if (destructive.some((kw) => lower.includes(kw))) {
    const before = candidates.length;
    candidates = candidates.filter((w) => w.write_access);
    const removed = before - candidates.length;
    if (removed > 0) {
      exclusions.push({
        candidate_id: 'read-only workers',
        code: 'NO_WRITE_ACCESS',
        evidence: `prompt contains destructive keyword; ${removed} read-only workers excluded`,
      });
    }
  }

  const unkeyed = candidates.filter(
    (w) => w.key_slot !== null && !hasKeyAvailable(w.key_slot, discovery)
  );
  if (unkeyed.length > 0) {
    exclusions.push({
      candidate_id: unkeyed.map((w) => w.id).join(', '),
      code: 'KEY_NOT_SET',
      evidence: 'required API key env var not present in environment',
    });
    candidates = candidates.filter(
      (w) => w.key_slot === null || hasKeyAvailable(w.key_slot, discovery)
    );
  }

  const keyStatuses = new Map(registry.keyStatus().map((k) => [k.name, k.status]));
  const cooling = candidates.filter(
    (w) => w.key_slot !== null && keyStatuses.get(w.key_slot) === 'down'
  );
  if (cooling.length > 0) {
    exclusions.push({
      candidate_id: cooling.map((w) => w.id).join(', '),
      code: 'KEY_COOLDOWN',
      evidence: 'key slot resting on cooldown after previous failure',
    });
    candidates = candidates.filter(
      (w) => w.key_slot === null || keyStatuses.get(w.key_slot) !== 'down'
    );
  }

  const cooked = cookPrompt(prompt, discovery, phase, useWorktree);

  const catalogHash = sha256(
    [...discovery.library_dirs, ...discovery.ssh_hosts, ...discovery.git_projects].join('|')
  );
  const policyHash = sha256(exclusions.map((e) => `${e.code}:${e.evidence}`).join('|'));
  const poolHash = sha256(
    Object.entries(discovery.keys)
      .map(([p, names]) => `${p}:${names.join(',')}`)
      .join('|')
  );
  const registryHash = sha256(workers.map((w) => `${w.id}:${w.key_slot ?? ''}`).join('|'));

  if (candidates.length === 0) {
    return {
      receipt_id: crypto.randomUUID(),
      context_hash: sha256(prompt),
      catalog_hash: catalogHash,
      policy_hash: policyHash,
      pool_hash: poolHash,
      registry_hash: registryHash,
      phase,
      selected: null,
      alternatives: [],
      exclusions,
      abstention: 'no workers passed constraint filters (add a provider key or install a CLI agent)',
      created_at: new Date().toISOString(),
      caller,
      cooked,
    };
  }

  const scored = candidates
    .map((w) => {
      let score = 0.8;
      if (w.agent === 'pi' && w.key_slot === null) score = 1.0;
      else if (w.key_slot === null) score = 0.9;
      return { score, w };
    })
    .sort((a, b) => b.score - a.score);

  const toSelection = (item: { score: number; w: DiscoveredWorker }): ReceiptSelection => ({
    worker: item.w.id,
    model: item.w.model,
    effort: cooked.task_class === 'engineering_build' ? 'high' : 'standard',
    gate: cooked.gate_policy,
    reason: `score=${item.score.toFixed(2)} · skill=${cooked.selected_skill}`,
  });

  return {
    receipt_id: crypto.randomUUID(),
    context_hash: sha256(prompt),
    catalog_hash: catalogHash,
    policy_hash: policyHash,
    pool_hash: poolHash,
    registry_hash: registryHash,
    phase,
    selected: toSelection(scored[0]),
    alternatives: scored.slice(1).map(toSelection),
    exclusions,
    abstention: null,
    created_at: new Date().toISOString(),
    caller,
    cooked,
  };
}

function hasKeyAvailable(slot: string, discovery: DiscoveryData): boolean {
  if (process.env[slot]) return true;
  return Object.values(discovery.keys).some((names) => names.includes(slot));
}

export function buildSelfConfigPlan(
  discovery: DiscoveryData,
  _cfg: Config,
  appliedTargets: Set<string>
): SelfConfigPlan {
  const home = os.homedir();
  const platform =
    process.platform === 'darwin'
      ? 'macOS'
      : process.platform === 'win32'
        ? 'Windows'
        : 'Linux';

  const globalDir =
    discovery.library_dirs.find((d) => d.includes('.agent-skills')) ??
    discovery.library_dirs[0] ??
    path.join(home, '.agent-skills');

  const globalSkillPath = path.join(globalDir, 'lingonberry-router', 'SKILL.md');
  const constitutionPath = path.join(home, '.lingonberry', 'CONSTITUTION.md');
  const mcpConfigPath = path.join(home, '.lingonberry', 'mcp.json');

  const targets: SelfConfigTarget[] = [
    {
      target: 'Global Agentic Skills + Constitution',
      scope: 'global',
      path: globalSkillPath,
      status: appliedTargets.has(globalSkillPath) ? 'applied' : 'ready',
      reason:
        'Single shared source of truth: every agent reading global skills inherits Lingonberry routing without per-agent duplication.',
      snippet: [
        '---',
        'name: lingonberry-router',
        'description: Delegate heavy, parallel, or multi-provider work via lingonberry-core.',
        '---',
        'Before multi-file edits or parallel fanout, run `lingonberry-core route "<prompt>"`',
        'to pick the least-loaded worker/key slot, then dispatch via `lingonberry-core run`.',
      ].join('\n'),
    },
    {
      target: 'Shared Router Directive',
      scope: 'global',
      path: constitutionPath,
      status: appliedTargets.has(constitutionPath) ? 'applied' : 'ready',
      reason:
        'Defines prompt-cooking rules, destructive-keyword gates, and key-slot isolation across all callers.',
      snippet: [
        '# Lingonberry Constitution Pointer',
        'Use `ROUTER_CALLER=<agent>` and `lingonberry-core serve` (127.0.0.1:8799).',
        'Never store raw API keys in prompts or SQLite; reference key slot names only.',
      ].join('\n'),
    },
    {
      target: 'MCP Tool Bridge (lingonberry-core mcp)',
      scope: 'global',
      path: mcpConfigPath,
      status: appliedTargets.has(mcpConfigPath) ? 'applied' : 'ready',
      reason:
        'Exposes route, run, fanout, and snapshot as standard MCP tools so IDE agents discover the router automatically.',
      snippet: JSON.stringify(
        {
          mcpServers: {
            'lingonberry-router': {
              command: 'lingonberry-core',
              args: ['mcp'],
            },
          },
        },
        null,
        2
      ),
    },
  ];

  const lightPointers: Array<{ name: string; file: string; reason: string; snippet: string }> = [
    {
      name: 'claude',
      file: path.join(home, '.claude', 'CLAUDE.md'),
      reason: 'Discovered Claude Code: 2-line pointer to shared global skill (light config).',
      snippet:
        '<!-- lingonberry:start -->\nRead `~/.agent-skills/lingonberry-router/SKILL.md` for subagent dispatch.\n<!-- lingonberry:end -->',
    },
    {
      name: 'codex',
      file: path.join(home, '.codex', 'AGENTS.md'),
      reason: 'Discovered Codex CLI: 2-line pointer to shared global skill (light config).',
      snippet:
        '<!-- lingonberry:start -->\nUse `lingonberry-core` per `~/.agent-skills/lingonberry-router/SKILL.md`.\n<!-- lingonberry:end -->',
    },
    {
      name: 'opencode',
      file: path.join(home, '.config', 'opencode', 'AGENTS.md'),
      reason: 'Discovered OpenCode: 2-line pointer to shared global skill (light config).',
      snippet:
        '<!-- lingonberry:start -->\nUse `lingonberry-core` per `~/.agent-skills/lingonberry-router/SKILL.md`.\n<!-- lingonberry:end -->',
    },
  ];

  const discoveredIds = new Set(discovery.agents.map((a) => a.id));
  for (const ptr of lightPointers) {
    const installed = discoveredIds.has(ptr.name);
    targets.push({
      target: `${ptr.name} (light pointer)`,
      scope: 'light-pointer',
      path: ptr.file,
      status: appliedTargets.has(ptr.file) ? 'applied' : 'ready',
      reason: installed
        ? ptr.reason
        : `Ready for ${ptr.name}: lightweight pointer stays dormant until ${ptr.name} is detected on PATH.`,
      snippet: ptr.snippet,
    });
  }

  return {
    os: platform,
    preferred_root: globalDir,
    strategy:
      'Global-first injection: write one canonical skill, constitution & MCP bridge in your shared global folder, plus 2-line idempotent pointers per agent.',
    targets,
  };
}
