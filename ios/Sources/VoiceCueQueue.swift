import Foundation

/// A spoken navigation cue waiting for the synthesizer.
///
/// `make` builds the sentence only when the cue is actually spoken and receives
/// the metres still left to `target` at that moment (nil for cues that are not
/// tied to a position), so a cue that had to wait never announces a stale distance.
struct VoiceCue {
    let key: String
    let target: Double?
    var created: TimeInterval
    let sequence: Int
    var queuedBehindSpeech: Bool
    var make: (Double?) -> String?
}

/// Pure ordering logic for spoken guidance (no AVFoundation, unit-tested in tests/main.swift).
///
/// Close cues are no longer dropped or cut off: they wait and are read one after
/// the other, the stop or manoeuvre that comes first along the GPX first. A cue whose
/// target has already been passed, or that waited too long, is discarded instead of
/// being read late. A newer cue for the same stop/manoeuvre replaces the pending one.
struct VoiceCueQueue {
    private(set) var pending: [VoiceCue] = []
    private var sequence = 0
    var maxPending = 4
    var maxAge: TimeInterval = 25
    var passedTolerance = 5.0
    var chainWindow: TimeInterval = 2.5

    var isEmpty: Bool { pending.isEmpty }
    var count: Int { pending.count }

    func contains(key: String) -> Bool { pending.contains { $0.key == key } }

    mutating func removeAll() { pending.removeAll() }

    /// Adds a cue, or refreshes the pending cue with the same key. Returns false
    /// only when the queue is full of nearer cues and this one could not be kept.
    @discardableResult
    mutating func enqueue(key: String, target: Double?, now: TimeInterval, behindSpeech: Bool,
                          make: @escaping (Double?) -> String?) -> Bool {
        if let index = pending.firstIndex(where: { $0.key == key }) {
            pending[index].make = make
            pending[index].created = now
            pending[index].queuedBehindSpeech = pending[index].queuedBehindSpeech || behindSpeech
            return true
        }
        sequence += 1
        pending.append(VoiceCue(key: key, target: target, created: now, sequence: sequence,
                                queuedBehindSpeech: behindSpeech, make: make))
        pending.sort(by: VoiceCueQueue.speaksFirst)
        if pending.count > maxPending { pending.removeLast(pending.count - maxPending) }
        return pending.contains { $0.key == key }
    }

    /// Drops cues whose target was passed or that waited too long, so they never
    /// take the place of a new cue when the queue is full.
    mutating func discardStale(along: Double, positionReliable: Bool, now: TimeInterval) {
        let age = maxAge, tolerance = passedTolerance
        pending.removeAll { cue in
            if now - cue.created > age { return true }
            guard positionReliable, let target = cue.target else { return false }
            return along > target + tolerance
        }
    }

    /// Removes and returns the next cue still worth saying, with its final text.
    /// Cues tied to a position wait while the GPS position is not reliable.
    mutating func next(along: Double, positionReliable: Bool, now: TimeInterval,
                       lastSpeechEnd: TimeInterval) -> (key: String, text: String)? {
        let age = maxAge, tolerance = passedTolerance
        pending.removeAll { now - $0.created > age }
        if positionReliable {
            pending.removeAll { cue in
                guard let target = cue.target else { return false }
                return along > target + tolerance
            }
        }
        while let index = pending.firstIndex(where: { positionReliable || $0.target == nil }) {
            let cue = pending.remove(at: index)
            let left: Double? = cue.target.map { $0 - along }
            guard let built = cue.make(left)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !built.isEmpty else { continue }
            let chained = cue.queuedBehindSpeech && now - lastSpeechEnd < chainWindow
            return (cue.key, chained ? VoiceCueQueue.chained(built) : built)
        }
        return nil
    }

    static func speaksFirst(_ a: VoiceCue, _ b: VoiceCue) -> Bool {
        let at = a.target ?? -Double.infinity
        let bt = b.target ?? -Double.infinity
        if at != bt { return at < bt }
        return a.sequence < b.sequence
    }

    /// "Svolta a destra." -> "Poi, svolta a destra." (acronyms such as "SS" keep their case).
    static func chained(_ text: String) -> String {
        guard let first = text.first else { return text }
        let rest = String(text.dropFirst())
        let secondIsLower = rest.first?.isLowercase ?? false
        let head = secondIsLower ? first.lowercased() : String(first)
        return "Poi, " + head + rest
    }
}
