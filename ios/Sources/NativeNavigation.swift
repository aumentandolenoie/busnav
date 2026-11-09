import Foundation
import CoreLocation
import AVFoundation
import MachO

struct NativeRoute: Decodable {
    typealias Coverage = GuidanceCoverage
    let coverage: Coverage?
    func supportsGuidance(at along: Double, maneuver: Double? = nil) -> Bool {
        coverage?.contains(progress: along, maneuver: maneuver) ?? true
    }
    func nextTurn(at along: Double) -> Turn? {
        turns.first { $0.verifiedRoad == true && $0.at > along-12 && supportsGuidance(at: along, maneuver: $0.at) }
    }
    struct Continuation {
        let index: Int
        let isStop: Bool
        let text: String
    }

    func upcomingStop(from progress: Double, startingAt index: Int) -> Int? {
        offsets.indices.dropFirst(index).first { offsets[$0] >= progress }
    }

    func continuation(after index: Int, from progress: Double, stopIndex: Int) -> Continuation? {
        let first = turns[index]
        let stop = upcomingStop(from: progress, startingAt: stopIndex)
        let stopAt = stop.map { offsets[$0] } ?? .infinity
        guard first.at >= progress, stopAt > first.at else { return nil }
        let nextIndex = index + 1
        let next = turns.indices.contains(nextIndex) ? turns[nextIndex] : nil
        let nextAt = next?.at ?? .infinity
        let secondAt = min(stopAt, nextAt)
        let gap = secondAt - first.at
        guard gap >= 5, gap <= 80, supportsGuidance(at: progress, maneuver: secondAt) else { return nil }
        if let stop, stopAt < nextAt {
            return Continuation(index: stop, isStop: true, text: "prossima fermata: \(stops[stop])")
        }
        guard nextAt < stopAt, next?.verifiedRoad == true, let text = next?.text, !text.isEmpty else { return nil }
        return Continuation(index: nextIndex, isStop: false, text: text)
    }

