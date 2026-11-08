import Foundation

// Platform-independent projection and progression; also exercised by CI.
struct GPXTracker {
    struct Hit { let along: Double; let distance: Double }
    let points: [[Double]]
    let distances: [Double]
    private(set) var along: Double? = nil
    private var lastTime: Double? = nil
    private var recovery: (Double, Double)? = nil

    init?(points: [[Double]]) {
        guard points.count >= 2, points.allSatisfy({ p in
            p.count == 2 && p.allSatisfy(\.isFinite) && abs(p[0]) <= 90 && abs(p[1]) <= 180
        }) else { return nil }
        self.points = points
        var ds = [0.0]
        for i in 1..<points.count { ds.append(ds.last! + Self.metres(points[i-1], points[i])) }
        guard ds.last! > 1 else { return nil }
        distances = ds
    }

    static func metres(_ a: [Double], _ b: [Double]) -> Double {
        let r = Double.pi / 180
        let h = pow(sin((b[0]-a[0])*r/2), 2) + cos(a[0]*r)*cos(b[0]*r)*pow(sin((b[1]-a[1])*r/2), 2)
        return 6_371_000 * 2 * atan2(sqrt(min(1,h)), sqrt(max(0,1-h)))
    }

    func project(_ p: [Double], window: ClosedRange<Double>? = nil) -> Hit {
        var best = Hit(along: 0, distance: .infinity)
        let scale = 111_320.0, lonScale = scale * cos(p[0] * .pi / 180)
        for i in 0..<(points.count-1) {
            if let window, distances[i+1] < window.lowerBound || distances[i] > window.upperBound { continue }
            let a = points[i], b = points[i+1]
            let dx = (b[1]-a[1])*lonScale, dy = (b[0]-a[0])*scale
            let px = (p[1]-a[1])*lonScale, py = (p[0]-a[0])*scale
            let squared = dx*dx+dy*dy
            let t = squared > 0 ? max(0,min(1,(px*dx+py*dy)/squared)) : 0
            let at = distances[i]+t*(distances[i+1]-distances[i])
            if let window, !window.contains(at) { continue }
            let distance = hypot(px-t*dx,py-t*dy)
            if distance < best.distance { best = Hit(along: at,distance: distance) }
        }
        return best
    }

    mutating func update(_ p: [Double], speed: Double, time: Double, accuracy: Double) -> Hit? {
        guard accuracy >= 0, accuracy <= 65, time.isFinite,
              lastTime == nil || time > lastTime! else { return nil }
        let elapsed = min(30,max(0.5,time-(lastTime ?? time-1)))
        lastTime = time
        let global = project(p)
        guard global.distance <= max(45,min(85,accuracy*1.5)) else { recovery = nil; return nil }
        guard let old = along else {
            along = global.along
            return global
        }
        let jump = max(65,min(450,max(5,speed)*elapsed*1.8+40))
        let local = project(p,window: max(0,old-30)...min(distances.last!,old+jump))
        let tolerance = max(20,min(45,accuracy))
        if local.distance <= min(65,global.distance+tolerance) {
            recovery = nil
            along = max(old,local.along)
            return Hit(along: along!,distance: local.distance)
        }
        // A route crossing must not jump to a much later lap on one GPS sample.
        if global.along >= old-30 {
            if let candidate = recovery, time-candidate.1 < 15,
               abs(global.along-candidate.0) <= max(80,max(5,speed)*elapsed*2+30) {
                along = max(old,global.along); recovery = nil
                return Hit(along: along!,distance: global.distance)
            }
            recovery = (global.along,time)
        }
        return nil
    }

    func coordinate(at value: Double) -> [Double] {
        let at = min(distances.last!,max(0,value))
        let index = max(1,distances.firstIndex(where: { $0 >= at }) ?? distances.count-1)
        let ratio = (at-distances[index-1])/max(0.001,distances[index]-distances[index-1])
        return [points[index-1][0]+(points[index][0]-points[index-1][0])*ratio,
                points[index-1][1]+(points[index][1]-points[index-1][1])*ratio]
    }
}
