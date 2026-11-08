import UIKit
import MapKit
import CoreLocation

// The preview and DriveViewController render the same immutable GPX with MapKit.
final class RoutePreviewView: UIView, MKMapViewDelegate, CLLocationManagerDelegate {
    let map = MKMapView()
    private let gps = CLLocationManager()
    private var waitingForPosition = false
    private let caption = UILabel()
    private var line: MKPolyline?
    private var pendingFit = false
    override init(frame: CGRect) {
        super.init(frame:frame)
        accessibilityIdentifier = "nativeRoutePreview"
        map.translatesAutoresizingMaskIntoConstraints = false
        map.delegate = self; map.showsCompass = false; map.isRotateEnabled = false
        map.showsTraffic = true; map.pointOfInterestFilter = .excludingAll
        map.preferredConfiguration = MKStandardMapConfiguration(emphasisStyle:.muted)
        addSubview(map)
        NSLayoutConstraint.activate([map.topAnchor.constraint(equalTo:topAnchor),map.bottomAnchor.constraint(equalTo:bottomAnchor),map.leadingAnchor.constraint(equalTo:leadingAnchor),map.trailingAnchor.constraint(equalTo:trailingAnchor)])
        map.setRegion(MKCoordinateRegion(center:CLLocationCoordinate2D(latitude:45.4064,longitude:11.8768),latitudinalMeters:13000,longitudinalMeters:13000),animated:false)
        gps.delegate = self; gps.desiredAccuracy = kCLLocationAccuracyBest
        caption.text = "  Anteprima · GPX ufficiale  "; caption.font = .systemFont(ofSize:12,weight:.semibold)
        caption.backgroundColor = .secondarySystemBackground; caption.layer.cornerRadius = 8; caption.clipsToBounds = true
        caption.translatesAutoresizingMaskIntoConstraints = false; addSubview(caption)
        let fit = UIButton(type:.system); fit.setImage(UIImage(systemName:"location.fill"),for:.normal)
        fit.backgroundColor = .systemBackground; fit.layer.cornerRadius = 12; fit.accessibilityLabel = "Centra posizione attuale"
        fit.accessibilityIdentifier = "previewCenterGPS"; fit.translatesAutoresizingMaskIntoConstraints = false
        fit.addTarget(self,action:#selector(centerGPS),for:.touchUpInside); addSubview(fit)
        NSLayoutConstraint.activate([caption.topAnchor.constraint(equalTo:topAnchor,constant:8),caption.leadingAnchor.constraint(equalTo:leadingAnchor,constant:12),caption.heightAnchor.constraint(equalToConstant:30),caption.trailingAnchor.constraint(lessThanOrEqualTo:fit.leadingAnchor,constant:-8),fit.topAnchor.constraint(equalTo:topAnchor,constant:8),fit.trailingAnchor.constraint(equalTo:trailingAnchor,constant:-12),fit.widthAnchor.constraint(equalToConstant:44),fit.heightAnchor.constraint(equalToConstant:44)])
    }
    required init?(coder:NSCoder) { fatalError("init(coder:) has not been implemented") }
    func show(_ raw:[String:Any]?) {
        map.removeOverlays(map.overlays); map.removeAnnotations(map.annotations); line = nil
        guard let raw,let points = raw["points"] as? [[Double]],GPXTracker(points:points) != nil else { return }
        var coordinates = points.map { CLLocationCoordinate2D(latitude:$0[0],longitude:$0[1]) }
        let overlay = MKPolyline(coordinates:&coordinates,count:coordinates.count); line = overlay; map.addOverlay(overlay)
        let stops = raw["stopCoordinates"] as? [[Double]] ?? [],names = raw["stops"] as? [String] ?? []
        for (i,p) in stops.enumerated() where p.count == 2 && p.allSatisfy(\.isFinite) && abs(p[0]) <= 90 && abs(p[1]) <= 180 {
            let pin = MKPointAnnotation(); pin.coordinate = CLLocationCoordinate2D(latitude:p[0],longitude:p[1]); pin.title = names.indices.contains(i) ? names[i] : "Fermata"
            map.addAnnotation(pin)
        }
        pendingFit = true; setNeedsLayout()
    }
    override func layoutSubviews() { super.layoutSubviews(); if pendingFit && bounds.width > 0 && bounds.height > 0 { pendingFit = false; fitRoute() } }
    @objc private func fitRoute() { if let line { map.setVisibleMapRect(line.boundingMapRect,edgePadding:UIEdgeInsets(top:56,left:28,bottom:28,right:28),animated:false) } }
    @objc private func centerGPS() {
        waitingForPosition = true
        switch gps.authorizationStatus {
        case .notDetermined: gps.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            map.showsUserLocation = true
            caption.text = "  Ricerca posizione GPS…  "
            gps.requestLocation()
        default:
            waitingForPosition = false; caption.text = "  Abilita Posizione nelle Impostazioni  "
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if waitingForPosition { centerGPS() }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard waitingForPosition, let fix = locations.last,
              fix.horizontalAccuracy >= 0, fix.horizontalAccuracy <= 100,
              abs(fix.timestamp.timeIntervalSinceNow) <= 15 else {
            waitingForPosition = false; caption.text = "  Posizione GPS non disponibile  "; return
        }
        waitingForPosition = false; pendingFit = false
        map.setRegion(MKCoordinateRegion(center:fix.coordinate,latitudinalMeters:1200,longitudinalMeters:1200),animated:false)
        caption.text = "  Anteprima · GPX ufficiale  "
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        waitingForPosition = false; caption.text = "  Posizione GPS non disponibile  "
    }
    func mapView(_ mapView:MKMapView,rendererFor overlay:MKOverlay) -> MKOverlayRenderer {
        let renderer = MKPolylineRenderer(overlay:overlay); renderer.strokeColor = .systemBlue; renderer.lineWidth = 6; renderer.lineCap = .round; renderer.lineJoin = .round; return renderer
    }
}

