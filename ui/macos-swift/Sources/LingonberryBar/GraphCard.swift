import AppKit
import Foundation

extension PopoverViewController {

    func makeOrchestrationCard(_ snap: Snapshot) -> NSView {
        let card = GraphCardView(snapshot: snap)
        card.translatesAutoresizingMaskIntoConstraints = false
        card.heightAnchor.constraint(equalToConstant: 200).isActive = true
        return card
    }

    private final class GraphCardView: NSView {
        let snapshot: Snapshot

        init(snapshot: Snapshot) {
            self.snapshot = snapshot
            super.init(frame: .zero)
            wantsLayer = true
        }

        required init?(coder: NSCoder) { fatalError() }

        override func draw(_ dirtyRect: NSRect) {
            super.draw(dirtyRect)

            // Background
            let bgPath = NSBezierPath(roundedRect: bounds, xRadius: 10, yRadius: 10)
            (NSColor.windowBackgroundColor.blended(withFraction: 0.03, of: NSColor.black)!).setFill()
            bgPath.fill()

            let border = NSBezierPath(roundedRect: bounds, xRadius: 10, yRadius: 10)
            NSColor.separatorColor.setStroke()
            border.lineWidth = 1
            border.stroke()

            let callers = Array(Set(snapshot.sessions.compactMap { $0.caller }))
            let workers = snapshot.workersLive

            // Title
            let titleAttr: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .semibold),
                .foregroundColor: NSColor.secondaryLabelColor,
            ]
            "ORCHESTRATION GRAPH".draw(at: NSPoint(x: 12, y: 12), withAttributes: titleAttr)

            let rightText = "\(snapshot.overview.liveWorkers) active · \(snapshot.jobs.count) jobs"
            let rightSize = rightText.size(withAttributes: titleAttr)
            rightText.draw(at: NSPoint(x: bounds.width - rightSize.width - 12, y: 12), withAttributes: titleAttr)

            // Layout positions
            let centerX = bounds.width / 2.0
            let centerY = bounds.height / 2.0 + 10
            let routerNodeSize: CGFloat = 52
            let routerRect = NSRect(x: centerX - routerNodeSize/2, y: centerY - routerNodeSize/2,
                                    width: routerNodeSize, height: routerNodeSize)

            // Draw cables first (behind nodes)
            for (idx, caller) in callers.enumerated() {
                let y = 35.0 + CGFloat(idx) * 55.0
                drawFiberCable(from: NSPoint(x: 40, y: y), to: NSPoint(x: centerX - routerNodeSize/2, y: centerY),
                               color: cableColor(for: caller))
            }
            for (idx, worker) in workers.enumerated() {
                let y = 35.0 + CGFloat(idx) * 55.0
                drawFiberCable(from: NSPoint(x: centerX + routerNodeSize/2, y: centerY),
                               to: NSPoint(x: bounds.width - 120, y: y),
                               color: cableColor(for: worker.worker))
            }

            // Draw callers (left)
            for (idx, caller) in callers.enumerated() {
                let y = 35.0 + CGFloat(idx) * 55.0
                drawNode(at: NSPoint(x: 40, y: y), label: caller, icon: callerIconFor(caller))
            }

            // Draw router (center, glowing)
            drawRouterNode(in: routerRect, active: snapshot.overview.running > 0)

