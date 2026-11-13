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
    let lines: [Line]
    let suggested: [Int]

    private enum Keys: String, CodingKey { case labels, lines, suggested }
    init(from decoder: Decoder) throws {
        // Bad ticket data must never block navigation: it only disables the calculator.
        if let parts = try? Self.parts(decoder) {
            labels = parts.labels; lines = parts.lines
            suggested = parts.suggested.filter { parts.lines.indices.contains($0) }
        } else {
            labels = [:]; lines = []; suggested = []
        }
    }
    private static func parts(_ decoder: Decoder) throws -> (labels: [String: String], lines: [Line], suggested: [Int]) {
        let c = try decoder.container(keyedBy: Keys.self)
        return (try c.decode([String: String].self, forKey: .labels),
                try c.decode([Line].self, forKey: .lines),
                try c.decodeIfPresent([Int].self, forKey: .suggested) ?? [])
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
