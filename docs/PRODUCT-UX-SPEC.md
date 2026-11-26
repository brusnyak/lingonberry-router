# Lingonberry Router — Product UX & Native App Specification

**Status:** Proposed product/design contract  
**Date:** 2026-11-26  
**Related:** [Ideal-state architecture](./IDEAL-STATE-ARCHITECTURE.md)  
**Design reference:** Stats-style information density and glanceability, adapted for agent orchestration—not a clone.

## 1. Product decision

Build **one coherent product with two presentation scales**:

1. **Menu-bar companion (macOS first):** fast glance, active orchestration, recent tasks, automation health and a few safe actions.
2. **Control Center window:** a detachable/expandable, persistent workspace for the full graph, task inspection, output, skills, providers, process details, logs and machine-wide automation.

Do not cram the full operator console into a fixed-height popover. The menu-bar surface should be useful in seconds; the Control Center should support sustained investigation.

### Platform strategy

- **Core:** Rust remains the source of truth for routing, discovery, process supervision, persistence, policy, scheduling and event history.
- **macOS shell:** SwiftUI + AppKit where needed. Native menu-bar presence, popover/window lifecycle, notifications, keyboard/accessibility and settings.
- **Cross-platform later:** keep platform UI adapters separate from the Rust core and define a stable, versioned local API/event contract now. Add native Windows and Linux shells when the shared contract and macOS UX are stable.
- **Existing web/Tauri UI:** treat it as an existing implementation to rationalize, not a second product to grow independently. Keep useful operator functionality during transition; choose one canonical macOS surface and avoid duplicate feature logic.

Apple provides SwiftUI `MenuBarExtra` with a window style for data-rich popover-like content; AppKit `NSStatusItem`/`NSPopover` remain available where custom lifecycle or detached-window behavior is needed. Prefer the native SwiftUI path first and introduce AppKit only for a demonstrated limitation.

## 2. Information architecture

### Menu-bar glance surface

Target: approximately 620–720 pt wide, height content-driven with a sensible maximum and internal scrolling. It should feel like a compact native utility, not a shrunken web dashboard.

Order:

1. **Header / status**
   - Lingonberry mark and daemon state.
   - Active task count, warning count and connection state.
   - Refresh/rescan only when useful; settings and open Control Center.
2. **Orchestration graph**
   - Compact horizontal caller → router → worker topology.
   - Callers stacked vertically on the left; router centered; actual workers stacked vertically on the right.
   - Show only currently active paths. Idle graph collapses to the router mark—no ghost callers or idle workers.
   - A small status caption may say “Idle” or “3 dispatches”; the graph itself remains router-only when idle.
3. **Active tasks**
   - One row per live task, showing caller, concise task title, worker, skill/capability, model/provider and elapsed time.
   - Selecting a task reveals a compact inspector with current stage, recent events and output preview.
   - Show task state explicitly: queued, planning, leased, running, retrying, waiting for approval, verifying, completed, failed or blocked.
4. **Automation**
   - Summary counts for Lingonberry jobs and other machine-discovered jobs.
   - Next scheduled run, last result and health warnings.
   - Selecting “All automations” opens the Control Center's Automation view.
5. **Recent activity**
   - Last few completed/failed tasks, with duration and expandable result summary.
   - Avoid dumping raw logs into the default view.

The popover must prioritize active work. If nothing is running, show the router-only graph, recent task summary, next automation and any actionable warnings—not an empty giant graph.

### Control Center window

Persistent, resizable, native-feeling workspace. Initial navigation:

- **Overview:** live graph, active tasks, system status and recent activity.
- **Tasks:** task list, plan/DAG, per-task inspector, output/artifacts, skill/tool trace, retries and verification.
- **Agents & Providers:** callers, workers, provider deployments, key-slot metadata, model capabilities, RPM/concurrency and health.
- **Automations:** Lingonberry jobs plus machine-wide scheduled jobs and active child processes.
- **Activity:** searchable event timeline and execution receipts.
- **Settings:** discovery roots, refresh policy, privacy, notifications, appearance, startup and platform integrations.

