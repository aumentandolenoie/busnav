import Foundation
import CoreLocation
import AVFoundation

struct NativeRoute: Decodable {
    struct Turn: Decodable { let at: Double; let side: String }
    let points: [[Double]]        // Latitude, longitude in canonical Academy order
    let offsets: [Double]         // Metres along the canonical GPX
    let stops: [String]           // Busitalia GTFS names only, no MOM supplements
    let turns: [Turn]             // Geometric indications, NOT verified road turns
}

final class NativeNavigation: NSObject, CLLocationManagerDelegate {
    var onLocation: ((CLLocation) -> Void)?
    var onStatus: ((String) -> Void)?
    var voiceEnabled = true
    var turnsEnabled = true

    private let manager = CLLocationManager()
    private let synthesizer = AVSpeechSynthesizer()
    private var route: NativeRoute?
    private var distances: [Double] = []
    private var active = false
    private var along = 0.0
    private var previousFixDate: Date?
    private var candidate: (along: Double, at: Date)?
    private var stopIndex = 0
    private var stopStages: [Int: Int] = [:]
    private var turnStages: [Int: Int] = [:]

    override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .automotiveNavigation
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = 3
        manager.pausesLocationUpdatesAutomatically = false
    }

    func start(route: NativeRoute, voiceEnabled: Bool, turnsEnabled: Bool) {
        stop()
        self.route = route
        self.voiceEnabled = voiceEnabled
        self.turnsEnabled = turnsEnabled
        distances = [0]
        for i in 1..<route.points.count {
            let a = route.points[i - 1], b = route.points[i]
            guard a.count == 2, b.count == 2 else {
                onStatus?("Geometria del percorso non valida")
                self.route = nil
                return
            }
            distances.append(distances[i - 1] + metres(a, b))
        }
        guard route.offsets.count == route.stops.count else {
            onStatus?("Fermate e distanze non corrispondono")
            self.route = nil
            return
        }
        along = 0
        stopIndex = 0
        previousFixDate = nil
        candidate = nil
        stopStages.removeAll()
        turnStages.removeAll()
        active = true
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            startLocationUpdates()
        case .denied, .restricted:
            active = false
            onStatus?("Posizione non autorizzata. Abilitala nelle impostazioni iOS.")
        @unknown default:
            break
        }
    }

    func stop() {
        active = false
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        synthesizer.stopSpeaking(at: .immediate)
        route = nil
        previousFixDate = nil
        candidate = nil
        stopStages.removeAll()
        turnStages.removeAll()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func startLocationUpdates() {
        guard active else { return }
        // Info.plist includes UIBackgroundModes=location. Start while foregrounded;
        // Core Location can then keep delivering updates after the screen locks.
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        onStatus?("GPS nativo avviato · audio disponibile anche a schermo bloccato, se iOS lo consente")
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            startLocationUpdates()
        case .denied, .restricted:
            if active {
                stop()
                onStatus?("GPS non autorizzato")
            }
        default: break
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        onStatus?("Errore GPS: \(error.localizedDescription)")
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard active, let route else { return }
        for location in locations {
            guard location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 110,
                  location.timestamp.timeIntervalSinceNow > -20 else { continue }
            onLocation?(location)
            updateProgress(location: location, route: route)
        }
    }

    private func updateProgress(location: CLLocation, route: NativeRoute) {
        let hit = nearest(location.coordinate, on: route.points)
        guard hit.distance <= 180 else {
            onStatus?("GPS a \(Int(hit.distance)) m dal GPX: annunci sospesi")
            return
        }
        let speed = max(0, location.speed)
        let elapsed = previousFixDate.map { max(0.5, min(20, location.timestamp.timeIntervalSince($0))) } ?? 1
        previousFixDate = location.timestamp
        let maximumJump = max(90, min(400, max(speed, 5) * elapsed * 2.5 + 70))
        if along > 0, hit.along > along + maximumJump {
            if let previous = candidate,
               location.timestamp.timeIntervalSince(previous.at) < 20,
               abs(previous.along - hit.along) < max(180, speed * elapsed * 3 + 75) {
                candidate = nil
            } else {
                candidate = (hit.along, location.timestamp)
                onStatus?("Riallineamento GPS al GPX")
                return
            }
        } else {
            candidate = nil
        }
        along = max(along, hit.along - 25)
        while stopIndex < route.stops.count && along > route.offsets[stopIndex] + 35 {
            stopIndex += 1
        }
        // Suppress the departure terminus announcement when starting there.
        if stopIndex == 0 && route.offsets.count > 1 &&
           route.offsets[0] < 50 && abs(along - route.offsets[0]) < 30 { stopIndex = 1 }

        let remaining = stopIndex < route.offsets.count ? route.offsets[stopIndex] - along : .infinity
        if voiceEnabled && stopIndex < route.stops.count && hit.distance < 100 && remaining >= 0 {
            let stage = stopStages[stopIndex, default: 0]
            let lead = max(140, min(400, max(speed, 6) * 22))
            if stage == 0 && remaining <= lead {
                speak("Tra \(Int(max(50, remaining / 50 * 50).rounded())) metri, prossima fermata: \(route.stops[stopIndex]).")
                stopStages[stopIndex] = 1
            } else if stage == 1 && remaining <= 65 && remaining >= 8 && speed > 2 {
                speak("Fermata in arrivo: \(route.stops[stopIndex]).")
                stopStages[stopIndex] = 2
            }
        }
        if turnsEnabled && voiceEnabled && hit.distance < 85 && remaining > 170 {
            for (index, turn) in route.turns.enumerated() where turn.at > along + 15 && turn.at < along + 450 {
                let distance = turn.at - along
                let lead = max(150, min(350, max(speed, 6) * 18))
                let stage = turnStages[index, default: 0]
                if stage == 0 && distance <= lead && !synthesizer.isSpeaking {
                    speak("Possibile svolta a \(turn.side) tra circa \(Int(distance.rounded())) metri.")
                    turnStages[index] = 1
                } else if stage == 1 && distance <= 85 && !synthesizer.isSpeaking {
                    speak("Possibile svolta a \(turn.side) tra poco.")
                    turnStages[index] = 2
                }
                break
            }
        }
    }

    func testVoice() {
        speak("Voce nativa LineaPilot attiva.")
    }

    private func speak(_ text: String) {
        guard !text.isEmpty else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            onStatus?("Audio nativo non disponibile: \(error.localizedDescription)")
            return
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "it-IT")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        synthesizer.speak(utterance)
    }

    private func metres(_ a: [Double], _ b: [Double]) -> Double {
        CLLocation(latitude: a[0], longitude: a[1]).distance(from: CLLocation(latitude: b[0], longitude: b[1]))
    }

    private func nearest(_ coordinate: CLLocationCoordinate2D, on points: [[Double]]) -> (along: Double, distance: Double) {
        var best = (along: 0.0, distance: Double.infinity)
        let latitudeScale = 111_320.0
        for i in 0..<(points.count - 1) {
            let a = points[i], b = points[i + 1]
            let longitudeScale = latitudeScale * cos(coordinate.latitude * .pi / 180)
            let dx = (b[1] - a[1]) * longitudeScale
            let dy = (b[0] - a[0]) * latitudeScale
            let px = (coordinate.longitude - a[1]) * longitudeScale
            let py = (coordinate.latitude - a[0]) * latitudeScale
            let lengthSquared = dx * dx + dy * dy
            let t = lengthSquared > 0 ? max(0, min(1, (px * dx + py * dy) / lengthSquared)) : 0
            let distance = hypot(px - t * dx, py - t * dy)
            if distance < best.distance {
                best = (distances[i] + t * (distances[i + 1] - distances[i]), distance)
            }
        }
        return best
    }
}
