import Foundation
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}
check(GPXTracker(points: []) == nil, "Empty GPX accepted")
check(GPXTracker(points: [[45,11],[Double.nan,11]]) == nil, "NaN accepted")
check(GPXTracker(points: [[45,11],[45,11]]) == nil, "Zero length accepted")
var route = GPXTracker(points: [[45,11],[45,11.01],[45.01,11.01]])!
let start = route.update([45,11.001],speed:10,time:100,accuracy:5)!
check(start.along > 50, "First fix projection failed")
check(route.update([45,11.002],speed:10,time:99,accuracy:5) == nil, "Out of order fix accepted")
check(route.update([45,11.002],speed:10,time:101,accuracy:100) == nil, "Inaccurate fix accepted")
check(route.update([46,12],speed:10,time:102,accuracy:5) == nil, "Off-route accepted")
check(route.update([45.005,11.01],speed:10,time:103,accuracy:5) == nil, "Single GPS jump accepted")
check(route.update([45.0051,11.01],speed:10,time:104,accuracy:5) != nil, "Consistent recovery rejected")
let end = route.coordinate(at:1_000_000)
check(abs(end[0]-45.01)<0.00001,"End wraps to start")
var loop = GPXTracker(points:[[45,11],[45,11.01],[45.01,11.01],[45.01,11],[45,11],[45,10.99]])!
_ = loop.update([45,11.0001],speed:6,time:10,accuracy:5)
let crossing = loop.update([45,11],speed:6,time:11,accuracy:5)!
check(crossing.along < 100,"Crossing jumped to final lap")
print("GPXTracker: validation, stale fixes, off-route, recovery, crossing, endpoints passed")

let coverage = GuidanceCoverage(complete: false, percent: 75, ranges: [[0,100],[150,200]])
check(coverage.contains(progress:80,maneuver:90), "Valid maneuver suppressed")
check(!coverage.contains(progress:80,maneuver:175), "Maneuver across uncovered gap accepted")
check(!coverage.contains(progress:125), "Uncovered interval accepted")
check(coverage.contains(progress:175,maneuver:190), "Coverage did not resume after gap")
check(!GuidanceCoverage(complete:false,percent:0,ranges:[]).contains(progress:0), "Empty coverage accepted")
print("GuidanceCoverage: gaps suppress maneuvers without blocking valid later intervals")

// Spoken cues close together are chained in route order, never dropped or stuck.
var cues = VoiceCueQueue()
let stopKept = cues.enqueue(key: "stop:1", target: 300, now: 0, behindSpeech: true) { left in
    "Tra \(Int(left ?? 0)) metri, prossima fermata: Noale."
}
let turnKept = cues.enqueue(key: "turn:0", target: 120, now: 0.5, behindSpeech: true) { left in
    "Tra circa \(Int(left ?? 0)) metri, svolta a destra."
}
check(stopKept && turnKept, "Cue rejected")
cues.enqueue(key: "turn:0", target: 120, now: 1, behindSpeech: true) { _ in "Svolta a destra." }
check(cues.count == 2, "Same manoeuvre queued twice")
let firstCue = cues.next(along: 20, positionReliable: true, now: 2, lastSpeechEnd: 1)!
check(firstCue.key == "turn:0", "The manoeuvre that comes first must be read first")
check(firstCue.text == "Poi, svolta a destra.", "Chained cue wording: \(firstCue.text)")
check(cues.next(along: 30, positionReliable: false, now: 3, lastSpeechEnd: 2) == nil, "Positional cue read without reliable GPS")
let secondCue = cues.next(along: 100, positionReliable: true, now: 4, lastSpeechEnd: 0)!
check(secondCue.text == "Tra 200 metri, prossima fermata: Noale.", "Waiting cue must use the live distance: \(secondCue.text)")
check(cues.isEmpty, "Queue not drained")
cues.enqueue(key: "turn:5", target: 500, now: 0, behindSpeech: false) { _ in "Svolta a sinistra." }
check(cues.next(along: 510, positionReliable: true, now: 1, lastSpeechEnd: 0) == nil, "Passed manoeuvre read late")
cues.enqueue(key: "stop:9", target: 900, now: 0, behindSpeech: false) { _ in "Fermata in arrivo: Treviso." }
check(cues.next(along: 800, positionReliable: true, now: 40, lastSpeechEnd: 0) == nil, "Expired cue read late")
check(VoiceCueQueue.chained("SS 13 a destra.") == "Poi, SS 13 a destra.", "Acronym lowercased")
print("VoiceCueQueue: ordering, chaining, live distances, stale and duplicate cues passed")
