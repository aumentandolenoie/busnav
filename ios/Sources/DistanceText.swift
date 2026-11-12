import Foundation

/// One rounding rule for every distance on screen and in the voice, identical on
/// web (app.js), iOS and Android: from 100 m in steps of 50 m, from 50 to 100 m
/// in steps of 10 m, below 50 m in steps of 5 m; from 1 km in tenths of a km.
enum DistanceText {
    static func rounded(_ metres: Double) -> Int {
        let m = metres.isFinite ? max(0, metres) : 0
        let step: Double = m >= 100 ? 50 : m >= 50 ? 10 : 5
        return Int((m / step).rounded() * step)
    }

    private static func kilometres(_ metres: Double) -> String {
        let tenths = Int((max(0, metres) / 100).rounded())
        return tenths % 10 == 0 ? "\(tenths / 10)" : "\(tenths / 10),\(tenths % 10)"
    }

    /// "150 m", "85 m", "35 m", "1,2 km".
    static func display(_ metres: Double) -> String {
        let value = rounded(metres)
        return value < 1000 ? "\(value) m" : kilometres(metres) + " km"
    }

    /// "150 metri", "1,2 chilometri", "1 chilometro".
    static func spoken(_ metres: Double) -> String {
        let value = rounded(metres)
        guard value >= 1000 else { return "\(value) metri" }
        let km = kilometres(metres)
        return km + (km == "1" ? " chilometro" : " chilometri")
    }
}
