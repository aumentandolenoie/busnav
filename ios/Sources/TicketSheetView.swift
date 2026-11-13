import UIKit

/// Small card over the driving map: Linea, Salita, Discesa and "Classe X = € Y a bordo".
/// It is only a subview, so GPS, voice and the camera keep running underneath.
final class TicketSheetView: UIVisualEffectView {
    private let data: TicketData
    private(set) var line: Int
    private(set) var from: Int?
    private(set) var to: Int?
    var onClose: (() -> Void)?

    private let lineButton = UIButton(type: .system)
    private let fromButton = UIButton(type: .system)
    private let toButton = UIButton(type: .system)
    private let result = UILabel()

    init(data: TicketData) {
        self.data = data
        line = data.suggested.first ?? -1
        super.init(effect: UIBlurEffect(style: .systemMaterial))
        translatesAutoresizingMaskIntoConstraints = false
        layer.cornerRadius = 22; clipsToBounds = true
        accessibilityIdentifier = "ticketSheet"
        accessibilityViewIsModal = false

        let title = UILabel(); title.text = "Biglietto a bordo"; title.font = .systemFont(ofSize: 17, weight: .bold)
        let close = UIButton(type: .system)
        close.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal); close.tintColor = .secondaryLabel
        close.accessibilityLabel = "Chiudi calcolo biglietto"; close.accessibilityIdentifier = "ticketClose"
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        close.widthAnchor.constraint(equalToConstant: 44).isActive = true
        close.heightAnchor.constraint(equalToConstant: 44).isActive = true
        let head = UIStackView(arrangedSubviews: [title, UIView(), close]); head.alignment = .center

        result.font = .systemFont(ofSize: 22, weight: .heavy); result.numberOfLines = 0
        result.accessibilityIdentifier = "ticketResult"
        let note = UILabel(); note.text = "Prezzi a bordo, corsa semplice · polimetriche Busitalia 10/2024"
        note.font = .systemFont(ofSize: 11); note.textColor = .secondaryLabel; note.numberOfLines = 0