Use a sidebar or compact segmented navigation; don't turn every card into a separate page. Preserve a strong overview and make detail available on selection.

## 3. Graph specification

### Topology

```text
CALLERS                         ROUTER                    WORKERS
Claude Code  ── caller color ──▶                         ┌─ OMP · NIM · model
Codex        ── caller color ──▶  LINGONBERRY ROUTER ────┼─ Pi · Groq · model
OpenCode     ── caller color ──▶                         └─ JCode · model
                                                        Kilo · model
```

This is a visual layout guide, not permission to draw every possible edge. Only render observed dispatch relationships from event data.

### Graph rules

- Stable color per caller identity, with a restrained accessible palette. Never assign colors based on current list order.
- Worker/provider identity uses small recognizable marks/icons plus readable labels. Do not rely on color alone.
- Connection starts at the caller and ends at the actual selected worker. The router is the center node.
- Show provider, model and key-slot label in worker detail or selected edge metadata. Never expose key values or secrets.
- Distinguish planned route, queued, leased, running, retrying, failover, verifying, succeeded, failed and blocked.
- Animate only live transitions; respect Reduce Motion and stop animation for terminal states.
- Multiple concurrent tasks produce separate paths. Parallel tasks from one caller retain the caller's color but have distinct task markers.
- Clicking caller filters tasks; clicking an edge opens the dispatch receipt; clicking a worker opens its capability/provider detail; clicking router opens policy/plan detail.
- When idle, the graph renders only the router icon. No placeholder caller or worker nodes.
- On narrow layouts, preserve left/router/right semantics with a compact horizontal graph; never turn it into a misleading unconnected list.

### Required event fields

The UI must consume actual persisted events, not infer topology from the latest sessions:

`event_id, run_id, task_id, caller_id, worker_id, provider_id, model_id, key_slot_id, state, occurred_at, attempt, parent_task_id`

Optional fields: `route_reason, skill_ids, capability_ids, latency_ms, token_usage, cost_estimate, error_code, gate_status`.

If a field is unknown, show “unknown” or omit it. Do not fabricate a provider, model, skill or edge.

## 4. Task inspector and output

Selecting a task opens a detail panel with:

- **Request:** original user objective and caller.
- **Plan:** parent task, child tasks, dependencies and acceptance criteria.
- **Execution:** worker/agent, model, provider, key-slot label, process/PID if available, attempt number and elapsed time.
- **Capabilities:** selected skills, hooks, commands, MCP tools and retrieval references, with version/source and whether each was actually executed.
- **Context:** retrieved files/symbols, source spans and content hashes; hide secrets and sensitive environment values.
- **Output:** streaming preview while running, final artifact/result when complete, copy/open actions.
- **Verification:** named gates, command/evidence, exit status and result. Never show “verified” from a model assertion alone.
- **Timeline:** ordered events, retry/failover and human approvals.

Default task rows stay compact. The inspector carries the detail. Keep raw output collapsed unless requested.

## 5. Automation and machine-wide cron monitoring

This is a first-class product area, not just a cron card.

### Two distinct scopes

**Lingonberry-managed automations**
- Jobs created or supervised by Lingonberry.
- Show schedule, enabled/paused, next run, last run, last result, watchdog, restart count and logs.
- Allow run, pause/resume and heal only when the backend confirms the operation and permissions.

**Machine-discovered automations**
- Other scheduled work found on the host: macOS launchd and crontab first; future adapters for systemd timers and Windows Task Scheduler.
- Show source, owner/user context when available, schedule, executable/command summary, last/next run if discoverable, health and active process.
- Default to **read-only**. Do not silently take ownership, modify, pause or kill third-party jobs.
- Clearly distinguish “discovered” from “managed” and indicate source coverage / permission limitations. Never claim “all machine jobs” if discovery is partial.

### Active process monitor

For active child processes, show:
- job/automation name and source;
- PID and parent PID when known;
- runtime, CPU and memory if available;
- command summary with sensitive arguments redacted;
- stdout/stderr tail and last exit status;
- stop action only for processes Lingonberry owns or where the user explicitly confirms a supported OS-level action.

