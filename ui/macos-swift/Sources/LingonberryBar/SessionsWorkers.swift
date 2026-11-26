import AppKit
import Foundation

extension PopoverViewController {

    func makeSessionsAndWorkers(_ snap: Snapshot) -> NSView {
        let container = NSView()
        container.translatesAutoresizingMaskIntoConstraints = false

        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 12
        row.alignment = .top

        // Sessions (left)
        let sessionsPanel = makeSessionsPanel(snap)
        row.addArrangedSubview(sessionsPanel)

        // Workers (right)
        let workersPanel = makeWorkersPanel(snap)
        row.addArrangedSubview(workersPanel)

        container.addSubview(row)
        row.translatesAutoresizingMaskIntoConstraints = false
        row.leadingAnchor.constraint(equalTo: container.leadingAnchor).isActive = true
        row.trailingAnchor.constraint(equalTo: container.trailingAnchor).isActive = true
        row.topAnchor.constraint(equalTo: container.topAnchor).isActive = true

        return container
    }

    private func makeSessionsPanel(_ snap: Snapshot) -> NSView {
        let panel = NSView()
        panel.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 8

        // Header
        let header = NSStackView()
        header.orientation = .horizontal
        header.spacing = 4
        header.alignment = .centerY

        let title = makeLabel("SESSIONS / TRACES", size: 10, weight: .semibold)
        title.textColor = NSColor.secondaryLabelColor
        header.addArrangedSubview(title)

        header.addArrangedSubview(NSView())

        let count = makeLabel("\(snap.sessions.count) total", size: 10, weight: .regular)
        count.textColor = NSColor.secondaryLabelColor
        header.addArrangedSubview(count)

        stack.addArrangedSubview(header)

        // Session rows
        let sessionsStack = NSStackView()
        sessionsStack.orientation = .vertical
        sessionsStack.spacing = 6

        for s in snap.sessions.prefix(6) {
            sessionsStack.addArrangedSubview(makeSessionRow(s, snap: snap))
        }

        stack.addArrangedSubview(sessionsStack)

        panel.addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.leadingAnchor.constraint(equalTo: panel.leadingAnchor).isActive = true
        stack.trailingAnchor.constraint(equalTo: panel.trailingAnchor).isActive = true
        stack.topAnchor.constraint(equalTo: panel.topAnchor).isActive = true
        stack.bottomAnchor.constraint(equalTo: panel.bottomAnchor).isActive = true

        return panel
    }

