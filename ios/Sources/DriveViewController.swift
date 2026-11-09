import UIKit
import MapKit

// Native Apple cartography, but the ONLY route overlay is the supplied Academy GPX.
final class DriveViewController: UIViewController, MKMapViewDelegate, UIGestureRecognizerDelegate {
    private let map = MKMapView()
    private let instruction = UILabel()
    private let turnDistance = UILabel()
    private let stopName = UILabel()
    private let stopDistance = UILabel()
    private let status = UILabel()
    private let roadStatus = UILabel()
    private let symbol = UIImageView()
    private var topPanel: UIView!
    private var bottomPanel: UIView!
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
    private let simulated: Bool
    private let demoMarker = MKPointAnnotation()

    init(route: NativeRoute, voiceEnabled: Bool, simulated: Bool = false) {
        self.simulated = simulated
        self.route = route
        self.voice = voiceEnabled
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
        map.showsUserLocation = !simulated
        map.showsCompass = false
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
        symbol.widthAnchor.constraint(equalToConstant:36).isActive = true
        instruction.font = UIFontMetrics(forTextStyle:.title2).scaledFont(for:.systemFont(ofSize:25,weight:.semibold),maximumPointSize:34); instruction.adjustsFontForContentSizeCategory = true; instruction.numberOfLines = 3; instruction.textColor = .white
        instruction.text = route.turns.contains(where: { $0.verifiedRoad == true }) ? "Segui il percorso ufficiale" : "Manovre stradali non disponibili"
        turnDistance.font = UIFontMetrics(forTextStyle:.largeTitle).scaledFont(for:.systemFont(ofSize:36,weight:.bold),maximumPointSize:46); turnDistance.adjustsFontForContentSizeCategory = true; turnDistance.textColor = .white
        turnDistance.adjustsFontSizeToFitWidth = true; turnDistance.minimumScaleFactor = 0.5
        turnDistance.text = "Attesa GPS"
        let repeatButton = UIButton(type:.system); repeatButton.setImage(UIImage(systemName:"speaker.wave.2.fill"),for:.normal); repeatButton.tintColor = .white
        repeatButton.accessibilityLabel = "Ripeti indicazione"; repeatButton.accessibilityIdentifier = "repeatCue"; touchTarget(repeatButton); repeatButton.addTarget(self,action:#selector(repeatCue),for:.touchUpInside)
        let text = UIStackView(arrangedSubviews:[turnDistance,instruction]); text.axis = .vertical; text.spacing = 5
        text.setContentCompressionResistancePriority(.defaultLow,for:.horizontal)
        let top = UIStackView(arrangedSubviews:[symbol,text]); top.spacing = 12; top.alignment = .center
        topPanel = panel(top,dark:true,trailing:repeatButton)
        topPanel.accessibilityIdentifier = "instructionPanel"
        view.addSubview(topPanel)
        NSLayoutConstraint.activate([
            topPanel.topAnchor.constraint(equalTo:view.safeAreaLayoutGuide.topAnchor,constant:8),
            topPanel.leadingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.leadingAnchor,constant:12),
            topPanel.trailingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.trailingAnchor,constant:-12),
            topPanel.heightAnchor.constraint(greaterThanOrEqualToConstant:80),
            topPanel.heightAnchor.constraint(lessThanOrEqualTo:view.safeAreaLayoutGuide.heightAnchor,multiplier:0.42)
        ])
        let label = UILabel(); label.text = "PROSSIMA FERMATA"; label.font = .systemFont(ofSize:12,weight:.bold); label.textColor = .secondaryLabel
        stopName.text = route.stops.first ?? "Solo percorso GPX"; stopName.font = UIFontMetrics(forTextStyle:.title2).scaledFont(for:.systemFont(ofSize:24,weight:.bold),maximumPointSize:34); stopName.adjustsFontForContentSizeCategory = true; stopName.numberOfLines = 2
        stopDistance.font = .monospacedDigitSystemFont(ofSize:19,weight:.semibold); stopDistance.textColor = .systemBlue
        status.font = UIFontMetrics(forTextStyle:.footnote).scaledFont(for:.systemFont(ofSize:13,weight:.medium),maximumPointSize:22); status.adjustsFontForContentSizeCategory = true; status.textColor = .secondaryLabel; status.numberOfLines = 2
        status.text = "GPX ufficiale · GPS in primo piano"
        let end = UIButton(type:.system); end.setTitle("Termina",for:.normal); end.tintColor = .systemRed; end.accessibilityIdentifier = "endNavigation"; touchTarget(end); end.addTarget(self,action:#selector(finish),for:.touchUpInside)
        let sound = UIButton(type:.system); sound.setImage(UIImage(systemName:voice ? "speaker.wave.2.fill" : "speaker.slash.fill"),for:.normal); sound.accessibilityLabel = "Attiva o disattiva annunci"; sound.accessibilityIdentifier = "toggleVoice"; touchTarget(sound); sound.addTarget(self,action:#selector(toggleVoice(_:)),for:.touchUpInside)
        let center = UIButton(type:.system); center.setImage(UIImage(systemName:"location.fill"),for:.normal); center.accessibilityLabel = "Centra GPS"; center.accessibilityIdentifier = "recenter"; touchTarget(center); center.addTarget(self,action:#selector(recenter),for:.touchUpInside)
        let compass = MKCompassButton(mapView:map); compass.compassVisibility = .visible
        compass.accessibilityLabel = "Orienta a nord"; compass.accessibilityIdentifier = "compass"; touchTarget(compass)
        let buttons = UIStackView(arrangedSubviews:[end,UIView(),sound,center]); buttons.spacing = 12; buttons.alignment = .center
        end.setContentCompressionResistancePriority(.required,for:.horizontal)
        let attribution = UILabel(); attribution.text = "GPX Academy · manovre © OpenStreetMap contributors"; attribution.font = .systemFont(ofSize:10); attribution.textColor = .secondaryLabel; attribution.numberOfLines = 2
        roadStatus.font = UIFont.preferredFont(forTextStyle: .footnote)
        roadStatus.adjustsFontForContentSizeCategory = true
        roadStatus.numberOfLines = 2
        roadStatus.textColor = .label
        roadStatus.isHidden = true
        let bottom = UIStackView(arrangedSubviews:[label,stopName,stopDistance,roadStatus,status,attribution]); bottom.axis = .vertical; bottom.spacing = 8
        bottomPanel = panel(bottom,dark:false,footer:buttons); bottomPanel.accessibilityIdentifier = "stopPanel"; view.addSubview(bottomPanel); view.addSubview(compass)
        NSLayoutConstraint.activate([
            bottomPanel.bottomAnchor.constraint(equalTo:view.safeAreaLayoutGuide.bottomAnchor,constant:-8),
            bottomPanel.leadingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.leadingAnchor,constant:12),
            bottomPanel.trailingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.trailingAnchor,constant:-12),
            bottomPanel.heightAnchor.constraint(lessThanOrEqualTo:view.safeAreaLayoutGuide.heightAnchor,multiplier:0.48),
            bottomPanel.topAnchor.constraint(greaterThanOrEqualTo:topPanel.bottomAnchor,constant:60),
            compass.trailingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.trailingAnchor,constant:-12),
            compass.bottomAnchor.constraint(equalTo:bottomPanel.topAnchor,constant:-8)
        ])
        // MapKit installs its own recognizers on internal subviews. Observe gestures
        // independently and simultaneously, without stealing map scrolling/zooming.
        for recognizer in [UIPanGestureRecognizer(target:self,action:#selector(mapGesture(_:))),
                           UIPinchGestureRecognizer(target:self,action:#selector(mapGesture(_:))),
                           UIRotationGestureRecognizer(target:self,action:#selector(mapGesture(_:)))] {
            recognizer.delegate = self; recognizer.cancelsTouchesInView = false
            map.addGestureRecognizer(recognizer)
        }
    }

    private func touchTarget(_ button: UIView) {
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(greaterThanOrEqualToConstant:44),
            button.heightAnchor.constraint(equalToConstant:44)
        ])
    }

