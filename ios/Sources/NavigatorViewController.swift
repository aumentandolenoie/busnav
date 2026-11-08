import UIKit
import WebKit
import CoreLocation
import AVFoundation

final class NavigatorViewController: UIViewController, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let navigation = NativeNavigation()
    private var drive: DriveViewController?
    private var lastLocation: CLLocation?
    private var gtfsDownload: URLSessionDataTask?
    private let gtfsURL = URL(string: "https://proxy.busone.app/biv/gtfs.zip")!

    override func viewDidLoad() {
        super.viewDidLoad()
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(BundledSite(), forURLScheme: "lineapilot")
        configuration.userContentController.add(self, name: "lineaPilot")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        // On iPhone portrait, LineaPilot is a long page: the map appears first,
        // followed by Academy/GTFS selectors. Disabling the WKWebView scroll
        // prevented users from reaching those controls in LiveContainer/SideStore.
        // Fullscreen navigation still locks page scrolling via body.navigating CSS.
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.alwaysBounceVertical = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.04, green: 0.07, blue: 0.13, alpha: 1)
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        navigation.onLocation = { [weak self] fix in self?.deliverLocation(fix) }
        navigation.onStatus = { [weak self] message in self?.deliverStatus(message); self?.drive?.message(message) }
        navigation.onProgress = { [weak self] along, deviation, stop, reliable in
            self?.drive?.update(along: along, deviation: deviation, stop: stop, reliable: reliable)
        }
        webView.load(URLRequest(url: URL(string: "lineapilot://app/index.html")!))
        if #available(iOS 17.0, *) {
            NotificationCenter.default.addObserver(self, selector: #selector(refreshVoiceCatalog), name: AVSpeechSynthesizer.availableVoicesDidChangeNotification, object: nil)
        }
        NotificationCenter.default.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func refreshVoiceCatalog() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.deliver(event: "voices", data: ["voices": self.navigation.italianVoices()])
        }
    }

    @objc private func didBecomeActive() {
        refreshVoiceCatalog()
        if let lastLocation { deliverLocation(lastLocation) }
        // Recheck published IPA updates after a return from the background.
        // The JS side throttles network requests to once per 10 minutes.
        webView.evaluateJavaScript("window.lineaPilotCheckUpdatesOnResume && window.lineaPilotCheckUpdatesOnResume()", completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "lineaPilot", let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "start":
            guard let raw = body["route"] as? [String: Any],
                  let data = try? JSONSerialization.data(withJSONObject: raw),
                  let route = try? JSONDecoder().decode(NativeRoute.self, from: data),
                  GPXTracker(points: route.points) != nil,
                  route.offsets.count == route.stops.count else {
                deliverStatus("Percorso nativo non valido")
                return
            }
            navigation.configureVoice(identifier: body["voiceId"] as? String, rate: body["rate"] as? Double)
            let voice = body["voice"] as? Bool ?? true
            let turnVoice = body["turnVoice"] as? Bool ?? true
            let screen = DriveViewController(route: route, voiceEnabled: voice)
            screen.onEnd = { [weak self] in
                self?.navigation.stop(); self?.drive = nil
                UIApplication.shared.isIdleTimerDisabled = false
                self?.webView.evaluateJavaScript("stopNavigation()", completionHandler: nil)
            }
            screen.onVoiceToggle = { [weak self] enabled in self?.navigation.voiceEnabled = enabled }
            screen.onRepeat = { [weak self] in self?.navigation.repeatInstruction() }
            drive = screen
            UIApplication.shared.isIdleTimerDisabled = true
            present(screen, animated: true) { [weak self] in
                self?.navigation.start(route: route, voiceEnabled: voice, turnsEnabled: turnVoice)
            }
        case "stop":
            navigation.stop()
            drive?.dismiss(animated: true); drive = nil
            UIApplication.shared.isIdleTimerDisabled = false
        case "settings":
            navigation.voiceEnabled = body["voice"] as? Bool ?? navigation.voiceEnabled
            navigation.turnsEnabled = body["turnVoice"] as? Bool ?? navigation.turnsEnabled
            navigation.configureVoice(identifier: body["voiceId"] as? String, rate: body["rate"] as? Double)
        case "downloadGTFS":
            guard let id = body["id"] as? String, id.hasPrefix("gtfs-"),
                  id.count < 96, id.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }) else { return }
            downloadGTFS(requestId: id, refresh: body["refresh"] as? Bool ?? false)
        case "listVoices":
            deliver(event: "voices", data: ["voices": navigation.italianVoices()])
        case "openUpdate":
            if let value = body["url"] as? String,
               let url = URL(string: value), url.scheme == "https",
               url.host == "github.com",
               url.path.hasPrefix("/aumentandolenoie/busnav/releases/download/") {
                UIApplication.shared.open(url)
            }
        case "checkUpdates":
            fetchReleases()
        case "testVoice":
            navigation.testVoice()
        default:
            break
        }
    }

    // A native download avoids CORS / blob XHR restrictions on custom schemes.
    // WebKit receives small, ordered chunks; it never needs to perform a ZIP request.
    private var cachedGTFSURL: URL? {
        guard let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        return folder.appendingPathComponent("lineapilot-busitalia-gtfs.zip")
    }

    private func downloadGTFS(requestId: String, refresh: Bool) {
        gtfsDownload?.cancel()
        // Native cache is essential when the WKWebView's IndexedDB storage is
        // unavailable (notably inside some app containers).
        if !refresh, let url = cachedGTFSURL,
           let cached = try? Data(contentsOf: url),
           cached.count >= 1000, cached.starts(with: [0x50, 0x4b]) {
            sendGTFSChunks(cached, requestId: requestId, offset: 0)
            return
        }
        var request = URLRequest(url: gtfsURL)
        request.setValue("LineaPilot; https://github.com/aumentandolenoie/busnav", forHTTPHeaderField: "X-BusOne-Client")
        request.setValue("personal", forHTTPHeaderField: "X-BusOne-Use")
        request.timeoutInterval = 60
        request.cachePolicy = .reloadIgnoringLocalCacheData
        gtfsDownload = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                if let error {
                    self.deliverGTFS(requestId, "error", "Rete: \(error.localizedDescription)")
                    return
                }
                guard let response = response as? HTTPURLResponse else {
                    self.deliverGTFS(requestId, "error", "Risposta HTTP mancante")
                    return
                }
                guard (200..<300).contains(response.statusCode) else {
                    self.deliverGTFS(requestId, "error", "Server GTFS: HTTP \(response.statusCode)")
                    return
                }
                guard let data, data.count >= 1000, data.count <= 100 * 1024 * 1024 else {
                    self.deliverGTFS(requestId, "error", "File GTFS vuoto o superiore a 100 MB")
                    return
                }
                guard data.starts(with: [0x50, 0x4b]) else {
                    self.deliverGTFS(requestId, "error", "Il server ha risposto, ma non con uno ZIP")
                    return
                }
                if let destination = self.cachedGTFSURL {
                    do { try data.write(to: destination, options: .atomic) }
                    catch { NSLog("LineaPilot GTFS cache unavailable: %@", error.localizedDescription) }
                }
                self.sendGTFSChunks(data, requestId: requestId, offset: 0)
            }
        }
        gtfsDownload?.resume()
    }

    private func sendGTFSChunks(_ data: Data, requestId: String, offset: Int) {
        let chunkSize = 48 * 1024
        guard offset < data.count else {
            deliverGTFS(requestId, "done", "")
            return
        }
        let end = min(offset + chunkSize, data.count)
        let base64 = data.subdata(in: offset..<end).base64EncodedString()
        deliverGTFS(requestId, "chunk", base64) { [weak self] error in
            guard let self else { return }
            if let error {
                NSLog("LineaPilot GTFS JavaScript transfer failed: %@", error.localizedDescription)
                self.deliverGTFS(requestId, "error", "Trasferimento alla schermata iOS interrotto")
            } else {
                self.sendGTFSChunks(data, requestId: requestId, offset: end)
            }
        }
    }

    private func deliverGTFS(_ id: String, _ kind: String, _ value: String,
                             completion: ((Error?) -> Void)? = nil) {
        // id and kind are validated or hard-coded; value is base64 or an escaped
        // error string. JSON encoding avoids quoting/injection issues.
        let args = [id, kind, value]
        guard let jsonData = try? JSONSerialization.data(withJSONObject: args),
              let json = String(data: jsonData, encoding: .utf8) else { return }
        webView.evaluateJavaScript("""
            if (window.lineaPilotGTFSReceive) {
              window.lineaPilotGTFSReceive.apply(window, \(json));
            }
            """) { _, error in completion?(error) }
    }

    private func fetchReleases() {
        guard let url = URL(string: "https://api.github.com/repos/aumentandolenoie/busnav/releases?per_page=40") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.deliver(event: "updateError", data: ["message": error.localizedDescription])
                    return
                }
                guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                      let data, let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                    self.deliver(event: "updateError", data: ["message": "Risposta GitHub non valida"])
                    return
                }
                self.deliver(event: "releases", data: ["releases": json])
            }
        }.resume()
    }

    private func deliverLocation(_ location: CLLocation) {
        lastLocation = location
        drive?.location(location)
        guard UIApplication.shared.applicationState == .active else { return }
        let payload: [String: Any] = [
            "lat": location.coordinate.latitude,
            "lng": location.coordinate.longitude,
            "accuracy": location.horizontalAccuracy,
            "speed": location.speed,
            "heading": location.course
        ]
        deliver(event: "location", data: payload)
    }

    private func deliverStatus(_ message: String) {
        guard UIApplication.shared.applicationState == .active else { return }
        deliver(event: "status", data: ["message": message])
    }

    private func deliver(event: String, data: [String: Any]) {
        guard let blob = try? JSONSerialization.data(withJSONObject: data),
              let json = String(data: blob, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.lineaPilotNativeReceive && window.lineaPilotNativeReceive('\(event)', \(json))") { _, error in
            if let error { NSLog("LineaPilot bridge: %@", error.localizedDescription) }
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