            // Draw workers (right)
            for (idx, worker) in workers.enumerated() {
                let y = 35.0 + CGFloat(idx) * 55.0
                drawWorkerNode(at: NSPoint(x: bounds.width - 120, y: y), worker: worker)
            }
        }

        private func drawFiberCable(from start: NSPoint, to end: NSPoint, color: NSColor) {
            let path = NSBezierPath()
            path.move(to: start)
            let cp1 = NSPoint(x: start.x + 70, y: start.y)
            let cp2 = NSPoint(x: end.x - 70, y: end.y)
            path.curve(to: end, controlPoint1: cp1, controlPoint2: cp2)
            color.withSystemEffect(.pressed).setStroke()
            path.lineWidth = 2.5
            path.stroke()

            // Dash pattern effect
            let dashPath = NSBezierPath()
            dashPath.move(to: start)
            dashPath.curve(to: end, controlPoint1: cp1, controlPoint2: cp2)
            NSColor.white.withAlphaComponent(0.4).setStroke()
            dashPath.lineWidth = 1.5
            let dash: [CGFloat] = [6, 3]
            dashPath.setLineDash(dash, count: 2, phase: 0)
            dashPath.stroke()
        }

        private func drawNode(at point: NSPoint, label: String, icon: String) {
            let size: CGFloat = 52
            let rect = NSRect(x: point.x - size/2, y: point.y - size/2, width: size, height: size)
            let path = NSBezierPath(roundedRect: rect, xRadius: 8, yRadius: 8)
            NSColor.windowBackgroundColor.blended(withFraction: 0.05, of: NSColor.black)!.setFill()
            path.fill()
            NSColor.separatorColor.setStroke()
            path.lineWidth = 1.5
            path.stroke()

            // Icon
            let nsIcon = NSImage(systemSymbolName: icon, accessibilityDescription: nil)!
            nsIcon.size = NSSize(width: 16, height: 16)
            nsIcon.draw(in: NSRect(x: rect.midX - 8, y: rect.midY - 2, width: 16, height: 16))

            // Label
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .medium),
                .foregroundColor: NSColor.labelColor,
            ]
            let labelSize = label.size(withAttributes: attrs)
            label.draw(at: NSPoint(x: rect.midX - labelSize.width/2, y: rect.minY - 16), withAttributes: attrs)
        }

        private func drawRouterNode(in rect: NSRect, active: Bool) {
            // Outer glow
            if active {
                let glowPath = NSBezierPath(ovalIn: rect.insetBy(dx: -13, dy: -13))
                NSColor.systemBlue.withAlphaComponent(0.3).setFill()
                glowPath.fill()
            }

            let nodePath = NSBezierPath(ovalIn: rect)
            NSColor.windowBackgroundColor.blended(withFraction: 0.08, of: NSColor.black)!.setFill()
            nodePath.fill()

            let borderColor: NSColor = active ? NSColor.systemBlue : NSColor.separatorColor
            borderColor.setStroke()
            nodePath.lineWidth = active ? 2.5 : 1.5
            nodePath.stroke()

            // Icon
            let nsIcon = NSImage(systemSymbolName: "arrow.triangle.branch", accessibilityDescription: nil)!
            nsIcon.size = NSSize(width: 16, height: 16)
            nsIcon.draw(in: NSRect(x: rect.midX - 8, y: rect.midY - 2, width: 16, height: 16))

            // Label
            let labelAttrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 9, weight: .semibold),
                .foregroundColor: NSColor.labelColor,
            ]
            "Router".draw(at: NSPoint(x: rect.midX - 20, y: rect.minY - 16), withAttributes: labelAttrs)

            if active {
                let countAttrs: [NSAttributedString.Key: Any] = [
                    .font: NSFont.monospacedDigitSystemFont(ofSize: 8, weight: .regular),
                    .foregroundColor: NSColor.systemBlue,
                ]
                "\(snapshot.overview.running) dispatching".draw(at: NSPoint(x: rect.midX - 40, y: rect.minY - 26),
                                                               withAttributes: countAttrs)
            }
        }

        private func drawWorkerNode(at point: NSPoint, worker: LiveWorker) {
            let size = NSSize(width: 120, height: 44)
            let rect = NSRect(x: point.x - size.width/2, y: point.y - size.height/2,
                              width: size.width, height: size.height)
            let path = NSBezierPath(roundedRect: rect, xRadius: 8, yRadius: 8)
            NSColor.windowBackgroundColor.blended(withFraction: 0.05, of: NSColor.black)!.setFill()
            path.fill()
            NSColor.separatorColor.setStroke()
            path.lineWidth = 1.5
            path.stroke()

            // Status dot
            let dotColor: NSColor = worker.key == nil ? NSColor.secondaryLabelColor : NSColor.systemGreen
            let dotPath = NSBezierPath(ovalIn: NSRect(x: rect.minX + 10, y: rect.midY - 3.5, width: 7, height: 7))
            dotColor.setFill()
            dotPath.fill()

            // Worker name
            let nameAttrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .medium),
                .foregroundColor: NSColor.labelColor,
            ]
            worker.worker.draw(at: NSPoint(x: rect.minX + 24, y: rect.midY + 8), withAttributes: nameAttrs)

            // Key
            let keyAttrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 9, weight: .regular),
                .foregroundColor: NSColor.secondaryLabelColor,
            ]
            (worker.key ?? "local").draw(at: NSPoint(x: rect.minX + 24, y: rect.midY - 6), withAttributes: keyAttrs)
        }

        private func cableColor(for name: String) -> NSColor {
            switch name.lowercased() {
            case "claude": return NSColor.systemOrange
            case "codex": return NSColor.systemGreen
            case "opencode": return NSColor.systemBlue
            case "pi": return NSColor.systemPurple
            case "kilo": return NSColor.systemPink
            default: return NSColor.secondaryLabelColor
            }
        }
    }
}
