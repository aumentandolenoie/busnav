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
