import AppKit
import Foundation

final class PopoverViewController: NSViewController {
    let client: RouterClient

    private let scrollView = NSScrollView()
    private let contentView = NSView()
    private var contentStack: NSStackView!

    init(client: RouterClient) {
        self.client = client
        super.init(nibName: nil, bundle: nil)
        self.preferredContentSize = NSSize(width: 700, height: 620)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func loadView() {
        view = NSView()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        contentStack = NSStackView()
        contentStack.orientation = .vertical
        contentStack.spacing = 0
        contentStack.alignment = .leading

        scrollView.documentView = contentView
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = false

        contentView.addSubview(contentStack)
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        contentStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 14).isActive = true
        contentStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -14).isActive = true
        contentStack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 8).isActive = true
        contentStack.bottomAnchor.constraint(greaterThanOrEqualTo: contentView.bottomAnchor, constant: -8).isActive = true

        view.addSubview(scrollView)
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.topAnchor.constraint(equalTo: view.topAnchor).isActive = true
        scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor).isActive = true
        scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor).isActive = true
        scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor).isActive = true
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        rebuildUI()
    }

    func rebuildUI() {
        contentStack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        contentStack.addArrangedSubview(makeHeaderBar())
        contentStack.addArrangedSubview(makeDivider())

        guard let snap = client.snapshot else {
            let empty = makeEmptyState()
            contentStack.addArrangedSubview(empty)
            return
        }

        contentStack.addArrangedSubview(makeTelemetryStrip(snap))
        contentStack.addArrangedSubview(makeDivider())

        let tabPicker = makeTabPicker()
        contentStack.addArrangedSubview(tabPicker)

        contentStack.addArrangedSubview(makeOrchestrationCard(snap))
        contentStack.addArrangedSubview(makeSessionsAndWorkers(snap))
        contentStack.addArrangedSubview(makeFooterBar(snap))
    }

    private func makeTabPicker() -> NSSegmentedControl {
        let seg = NSSegmentedControl()
        seg.segmentCount = 2
        seg.setLabel("Overview", forSegment: 0)
        seg.setLabel("Cron", forSegment: 1)
        seg.selectedSegment = 0
        seg.segmentStyle = .texturedRounded
        seg.target = self
        seg.action = #selector(tabChanged(_:))
        seg.translatesAutoresizingMaskIntoConstraints = false
        seg.widthAnchor.constraint(equalToConstant: 200).isActive = true
        return seg
    }

    @objc private func tabChanged(_ seg: NSSegmentedControl) {
        rebuildUI()
    }

    @objc private func rescanClicked() {
        Task { await client.rescan() }
        rebuildUI()
    }

    @objc private func quitClicked() {
        client.stop()
        NSApplication.shared.terminate(nil)
    }

    private func makeDivider() -> NSView {
        let v = NSView()
        v.heightAnchor.constraint(equalToConstant: 1).isActive = true
        v.wantsLayer = true
        v.layer?.backgroundColor = NSColor.separatorColor.cgColor
        return v
    }

    private func makeEmptyState() -> NSView {
        let v = NSView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.heightAnchor.constraint(equalToConstant: 200).isActive = true

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 8

        let icon = NSImageView(image: NSImage(systemSymbolName: "wifi.slash", accessibilityDescription: nil)!)
        icon.contentTintColor = NSColor.secondaryLabelColor
        stack.addArrangedSubview(icon)

        let label = makeLabel("Waiting for lingonberry-core on 127.0.0.1:8799", size: 12, weight: .medium)
        stack.addArrangedSubview(label)

        let hint = makeLabel("Run `lingonberry-core serve` or click Rescan.", size: 11, weight: .regular)
        hint.textColor = NSColor.secondaryLabelColor
        stack.addArrangedSubview(hint)

        let retry = NSButton(title: "Retry Connection", target: self, action: #selector(rescanClicked))
        retry.bezelStyle = .rounded
        stack.addArrangedSubview(retry)

        v.addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.centerXAnchor.constraint(equalTo: v.centerXAnchor).isActive = true
        stack.centerYAnchor.constraint(equalTo: v.centerYAnchor).isActive = true

        return v
    }

    // MARK: - Free helper functions
    func callerIcon(for name: String) -> String {
        switch name.lowercased() {
        case "claude": return "c.circle.fill"
        case "codex": return "x.circle.fill"
        case "opencode": return "o.circle.fill"
        case "pi": return "pi.circle.fill"
        case "kilo": return "k.circle.fill"
        default: return "person.circle.fill"
        }
    }

    // Header bar — icon only on left, minimal right
    private func makeHeaderBar() -> NSView {
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 10
        row.alignment = .centerY

        let icon = NSImageView()
        icon.image = NSImage(named: "LingonberryIcon")
        icon.imageScaling = .scaleProportionallyUpOrDown
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.widthAnchor.constraint(equalToConstant: 36).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 36).isActive = true
        row.addArrangedSubview(icon)

        row.addArrangedSubview(NSView())

        let tabSeg = NSSegmentedControl()
        tabSeg.segmentCount = 2
        tabSeg.setLabel("Overview", forSegment: 0)
        tabSeg.setLabel("Cron", forSegment: 1)
        tabSeg.selectedSegment = 0
        tabSeg.segmentStyle = .texturedRounded
        tabSeg.target = self
        tabSeg.action = #selector(tabChanged(_:))
        tabSeg.translatesAutoresizingMaskIntoConstraints = false
        tabSeg.widthAnchor.constraint(equalToConstant: 200).isActive = true
        row.addArrangedSubview(tabSeg)

        row.addArrangedSubview(NSView())

        let rescanBtn = NSButton(title: "Rescan", target: self, action: #selector(rescanClicked))
        rescanBtn.bezelStyle = .shadowlessSquare
        rescanBtn.font = .systemFont(ofSize: 11, weight: .medium)
        row.addArrangedSubview(rescanBtn)

        let quitBtn = NSButton(title: "Quit", target: self, action: #selector(quitClicked))
        quitBtn.bezelStyle = .shadowlessSquare
        quitBtn.font = .systemFont(ofSize: 11, weight: .medium)
        quitBtn.contentTintColor = NSColor.systemRed
        row.addArrangedSubview(quitBtn)

        return row
    }
}

// MARK: - Free helper functions
func callerIconFor(_ name: String) -> String {
    switch name.lowercased() {
    case "claude": return "c.circle.fill"
    case "codex": return "x.circle.fill"
    case "opencode": return "o.circle.fill"
    case "pi": return "pi.circle.fill"
    case "kilo": return "k.circle.fill"
    default: return "person.circle.fill"
    }
}
