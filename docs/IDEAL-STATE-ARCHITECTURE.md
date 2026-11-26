# Lingonberry Router — Ideal-State Architecture & Engineering Review

**Status:** Proposed architecture, not an implementation claim  
**Reviewed:** 2026-11-26  
**Baseline:** `main` at review time  
**Purpose:** Define the product boundary, identify verified gaps, and sequence the work needed for reliable long-prompt, multi-topic orchestration on both frontier and small models.

## Executive decision

Lingonberry should become a **local-first agent orchestration control plane**, not merely a model router and not another general-purpose agent framework.

Its differentiator should be the combination of:

1. Local discovery of caller CLIs, provider/model/key slots, skills, commands, hooks and workspace context.
2. A deterministic planning and policy layer that turns a request into a validated task DAG.
3. A capability-aware scheduler that delegates each task to the cheapest suitable healthy worker.
4. Durable execution, checkpoints, retries, evidence gates and human approval.
5. A truthful live graph showing the actual caller → router → task → worker → provider/key → outcome path.

Keep Rust as the execution and policy core. Do not replace it with a large framework. Borrow proven patterns and integrate through MCP/adapters where useful.

## 1. Current baseline: what is real

The repository currently contains a Rust CLI and Axum loopback server, SQLite WAL persistence, dynamic discovery, provider-scoped key leasing, worker health state, receipts, prompt cooking, a basic MCP stdio bridge, run/fanout endpoints, and a React orchestration graph.

The current implementation already has important foundations:
- `LeaseGuard` releases inflight capacity on drop.
- Key leases are scoped to a provider.
- Routing excludes workers marked down and key slots cooling down.
- Provider API calls have timeouts, configurable token limits and a sibling-key failover path.
- Long raw inputs over `CHUNK_CHARS` use a sequential chunk/map-reduce path.
- The MCP bridge exposes route, discover, snapshot and self-config tools.
- SQLite stores runs, receipts and session steps.

The old `docs/IDEAL-STATE-CRITIQUE.md` is stale in places: it still lists RAII leasing, health filtering and failover as missing. Replace it with a current-state review or mark it superseded after this document is accepted.

## 2. Verified gaps and risks

### P0 — Security and execution truth

**Explicit worker override bypasses the route receipt.** In `dispatch_run_async`, a supplied `worker_id` is resolved before the receipt's selected worker. The receipt filters down/unhealthy workers and, for non-owner callers, excludes keyed workers; the explicit override can therefore select a worker the receipt excluded. The HTTP `/api/run` and `/api/fanout` paths pass caller-controlled or registry-derived worker IDs into this path. In addition, keyed provider execution can reach the generic provider-call path even when the `live_api` flag is false. Treat this as a potential owner-key spend boundary bypass until regression-tested and fixed.

**Required fix:** worker overrides must be checked against the exact eligible candidate set produced by policy. Caller identity and allowed credential scopes must be established independently of Origin headers. A non-owner request must never acquire or execute an owner key slot. Fanout must use the same authorization path as a single run. Fail closed when caller identity is unknown.

**Verification is overstated.** A successful CLI exit or a non-empty provider response is currently recorded as a passed gate in some paths. That is not equivalent to executing the advertised test/build/security gate or proving the result. Gate names in cooked prompt metadata must not be presented as completed checks.

**Required fix:** define typed gate executors (test command, build, lint, secret scan, schema check, evidence/citation check). Persist gate command, exit code, stdout/stderr summary, artifact/diff hash and status. A gate passes only after its executor returns success. If no gate ran, report `not_run`, never `passed`.

### P1 — Planner and skill selection

Current `cook_prompt` classifies the whole prompt into one task class using keyword precedence, then selects at most one local skill by simple token overlap. Skill scanning is shallow (immediate child directories), parses only a small frontmatter slice, and injects a capped prefix of the skill body. Retrieval metadata currently records library/workspace paths; it does not retrieve ranked file or symbol content. Commands and hooks are selected as descriptive strings, not compiled into an executable capability plan.

The route score is mostly `WORKER_ORDER` preference. It does not score actual task capability, model context capacity, structured-output support, latency, reliability, cost, permissions or current load.

**Required fix:** separate task understanding from worker selection. Support multiple task types and multiple skills per plan. Make every selected skill/tool/hook/command an explicit catalog item with provenance, version/hash, inputs, permissions and applicability. Add deterministic retrieval and transparent scoring.

### P1 — Long and multi-topic prompts

The current chunker splits on blank lines and then hard-splits by character count. The map stage runs sequentially on the same provider/model, and the reduce stage merges the results. This is useful as a basic long-input fallback, but it is not topic decomposition, dependency planning or capability-aware delegation.

