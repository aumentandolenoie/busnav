import UIKit
import MapKit

// Native Apple cartography, but the ONLY route overlay is the supplied Academy GPX.
final class DriveViewController: UIViewController, MKMapViewDelegate {
    private let map = MKMapView()
    private let instruction = UILabel()
    private let turnDistance = UILabel()
    private let stopName = UILabel()
    private let stopDistance = UILabel()
    private let status = UILabel()
    private let symbol = UIImageView()
    private let route: NativeRoute
    private let geometry: GPXTracker
    private var following = true
    private var lastHeading = 0.0
    private var fix: CLLocation?
    private var progress = 0.0
    private var reliable = false
    private var stopAnnotations: [MKPointAnnotation] = []
    var onEnd: (() -> Void)?
    var onVoiceToggle: ((Bool) -> Void)?
    var onRepeat: (() -> Void)?
    private var voice = true

    init(route: NativeRoute) {
        self.route = route
        self.geometry = GPXTracker(points: route.points)!
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        map.frame = view.bounds; map.autoresizingMask = [.flexibleWidth,.flexibleHeight]
        map.delegate = self
        map.showsUserLocation = true
        map.showsCompass = true
        map.showsTraffic = true
        map.pointOfInterestFilter = .excludingAll
        map.preferredConfiguration = MKStandardMapConfiguration(elevationStyle: .realistic, emphasisStyle: .muted)
        view.addSubview(map)
        var coordinates = route.points.map { CLLocationCoordinate2D(latitude: $0[0],longitude: $0[1]) }
        let line = MKPolyline(coordinates: &coordinates,count: coordinates.count)
        map.addOverlay(line,level: .aboveRoads)
        map.setVisibleMapRect(line.boundingMapRect,edgePadding: UIEdgeInsets(top:200,left:40,bottom:250,right:40),animated:false)
        for (i,name) in route.stops.enumerated() {
            let p = route.stopCoordinates?.indices.contains(i) == true ? route.stopCoordinates![i] : geometry.coordinate(at: route.offsets[i])
            guard p.count == 2, p.allSatisfy(\.isFinite) else { continue }
            let pin = MKPointAnnotation(); pin.coordinate = CLLocationCoordinate2D(latitude:p[0],longitude:p[1]); pin.title = name
            stopAnnotations.append(pin)
        }
        map.addAnnotations(stopAnnotations)
        symbol.image = UIImage(systemName:"arrow.up"); symbol.tintColor = .white
        symbol.contentMode = .scaleAspectFit
        symbol.widthAnchor.constraint(equalToConstant:50).isActive = true
        instruction.font = .systemFont(ofSize:25,weight:.semibold); instruction.numberOfLines = 3; instruction.textColor = .white
        instruction.text = route.turns.contains(where: { $0.verifiedRoad == true }) ? "Segui il percorso ufficiale" : "Manovre stradali non disponibili"
        turnDistance.font = .systemFont(ofSize:36,weight:.bold); turnDistance.textColor = .white
        turnDistance.text = "Attesa GPS"
        let repeatButton = UIButton(type:.system); repeatButton.setImage(UIImage(systemName:"speaker.wave.2.fill"),for:.normal); repeatButton.tintColor = .white
        repeatButton.accessibilityLabel = "Ripeti indicazione"; repeatButton.addTarget(self,action:#selector(repeatCue),for:.touchUpInside)
        let text = UIStackView(arrangedSubviews:[turnDistance,instruction]); text.axis = .vertical; text.spacing = 5
        let top = UIStackView(arrangedSubviews:[symbol,text,repeatButton]); top.spacing = 16; top.alignment = .center
        let topPanel = panel(top,dark:true)
        view.addSubview(topPanel)
        NSLayoutConstraint.activate([topPanel.topAnchor.constraint(equalTo:view.safeAreaLayoutGuide.topAnchor,constant:8),topPanel.leadingAnchor.constraint(equalTo:view.leadingAnchor,constant:12),topPanel.trailingAnchor.constraint(equalTo:view.trailingAnchor,constant:-12)])
        let label = UILabel(); label.text = "PROSSIMA FERMATA"; label.font = .systemFont(ofSize:12,weight:.bold); label.textColor = .secondaryLabel
        stopName.text = route.stops.first ?? "Solo percorso GPX"; stopName.font = .systemFont(ofSize:24,weight:.bold); stopName.numberOfLines = 2
        stopDistance.font = .monospacedDigitSystemFont(ofSize:19,weight:.semibold); stopDistance.textColor = .systemBlue
        status.font = .systemFont(ofSize:13,weight:.medium); status.textColor = .secondaryLabel; status.numberOfLines = 2
        status.text = "GPX ufficiale · GPS in primo piano"
        let end = UIButton(type:.system); end.setTitle("Termina",for:.normal); end.tintColor = .systemRed; end.addTarget(self,action:#selector(finish),for:.touchUpInside)
        let sound = UIButton(type:.system); sound.setImage(UIImage(systemName:"speaker.wave.2.fill"),for:.normal); sound.accessibilityLabel = "Attiva o disattiva annunci"; sound.addTarget(self,action:#selector(toggleVoice(_:)),for:.touchUpInside)
        let center = UIButton(type:.system); center.setImage(UIImage(systemName:"location.fill"),for:.normal); center.accessibilityLabel = "Centra GPS"; center.addTarget(self,action:#selector(recenter),for:.touchUpInside)
        let buttons = UIStackView(arrangedSubviews:[end,UIView(),sound,center]); buttons.spacing = 25
        let bottom = UIStackView(arrangedSubviews:[label,stopName,stopDistance,status,buttons]); bottom.axis = .vertical; bottom.spacing = 8
        let bottomPanel = panel(bottom,dark:false); view.addSubview(bottomPanel)
        NSLayoutConstraint.activate([bottomPanel.bottomAnchor.constraint(equalTo:view.safeAreaLayoutGuide.bottomAnchor,constant:-8),bottomPanel.leadingAnchor.constraint(equalTo:view.leadingAnchor,constant:12),bottomPanel.trailingAnchor.constraint(equalTo:view.trailingAnchor,constant:-12)])
        for recognizer in map.gestureRecognizers ?? [] { recognizer.addTarget(self,action:#selector(mapGesture(_:))) }
    }

    private func panel(_ content: UIView,dark: Bool) -> UIView {
        let panel = UIVisualEffectView(effect:UIBlurEffect(style:dark ? .systemChromeMaterialDark : .systemMaterial))
        panel.translatesAutoresizingMaskIntoConstraints = false; panel.layer.cornerRadius = 24; panel.clipsToBounds = true
        if dark { panel.contentView.backgroundColor = UIColor(red:0.03,green:0.19,blue:0.12,alpha:0.8) }
        content.translatesAutoresizingMaskIntoConstraints = false; panel.contentView.addSubview(content)
        NSLayoutConstraint.activate([content.topAnchor.constraint(equalTo:panel.contentView.topAnchor,constant:18),content.bottomAnchor.constraint(equalTo:panel.contentView.bottomAnchor,constant:-18),content.leadingAnchor.constraint(equalTo:panel.contentView.leadingAnchor,constant:18),content.trailingAnchor.constraint(equalTo:panel.contentView.trailingAnchor,constant:-18)])
        return panel
    }
    func location(_ location: CLLocation) { fix = location; updateCamera() }
    func message(_ message: String) { status.text = message }
    func update(along:Double,deviation:Double,stop:Int,reliable:Bool) {
        progress = along; self.reliable = reliable
        if !reliable {
            instruction.text = deviation > 85 ? "Fuori dal percorso ufficiale" : "Verifica posizione GPS"
            turnDistance.text = "Annunci sospesi"; symbol.image = UIImage(systemName:"exclamationmark.triangle")
            return
        }
        if let next = route.turns.first(where: { $0.verifiedRoad == true && $0.at > along-12 }) {
            turnDistance.text = distance(max(0,next.at-along))
            instruction.text = next.text
            symbol.image = UIImage(systemName: next.kind == "roundabout" ? "arrow.trianglehead.clockwise.rotate.90" : next.side == "sinistra" ? "arrow.turn.up.left" : "arrow.turn.up.right") ?? UIImage(systemName:"arrow.up")
        } else {
            instruction.text = "Segui il GPX ufficiale"; turnDistance.text = distance(geometry.distances.last!-along)
            symbol.image = UIImage(systemName:"arrow.up")
        }
        if stop < route.stops.count {
            stopName.text = route.stops[stop]; stopDistance.text = distance(max(0,route.offsets[stop]-along))+" · fermata \(stop+1) di \(route.stops.count)"
        } else {
            stopName.text = route.stops.isEmpty ? "Solo percorso GPX" : "Capolinea raggiunto"
            stopDistance.text = distance(max(0,geometry.distances.last!-along))+" al termine"
        }
        updateCamera()
    }
    private func distance(_ m:Double) -> String { m < 1000 ? "\(Int(max(0,m)/10)*10) m" : String(format:"%.1f km",m/1000) }
    private func updateCamera() {
        guard following, let fix else { return }
        // Use actual GPS position; route bearing is only appropriate while matched.
        var heading = lastHeading
        if reliable {
            let a = geometry.coordinate(at:progress), b = geometry.coordinate(at:progress+40)
            if GPXTracker.metres(a,b) > 10 {
                let r = Double.pi/180, d = (b[1]-a[1])*r
                heading = atan2(sin(d)*cos(b[0]*r),cos(a[0]*r)*sin(b[0]*r)-sin(a[0]*r)*cos(b[0]*r)*cos(d))/r
            }
        } else if fix.course >= 0 && fix.speed > 3 { heading = fix.course }
        lastHeading = heading
        map.setCamera(MKMapCamera(lookingAtCenter:fix.coordinate,fromDistance:650,pitch:55,heading:heading),animated:false)
    }
    @objc private func mapGesture(_ gesture: UIGestureRecognizer) { if gesture.state == .began { following = false } }
    @objc private func recenter() { following = true; updateCamera() }
    @objc private func repeatCue() { onRepeat?() }
    @objc private func toggleVoice(_ sender:UIButton) { voice.toggle(); sender.setImage(UIImage(systemName:voice ? "speaker.wave.2.fill" : "speaker.slash.fill"),for:.normal); onVoiceToggle?(voice) }
    @objc private func finish() { onEnd?(); dismiss(animated:true) }
    func mapView(_ mapView:MKMapView,rendererFor overlay:MKOverlay) -> MKOverlayRenderer {
        let renderer = MKPolylineRenderer(overlay:overlay); renderer.strokeColor = .systemBlue; renderer.lineWidth = 8; renderer.lineCap = .round; renderer.lineJoin = .round; return renderer
    }
    func mapView(_ mapView:MKMapView,viewFor annotation:MKAnnotation) -> MKAnnotationView? {
        guard !(annotation is MKUserLocation) else { return nil }
        let pin = MKMarkerAnnotationView(annotation:annotation,reuseIdentifier:"stop"); pin.markerTintColor = .systemBlue; pin.glyphImage = UIImage(systemName:"bus.fill"); pin.canShowCallout = true; pin.displayPriority = .defaultLow; return pin
    }
}
