import AppKit
import Foundation

extension PopoverViewController {

    func makeTelemetryStrip(_ snap: Snapshot) -> NSView {
        let total = max(1, snap.overview.completed24h + snap.overview.failed24h)
        let successPct = Int(Double(snap.overview.completed24h) / Double(total) * 100.0)
        let activeKeys = snap.workers.filter { $0.status == "active" || $0.status == "idle" }.count

        let container = NSView()
        container.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 8

        // Stat row
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 12
        row.alignment = .centerY

        let items: [(String, String, NSColor)] = [
            ("running", "\(snap.overview.running)", NSColor.systemBlue),
            ("avg", String(format: "%.1fs", snap.overview.avgDurationS ?? 0.0), NSColor.labelColor),
            ("keys", "\(activeKeys)/\(snap.workers.count)", NSColor.labelColor),
            ("cron", "\(snap.cronLive.count)", NSColor.labelColor),
        ]
        for (label, value, color) in items {
            row.addArrangedSubview(makeStatItem(label, value, color: color))
        }

        let spacer = NSView()
        row.addArrangedSubview(spacer)

        let successItem = makeStatItem("success", "\(successPct)%", color: NSColor.systemGreen)
        row.addArrangedSubview(successItem)

        stack.addArrangedSubview(row)

        // Progress bar
        let bar = NSView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.heightAnchor.constraint(equalToConstant: 3).isActive = true

        let passRatio = CGFloat(snap.overview.completed24h) / CGFloat(total)
        let failRatio = CGFloat(snap.overview.failed24h) / CGFloat(total)

        let passBar = NSView()
        passBar.wantsLayer = true
        passBar.layer?.backgroundColor = NSColor.systemGreen.cgColor
        let failBar = NSView()
        failBar.wantsLayer = true
        failBar.layer?.backgroundColor = NSColor.systemOrange.cgColor

        bar.addSubview(passBar)
        bar.addSubview(failBar)

        passBar.translatesAutoresizingMaskIntoConstraints = false
        failBar.translatesAutoresizingMaskIntoConstraints = false
        passBar.leadingAnchor.constraint(equalTo: bar.leadingAnchor).isActive = true
        passBar.topAnchor.constraint(equalTo: bar.topAnchor).isActive = true
        passBar.bottomAnchor.constraint(equalTo: bar.bottomAnchor).isActive = true
        passBar.widthAnchor.constraint(equalTo: bar.widthAnchor, multiplier: passRatio).isActive = true

        failBar.leadingAnchor.constraint(equalTo: passBar.trailingAnchor).isActive = true
        failBar.topAnchor.constraint(equalTo: bar.topAnchor).isActive = true
        failBar.bottomAnchor.constraint(equalTo: bar.bottomAnchor).isActive = true
        failBar.widthAnchor.constraint(equalTo: bar.widthAnchor, multiplier: failRatio).isActive = true

        stack.addArrangedSubview(bar)

        container.addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.leadingAnchor.constraint(equalTo: container.leadingAnchor).isActive = true
        stack.trailingAnchor.constraint(equalTo: container.trailingAnchor).isActive = true
        stack.topAnchor.constraint(equalTo: container.topAnchor).isActive = true
        stack.bottomAnchor.constraint(equalTo: container.bottomAnchor).isActive = true

        return container
    }

    private func makeStatItem(_ label: String, _ value: String, color: NSColor) -> NSView {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 1
        stack.alignment = .leading

        let l = makeLabel(label, size: 9, weight: .regular)
        l.textColor = NSColor.tertiaryLabelColor
        stack.addArrangedSubview(l)

        let v = makeLabel(value, size: 11, weight: .medium)
        v.textColor = color
        stack.addArrangedSubview(v)

        return stack
    }

    func makeLabel(_ text: String, size: CGFloat, weight: NSFont.Weight) -> NSTextField {
        let f = NSTextField(labelWithString: text)
        f.font = NSFont.monospacedDigitSystemFont(ofSize: size, weight: weight)
        f.isEditable = false
        f.isSelectable = false
        f.drawsBackground = false
        return f
    }
}
