import AppKit
import Foundation

extension PopoverViewController {

    func makeFooterBar(_ snap: Snapshot) -> NSView {
        let bar = NSView()
        bar.wantsLayer = true
        bar.layer?.backgroundColor = NSColor.windowBackgroundColor.blended(withFraction: 0.03, of: NSColor.black)!.cgColor
        bar.layer?.cornerRadius = 8
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.heightAnchor.constraint(equalToConstant: 34).isActive = true

        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 10
        row.alignment = .centerY

        let left = makeLabel("~/.lingonberry/router.json · 127.0.0.1:8799", size: 10, weight: .regular)
        left.textColor = NSColor.secondaryLabelColor
        row.addArrangedSubview(left)

        row.addArrangedSubview(NSView())

        let ram = makeLabel("mem: \(String(format: "%.1f", snap.system.ramUsedGb ?? 0)) GB", size: 10, weight: .regular)
        ram.textColor = NSColor.secondaryLabelColor
        row.addArrangedSubview(ram)

        let status = makeLabel(snap.router.up ? "daemon online" : "offline", size: 10, weight: .regular)
        status.textColor = snap.router.up ? NSColor.systemGreen : NSColor.systemRed
        row.addArrangedSubview(status)

        bar.addSubview(row)
        row.translatesAutoresizingMaskIntoConstraints = false
        row.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 14).isActive = true
        bar.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: 14).isActive = true
        row.centerYAnchor.constraint(equalTo: bar.centerYAnchor).isActive = true

        return bar
    }
}