        let stack = UIStackView(arrangedSubviews: [head,
            row("Linea", lineButton, id: "ticketLine"), row("Salita", fromButton, id: "ticketFrom"),
            row("Discesa", toButton, id: "ticketTo"), result, note])
        stack.axis = .vertical; stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        // Scrolls when the screen is short or the text is very large.
        let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = false
        contentView.addSubview(scroll); scroll.addSubview(stack)
        let natural = scroll.heightAnchor.constraint(equalTo: stack.heightAnchor); natural.priority = UILayoutPriority(740)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 8),
            scroll.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -14),
            scroll.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 14),
            scroll.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor), natural
        ])
        render()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func row(_ name: String, _ button: UIButton, id: String) -> UIView {
        let label = UILabel(); label.text = name; label.font = .systemFont(ofSize: 13, weight: .bold); label.textColor = .secondaryLabel
        label.widthAnchor.constraint(equalToConstant: 62).isActive = true
        var config = UIButton.Configuration.gray()
        config.titleLineBreakMode = .byTruncatingTail
        config.titleAlignment = .leading
        config.baseForegroundColor = .label
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 10)
        button.configuration = config
        button.contentHorizontalAlignment = .leading
        button.showsMenuAsPrimaryAction = true
        button.accessibilityIdentifier = id
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        let stack = UIStackView(arrangedSubviews: [label, button]); stack.spacing = 8; stack.alignment = .center
        return stack
    }

    /// The boarding stop follows the bus each time the sheet is opened.
    func suggestBoarding(latitude: Double, longitude: Double) {
        guard let near = data.nearestStop(line: line, latitude: latitude, longitude: longitude) else { return }
        from = near
        if to == near { to = nil }
        render()
    }

    private func setTitle(_ button: UIButton, _ text: String) {
        var config = button.configuration
        config?.title = text
        button.configuration = config
    }

    private func render() {
        let lines = data.lines
        setTitle(lineButton, lines.indices.contains(line) ? lines[line].label : "Scegli la linea")
        func lineAction(_ i: Int) -> UIAction {
            UIAction(title: lines[i].label, state: i == line ? .on : .off) { [weak self] _ in
                guard let self else { return }
                self.line = i; self.from = nil; self.to = nil
                self.onLineChange?()
                self.render()
            }
        }
        var sections: [UIMenuElement] = []
        if !data.suggested.isEmpty {
            sections.append(UIMenu(title: "Linea in corso", options: .displayInline, children: data.suggested.map(lineAction)))
            sections.append(UIMenu(title: "Altre linee", options: .displayInline, children: data.otherLines.map(lineAction)))
        } else {
            sections = lines.indices.map(lineAction)
        }
        lineButton.menu = UIMenu(title: "Linea della polimetrica", children: sections)

        let stops = lines.indices.contains(line) ? lines[line].stops : []
        for (button, current, isFrom) in [(fromButton, from, true), (toButton, to, false)] {
            button.isEnabled = !stops.isEmpty
            let name = current.flatMap { stops.indices.contains($0) ? "\($0 + 1) · \(stops[$0].name)" : nil }
            setTitle(button, name ?? (stops.isEmpty ? "—" : isFrom ? "Scegli la salita" : "Scegli la discesa"))
            button.menu = stops.isEmpty ? nil : UIMenu(title: isFrom ? "Salita" : "Discesa", children: stops.indices.map { i in
                UIAction(title: "\(i + 1) · \(stops[i].name)", state: i == current ? .on : .off) { [weak self] _ in
                    if isFrom { self?.from = i } else { self?.to = i }
                    self?.render()
                }
            })
        }

        var text = "", priced = false
        if data.isEmpty { text = "Polimetriche non disponibili" }
        else if !lines.indices.contains(line) { text = "Scegli la linea della polimetrica" }
        else if from == nil { text = "Scegli la salita" }
        else if to == nil { text = "Scegli la discesa" }
        else if let from, let to {
            text = data.fareText(line: line, from: from, to: to) ?? (data.labels[""] ?? "")
            priced = (data.code(line: line, from: from, to: to) ?? "") != ""
        }
        result.text = text
        result.font = .systemFont(ofSize: priced ? 22 : 16, weight: priced ? .heavy : .semibold)
        result.textColor = priced ? UIColor(red: 0.04, green: 0.43, blue: 0.31, alpha: 1) : .secondaryLabel
        result.accessibilityValue = text
    }

    /// Lets the owner re-suggest the boarding stop for the newly chosen line.
    var onLineChange: (() -> Void)?

    @objc private func closeTapped() { onClose?() }

    /// For tests and VoiceOver checks: what the sheet shows now.
    var resultText: String { result.text ?? "" }
    var boardingTitle: String { fromButton.configuration?.title ?? "" }
    /// Same effect as picking the items in the menus.
    func choose(line: Int? = nil, from: Int? = nil, to: Int? = nil) {
        if let line, data.lines.indices.contains(line) { self.line = line; self.from = nil; self.to = nil }
        if let from { self.from = from }
        if let to { self.to = to }
        render()
    }

    /// Calculator glyph shared with the bottom-left button.
    static func calculatorImage(side: CGFloat = 26, color: UIColor) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { _ in
            let s = side / 24
            color.setStroke(); color.setFill()
            let body = UIBezierPath(roundedRect: CGRect(x: 5 * s, y: 2.8 * s, width: 14 * s, height: 18.4 * s), cornerRadius: 2.6 * s)
            body.lineWidth = 1.9 * s; body.stroke()
            UIBezierPath(roundedRect: CGRect(x: 7.8 * s, y: 5.6 * s, width: 8.4 * s, height: 3.6 * s), cornerRadius: 0.8 * s).fill()
            for y in [12.6, 15.6, 18.4] {
                for x in [8.6, 12.0, 15.4] {
                    UIBezierPath(ovalIn: CGRect(x: (x - 1.15) * s, y: (y - 1.15) * s, width: 2.3 * s, height: 2.3 * s)).fill()
                }
            }
        }.withRenderingMode(.alwaysTemplate)
    }
}
