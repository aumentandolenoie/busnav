import UIKit
import WebKit
import CoreLocation

final class NavigatorViewController: UIViewController, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let navigation = NativeNavigation()
    private var lastLocation: CLLocation?

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
        navigation.onStatus = { [weak self] message in self?.deliverStatus(message) }
        webView.load(URLRequest(url: URL(string: "lineapilot://app/index.html")!))
        NotificationCenter.default.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func didBecomeActive() {
        if let lastLocation { deliverLocation(lastLocation) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "lineaPilot", let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "start":
            guard let raw = body["route"] as? [String: Any],
                  let data = try? JSONSerialization.data(withJSONObject: raw),
                  let route = try? JSONDecoder().decode(NativeRoute.self, from: data),
                  route.points.count >= 2 else {
                deliverStatus("Percorso nativo non valido")
                return
            }
            navigation.start(route: route, voiceEnabled: body["voice"] as? Bool ?? true,
                             turnsEnabled: body["turnVoice"] as? Bool ?? true)
        case "stop":
            navigation.stop()
        case "settings":
            navigation.voiceEnabled = body["voice"] as? Bool ?? navigation.voiceEnabled
            navigation.turnsEnabled = body["turnVoice"] as? Bool ?? navigation.turnsEnabled
        case "testVoice":
            navigation.testVoice()
        default:
            break
        }
    }

    private func deliverLocation(_ location: CLLocation) {
        lastLocation = location
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
