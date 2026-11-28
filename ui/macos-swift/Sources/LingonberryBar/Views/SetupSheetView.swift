import SwiftUI

struct SetupPanelView: View {
    @ObservedObject var store: RouterStore
    @Environment(\.colorScheme) private var colorScheme

    // Keychain add form
    @State private var provider: String = "nim"
    @State private var label: String = "default"
    @State private var apiKey: String = ""
    @State private var costTier: String = "free_tier"
    @State private var baseUrl: String = ""
    @State private var model: String = ""
    @State private var rpmLimitText: String = "30"

    // Self-config target selection
    @State private var selectedTargets: Set<String> = []
    @State private var didSeedTargets: Bool = false

    // Overnight & Kiro Spec form
    @State private var budgetUsdText: String = "0"
    @State private var maxRunsText: String = "5"
    @State private var didSeedOvernight: Bool = false
    @State private var specTitle: String = ""
    @State private var specGoal: String = ""
    @State private var specGlobs: String = "core/src/**"
    @State private var specGate: String = "test"
    @State private var specSandbox: String = "docker"

    private var theme: ThemePalette { ThemePalette(colorScheme: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Top bar
            HStack(spacing: 8) {
                Button(action: { store.showSetup = false }) {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 10, weight: .semibold))
                        Text("Back")
                            .font(mono(10.5, .medium))
                    }
                    .foregroundStyle(theme.text)
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .background(theme.card2)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(theme.border))
                }
                .buttonStyle(.plain)
                .focusable(false)

                Text("Setup & Safety")
                    .font(mono(12, .semibold))
                    .foregroundStyle(theme.text)

                Spacer()

                ForEach(SetupTab.allCases) { tab in
                    Button(action: { store.setupTab = tab }) {
                        Text(tab.rawValue)
                            .font(mono(10, store.setupTab == tab ? .semibold : .regular))
                            .foregroundStyle(store.setupTab == tab ? theme.card : theme.textMuted)
                            .padding(.horizontal, 9)
                            .frame(height: 24)
                            .background(store.setupTab == tab ? theme.accent : theme.card2)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)
                    .focusable(false)
                }
            }

            if let err = store.actionError {
                Text(err)
                    .font(mono(10))
                    .foregroundStyle(theme.err)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.err.opacity(0.10))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            } else if let ok = store.actionNotice {
                Text(ok)
                    .font(mono(10))
                    .foregroundStyle(theme.ok)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.ok.opacity(0.10))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            switch store.setupTab {
            case .keys:
                keysTab
            case .selfConfig:
                selfConfigTab
            case .overnight:
                overnightTab
            }
        }
        .padding(14)
        .onAppear {
            Task { await store.loadSetupDetails() }
            seedFormDefaults()
        }
    }

    private func seedFormDefaults() {
        if !didSeedTargets, let targets = store.selfConfigPlan?.targets {
            selectedTargets = Set(targets.map { $0.path })
            didSeedTargets = true
        }
        if !didSeedOvernight, let ov = store.overnight {
            budgetUsdText = String(format: "%.0f", ov.nightly_budget_usd)
            maxRunsText = "\(ov.max_runs_per_night)"
            didSeedOvernight = true
        }
    }

    // MARK: - Tab 1: Keychain & Providers

    private var keysTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Add Key to macOS Keychain")
                    .font(mono(11, .semibold))
                    .foregroundStyle(theme.textMuted)

                HStack(spacing: 8) {
                    Picker("Provider", selection: $provider) {
                        Text("nim (free)").tag("nim")
                        Text("groq (free)").tag("groq")
                        Text("google (free)").tag("google")
                        Text("openrouter").tag("openrouter")
                        Text("openai (paid)").tag("openai")
                        Text("anthropic (paid)").tag("anthropic")
                        Text("custom").tag("custom")
                    }
                    .labelsHidden()
                    .frame(width: 140)
                    .onChange(of: provider) { _, newVal in
                        if newVal == "openai" || newVal == "anthropic" {
                            costTier = "metered_paid"
                        } else if newVal == "ollama" {
                            costTier = "local"
                        } else {
                            costTier = "free_tier"
                        }
                    }

                    Picker("Tier", selection: $costTier) {
                        Text("free_tier").tag("free_tier")
                        Text("local").tag("local")
                        Text("metered_paid").tag("metered_paid")
                    }
                    .labelsHidden()
                    .frame(width: 120)

                    TextField("label (e.g. main)", text: $label)
                        .textFieldStyle(.roundedBorder)
                        .font(mono(10.5))

                    TextField("rpm", text: $rpmLimitText)
                        .textFieldStyle(.roundedBorder)
                        .font(mono(10.5))
                        .frame(width: 58)
                }

                HStack(spacing: 8) {
                    SecureField("Paste API key (stored encrypted in macOS Keychain)", text: $apiKey)
                        .textFieldStyle(.roundedBorder)
                        .font(mono(10.5))

                    Button(action: {
                        Task {
                            let rpm = Int(rpmLimitText.trimmingCharacters(in: .whitespaces))
                            let ok = await store.addKeychainKey(
                                provider: provider,
                                label: label,
                                apiKey: apiKey,
                                costTier: costTier,
                                baseUrl: baseUrl.isEmpty ? nil : baseUrl,
                                model: model.isEmpty ? nil : model,
                                rpmLimit: rpm
                            )
                            if ok { apiKey = "" }
                        }
                    }) {
                        Text(store.isBusyAction ? "Verifying…" : "Verify & Save")
                            .font(mono(10.5, .medium))
                            .foregroundStyle(theme.card)
                            .padding(.horizontal, 12)
                            .frame(height: 26)
                            .background(apiKey.trimmingCharacters(in: .whitespaces).isEmpty ? theme.textDim : theme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)
                    .disabled(store.isBusyAction || apiKey.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                HStack(spacing: 8) {
                    TextField("Optional base_url (required for custom)", text: $baseUrl)
                        .textFieldStyle(.roundedBorder)
                        .font(mono(10))
                    TextField("Optional default model", text: $model)
                        .textFieldStyle(.roundedBorder)
                        .font(mono(10))
                }
            }
            .padding(12)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Discovered & Keychain Slots")
                        .font(mono(11, .semibold))
                        .foregroundStyle(theme.textMuted)
                    Spacer()
                    Text("\(store.workers.count) total")
                        .font(mono(9.5))
                        .foregroundStyle(theme.textDim)
                }

                if store.workers.isEmpty {
                    Text("No API keys configured yet. Add a free NVIDIA NIM, Groq, or Google AI Studio key above, or start Ollama locally.")
                        .font(mono(10))
                        .foregroundStyle(theme.textDim)
                } else {
                    ForEach(store.workers) { slot in
                        HStack(spacing: 8) {
                            Circle()
                                .fill(slot.isCooling ? theme.warn : theme.ok)
                                .frame(width: 6, height: 6)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(slot.name)
                                    .font(mono(10.5, .medium))
                                    .foregroundStyle(theme.text)
                                Text("\(slot.provider ?? "other") · \(slot.cost_tier ?? "free_tier") · \(slot.rpm_limit) rpm")
                                    .font(mono(9.5))
                                    .foregroundStyle(theme.textDim)
                            }
                            Spacer()
                            if slot.isCooling {
                                Button("Reset") {
                                    Task { await store.resetKeyCooldown(slot.name) }
                                }
                                .buttonStyle(.plain)
                                .font(mono(9.5, .medium))
                                .foregroundStyle(theme.warn)
                            }
                            Button("Test") {
                                Task { await store.testKeySlot(slot.name) }
                            }
                            .buttonStyle(.plain)
                            .font(mono(9.5, .medium))
                            .foregroundStyle(theme.text)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(theme.card2)
                            .clipShape(RoundedRectangle(cornerRadius: 5))

                            if slot.name.hasPrefix("kc:") {
                                Button("Remove") {
                                    Task { await store.deleteKeySlot(slot.name) }
                                }
                                .buttonStyle(.plain)
                                .font(mono(9.5, .medium))
                                .foregroundStyle(theme.err)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(theme.err.opacity(0.10))
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                            }
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(theme.card2)
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                    }
                }
            }
            .padding(12)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))
        }
    }

    // MARK: - Tab 2: Self-Config & pi-rust

    private var selfConfigTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Readiness & pi-rust card
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Execution Layer & Readiness")
                        .font(mono(11, .semibold))
                        .foregroundStyle(theme.textMuted)
                    Spacer()
                    if let mode = store.readiness?.mode {
                        Text(mode)
                            .font(mono(9.5, .semibold))
                            .foregroundStyle(mode == "full" ? theme.ok : theme.warn)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(theme.card2)
                            .clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                }

                if let r = store.readiness {
                    HStack(spacing: 16) {
                        statusPill("pi-rust", r.pi_installed ? "ready" : "missing", r.pi_installed ? theme.ok : theme.warn)
                        statusPill("mini-harness", r.mini_harness_ready ? "seeded" : "missing", r.mini_harness_ready ? theme.ok : theme.warn)
                        statusPill("agents", "\(r.agents_count)", theme.text)
                        statusPill("free keys", "\(r.free_keys_count)", r.free_keys_count > 0 ? theme.ok : theme.warn)
                        statusPill("skills", "\(r.external_skills_count)", theme.text)
                    }

                    HStack(spacing: 8) {
                        if !r.pi_installed {
                            Button(action: { Task { await store.installPiRust() } }) {
                                Text(store.isBusyAction ? "Installing pi-rust…" : "Install pi-rust")
                                    .font(mono(10.5, .medium))
                                    .foregroundStyle(theme.card)
                                    .padding(.horizontal, 12)
                                    .frame(height: 26)
                                    .background(theme.accent)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                            .disabled(store.isBusyAction)
                        }

                        Button(action: { Task { await store.rescanAll() } }) {
                            Text("Rescan Machine")
                                .font(mono(10.5, .medium))
                                .foregroundStyle(theme.text)
                                .padding(.horizontal, 10)
                                .frame(height: 26)
                                .background(theme.card2)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(theme.border))
                        }
                        .buttonStyle(.plain)
                        .disabled(store.isBusyAction)
                    }

                    ForEach(r.recommendations, id: \.self) { rec in
                        Text("• \(rec)")
                            .font(mono(9.5))
                            .foregroundStyle(theme.textMuted)
                    }
                }
            }
            .padding(12)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))

            // Light global pointers
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Global-First Agent Pointers")
                        .font(mono(11, .semibold))
                        .foregroundStyle(theme.textMuted)
                    Spacer()
                    if let plan = store.selfConfigPlan {
                        Button("Apply Selected") {
                            let chosen = selectedTargets.isEmpty
                                ? plan.targets.map { $0.path }
                                : Array(selectedTargets)
                            Task { await store.applySelfConfig(targets: chosen) }
                        }
                        .buttonStyle(.plain)
                        .font(mono(10, .medium))
                        .foregroundStyle(theme.card)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(theme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .disabled(store.isBusyAction)
                    }
                }

                if let plan = store.selfConfigPlan {
                    Text("Root: \(plan.preferred_root) · \(plan.strategy)")
                        .font(mono(9.5))
                        .foregroundStyle(theme.textDim)
                    ForEach(plan.targets) { t in
                        let isSelected = selectedTargets.contains(t.path) || (!didSeedTargets)
                        HStack(spacing: 8) {
                            Button(action: {
                                if !didSeedTargets {
                                    selectedTargets = Set(plan.targets.map { $0.path })
                                    didSeedTargets = true
                                }
                                if selectedTargets.contains(t.path) {
                                    selectedTargets.remove(t.path)
                                } else {
                                    selectedTargets.insert(t.path)
                                }
                            }) {
                                Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                                    .foregroundStyle(isSelected ? theme.accent : theme.textDim)
                            }
                            .buttonStyle(.plain)

                            VStack(alignment: .leading, spacing: 1) {
                                Text("\(t.target) (\(t.scope))")
                                    .font(mono(10, .medium))
                                    .foregroundStyle(theme.text)
                                Text(t.path)
                                    .font(mono(9))
                                    .foregroundStyle(theme.textDim)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            Spacer()
                            Text(t.status)
                                .font(mono(9.5, .medium))
                                .foregroundStyle(t.status == "applied" ? theme.ok : theme.warn)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(theme.card2)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                } else {
                    Text("Loading self-configuration plan…")
                        .font(mono(10))
                        .foregroundStyle(theme.textDim)
                }
            }
            .padding(12)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))

            if let gw = store.gateway {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Zero-Hosting Channel Gateway & Shared Memory")
                            .font(mono(11, .semibold))
                            .foregroundStyle(theme.textMuted)
                        Spacer()
                        Text("\(gw.entries_count) memory notes")
                            .font(mono(9.5))
                            .foregroundStyle(theme.textDim)
                    }
                    ForEach(gw.channels) { ch in
                        HStack(spacing: 8) {
                            Circle()
                                .fill(ch.connected ? theme.ok : theme.textDim)
                                .frame(width: 5, height: 5)
                            Text(ch.label)
                                .font(mono(10, .medium))
                                .foregroundStyle(theme.text)
                            Text(ch.transport)
                                .font(mono(9))
                                .foregroundStyle(theme.textDim)
                            Spacer()
                            Text(ch.connected ? "connected" : "standby")
                                .font(mono(9, .medium))
                                .foregroundStyle(ch.connected ? theme.ok : theme.textDim)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(theme.card2)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                }
                .padding(12)
                .background(theme.card)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))
            }
        }
    }

    // MARK: - Tab 3: Overnight & Safety

    private var overnightTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Overnight Proposal Queue (Owner Approval Required)")
                        .font(mono(11, .semibold))
                        .foregroundStyle(theme.textMuted)
                    Spacer()
                    let enabled = store.overnight?.enabled ?? false
                    Button(enabled ? "Enabled" : "Off") {
                        Task {
                            await store.toggleOvernight(
                                enabled: !enabled,
                                budgetUsd: Double(budgetUsdText) ?? 0,
                                maxRuns: Int(maxRunsText) ?? 5
                            )
                        }
                    }
                    .buttonStyle(.plain)
                    .font(mono(10, .semibold))
                    .foregroundStyle(enabled ? theme.card : theme.text)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(enabled ? theme.ok : theme.card2)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }

                HStack(spacing: 8) {
                    Text("Max paid $/night:")
                        .font(mono(9.5))
                        .foregroundStyle(theme.textDim)
                    TextField("0", text: $budgetUsdText)
                        .textFieldStyle(.roundedBorder)
                        .font(mono(10))
                        .frame(width: 56)

                    Text("Max runs:")
                        .font(mono(9.5))
                        .foregroundStyle(theme.textDim)
                    TextField("5", text: $maxRunsText)
                        .textFieldStyle(.roundedBorder)
                        .font(mono(10))
                        .frame(width: 48)

                    Button("Save Policy") {
                        Task {
                            await store.toggleOvernight(
                                enabled: store.overnight?.enabled ?? false,
                                budgetUsd: Double(budgetUsdText) ?? 0,
                                maxRuns: Int(maxRunsText) ?? 5
                            )
                        }
                    }
                    .buttonStyle(.plain)
                    .font(mono(9.5, .medium))
                    .foregroundStyle(theme.text)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(theme.card2)
                    .clipShape(RoundedRectangle(cornerRadius: 6))

                    Spacer()

                    Button("Scan Repos") {
                        Task { await store.scanOvernightProposals() }
                    }
                    .buttonStyle(.plain)
                    .font(mono(10, .medium))
                    .foregroundStyle(theme.card)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(theme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .disabled(store.isBusyAction)
                }

                if let ov = store.overnight {
                    Text("Tonight: \(ov.runs_tonight)/\(ov.max_runs_per_night) runs · mode: \(ov.free_only ? "free-tier & local only" : String(format: "up to $%.2f", ov.nightly_budget_usd))")
                        .font(mono(9.5))
                        .foregroundStyle(theme.textDim)
                }
            }
            .padding(12)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))

            VStack(alignment: .leading, spacing: 6) {
                Text("Proposed & Recent Tickets")
                    .font(mono(11, .semibold))
                    .foregroundStyle(theme.textMuted)
                let tickets = store.overnight?.tickets ?? []
                if tickets.isEmpty {
                    Text("No overnight tickets queued. Click Scan Repos to propose isolated worktree checks.")
                        .font(mono(10))
                        .foregroundStyle(theme.textDim)
                } else {
                    ForEach(tickets.prefix(12)) { ticket in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(spacing: 6) {
                                Text(ticket.status)
                                    .font(mono(9, .semibold))
                                    .foregroundStyle(ticket.status == "done" ? theme.ok : (ticket.status == "pending_approval" ? theme.warn : theme.textMuted))
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 2)
                                    .background(theme.card)
                                    .clipShape(RoundedRectangle(cornerRadius: 4))
                                Text(ticket.title)
                                    .font(mono(10.5, .medium))
                                    .foregroundStyle(theme.text)
                                    .lineLimit(1)
                                Spacer()
                                Text(ticket.cost_tier)
                                    .font(mono(9))
                                    .foregroundStyle(theme.textDim)
                            }
                            Text(ticket.prompt)
                                .font(mono(9.5))
                                .foregroundStyle(theme.textMuted)
                                .lineLimit(2)
                            if let summary = ticket.summary, !summary.isEmpty {
                                Text(summary)
                                    .font(mono(9))
                                    .foregroundStyle(theme.textDim)
                                    .lineLimit(2)
                            }
                            if ticket.status == "pending_approval" {
                                HStack(spacing: 8) {
                                    Button("Approve (Free · Worktree)") {
                                        Task { await store.approveTicket(id: ticket.id, allowPaid: false) }
                                    }
                                    .buttonStyle(.plain)
                                    .font(mono(9.5, .medium))
                                    .foregroundStyle(theme.card)
                                    .padding(.horizontal, 9)
                                    .padding(.vertical, 4)
                                    .background(theme.ok)
                                    .clipShape(RoundedRectangle(cornerRadius: 5))

                                    Button("Defer") {
                                        Task { await store.deferTicket(id: ticket.id) }
                                    }
                                    .buttonStyle(.plain)
                                    .font(mono(9.5, .medium))
                                    .foregroundStyle(theme.textMuted)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(theme.card)
                                    .clipShape(RoundedRectangle(cornerRadius: 5))
                                }
                            }
                        }
                        .padding(8)
                        .background(theme.card2)
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                    }
                }
            }
            .padding(12)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))

            // Kiro Spec Lock
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Kiro Specs (SHA-256 Approved Scope)")
                        .font(mono(11, .semibold))
                        .foregroundStyle(theme.textMuted)
                    Spacer()
                    Text("\(store.specs.count) specs")
                        .font(mono(9.5))
                        .foregroundStyle(theme.textDim)
                }

                HStack(spacing: 8) {
                    TextField("Spec title", text: $specTitle)
                        .textFieldStyle(.roundedBorder)
                        .font(mono(10))
                    TextField("Allowed path globs", text: $specGlobs)
                        .textFieldStyle(.roundedBorder)
                        .font(mono(10))
                }
                HStack(spacing: 8) {
                    TextField("Goal & acceptance criteria", text: $specGoal)
                        .textFieldStyle(.roundedBorder)
                        .font(mono(10))
                    Picker("Sandbox", selection: $specSandbox) {
                        Text("docker").tag("docker")
                        Text("seatbelt").tag("seatbelt")
                    }
                    .labelsHidden()
                    .frame(width: 96)
                    Button("Draft Spec") {
                        let globs = specGlobs.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                        Task {
                            await store.createSpec(
                                title: specTitle,
                                goal: specGoal,
                                allowedPathGlobs: globs.isEmpty ? ["core/src/**"] : globs,
                                gateCmd: specGate,
                                sandboxTier: specSandbox,
                                maxBudgetUsd: Double(budgetUsdText) ?? 0
                            )
                            specTitle = ""
                            specGoal = ""
                        }
                    }
                    .buttonStyle(.plain)
                    .font(mono(9.5, .medium))
                    .foregroundStyle(theme.card)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(specTitle.isEmpty || specGoal.isEmpty ? theme.textDim : theme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                    .disabled(store.isBusyAction || specTitle.isEmpty || specGoal.isEmpty)
                }

                ForEach(store.specs.prefix(8)) { spec in
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(spec.title) (\(spec.status))")
                                .font(mono(10, .medium))
                                .foregroundStyle(theme.text)
                            Text("\(spec.sandbox_tier) · \(spec.allowed_path_globs.joined(separator: ", ")) · \(String(spec.sha256_digest.prefix(10)))")
                                .font(mono(9))
                                .foregroundStyle(theme.textDim)
                                .lineLimit(1)
                        }
                        Spacer()
                        if spec.status == "draft" {
                            Button("Sign & Approve") {
                                Task { await store.approveSpec(id: spec.spec_id) }
                            }
                            .buttonStyle(.plain)
                            .font(mono(9, .semibold))
                            .foregroundStyle(theme.card)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(theme.ok)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        } else if spec.status == "approved" {
                            Button("Run Spec") {
                                Task { await store.runSpec(id: spec.spec_id) }
                            }
                            .buttonStyle(.plain)
                            .font(mono(9, .semibold))
                            .foregroundStyle(theme.card)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(theme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                    }
                    .padding(7)
                    .background(theme.card2)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
            .padding(12)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.border))
        }
    }

    private func statusPill(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(mono(9))
                .foregroundStyle(theme.textDim)
            Text(value)
                .font(mono(10.5, .semibold))
                .foregroundStyle(color)
        }
    }
}