**Required fix:** use structure-aware segmentation, topic/intent extraction, subtask generation, dependency edges, independent parallel branches, explicit shared context and synthesis/verification tasks. Preserve source spans and stable IDs so every finding can be traced to the input. Chunking must respect token budgets, not character counts alone.

### P1 — Execution and resilience

The fanout interface accepts a list of prompts (or creates fixed architecture/tests/security branches) and distributes them round-robin over the discovered worker list. It does not yet derive task-specific branches or schedule by capability/health/load. Execution records a run and session steps, but the product needs a durable task graph with parent/child relations, dependency state, retries, cancellation propagation and restart recovery.

**Required fix:** persist a plan and DAG before execution; run only ready nodes; checkpoint every state transition; reconcile orphaned running nodes after restart; use bounded retry/fallback policies by error class; make cancellation idempotent and propagate it to child process groups.

### P1 — Interface truthfulness

The graph derives callers from recent sessions and draws caller-to-router and router-to-displayed-worker edges. It does not currently encode the exact caller-to-worker association for each run; active paths share a generic color. The visualization can therefore imply relationships that were not observed.

**Required fix:** render edges from persisted dispatch events containing run ID, caller identity, selected worker, provider, actual key-slot name, model, status and timestamps. Distinguish planned, leased, running, retrying, gated and completed edges. Use one stable color per caller, not one generic active color. When idle, show only the router mark.

## 3. Ideal architecture

```text
Caller adapters (Claude / Codex / OpenCode / shell / MCP)
                         |
                 Intake + identity
                         |
              Normalize request + files
                         |
          Deterministic policy pre-filter
                         |
        Planner (small model first, escalate)
                         |
      Task DAG + capability/skill composition
                         |
       Retrieval compiler (FTS/BM25 + symbols)
                         |
       Plan validator + receipt + approval gate
                         |
             Capability-aware scheduler
                 /       |        \
             Worker A  Worker B  Worker C
                 \       |        /
           Provider/key lease + budgets
                         |
             Execution + checkpoints
                         |
           Typed evidence / quality gates
                         |
             Synthesis + final verifier
                         |
              Result + replayable trace
```

### A. Intake and identity

Normalize caller, prompt, attachments, workspace, current branch, requested outcome, constraints and approval policy. Caller identity must be a typed trusted value (CLI adapter identity, MCP connection identity or local owner identity), not a user-supplied string alone.

### B. Capability catalog

Build one local catalog from:
- Agent adapters: Claude Code, Codex, OpenCode, Pi, OMP, JCode, Kilo and future CLIs.
- Provider deployments: provider, base URL, model, key-slot reference, context window, max output, tool/JSON support, latency/cost profile, rate limits and health.
- Skills: valid `SKILL.md` frontmatter, description, triggers, body path, allowed tools, version/hash and source.
- Commands, hooks, MCP tools, scripts and gates: typed input/output schemas, execution mode, permission class, timeout and evidence contract.
- Workspace resources: indexed files, symbols, docs, git status, tests and project instructions.

Discovery should be incremental and observable. Never execute a skill or hook merely because it was discovered.

### C. Deterministic retrieval and plan compilation

Use a hybrid pipeline:
1. Hard filters: permission, caller credential scope, workspace access, provider compatibility, health, cooldown, context limit and budget.
2. Lexical retrieval: SQLite FTS5/BM25 over skill metadata, command descriptions, hook metadata, docs and workspace symbol/file summaries.
3. Optional semantic retrieval: local embeddings only when available and beneficial; never required for core correctness.
4. Deterministic reranking: exact identifiers, phrase matches, task category, skill triggers, recency and source authority. Stable tie-break by catalog ID.
5. Planner proposal: structured JSON task DAG from a model, with bounded schema repair.
6. Compiler validation: all referenced capabilities exist; permissions are sufficient; dependencies are acyclic; every task has an output contract and gate; resource budgets are bounded.
7. Receipt: hash prompt/context/catalog/policy/plan, record selected capabilities, alternatives, exclusions and why.

Small models should propose structure, not own safety policy. A deterministic validator must reject invalid plans and can request one bounded repair or fall back to a conservative single-task plan.

### D. Task DAG and scheduler

Each task should include:
- Stable task ID and parent plan ID.
- Objective, scope, expected artifact and acceptance criteria.
- Dependencies and parallelism group.
- Selected skills, tools, commands, hooks and retrieval references.
- Worker capability requirements and forbidden capabilities.
- Context/token/time/cost budget.
- Workspace/file ownership and write permissions.
- Gate contract, retry policy and escalation condition.

Scheduler order: ready tasks first; filter hard constraints; score eligible workers using task-fit, model quality tier, remaining context, health, latency, cost, current concurrency and historical success. Use deterministic tie-breaking. Never let a score override a hard policy constraint.