    // Text scrolls if space is limited. The footer and repeat button stay visible.
    private func panel(_ content: UIView,dark: Bool,trailing: UIButton? = nil,footer: UIView? = nil) -> UIView {
        let panel = UIVisualEffectView(effect:UIBlurEffect(style:dark ? .systemChromeMaterialDark : .systemMaterial))
        panel.translatesAutoresizingMaskIntoConstraints = false; panel.layer.cornerRadius = 24; panel.clipsToBounds = true
        if dark { panel.contentView.backgroundColor = UIColor(red:0.03,green:0.19,blue:0.12,alpha:0.8) }
        let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.contentInsetAdjustmentBehavior = .never; scroll.showsVerticalScrollIndicator = true
        panel.contentView.addSubview(scroll)
        content.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(content)
        let naturalHeight = scroll.heightAnchor.constraint(equalTo:content.heightAnchor); naturalHeight.priority = .defaultHigh
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo:panel.contentView.topAnchor,constant:12),
            scroll.leadingAnchor.constraint(equalTo:panel.contentView.leadingAnchor,constant:12),
            content.topAnchor.constraint(equalTo:scroll.contentLayoutGuide.topAnchor),
            content.bottomAnchor.constraint(equalTo:scroll.contentLayoutGuide.bottomAnchor),
            content.leadingAnchor.constraint(equalTo:scroll.contentLayoutGuide.leadingAnchor),
            content.trailingAnchor.constraint(equalTo:scroll.contentLayoutGuide.trailingAnchor),
            content.widthAnchor.constraint(equalTo:scroll.frameLayoutGuide.widthAnchor), naturalHeight
        ])
        if let trailing {
            panel.contentView.addSubview(trailing)
            NSLayoutConstraint.activate([
                trailing.trailingAnchor.constraint(equalTo:panel.contentView.trailingAnchor,constant:-12),
                trailing.centerYAnchor.constraint(equalTo:panel.contentView.centerYAnchor),
                scroll.trailingAnchor.constraint(equalTo:trailing.leadingAnchor,constant:-8)
            ])
        } else { scroll.trailingAnchor.constraint(equalTo:panel.contentView.trailingAnchor,constant:-12).isActive = true }
        if let footer {
            footer.translatesAutoresizingMaskIntoConstraints = false; panel.contentView.addSubview(footer)
            NSLayoutConstraint.activate([
                footer.topAnchor.constraint(equalTo:scroll.bottomAnchor,constant:10),
                footer.bottomAnchor.constraint(equalTo:panel.contentView.bottomAnchor,constant:-12),
                footer.leadingAnchor.constraint(equalTo:panel.contentView.leadingAnchor,constant:12),
                footer.trailingAnchor.constraint(equalTo:panel.contentView.trailingAnchor,constant:-12)
            ])
        } else { scroll.bottomAnchor.constraint(equalTo:panel.contentView.bottomAnchor,constant:-12).isActive = true }
        return panel
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard let topPanel, let bottomPanel else { return }
        map.layoutMargins = UIEdgeInsets(top:topPanel.frame.maxY+8,left:16,bottom:view.bounds.maxY-bottomPanel.frame.minY+8,right:16)
    }
    func location(_ location: CLLocation) { fix = location; if simulated { demoMarker.coordinate = location.coordinate; demoMarker.title = "Posizione simulata"; if !map.annotations.contains(where: { $0 === demoMarker }) { map.addAnnotation(demoMarker) } }; updateCamera() }
    func message(_ message: String) { status.text = message }
    func update(along:Double,deviation:Double,stop:Int,reliable:Bool) {
        var roadDetails: [String] = []
        if reliable, deviation < 45 {
            if let limit = route.speedLimit(at: along) { roadDetails.append("Limite mappato \(limit) km/h") }
            if let index = route.nextCamera(at: along, within: 350), let camera = route.roadCameras?[index] {
                roadDetails.append("\(camera.title) · \(distance(camera.at - along))")
            }
        }
        roadStatus.text = roadDetails.joined(separator: "\n")
        roadStatus.isHidden = roadDetails.isEmpty
        progress = along; self.reliable = reliable
        if !reliable {
            instruction.text = deviation > 85 ? "Fuori dal percorso ufficiale" : "Verifica posizione GPS"
            turnDistance.text = "Annunci sospesi"; symbol.image = UIImage(systemName:"exclamationmark.triangle")
            updateCamera()
            return
        }
        if let next = route.nextTurn(at: along) {
            turnDistance.text = distance(max(0,next.at-along))
            instruction.text = next.text
            symbol.image = UIImage(systemName: next.kind == "roundabout" ? "arrow.triangle.2.circlepath" : next.side == "sinistra" ? "arrow.turn.up.left" : "arrow.turn.up.right") ?? UIImage(systemName:"arrow.up")
        } else {
            instruction.text = route.supportsGuidance(at: along) ? "Segui il GPX ufficiale" : "Manovre non disponibili qui: segui il GPX ufficiale"
            turnDistance.text = route.supportsGuidance(at: along) ? distance(geometry.distances.last!-along) : "Tratto non coperto"
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
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
    @objc private func mapGesture(_ gesture: UIGestureRecognizer) {
        if gesture.state == .began || gesture.state == .changed { following = false }
    }
    @objc private func recenter() { following = true; updateCamera() }
    @objc private func repeatCue() { onRepeat?() }
    @objc private func toggleVoice(_ sender:UIButton) { voice.toggle(); sender.setImage(UIImage(systemName:voice ? "speaker.wave.2.fill" : "speaker.slash.fill"),for:.normal); onVoiceToggle?(voice) }
    @objc private func finish() { onEnd?(); dismiss(animated:true) }
    func mapView(_ mapView:MKMapView,rendererFor overlay:MKOverlay) -> MKOverlayRenderer {
        let renderer = MKPolylineRenderer(overlay:overlay); renderer.strokeColor = .systemBlue; renderer.lineWidth = 8; renderer.lineCap = .round; renderer.lineJoin = .round; return renderer
    }
    func mapView(_ mapView:MKMapView,viewFor annotation:MKAnnotation) -> MKAnnotationView? {
        guard !(annotation is MKUserLocation) else { return nil }
        let pin = MKMarkerAnnotationView(annotation:annotation,reuseIdentifier:"stop"); pin.markerTintColor = .systemBlue; pin.glyphImage = UIImage(systemName:annotation === demoMarker ? "location.fill" : "bus.fill"); pin.canShowCallout = true; pin.displayPriority = .defaultLow; return pin
    }
}