    private func makeSessionRow(_ s: SessionRow, snap: Snapshot) -> NSView {
        let card = NSView()
        card.wantsLayer = true
        card.layer?.backgroundColor = NSColor.windowBackgroundColor.blended(withFraction: 0.05, of: NSColor.black)!.cgColor
        card.layer?.cornerRadius = 8
        card.layer?.borderWidth = 1
        card.layer?.borderColor = NSColor.separatorColor.cgColor
        card.translatesAutoresizingMaskIntoConstraints = false
        card.heightAnchor.constraint(greaterThanOrEqualToConstant: 60).isActive = true

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 4
        card.addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 8).isActive = true
        stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -8).isActive = true
        stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 6).isActive = true
        stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -6).isActive = true

        // Top row: status dot, prompt, worker/key/duration
        let topRow = NSStackView()
        topRow.orientation = .horizontal
        topRow.spacing = 8
        topRow.alignment = .centerY

        let dot = NSView()
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 3
        let stateColor: NSColor = s.state == "done" ? NSColor.systemGreen :
            s.state == "running" ? NSColor.systemBlue : NSColor.systemOrange
        dot.layer?.backgroundColor = stateColor.cgColor
        dot.widthAnchor.constraint(equalToConstant: 6).isActive = true
        dot.heightAnchor.constraint(equalToConstant: 6).isActive = true
        topRow.addArrangedSubview(dot)

        let prompt = makeLabel(s.prompt, size: 11, weight: .medium)
        prompt.lineBreakMode = .byTruncatingTail
        prompt.maximumNumberOfLines = 1
        topRow.addArrangedSubview(prompt)

        topRow.addArrangedSubview(NSView())

        let meta = NSStackView()
        meta.orientation = .horizontal
        meta.spacing = 4
        meta.alignment = .centerY

        let workerIcon = callerIcon(for: s.worker)
        let wIcon = NSImageView(image: NSImage(systemSymbolName: workerIcon, accessibilityDescription: nil)!)
        wIcon.contentTintColor = NSColor.secondaryLabelColor
        wIcon.translatesAutoresizingMaskIntoConstraints = false
        wIcon.widthAnchor.constraint(equalToConstant: 10).isActive = true
        wIcon.heightAnchor.constraint(equalToConstant: 10).isActive = true
        meta.addArrangedSubview(wIcon)

        let wName = makeLabel(s.worker, size: 9.5, weight: .regular)
        wName.textColor = NSColor.secondaryLabelColor
        meta.addArrangedSubview(wName)

        if let key = s.key {
            let kLabel = makeLabel(key, size: 9.5, weight: .regular)
            kLabel.textColor = NSColor.secondaryLabelColor
            meta.addArrangedSubview(kLabel)
        }

        let dur = makeLabel(String(format: "%.1fs", s.durationS), size: 9.5, weight: .regular)
        dur.textColor = NSColor.secondaryLabelColor
        meta.addArrangedSubview(dur)

        topRow.addArrangedSubview(meta)

        stack.addArrangedSubview(topRow)

        // Expanded detail (always show compact version)
        let detailStack = NSStackView()
        detailStack.orientation = .vertical
        detailStack.spacing = 4

        // Skill/hook/gate chips
        let chipsRow = NSStackView()
        chipsRow.orientation = .horizontal
        chipsRow.spacing = 6

        chipsRow.addArrangedSubview(makeChip("Skill: context-retrieval", color: NSColor.systemBlue))
        chipsRow.addArrangedSubview(makeChip("Hook: grounding", color: NSColor.systemGreen))
        chipsRow.addArrangedSubview(makeChip("Gate: passed", color: NSColor.systemGreen))
        chipsRow.addArrangedSubview(NSView())

        detailStack.addArrangedSubview(chipsRow)

        // Output
        let outputLabel = makeLabel("OUTPUT", size: 9, weight: .semibold)
        outputLabel.textColor = NSColor.tertiaryLabelColor
        detailStack.addArrangedSubview(outputLabel)

        let output = makeLabel(s.output ?? "working…", size: 10, weight: .regular)
        output.textColor = s.state == "done" ? NSColor.systemGreen : NSColor.secondaryLabelColor
        output.lineBreakMode = .byWordWrapping
        output.maximumNumberOfLines = 3
        output.wantsLayer = true
        output.layer?.backgroundColor = NSColor.windowBackgroundColor.blended(withFraction: 0.08, of: NSColor.black)!.cgColor
        output.layer?.cornerRadius = 6
        output.translatesAutoresizingMaskIntoConstraints = false
        output.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        detailStack.addArrangedSubview(output)

        stack.addArrangedSubview(detailStack)

        return card
    }

    private func makeChip(_ text: String, color: NSColor) -> NSView {
        let label = makeLabel(text, size: 9, weight: .medium)
        label.textColor = color
        label.translatesAutoresizingMaskIntoConstraints = false
        label.heightAnchor.constraint(equalToConstant: 20).isActive = true

        let container = NSView()
        container.addSubview(label)
        label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 6).isActive = true
        container.trailingAnchor.constraint(equalTo: label.trailingAnchor, constant: 6).isActive = true
        label.centerYAnchor.constraint(equalTo: container.centerYAnchor).isActive = true
        container.wantsLayer = true
        container.layer?.backgroundColor = color.withAlphaComponent(0.12).cgColor
        container.layer?.cornerRadius = 6
        return container
    }

    private func makeWorkersPanel(_ snap: Snapshot) -> NSView {
        let panel = NSView()
        panel.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 8

        let header = NSStackView()
        header.orientation = .horizontal
        header.spacing = 4
        header.alignment = .centerY

        let title = makeLabel("WORKER SLOTS", size: 10, weight: .semibold)
        title.textColor = NSColor.secondaryLabelColor
        header.addArrangedSubview(title)

        header.addArrangedSubview(NSView())

        let count = makeLabel("\(snap.workersLive.count) running", size: 10, weight: .regular)
        count.textColor = NSColor.secondaryLabelColor
        header.addArrangedSubview(count)

        stack.addArrangedSubview(header)

        let workersStack = NSStackView()
        workersStack.orientation = .vertical
        workersStack.spacing = 6

        if snap.workersLive.isEmpty {
            let empty = makeLabel("Idle — waiting for dispatch", size: 11, weight: .regular)
            empty.textColor = NSColor.secondaryLabelColor
            empty.translatesAutoresizingMaskIntoConstraints = false
            empty.heightAnchor.constraint(equalToConstant: 44).isActive = true
            empty.wantsLayer = true
            empty.layer?.backgroundColor = NSColor.windowBackgroundColor.blended(withFraction: 0.05, of: NSColor.black)!.cgColor
            empty.layer?.cornerRadius = 8
            workersStack.addArrangedSubview(empty)
        } else {
            for w in snap.workersLive {
                workersStack.addArrangedSubview(makeWorkerSlotRow(w))
            }
        }

        stack.addArrangedSubview(workersStack)

        panel.addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.leadingAnchor.constraint(equalTo: panel.leadingAnchor).isActive = true
        stack.trailingAnchor.constraint(equalTo: panel.trailingAnchor).isActive = true
        stack.topAnchor.constraint(equalTo: panel.topAnchor).isActive = true
        stack.bottomAnchor.constraint(equalTo: panel.bottomAnchor).isActive = true

        return panel
    }

    private func makeWorkerSlotRow(_ w: LiveWorker) -> NSView {
        let card = NSView()
        card.wantsLayer = true
        card.layer?.backgroundColor = NSColor.windowBackgroundColor.blended(withFraction: 0.05, of: NSColor.black)!.cgColor
        card.layer?.cornerRadius = 8
        card.translatesAutoresizingMaskIntoConstraints = false
        card.heightAnchor.constraint(equalToConstant: 52).isActive = true

        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 8
        row.alignment = .centerY
        card.addSubview(row)
        row.translatesAutoresizingMaskIntoConstraints = false
        row.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 8).isActive = true
        row.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -8).isActive = true
        row.centerYAnchor.constraint(equalTo: card.centerYAnchor).isActive = true

        let dot = NSView()
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 3
        dot.layer?.backgroundColor = NSColor.systemGreen.cgColor
        dot.widthAnchor.constraint(equalToConstant: 6).isActive = true
        dot.heightAnchor.constraint(equalToConstant: 6).isActive = true
        row.addArrangedSubview(dot)

        let name = makeLabel(w.worker, size: 10.5, weight: .medium)
        row.addArrangedSubview(name)

        let meta = makeLabel("pid \(w.pid) · \(w.key ?? "local")", size: 9, weight: .regular)
        meta.textColor = NSColor.secondaryLabelColor
        row.addArrangedSubview(meta)

        row.addArrangedSubview(NSView())

        let killBtn = NSButton(title: "Kill", target: self, action: #selector(killWorkerClicked(_:)))
        killBtn.bezelStyle = .rounded
        killBtn.font = .systemFont(ofSize: 10, weight: .regular)
        killBtn.tag = Int(w.pid)
        killBtn.translatesAutoresizingMaskIntoConstraints = false
        killBtn.widthAnchor.constraint(equalToConstant: 44).isActive = true
        row.addArrangedSubview(killBtn)

        return card
    }

    @objc private func killWorkerClicked(_ sender: NSButton) {
        let pid = UInt32(sender.tag)
        Task { await client.killWorker(pid: pid) }
        rebuildUI()
    }
}
