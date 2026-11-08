import Foundation
import CoreLocation
import AVFoundation
import MachO

struct NativeRoute: Decodable {
    struct Turn: Decodable {
        let at: Double
        let side: String
        let kind: String?
        let text: String?
        let verifiedRoad: Bool?
    }
    let name: String?
    let stopCoordinates: [[Double]]?
    let points: [[Double]]        // Latitude, longitude in canonical Academy order
    let offsets: [Double]         // Metres along the canonical GPX
    let stops: [String]           // Busitalia GTFS names only, no MOM supplements
    let turns: [Turn]             // Validated road annotations only; geometry never routes
}

final class NativeNavigation: NSObject, CLLocationManagerDelegate, AVSpeechSynthesizerDelegate {
    var onProgress: ((Double, Double, Int, Bool) -> Void)?
    var onLocation: ((CLLocation) -> Void)?
    var onStatus: ((String) -> Void)?
    var voiceEnabled = true {
        didSet { if !voiceEnabled { synthesizer.stopSpeaking(at: .immediate); speakingStop = false } }
    }
    var turnsEnabled = true
    var voiceIdentifier: String = ""
    var voiceRate: Float = 1.0

    func italianVoices() -> [[String: Any]] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.lowercased().hasPrefix("it") }
            .map { voice in
                ["id": voice.identifier, "name": voice.name,
                 "lang": voice.language, "quality": voice.quality == .enhanced ? 3 : 1,
                 "enhanced": voice.quality == .enhanced] as [String: Any]
            }
    }

    func configureVoice(identifier: String?, rate: Double?) {
        if let identifier { voiceIdentifier = identifier }
        if let rate, rate.isFinite { voiceRate = Float(min(1.25, max(0.75, rate))) }
    }

    private let manager = CLLocationManager()
    private var locationUpdatesStarted = false

    // LiveContainer launches our Swift code inside a different, signed host app.
    // The host may lack UIBackgroundModes=location even when LineaPilot's own
    // Info.plist declares it. Setting allowsBackgroundLocationUpdates=true then
    // raises an uncaught NSInvalidArgumentException in Core Location.
    private static let isHostedByLiveContainer: Bool = {
        for index in 0..<_dyld_image_count() {
            if let path = _dyld_get_image_name(index) {
                let image = String(cString: path).lowercased()
                if image.contains("livecontainershared") || image.contains("livecontainer.app/") {
                    return true
                }
            }
        }
        return false
    }()

    private var canUseBackgroundLocation: Bool {
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        return !Self.isHostedByLiveContainer && modes.contains("location")
    }
    private let synthesizer = AVSpeechSynthesizer()
    private var route: NativeRoute?
    private var tracker: GPXTracker?
    private var lastOffRouteAlert = Date.distantPast
    private var speakingStop = false
    private var matched = false
    private var active = false
    private var along = 0.0
    private var lastGoodFix = Date.distantPast
    private var watchdog: Timer?
    private var interrupted = false
    private var staleWarning = false
    private var stopIndex = 0
    private var stopStages: [Int: Int] = [:]
    private var turnStages: [Int: Int] = [:]

    override init() {
        super.init()
        manager.delegate = self
        synthesizer.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(audioInterrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
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
        guard let geometry = GPXTracker(points: route.points),
              route.offsets.count == route.stops.count,
              route.offsets.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= geometry.distances.last! + 50 }),
              zip(route.offsets, route.offsets.dropFirst()).allSatisfy({ pair in pair.0 <= pair.1 }),
              route.turns.allSatisfy({ $0.at.isFinite && $0.at >= 0 && $0.at <= geometry.distances.last! }) else {
            onStatus?("Geometria GPX o sequenza fermate non valida")
            self.route = nil
            return
        }
        tracker = geometry
        along = 0
        stopIndex = 0
        lastGoodFix = Date()
        staleWarning = false
        stopStages.removeAll()
        turnStages.removeAll()
        active = true
        lastOffRouteAlert = .distantPast
        watchdog = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            guard let self, self.active, Date().timeIntervalSince(self.lastGoodFix) > 15 else { return }
            self.matched = false
            self.onProgress?(self.along, 0, self.stopIndex, false)
            self.onStatus?("Segnale GPS assente · annunci sospesi")
            if !self.staleWarning {
                self.synthesizer.stopSpeaking(at: .immediate); self.speakingStop = false
                self.staleWarning = true
            }
        }
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
        watchdog?.invalidate(); watchdog = nil
        matched = false
        speakingStop = false
        locationUpdatesStarted = false
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        synthesizer.stopSpeaking(at: .immediate)
        route = nil
        tracker = nil
        lastGoodFix = Date()
        staleWarning = false
        stopStages.removeAll()
        turnStages.removeAll()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func startLocationUpdates() {
        guard active, !locationUpdatesStarted else { return }
        // Only a standalone installation whose executing app declares the location
        // background mode can request continuous updates. In LiveContainer, the
        // process belongs to the host and enabling this flag crashes Core Location.
        let backgroundAllowed = canUseBackgroundLocation
        manager.allowsBackgroundLocationUpdates = backgroundAllowed
        if backgroundAllowed {
            manager.showsBackgroundLocationIndicator = true
        }
        manager.startUpdatingLocation()
        locationUpdatesStarted = true
        if Self.isHostedByLiveContainer {
            onStatus?("GPS attivo in primo piano · LiveContainer non supporta la modalità GPS in background")
        } else if backgroundAllowed {
            onStatus?("GPS nativo attivo · modalità background richiesta (da verificare sul dispositivo)")
        } else {
            onStatus?("GPS attivo in primo piano · modalità background non disponibile per questa installazione")
        }
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
        matched = false
        synthesizer.stopSpeaking(at: .immediate); speakingStop = false
        onProgress?(along, 0, stopIndex, false)
        onStatus?("Errore GPS: \(error.localizedDescription)")
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard active, let route else { return }
        // Core Location can deliver a historical batch after resuming. Never
        // replay directions for locations that the vehicle has already passed.
        guard let location = locations.max(by: { $0.timestamp < $1.timestamp }) else { return }
        guard location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 65,
              location.timestamp.timeIntervalSinceNow > -8,
              location.timestamp.timeIntervalSinceNow < 2 else {
            matched = false
            onProgress?(along, 0, stopIndex, false)
            onStatus?(manager.accuracyAuthorization == .reducedAccuracy ? "Attiva Posizione precisa per LiveContainer nelle impostazioni iOS" : "GPS poco preciso · annunci sospesi")
            return
        }
        lastGoodFix = Date(); staleWarning = false
        onLocation?(location)
        updateProgress(location: location, route: route)
    }

    private func updateProgress(location: CLLocation, route: NativeRoute) {
        let speed = max(0, location.speed)
        guard let hit = tracker?.update([location.coordinate.latitude, location.coordinate.longitude],
                                        speed: speed, time: location.timestamp.timeIntervalSince1970,
                                        accuracy: location.horizontalAccuracy) else {
            matched = false
            let distance = tracker?.project([location.coordinate.latitude, location.coordinate.longitude]).distance ?? 0
            onProgress?(along, distance, stopIndex, false)
            onStatus?(distance > 85 ? "Fuori percorso · segui il GPX ufficiale" : "GPS in riallineamento · annunci sospesi")
            if distance > 85 && Date().timeIntervalSince(lastOffRouteAlert) > 45 {
                if voiceEnabled { speak("Sei fuori dal percorso ufficiale. Controlla la posizione sul GPX.", stopPriority: true) }
                lastOffRouteAlert = Date()
            }
            return
        }
        matched = true
        along = hit.along
        while stopIndex < route.stops.count && along > route.offsets[stopIndex] + 35 {
            stopIndex += 1
        }
        // Suppress the departure terminus announcement when starting there.
        if stopIndex == 0 && route.offsets.count > 1 &&
           route.offsets[0] < 50 && abs(along - route.offsets[0]) < 30 { stopIndex = 1 }

        onProgress?(along, hit.distance, stopIndex, true)
        let remaining = stopIndex < route.offsets.count ? route.offsets[stopIndex] - along : .infinity
        if voiceEnabled && stopIndex < route.stops.count && hit.distance < 100 && remaining >= 0 {
            let stage = stopStages[stopIndex, default: 0]
            let lead = max(140, min(400, max(speed, 6) * 22))
            if stage == 0 && remaining <= lead && !speakingStop {
                if speak("Tra \(Int(max(50, (remaining / 50).rounded() * 50))) metri, prossima fermata: \(route.stops[stopIndex]).", stopPriority: true) { stopStages[stopIndex] = 1 }
            } else if stage == 1 && remaining <= 65 && remaining >= 8 && speed > 2 {
                if speak("Fermata in arrivo: \(route.stops[stopIndex]).", stopPriority: true) { stopStages[stopIndex] = 2 }
            }
        }
        if turnsEnabled && voiceEnabled && hit.distance < 65 {
            for (index, turn) in route.turns.enumerated() where turn.verifiedRoad == true && turn.at > along - 12 && turn.at < along + 450 {
                let distance = turn.at - along
                let lead = max(150, min(350, max(speed, 6) * 18))
                let stage = turnStages[index, default: 0]
                if stage == 0 && distance <= lead && !synthesizer.isSpeaking {
                    if turn.verifiedRoad == true, let message = turn.text, !message.isEmpty {
                        if speak("Tra circa \(Int(max(0,distance).rounded())) metri, \(message).") { turnStages[index] = 1 }
                    }
                } else if stage == 1 && distance <= max(20, speed * 3) && !synthesizer.isSpeaking {
                    if turn.verifiedRoad == true, let message = turn.text, !message.isEmpty {
                        if speak(message) { turnStages[index] = 2 }
                    }
                }
                break
            }
        }
    }

    func repeatInstruction() {
        guard voiceEnabled, matched, let route else { return }
        if let turn = route.turns.first(where: { $0.verifiedRoad == true && $0.at > along - 12 }), let text = turn.text {
            speak("Tra \(Int(max(0, turn.at-along).rounded())) metri, \(text)", stopPriority: true)
        } else if stopIndex < route.stops.count {
            speak("Prossima fermata: \(route.stops[stopIndex])", stopPriority: true)
        } else { speak("Segui il percorso ufficiale.", stopPriority: true) }
    }

    func testVoice() {
        speak("Voce nativa LineaPilot attiva.")
    }

    @objc private func audioInterrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        interrupted = type == .began
        if interrupted { synthesizer.stopSpeaking(at: .immediate); speakingStop = false }
        // Stale utterances are discarded; next GPS fixes schedule current cues.
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        speakingStop = false
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        // Do not deactivate the session here: a priority stop may already be starting.
    }

    @discardableResult private func speak(_ text: String, stopPriority: Bool = false) -> Bool {
        guard !text.isEmpty, !interrupted else { return false }
        if synthesizer.isSpeaking {
            guard stopPriority && !speakingStop else { return false }
            synthesizer.stopSpeaking(at: .immediate)
        }
        speakingStop = stopPriority
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            speakingStop = false
            onStatus?("Audio nativo non disponibile: \(error.localizedDescription)")
            return false
        }
        let utterance = AVSpeechUtterance(string: text)
        let chosen = AVSpeechSynthesisVoice.speechVoices()
            .first { $0.identifier == voiceIdentifier && $0.language.lowercased().hasPrefix("it") }
        // Automatic selects the highest-quality installed Italian voice.
        // Siri's private voice is not exposed by the public AVSpeech API.
        let automatic = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.lowercased().hasPrefix("it") }
            .sorted { a, b in
                if a.quality != b.quality { return a.quality.rawValue > b.quality.rawValue }
                let aExact = a.language.lowercased() == "it-it"
                let bExact = b.language.lowercased() == "it-it"
                if aExact != bExact { return aExact }
                return a.name.localizedStandardCompare(b.name) == .orderedAscending
            }.first
        utterance.voice = chosen ?? automatic ?? AVSpeechSynthesisVoice(language: "it-IT")
        utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate,
                            max(AVSpeechUtteranceMinimumSpeechRate,
                                AVSpeechUtteranceDefaultSpeechRate * voiceRate))
        synthesizer.speak(utterance)
        return true
    }

}