Run independent tasks concurrently only when their file/data scopes do not conflict. Use isolated worktrees or declared artifact boundaries for write tasks. Merge through an explicit integration task.

### E. Small-model-first intelligence

The goal is not to pretend a small model equals Claude or Codex. The goal is to reduce the reasoning burden and give smaller models better inputs and tighter loops.

- Use deterministic rules and retrieval before spending tokens.
- Route planning to a cheap model only when the prompt is genuinely complex; use a compact schema and a small planning context.
- Give each worker a focused task packet, not the entire conversation or repository.
- Retrieve exact relevant files/symbols and include short source excerpts with stable references.
- Prefer tools, parsers, tests and scripts for factual/deterministic operations.
- Use bounded loops: plan → execute → validate → one repair → escalate.
- Validate structured output locally; never trust free-form claims that work is complete.
- Escalate only the uncertain/high-risk subtask to a stronger model, preserving already verified work.
- Cache retrieval and reusable intermediate artifacts by content hash.
- Track success by task category/model/skill combination to improve routing from evidence, not intuition.

### F. Durable execution and receipts

Persist plan, tasks, attempts, leases, events and gate results in SQLite. Use an append-only event log as the audit trail and materialized state for fast snapshots. Store no raw key values. Record key-slot identifiers only. Add startup reconciliation for process liveness and interrupted tasks, idempotency keys for external side effects, retry budgets, timeout policy and cancellation propagation.

A receipt must explain: what was requested, how it was decomposed, which skills/tools were selected, which context was retrieved, what was excluded and why, which workers were eligible, why the selected worker won, what actually ran, what gates passed, and what remains unverified.

## 4. Competitor map and product positioning

This is a category comparison, not a benchmark ranking. The products solve adjacent but different layers.