Use stable process identity and revalidate PID ownership before destructive actions. A stale PID must never be enough to kill a process.

## 6. Providers, keys and worker health

- Separate **caller/agent CLI**, **worker adapter**, **provider**, **model deployment** and **credential slot**. They are different entities.
- Show provider group and per-key-slot health, RPM/concurrency limits, cooldown, in-flight count and recent request outcomes.
- Show key-slot display names or short non-secret identifiers only. Never display, copy, log or send raw API keys to the UI.
- Make RPM limits editable only through an authorized backend action; show pending/saved/error states.
- Worker health should distinguish unavailable, idle, busy, cooling down, disabled and permission-blocked.
- Show why a worker was selected or excluded in its route receipt.

## 7. Visual design direction

### Character

- Calm, precise, premium developer utility.
- Information-dense but not cramped.
- Neutral graphite/soft system surfaces; one accent per caller; status colors reserved for state.
- Subtle borders, consistent 8/12/16 pt spacing, restrained corner radii and clear typography.
- Prefer native SF Symbols or carefully designed custom vector marks. Use official brand marks only where permitted and available; never invent inaccurate logos.
- Light, dark and system appearance. Strong contrast and accessible labels.
- No oversized hero card, excessive empty graph canvas, generic dashboard gradients, or decorative animations.

### Critique of supplied reference screenshot

Keep:
- clean light theme;
- clear section headings;
- visible provider/worker/automation categories;
- sessions as a useful activity feed;
- low visual noise.

Change:
- the screenshot is a broad web dashboard, not a menu-bar interaction model;
- the graph has too much empty space and its edges imply all-to-all routes rather than real dispatches;
- caller circles with initials are placeholders, not caller identity marks;
- worker nodes lack meaningful capability/provider hierarchy;
- workers/providers repeat the same facts in separate cards;
- sessions need task state, skill, worker/model and result preview;
- cron needs separate managed/discovered scopes and live process inspection;
- header controls (refresh/quit) are too prominent relative to monitoring and navigation;
- a fixed full-width graph is unsuitable for a compact menu-bar popover.

## 8. Native implementation boundaries

### SwiftUI shell

- Use `MenuBarExtra` with `.menuBarExtraStyle(.window)` for the initial macOS surface.
- Use a separate `WindowGroup` or managed AppKit window for the persistent Control Center. Support opening/detaching the detailed view without making the menu-bar popover itself enormous.
- Use AppKit `NSStatusItem`/`NSPopover` only if SwiftUI's menu-bar lifecycle or detached-window requirements prove insufficient.
- Use Swift concurrency and a single observable application store. Avoid multiple independent polling loops in individual views.
- Provide a typed API client with request timeouts, cancellation, error states and schema-version handling.
- Prefer server-sent events or a local event stream for live task transitions; use a modest snapshot refresh as a fallback, not multiple competing 2-second pollers.
- The UI must not own routing policy or schedule logic. It renders Rust-owned state and issues authorized commands.

### Rust core contract

Rust owns:
- discovery and inventory;
- task plans, DAG state and receipts;
- route decisions and capability registry;
- worker/provider/key-slot state;
- cron/job inventory and process ownership;
- event persistence and snapshots;
- authorization, confirmation and audit logging.

Expose stable typed DTOs and versioned endpoints/events. The UI must not parse arbitrary debug strings to infer state.

### Cross-platform path

Do not port the SwiftUI view tree directly. Reuse:
- Rust engine and data contracts;
- shared interaction/visual specifications;
- event names, state enums, accessibility labels and acceptance tests.

Implement thin native shells for each OS when justified. macOS first; Linux and Windows later. Do not add a cross-platform UI framework merely to claim portability before the product model is stable.

## 9. Performance, privacy and accessibility

- Idle UI should consume negligible CPU and avoid tight polling.
- No background embeddings or indexing work on the UI thread.
- Bound event history and virtualize long task/job lists.
- Cache snapshots; coalesce refreshes; cancel requests when views close.
- Bind to loopback only; use an explicit local authentication/authorization model for privileged actions.
- Redact API keys, tokens, sensitive command arguments and environment values in every view and log.
- Make machine-wide discovery opt-in/configurable by source and report incomplete coverage.
- Respect Reduce Motion, VoiceOver, keyboard navigation, Dynamic Type where applicable and light/dark contrast.

