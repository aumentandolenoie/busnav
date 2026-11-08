import Foundation

// A GPS fix may be valid while road instructions for that interval are absent.
// Never reach across an unvalidated gap to announce a later maneuver.
struct GuidanceCoverage: Decodable {
    let complete: Bool
    let percent: Double
    let ranges: [[Double]]

    func contains(progress: Double, maneuver: Double? = nil) -> Bool {
        ranges.contains { range in
            guard range.count == 2, range[0].isFinite, range[1].isFinite,
                  range[0] <= progress, progress <= range[1] else { return false }
            guard let maneuver else { return true }
            return range[0] <= maneuver && maneuver <= range[1]
        }
    }
}