| Project | Strongest primitive | What Lingonberry should learn | Where Lingonberry can differentiate |
|---|---|---|---|
| [LiteLLM](https://docs.litellm.ai/docs/router/learn/concepts) | Model/provider gateway: deployments, load balancing, retries, fallbacks, cooldowns, budgets | Failure taxonomy, deployment groups, health-aware selection, explicit retry/fallback ownership | Local CLI caller identity, skill/workspace discovery, task DAG, process control and local UI |
| [OpenRouter](https://openrouter.ai/docs) | Hosted model catalog and unified API | Provider/model breadth and normalized model metadata | Local execution and agent-harness orchestration |
| [Portkey](https://portkey.ai/docs) | AI gateway, policies, observability and routing | Governance, traces and provider abstraction | Local-first agent and workspace execution |
| [LangGraph](https://langchain-ai.github.io/langgraph/) | Stateful graph runtime with checkpointing and interrupts | Explicit state graph, durable checkpoints, resumability and human approval | Rust-native local runtime, automatic machine discovery and cross-CLI control plane |
| [CrewAI](https://docs.crewai.com/) | Role/task teams and event-driven Flows | Clear task contracts, delegation and flow lifecycle | Lower-level capability routing and OS/process ownership |
| [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/) | Agents plus workflow orchestration | Typed workflows, middleware and observability | Small local daemon, cross-provider key pool and local CLI adapters |
| [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/) | Agent handoffs, tools and guardrails | Small, composable handoff and guardrail primitives | Cross-vendor workers, local skills and deterministic scheduling |
| [Google ADK](https://google.github.io/adk-docs/) | Agent hierarchy and workflow agents | Explicit sequential/parallel/loop workflows | Local-first unified execution across heterogeneous CLIs |
| [MCP](https://modelcontextprotocol.io/) | Interoperability protocol for tools/resources/prompts | Keep MCP as an adapter and discovery surface | MCP is not the orchestration engine; Lingonberry owns policy, planning and execution |
| [Temporal](https://docs.temporal.io/) | Durable workflow execution | Retry, timer, replay and recovery semantics | Lightweight local-first use case; adopt concepts before adding a service dependency |
| Claude Code / Codex / OpenCode | Deep single-agent execution loops | Delegate focused tasks to the best native harness instead of reimplementing their coding loop | Shared cross-agent planning, capability registry, budgets, evidence and visibility |

**Positioning:** LiteLLM-class provider routing + LangGraph-style explicit task state + local agent-harness adapters + a deterministic capability/retrieval compiler. Do not try to outbuild all four categories at once.

## 5. Prioritized implementation roadmap

### Phase 0 — Security and truth (blocker)
- Enforce worker eligibility after overrides; never trust a caller-selected worker ID.
- Add trusted caller identity and credential scopes; prove non-owner CLI/MCP/HTTP calls cannot spend owner keys.
- Make fanout use the same authorization and scheduling path.
- Separate `not_run`, `passed`, `failed`, `skipped` and `unverified` gates.
- Add run-level HTTP security tests, including Host/Origin variations and key-spend sentinels.

**Exit:** all authorization regression tests pass; no route can spend a key outside its caller scope; no gate reports passed without execution.

### Phase 1 — Capability catalog and deterministic retrieval
- Parse recursive skill directories and YAML frontmatter robustly.
- Index skill descriptions, commands, hooks, MCP tool schemas and workspace file/symbol summaries into SQLite FTS5.
- Return ranked results with source paths, hashes and match explanations.
- Support selecting multiple skills and capabilities with conflict/permission checks.
- Add catalog version/hash to receipts.

**Exit:** a golden suite selects the right skills/capabilities for single- and multi-domain prompts with explainable stable results.

### Phase 2 — Planner and DAG
- Add `plan` CLI/API/MCP operation returning validated JSON DAG.
- Implement task schema, dependencies, artifact contracts, budgets and gates.
- Add model-assisted decomposition with schema validation, repair cap and deterministic fallback.
- Preserve prompt source spans and task-to-source provenance.

**Exit:** long multi-topic benchmark prompts produce complete non-overlapping task graphs with dependency edges and no dropped requirements.

### Phase 3 — Durable scheduler and execution
- Schedule ready tasks by capability, health, load, latency, cost and policy.
- Run independent tasks in parallel with bounded concurrency.
- Add task-level leases, checkpoints, retry/fallback classes, cancellation and restart reconciliation.
- Add worktree/artifact isolation and explicit integration task.

**Exit:** kill/restart/retry tests recover without duplicate side effects or orphaned leases.

### Phase 4 — Evidence gates and quality
- Implement actual test/build/lint/security/schema/source-grounding gate adapters.
- Persist artifacts and gate evidence.
- Add independent reviewer/verifier only for high-risk or uncertain work.
- Require human approval for destructive or externally visible actions.

**Exit:** final status is computed from evidence, not model assertions.

### Phase 5 — Orchestration graph and operator UX
- Model graph edges from actual run/task events.
- Horizontal graph: caller cards vertically stacked left, router in the center, actual workers vertically stacked right.
- Distinct caller colors; show provider/model/key slot on the worker edge or detail.
- Active path only; idle state shows only the router icon.
- Click a node/edge to inspect task, receipt, skill, context, attempts and gate evidence.

**Exit:** visual graph agrees with event log for parallel, retry, failover and completed runs.

## 6. Evaluation suite

Build a local, deterministic golden dataset before optimizing prompts or models. Include:
- Multi-topic prompt with research + code changes + tests + security review.
- Long document with headings, tables and references; verify no dropped source spans.
- Ambiguous prompt where the planner must ask one clarification or abstain.
- Conflicting skills and mutually exclusive hooks.
- Worker unavailable, key cooling, 429, timeout, context-window and truncated-output failures.
- Non-owner caller attempts to force an owner-key worker.
- Parallel write tasks with overlapping file ownership.
- Restart during a leased/running task and cancellation during child process execution.

Measure:
- Requirement coverage and dropped-requirement rate.
- Task decomposition precision/recall and dependency correctness.
- Skill/capability top-k precision.
- Route feasibility and policy violations (target zero).
- Gate correctness and evidence completeness.
- End-to-end success, retries, recovery and duplicate side effects.
- Input/output tokens, latency and estimated cost by model tier.
- Small-model completion rate versus a frontier-model baseline on the same tasks.

Do not publish a claim that smaller models match frontier models unless the benchmark supports it. The target is better task success per unit cost through retrieval, decomposition, tools and verification.

## 7. Architectural rules

1. **Policy is deterministic; reasoning is advisory.** Models may propose intent and plans; Rust validates permissions, schemas, budgets and DAGs.
2. **No fake work.** A selected skill, hook, command or gate must either execute or be explicitly marked not executed.
3. **No hidden credential escalation.** Caller scope follows every task and retry.
4. **No giant shared prompt.** Each subtask receives the smallest sufficient context packet.
5. **No opaque routing.** Every exclusion and selection has a stable reason code.
6. **No premature framework migration.** Keep the Rust core; adopt proven algorithms and protocol adapters.
7. **No unbounded autonomy.** Every loop has depth, time, token, retry and cost limits.

## 8. Immediate next engineering tickets

1. **SEC-01:** enforce route-receipt eligibility for worker overrides and fanout; add non-owner key isolation regression tests.
2. **GATE-01:** make gate execution real and distinguish evidence status from model output.
3. **CAP-01:** recursive skill/capability catalog + FTS5 retrieval.
4. **PLAN-01:** schema-first multi-topic planner and DAG validator.
5. **EXEC-01:** durable task scheduler, checkpoints and recovery.
6. **UI-01:** event-accurate caller → router → worker graph.

**Recommended first implementation:** SEC-01, followed by GATE-01. Do not add planner autonomy on top of a bypassable credential boundary or misleading completion status.