## 10. Acceptance criteria

### Menu-bar companion
- [ ] Opens quickly and remains responsive while the Rust daemon is busy.
- [ ] Idle graph shows only the router mark.
- [ ] Active graph shows only actual caller-to-worker dispatches.
- [ ] Caller colors remain stable between launches.
- [ ] Active task row identifies caller, task, skill/capability, worker, provider/model and elapsed time when known.
- [ ] Selecting a task shows output, timeline and evidence without opening a browser.
- [ ] Disconnected/daemon-down state is explicit and recoverable.
- [ ] No secrets appear in UI, logs, accessibility labels or copied diagnostics.

### Control Center
- [ ] Resizable window with Overview, Tasks, Agents & Providers, Automations, Activity and Settings.
- [ ] Graph interactions open the corresponding real entity/receipt.
- [ ] Search/filter works across tasks, workers and jobs.
- [ ] Task plan, attempts, outputs and verification are inspectable.
- [ ] Automation view separates Lingonberry-managed and machine-discovered jobs.
- [ ] Third-party machine jobs are read-only by default.
- [ ] Process stop revalidates ownership and asks for confirmation where needed.

### Truth and resilience
- [ ] UI graph matches event log under parallel runs, retry, failover and cancellation.
- [ ] Unknown fields are omitted or explicitly unknown, never guessed.
- [ ] Stale snapshot, API error and partial discovery states are visible.
- [ ] All destructive/privileged actions are authorized by Rust and audited.
- [ ] Tests cover idle/active graph, multiple callers, multiple workers, long labels, missing provider metadata, partial cron discovery and stale PIDs.

## 11. Delivery sequence

1. **UX-01 — Data contract:** define event/DTO schema for caller-task-worker-provider-skill-process-job relationships.
2. **UX-02 — Native shell consolidation:** designate SwiftUI as canonical macOS menu-bar app; inventory Tauri/web UI and prevent duplicate behavior.
3. **UX-03 — Graph:** actual event-driven horizontal graph, idle-router-only state and stable caller colors.
4. **UX-04 — Task inspector:** skill/agent/provider/model/output/timeline/evidence.
5. **UX-05 — Automation inventory:** managed vs discovered jobs, process monitor and safe controls.
6. **UX-06 — Control Center:** persistent window and navigation for deep inspection.
7. **UX-07 — Platform adapters:** Windows/Linux only after contract and macOS UX stabilize.

Do not begin by polishing every card. First fix the event model so the interface can tell the truth.

## 12. Existing implementation notes from repository review

At review time:
- `ui/macos-swift` already contains a SwiftUI `MenuBarExtra`, a 660 pt `PopoverView`, Codable snapshot models and a `RouterClient`.
- `PopoverView` currently shows a graph with the first three sessions' callers and first three workers, rather than actual caller-to-worker event edges. It shows only a small subset of sessions/jobs in the overview.
- The Swift client polls the snapshot every 2 seconds.
- `src/client/components/MenuBarGiga.tsx` is a separate React implementation of a 900 pt menu-bar-style dashboard.
- `tray/tauri.conf.json` defines a 780 × 660 Tauri popover window. This creates overlapping UI implementations that need a clear ownership decision.
- The existing SwiftUI UI is therefore a foundation, not a blank slate. Evolve it incrementally after the data contract is defined.

## References

- Apple SwiftUI MenuBarExtra: https://developer.apple.com/documentation/swiftui/menubarextra
- Apple MenuBarExtra window style: https://developer.apple.com/documentation/swiftui/menubarextrastyle/window
- Apple AppKit NSStatusItem: https://developer.apple.com/documentation/appkit/nsstatusitem
- Apple Human Interface Guidelines — Popovers: https://developer.apple.com/design/human-interface-guidelines/popovers
- Stats macOS menu-bar monitor (density/glanceability reference): https://github.com/exelban/stats