    func voiceMessage(_ first: String, distance: Double?, continuation: Continuation? = nil) -> String {
        let punctuation = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ".!?"))
        let firstClause = first.trimmingCharacters(in: punctuation)
        let prefix = distance.map { "Tra circa \(Int($0.rounded())) metri, " } ?? ""
        func lowerInitial(_ text: String) -> String { text.prefix(1).lowercased() + String(text.dropFirst()) }
        let secondClause = continuation.map { ", poi " + lowerInitial($0.text.trimmingCharacters(in: punctuation)) } ?? ""
        return prefix + (prefix.isEmpty ? firstClause : lowerInitial(firstClause)) + secondClause + "."
    }

    struct Turn: Decodable {
        let at: Double
        let side: String
        let kind: String?
        let text: String?
        let verifiedRoad: Bool?
    }
    struct Camera: Decodable {
        let at: Double
        let kind: String
        var title: String { kind == "redLight" ? "Controllo semaforico" : "Autovelox fisso" }
    }

    let speedLimits: [[Double]]?
    let roadCameras: [Camera]?

    func speedLimit(at along: Double) -> Int? {
        guard supportsGuidance(at: along) else { return nil }
        let values = Set((speedLimits ?? []).compactMap { segment -> Int? in
            guard segment.count == 3, segment[0] <= along, along < segment[1],
                  (5...130).contains(segment[2]), segment[2].rounded() == segment[2] else { return nil }
            return Int(segment[2])
        })
        return values.count == 1 ? values.first : nil
    }

    func nextCamera(at along: Double, within distance: Double, excluding used: Set<Int> = []) -> Int? {
        guard let cameras = roadCameras else { return nil }
        return cameras.indices.filter { index in
            let camera = cameras[index]
            return !used.contains(index) && ["speed", "redLight"].contains(camera.kind) &&
                camera.at > along && camera.at <= along + distance &&
                supportsGuidance(at: along, maneuver: camera.at)
        }.min { cameras[$0].at < cameras[$1].at }
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

    private func installedItalianVoices() -> [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.lowercased().hasPrefix("it") }
            .filter { voice in
                if #available(iOS 17.0, *) { return !voice.voiceTraits.contains(.isNoveltyVoice) }
                return true
            }
            .sorted { a, b in
                if a.quality != b.quality { return a.quality.rawValue > b.quality.rawValue }
                let aExact = a.language.lowercased() == "it-it"
                let bExact = b.language.lowercased() == "it-it"
                if aExact != bExact { return aExact }
                return a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
    }

    func italianVoices() -> [[String: Any]] {
        installedItalianVoices().map { voice in
            ["id": voice.identifier, "name": voice.name,
             "lang": voice.language,
             "quality": voice.quality == .premium ? 5 : voice.quality == .enhanced ? 3 : 1,
             "premium": voice.quality == .premium,
             "enhanced": voice.quality.rawValue >= AVSpeechSynthesisVoiceQuality.enhanced.rawValue] as [String: Any]
        }
    }

    func configureVoice(identifier: String?, rate: Double?) {
        if let identifier { voiceIdentifier = identifier }
        if let rate, rate.isFinite { voiceRate = Float(min(1.25, max(0.75, rate))) }
    }

    private var isSimulating = false
    private var demoTimer: Timer?
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
    private var spokenCameras = Set<Int>()
    private var chainedStopAfter = -Double.infinity
    private var stopStages: [Int: Int] = [:]
    private var turnStages: [Int: Int] = [:]

    override init() {
        super.init()
        manager.delegate = self
        synthesizer.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(audioInterrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        manager.activityType = .automotiveNavigation
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.pausesLocationUpdatesAutomatically = false
    }

    func start(route: NativeRoute, voiceEnabled: Bool, turnsEnabled: Bool, simulated: Bool = false) {
        stop()
        isSimulating = simulated
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
        spokenCameras.removeAll()
        chainedStopAfter = -.infinity
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
        if simulated {
            var progress = 0.0
            demoTimer = Timer.scheduledTimer(withTimeInterval:1,repeats:true) { [weak self] timer in
                guard let self, self.active, let tracker = self.tracker else { timer.invalidate(); return }
                let point = tracker.coordinate(at:progress)
                let location = CLLocation(coordinate:CLLocationCoordinate2D(latitude:point[0],longitude:point[1]),altitude:0,horizontalAccuracy:5,verticalAccuracy:5,course:0,speed:14,timestamp:Date())
                self.locationManager(self.manager,didUpdateLocations:[location])
                self.onStatus?("SIMULAZIONE · posizione virtuale")
                progress += 14
                if progress > tracker.distances.last! + 50 { timer.invalidate(); self.onStatus?("Simulazione completata"); self.stop() }
            }
            return
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
        demoTimer?.invalidate(); demoTimer = nil; isSimulating = false
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
        spokenCameras.removeAll()
        chainedStopAfter = -.infinity
        stopStages.removeAll()
        turnStages.removeAll()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func startLocationUpdates() {
        guard active, !isSimulating, !locationUpdatesStarted else { return }
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
        guard !isSimulating else { return }
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
            synthesizer.stopSpeaking(at: .immediate); speakingStop = false
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
        onStatus?("GPS ±\(Int(location.horizontalAccuracy)) m · GPX ufficiale")
        along = hit.along
        while stopIndex < route.stops.count && along > route.offsets[stopIndex] + 35 {
            stopIndex += 1
        }
        // Suppress the departure terminus announcement when starting there.
        if stopIndex == 0 && route.offsets.count > 1 &&
           route.offsets[0] < 50 && abs(along - route.offsets[0]) < 30 { stopIndex = 1 }

        onProgress?(along, hit.distance, stopIndex, true)
        announce(atSpeed: speed, deviation: hit.distance, route: route)
        if voiceEnabled, hit.distance < 45, !synthesizer.isSpeaking,
           let index = route.nextCamera(at: along, within: max(120, min(250, speed * 12)), excluding: spokenCameras),
           let camera = route.roadCameras?[index], camera.at - along >= 15 {
            let metres = Int(max(20, ((camera.at - along) / 10).rounded() * 10))
            if speak("Tra circa \(metres) metri, \(camera.title.lowercased()).") { spokenCameras.insert(index) }
        }
    }

    private func nextVoiceTurn(in route: NativeRoute, maxDistance: Double = 450) -> Int? {
        route.turns.indices.first { index in
            let turn = route.turns[index]
            return turn.verifiedRoad == true && !(turn.text ?? "").isEmpty &&
                turn.at > along - 12 && turn.at < along + maxDistance &&
                !(turn.at <= along && turnStages[index] == 2) &&
                route.supportsGuidance(at: along, maneuver: turn.at)
        }
    }

    private func announce(atSpeed speed: Double, deviation: Double, route: NativeRoute) {
        guard voiceEnabled else { return }
        let index = turnsEnabled && deviation < 65 ? nextVoiceTurn(in: route) : nil
        let turn = index.map { route.turns[$0] }
        let distance = (turn?.at ?? .infinity) - along
        let lead = max(150, min(350, max(speed, 6) * 18))
        let near = max(20, speed * 3)
        let stopLead = max(140, min(400, max(speed, 6) * 22))
        let remaining = stopIndex < route.stops.count ? route.offsets[stopIndex] - along : .infinity
        let stopStage = stopStages[stopIndex, default: 0]

        var stopFollowsChain = false
        if let index, let turn, let text = turn.text, distance >= 0,
           turnStages[index, default: 0] == 0,
           let continuation = route.continuation(after: index, from: along, stopIndex: stopIndex) {
            let secondaryStage = continuation.isStop ? stopStages[continuation.index] : turnStages[continuation.index]
            if (secondaryStage ?? 0) == 0 {
                stopFollowsChain = continuation.isStop
                let chainLead = continuation.isStop ? max(lead, stopLead - (route.offsets[continuation.index] - turn.at)) : lead
                if distance <= chainLead {
                    let message = route.voiceMessage(text, distance: distance > near ? distance : nil, continuation: continuation)
                    if speak(message, stopPriority: continuation.isStop) {
                        turnStages[index] = distance <= near ? 2 : 1
                        if continuation.isStop {
                            stopStages[continuation.index] = 1
                            chainedStopAfter = turn.at
                        } else {
                            turnStages[continuation.index] = 1
                        }
                        return
                    }
                }
            }
        }

        if stopIndex < route.stops.count && deviation < 100 && remaining >= 0 {
            if stopStage == 0 && remaining <= stopLead && !stopFollowsChain && !synthesizer.isSpeaking {
                if speak("Tra \(Int(max(50, (remaining / 50).rounded() * 50))) metri, prossima fermata: \(route.stops[stopIndex]).", stopPriority: true) {
                    stopStages[stopIndex] = 1
                    return
                }
            } else if stopStage == 1 && remaining <= 65 && remaining >= 8 && speed > 2 && along >= chainedStopAfter {
                if speak("Fermata in arrivo: \(route.stops[stopIndex]).", stopPriority: true) {
                    stopStages[stopIndex] = 2
                    return
                }
            }
        }
        guard let index, let text = turn?.text, !synthesizer.isSpeaking else { return }
        let stage = turnStages[index, default: 0]
        if stage < 2 && distance <= near {
            if speak(route.voiceMessage(text, distance: nil)) { turnStages[index] = 2 }
        } else if stage == 0 && distance <= lead {
            if speak(route.voiceMessage(text, distance: distance)) { turnStages[index] = 1 }
        }
    }

    func repeatInstruction() {
        guard voiceEnabled, matched, let route else { return }
        let stop = route.upcomingStop(from: along, startingAt: stopIndex)
        let stopAt = stop.map { route.offsets[$0] } ?? .infinity
        if turnsEnabled, let index = nextVoiceTurn(in: route, maxDistance: .infinity), let text = route.turns[index].text,
           route.turns[index].at < stopAt {
            let distance = route.turns[index].at - along
            let continuation = route.continuation(after: index, from: along, stopIndex: stopIndex)
            speak(route.voiceMessage(text, distance: distance > 20 ? distance : nil, continuation: continuation), stopPriority: true)
        } else if let stop {
            speak("Prossima fermata: \(route.stops[stop])", stopPriority: true)
        } else { speak("Segui il percorso ufficiale.", stopPriority: true) }
    }

    func testVoice() {
        speak("Tra duecento metri, alla rotonda, prendi la seconda uscita, poi prossima fermata: Padova Autostazione. Svolta a destra, poi svolta a sinistra.")
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
        let installed = installedItalianVoices()
        let chosen = installed.first { $0.identifier == voiceIdentifier }
        // Public downloaded Premium / Enhanced voices are available here.
        // Siri voices selected in system settings may fall back through this API.
        let automatic = installed.first
        utterance.voice = chosen ?? automatic ?? AVSpeechSynthesisVoice(language: "it-IT")
        utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate,
                            max(AVSpeechUtteranceMinimumSpeechRate,
                                AVSpeechUtteranceDefaultSpeechRate * voiceRate))
        synthesizer.speak(utterance)
        return true
    }

}
