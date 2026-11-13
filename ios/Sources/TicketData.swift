import Foundation

/// On-board ticket calculator: Busitalia Padova polimetriche (fares/polimetriche-padova.json).
/// The web layer sends the data with the route; the rules match tickets.js.
/// fares[i][j] (j <= i) is a code such as "C3", "TU2" or "" and labels[code] the text to show.
struct TicketData: Decodable {
    struct Stop {
        let name: String
        let latitude: Double?
        let longitude: Double?
    }
    struct Line: Decodable {
        let code: String
        let title: String
        let stops: [Stop]
        let fares: [[String]]
        var label: String { "\(code) · \(title)" }

        private enum Keys: String, CodingKey { case code, title, stops, fares }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            code = try c.decode(String.self, forKey: .code)
            title = try c.decode(String.self, forKey: .title)
            fares = try c.decode([[String]].self, forKey: .fares)
            // Each stop is [name] or [name, latitude, longitude].
            var list = try c.nestedUnkeyedContainer(forKey: .stops)
            var stops: [Stop] = []
            while !list.isAtEnd {
                var item = try list.nestedUnkeyedContainer()
                let name = try item.decode(String.self)
                var lat: Double?, lon: Double?
                if !item.isAtEnd { lat = try item.decode(Double.self) }
                if !item.isAtEnd { lon = try item.decode(Double.self) }
                stops.append(Stop(name: name, latitude: lat, longitude: lon))
            }
            self.stops = stops
        }
    }

    /// Boarding is suggested only when a fare node is this close to the bus.
    static let nearestLimit = 6000.0

    let labels: [String: String]
    /// How to sell a fare on board (e.g. which tickets to combine); optional.
    let notes: [String: String]
    let lines: [Line]
    let suggested: [Int]

    private enum Keys: String, CodingKey { case labels, notes, lines, suggested }
    init(from decoder: Decoder) throws {
        // Bad ticket data must never block navigation: it only disables the calculator.
        if let parts = try? Self.parts(decoder) {
            labels = parts.labels; notes = parts.notes; lines = parts.lines
            suggested = parts.suggested.filter { parts.lines.indices.contains($0) }
        } else {
            labels = [:]; notes = [:]; lines = []; suggested = []
        }
    }
    private static func parts(_ decoder: Decoder) throws -> (labels: [String: String], notes: [String: String], lines: [Line], suggested: [Int]) {
        let c = try decoder.container(keyedBy: Keys.self)
        return (try c.decode([String: String].self, forKey: .labels),
                (try? c.decodeIfPresent([String: String].self, forKey: .notes)) ?? [:],
                try c.decode([Line].self, forKey: .lines),
                try c.decodeIfPresent([Int].self, forKey: .suggested) ?? [])
    }

    init(labels: [String: String], notes: [String: String] = [:], lines: [Line], suggested: [Int]) {
        self.labels = labels; self.notes = notes; self.lines = lines
        self.suggested = suggested.filter { lines.indices.contains($0) }
    }

    /// The Academy route being driven, used to suggest its polimetrica.
    struct RouteInfo: Decodable {
        let category: String?
        let line: String?
        let name: String?
        /// Lines named by the Academy evidence (indicators, duty sheets), e.g. for market-day detours.
        let aliases: [String]?
    }

    /// Data sent by the web layer; if missing, the copy bundled in the app. The line is
    /// suggested here too when the web layer could not do it. Same rules as tickets.js.
    static func resolve(sent: TicketData?, route: RouteInfo?, bundle: Bundle = .main) -> TicketData? {
        var data = sent
        if data?.isEmpty ?? true,
           let url = bundle.resourceURL?.appendingPathComponent("Web/fares/polimetriche-padova.json"),
           let raw = try? Data(contentsOf: url) {
            data = try? JSONDecoder().decode(TicketData.self, from: raw)
        }
        guard let data, !data.isEmpty else { return nil }
        guard data.suggested.isEmpty, let route else { return data }
        return TicketData(labels: data.labels, notes: data.notes, lines: data.lines,
                          suggested: suggestedLines(data.lines, category: route.category ?? "", line: route.line ?? "",
                                                    name: route.name ?? "", aliases: route.aliases ?? []))
    }

    private static let aliases = ["TD": ["T", "TL"], "AB": ["A", "AT"], "MLA": ["M"]]
    /// Polimetrica lines for an Academy route, best first (indexes into `lines`).
    static func suggestedLines(_ lines: [Line], category: String, line: String, name: String, aliases evidence: [String] = []) -> [Int] {
        if category.lowercased().hasPrefix("urban") { return [] }
        let code = line.trimmingCharacters(in: .whitespaces).uppercased()
        let all = lines.map(\.code)
        var codes: [String] = []
        if (1...3).contains(code.count), code.allSatisfy({ $0.isASCII && $0.isNumber }) {
            let base = "E" + String(repeating: "0", count: 3 - code.count) + code
            codes = all.filter { c in
                c == base || (c.hasPrefix(base) && c.count == base.count + 1 && c.last.map { $0.isASCII && $0.isUppercase } == true)
            }
            // Line 19 also has the separate E019A polimetrica for the Liceo Galilei trips.
            if name.uppercased().range(of: #"LICEO\s+GALI"#, options: .regularExpression) != nil {
                codes = codes.filter { $0 != base } + codes.filter { $0 == base }
            }
        } else if all.contains(code) {
            codes = [code]
        } else if let alias = aliases[code] {
            codes = alias.filter { all.contains($0) }
        }
        // Lines without a number of their own (Deviazioni mercatali…): the Academy evidence.
        if codes.isEmpty { codes = evidence.compactMap { polimetricaCode($0, in: all) } }
        var seen = Set<String>()
        return codes.filter { seen.insert($0).inserted }.compactMap { all.firstIndex(of: $0) }
    }

    /// GTFS/Academy code → polimetrica code: E005V → E005, E0092 → E009, EA → A.
    static func polimetricaCode(_ raw: String, in all: [String]) -> String? {
        let c = raw.trimmingCharacters(in: .whitespaces).uppercased()
        if all.contains(c) { return c }
        if c.count >= 4, c.hasPrefix("E"), c.dropFirst().prefix(3).allSatisfy({ $0.isASCII && $0.isNumber }) {
            let base = String(c.prefix(4))
            if all.contains(base) { return base }
        }
        if c.count >= 2, c.hasPrefix("E"), c.dropFirst().allSatisfy({ $0.isASCII && $0.isLetter }), all.contains(String(c.dropFirst())) {
            return String(c.dropFirst())
        }
        return nil
    }

    var isEmpty: Bool { lines.isEmpty }
    /// Suggested lines first, then all the others.
    var otherLines: [Int] { lines.indices.filter { !suggested.contains($0) } }

    /// Fare code between two stops of a line, in either order; nil if out of range.
    func code(line: Int, from: Int, to: Int) -> String? {
        guard lines.indices.contains(line) else { return nil }
        let l = lines[line]
        guard l.stops.indices.contains(from), l.stops.indices.contains(to),
              l.fares.indices.contains(max(from, to)) else { return nil }
        let row = l.fares[max(from, to)]
        return row.indices.contains(min(from, to)) ? row[min(from, to)] : nil
    }

    /// "Classe 3 = € 4,00 a bordo", or the "not in the polimetrica" text.
    func fareText(line: Int, from: Int, to: Int) -> String? {
        guard let code = code(line: line, from: from, to: to) else { return nil }
        return labels[code] ?? labels[""]
    }

    /// How to sell that fare on board, or "" when there is nothing to add.
    func fareNote(line: Int, from: Int, to: Int) -> String {
        code(line: line, from: from, to: to).flatMap { notes[$0] } ?? ""
    }

    /// Nearest fare node with a known position, if within `limit` metres.
    func nearestStop(line: Int, latitude: Double, longitude: Double, limit: Double = nearestLimit) -> Int? {
        guard lines.indices.contains(line), latitude.isFinite, longitude.isFinite else { return nil }
        var best: (index: Int, distance: Double)?
        for (i, stop) in lines[line].stops.enumerated() {
            guard let lat = stop.latitude, let lon = stop.longitude else { continue }
            let d = Self.metres(latitude, longitude, lat, lon)
            if d < (best?.distance ?? .infinity) { best = (i, d) }
        }
        guard let best, best.distance <= limit else { return nil }
        return best.index
    }

    static func metres(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let y = (lat2 - lat1) * 111_320
        let x = (lon2 - lon1) * 111_320 * cos((lat1 + lat2) / 2 * .pi / 180)
        return (x * x + y * y).squareRoot()
    }
}
