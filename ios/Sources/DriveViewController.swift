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
    private let speedSign = UILabel()
    // Bottom-left, mirroring the speed sign: opens the on-board ticket calculator.
    private let ticketButton = UIButton(type: .system)
    private var ticketSheet: TicketSheetView?
    /// Sent by the web layer, otherwise the copy bundled in the app.
    private lazy var tickets: TicketData? = TicketData.resolve(sent: route.tickets, route: route.ticketRoute)
    private var ticketPortrait: [NSLayoutConstraint] = []
    private var ticketLandscape: [NSLayoutConstraint] = []
    private var portraitConstraints: [NSLayoutConstraint] = []
    private var landscapeConstraints: [NSLayoutConstraint] = []
    private var landscape: Bool?
    private var cameraViewport = CGRect.zero
    private var routeBounds = MKMapRect.null
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
    // Our own position marker (real GPS and simulation alike): a blue navigation
    // arrow like Apple Maps instead of the round user-location dot.
    private let puck = MKPointAnnotation()
    private weak var puckView: NavigationPuckView?
    /// Vertical position of the vehicle inside the free map area (0 = top, 1 = bottom).
    /// Lower than the centre so more of the road ahead is visible.
    static let positionAnchor: CGFloat = 0.75

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
        map.showsUserLocation = false
        map.showsCompass = false
        map.showsTraffic = true
        map.pointOfInterestFilter = .excludingAll
        map.preferredConfiguration = MKStandardMapConfiguration(elevationStyle: .realistic, emphasisStyle: .muted)
        view.addSubview(map)
        var coordinates = route.points.map { CLLocationCoordinate2D(latitude: $0[0],longitude: $0[1]) }
        let line = MKPolyline(coordinates: &coordinates,count: coordinates.count)
        map.addOverlay(line,level: .aboveRoads)
        routeBounds = line.boundingMapRect
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
        let label = UILabel(); label.text = "PROSSIMA FERMATA"; label.font = .systemFont(ofSize:12,weight:.bold); label.textColor = .secondaryLabel
        stopName.text = route.stops.first ?? "Solo percorso GPX"; stopName.font = UIFontMetrics(forTextStyle:.title2).scaledFont(for:.systemFont(ofSize:24,weight:.bold),maximumPointSize:34); stopName.adjustsFontForContentSizeCategory = true; stopName.numberOfLines = 2
        stopDistance.font = .monospacedDigitSystemFont(ofSize:19,weight:.semibold); stopDistance.textColor = .systemBlue
        status.font = UIFontMetrics(forTextStyle:.footnote).scaledFont(for:.systemFont(ofSize:13,weight:.medium),maximumPointSize:22); status.adjustsFontForContentSizeCategory = true; status.textColor = .secondaryLabel; status.numberOfLines = 2
        status.text = "GPX ufficiale · GPS in primo piano"
        let end = UIButton(type:.system); end.setTitle("Termina",for:.normal); end.tintColor = .systemRed; end.accessibilityIdentifier = "endNavigation"; touchTarget(end,width:78); end.addTarget(self,action:#selector(finish),for:.touchUpInside)
        let sound = UIButton(type:.system); sound.setImage(UIImage(systemName:voice ? "speaker.wave.2.fill" : "speaker.slash.fill"),for:.normal); sound.accessibilityLabel = "Attiva o disattiva annunci"; sound.accessibilityIdentifier = "toggleVoice"; touchTarget(sound); sound.addTarget(self,action:#selector(toggleVoice(_:)),for:.touchUpInside)
        let center = UIButton(type:.system); center.setImage(UIImage(systemName:"location.fill"),for:.normal); center.accessibilityLabel = "Centra GPS"; center.accessibilityIdentifier = "recenter"; touchTarget(center); center.addTarget(self,action:#selector(recenter),for:.touchUpInside)
        let compass = MKCompassButton(mapView:map); compass.compassVisibility = .visible
        compass.accessibilityLabel = "Orienta a nord"; compass.accessibilityIdentifier = "compass"; touchTarget(compass)
        let buttons = UIStackView(arrangedSubviews:[end,UIView(),sound,center]); buttons.spacing = 4; buttons.alignment = .center
        end.setContentCompressionResistancePriority(.required,for:.horizontal)
        let attribution = UILabel(); attribution.text = "GPX Academy · manovre © OpenStreetMap contributors"; attribution.font = .systemFont(ofSize:10); attribution.textColor = .secondaryLabel; attribution.numberOfLines = 2
        roadStatus.font = UIFont.preferredFont(forTextStyle: .footnote)
        roadStatus.adjustsFontForContentSizeCategory = true
        roadStatus.numberOfLines = 2
        roadStatus.textColor = .label
        roadStatus.isHidden = true
        let bottom = UIStackView(arrangedSubviews:[label,stopName,stopDistance,roadStatus,status,attribution]); bottom.axis = .vertical; bottom.spacing = 8
        bottomPanel = panel(bottom,dark:false,footer:buttons); bottomPanel.accessibilityIdentifier = "stopPanel"; view.addSubview(bottomPanel); view.addSubview(compass)
        let safe = view.safeAreaLayoutGuide
        speedSign.translatesAutoresizingMaskIntoConstraints = false
        speedSign.accessibilityIdentifier = "speedLimitSign"
        speedSign.isAccessibilityElement = true
        speedSign.textAlignment = .center
        speedSign.font = .monospacedDigitSystemFont(ofSize:19,weight:.bold)
        speedSign.textColor = .black
        speedSign.backgroundColor = .white
        speedSign.layer.cornerRadius = 23
        speedSign.layer.borderWidth = 4
        speedSign.layer.borderColor = UIColor(red:0.83,green:0.10,blue:0.13,alpha:1).cgColor
        speedSign.clipsToBounds = true
        speedSign.isHidden = true
        view.addSubview(speedSign)
        ticketButton.translatesAutoresizingMaskIntoConstraints = false
        ticketButton.setImage(TicketSheetView.calculatorImage(color: .black), for: .normal)
        ticketButton.tintColor = UIColor(red: 0.04, green: 0.43, blue: 0.31, alpha: 1)
        ticketButton.backgroundColor = .systemBackground.withAlphaComponent(0.94)
        ticketButton.layer.cornerRadius = 23
        ticketButton.layer.shadowColor = UIColor.black.cgColor; ticketButton.layer.shadowOpacity = 0.2
        ticketButton.layer.shadowRadius = 5; ticketButton.layer.shadowOffset = CGSize(width: 0, height: 2)
        ticketButton.accessibilityLabel = "Calcola biglietto a bordo"
        ticketButton.accessibilityIdentifier = "ticketButton"
        ticketButton.addTarget(self, action: #selector(toggleTicketSheet), for: .touchUpInside)
        ticketButton.isHidden = tickets == nil
        view.addSubview(ticketButton)

        NSLayoutConstraint.activate([
            topPanel.topAnchor.constraint(equalTo:safe.topAnchor,constant:8),
            topPanel.leadingAnchor.constraint(equalTo:safe.leadingAnchor,constant:12),
            topPanel.heightAnchor.constraint(greaterThanOrEqualToConstant:72),
            bottomPanel.bottomAnchor.constraint(equalTo:safe.bottomAnchor,constant:-8),
            bottomPanel.leadingAnchor.constraint(equalTo:topPanel.leadingAnchor),
            bottomPanel.widthAnchor.constraint(equalTo:topPanel.widthAnchor),
            compass.trailingAnchor.constraint(equalTo:safe.trailingAnchor,constant:-12),
            speedSign.trailingAnchor.constraint(equalTo:compass.leadingAnchor,constant:-8),
            speedSign.centerYAnchor.constraint(equalTo:compass.centerYAnchor),
            speedSign.widthAnchor.constraint(equalToConstant:46),
            speedSign.heightAnchor.constraint(equalTo:speedSign.widthAnchor),
            ticketButton.widthAnchor.constraint(equalTo:speedSign.widthAnchor),
            ticketButton.heightAnchor.constraint(equalTo:speedSign.heightAnchor),
            ticketButton.centerYAnchor.constraint(equalTo:compass.centerYAnchor)
        ])
        ticketPortrait = [ticketButton.leadingAnchor.constraint(equalTo:safe.leadingAnchor,constant:12)]
        ticketLandscape = [ticketButton.leadingAnchor.constraint(equalTo:topPanel.trailingAnchor,constant:12)]
        portraitConstraints = [
            topPanel.trailingAnchor.constraint(equalTo:safe.trailingAnchor,constant:-12),
            topPanel.heightAnchor.constraint(lessThanOrEqualTo:safe.heightAnchor,multiplier:0.42),
            bottomPanel.heightAnchor.constraint(lessThanOrEqualTo:safe.heightAnchor,multiplier:0.48),
            bottomPanel.topAnchor.constraint(greaterThanOrEqualTo:topPanel.bottomAnchor,constant:60),
            compass.bottomAnchor.constraint(equalTo:bottomPanel.topAnchor,constant:-9)
        ]
        let columnWidth = topPanel.widthAnchor.constraint(equalTo:safe.widthAnchor,multiplier:0.38)
        columnWidth.priority = UILayoutPriority(999)
        landscapeConstraints = [
            columnWidth,
            topPanel.widthAnchor.constraint(greaterThanOrEqualToConstant:210),
            topPanel.widthAnchor.constraint(lessThanOrEqualToConstant:280),
            topPanel.heightAnchor.constraint(lessThanOrEqualTo:safe.heightAnchor,multiplier:0.42),
            bottomPanel.topAnchor.constraint(greaterThanOrEqualTo:topPanel.bottomAnchor,constant:8),
            compass.bottomAnchor.constraint(equalTo:safe.bottomAnchor,constant:-12)
        ]
        // MapKit installs its own recognizers on internal subviews. Observe gestures
        // independently and simultaneously, without stealing map scrolling/zooming.
        for recognizer in [UIPanGestureRecognizer(target:self,action:#selector(mapGesture(_:))),
                           UIPinchGestureRecognizer(target:self,action:#selector(mapGesture(_:))),
                           UIRotationGestureRecognizer(target:self,action:#selector(mapGesture(_:)))] {
            recognizer.delegate = self; recognizer.cancelsTouchesInView = false
            map.addGestureRecognizer(recognizer)
        }
    }

    private func touchTarget(_ button: UIView,width:CGFloat = 44) {
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant:width),
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

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        let isLandscape = view.bounds.width > view.bounds.height
        guard landscape != isLandscape else { return }
        closeTicketSheet()   // its constraints belong to the previous orientation
        NSLayoutConstraint.deactivate(portraitConstraints + landscapeConstraints + ticketPortrait + ticketLandscape)
        NSLayoutConstraint.activate(isLandscape ? landscapeConstraints + ticketLandscape : portraitConstraints + ticketPortrait)
        landscape = isLandscape
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let safe = view.safeAreaLayoutGuide.layoutFrame
        let left = landscape == true ? topPanel.frame.maxX + 8 : safe.minX + 8
        let top = landscape == true ? safe.minY + 8 : topPanel.frame.maxY + 8
        let bottom = landscape == true ? safe.maxY - 8 : bottomPanel.frame.minY - 8
        let viewport = CGRect(x:left,y:top,width:safe.maxX-8-left,height:bottom-top)
        guard viewport.width > 0, viewport.height > 0, cameraViewport != viewport else { return }
        let initialLayout = cameraViewport.isEmpty
        cameraViewport = viewport
        let margins = UIEdgeInsets(top:viewport.minY,left:viewport.minX,
                                   bottom:map.bounds.maxY-viewport.maxY,right:map.bounds.maxX-viewport.maxX)
        // MapKit's legal label sits at the bottom-left of the margins: keep it beside
        // the ticket button instead of under it. The camera uses `cameraViewport`.
        var ornaments = margins
        if !ticketButton.isHidden { ornaments.left = max(ornaments.left, ticketButton.frame.maxX + 6) }
        map.layoutMargins = ornaments
        if initialLayout && fix == nil {
            map.setVisibleMapRect(routeBounds,edgePadding:margins,animated:false)
        }
        updateCamera()
    }
    func location(_ location: CLLocation) {
        fix = location
        puck.coordinate = location.coordinate
        if !map.annotations.contains(where: { $0 === puck }) { map.addAnnotation(puck) }
        refreshHeading()
        updateCamera()
        orientPuck()
    }
    func message(_ message: String) { status.text = message }
    func update(along:Double,deviation:Double,stop:Int,reliable:Bool) {
        let limit = reliable ? fix.flatMap {
            route.speedLimit(at: along, accuracy: $0.horizontalAccuracy, deviation: deviation)
        } : nil
        speedSign.text = limit.map { String($0) }
        speedSign.accessibilityLabel = limit.map { "Limite di velocità \($0) chilometri orari" }
        speedSign.isHidden = limit == nil
        var roadDetails: [String] = []
        if reliable, deviation < 45 {
            if let index = route.nextCamera(at: along, within: 350), let camera = route.roadCameras?[index] {
                roadDetails.append("\(camera.title) · \(distance(camera.at - along))")
            }
        }
        roadStatus.text = roadDetails.joined(separator: "\n")
        roadStatus.isHidden = roadDetails.isEmpty
        progress = along; self.reliable = reliable
        refreshHeading()
        defer { orientPuck() }
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
    private func distance(_ m:Double) -> String { DistanceText.display(m) }
    /// Direction of travel: route bearing while matched, otherwise the GPS course.
    private func refreshHeading() {
        guard let fix else { return }
        if reliable {
            let a = geometry.coordinate(at:progress), b = geometry.coordinate(at:progress+40)
            if GPXTracker.metres(a,b) > 10 {
                let r = Double.pi/180, d = (b[1]-a[1])*r
                lastHeading = atan2(sin(d)*cos(b[0]*r),cos(a[0]*r)*sin(b[0]*r)-sin(a[0]*r)*cos(b[0]*r)*cos(d))/r
            }
        } else if fix.course >= 0 && fix.speed > 3 { lastHeading = fix.course }
    }
    private func orientPuck() {
        puckView?.orient(heading: lastHeading, mapHeading: map.camera.heading, pitch: map.camera.pitch)
    }
    private func updateCamera() {
        guard following, let fix else { return }
        // Use actual GPS position; route bearing is only appropriate while matched.
        let heading = lastHeading
        let camera = MKMapCamera(lookingAtCenter:fix.coordinate,fromDistance:650,pitch:55,heading:heading)
        map.setCamera(camera,animated:false)
        guard !cameraViewport.isEmpty else { return }
        let anchor = CGPoint(x:cameraViewport.midX,y:cameraViewport.minY + cameraViewport.height * Self.positionAnchor)
        // Use the projected ground point so the offset also works with pitch and heading.
        let actual = map.convert(fix.coordinate,toPointTo:map)
        let underAnchor = map.convert(anchor,toCoordinateFrom:map)
        guard CLLocationCoordinate2DIsValid(underAnchor),
              hypot(actual.x-anchor.x,actual.y-anchor.y) > 1 else { return }
        let target = MKMapPoint(fix.coordinate), ground = MKMapPoint(underAnchor)
        let center = MKMapPoint(camera.centerCoordinate)
        camera.centerCoordinate = MKMapPoint(x:center.x+target.x-ground.x,y:center.y+target.y-ground.y).coordinate
        map.setCamera(camera,animated:false)
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
    @objc private func mapGesture(_ gesture: UIGestureRecognizer) {
        if gesture.state == .began || gesture.state == .changed { following = false }
    }
    @objc private func recenter() { following = true; updateCamera() }
    @objc private func repeatCue() { onRepeat?() }
    @objc private func toggleVoice(_ sender:UIButton) { voice.toggle(); sender.setImage(UIImage(systemName:voice ? "speaker.wave.2.fill" : "speaker.slash.fill"),for:.normal); onVoiceToggle?(voice) }
    @objc private func finish() { onEnd?(); dismiss(animated:true) }
    @objc private func toggleTicketSheet() {
        if ticketSheet != nil { closeTicketSheet(); return }
        guard let data = tickets else { return }
        let sheet = TicketSheetView(data: data)
        sheet.onClose = { [weak self] in self?.closeTicketSheet() }
        sheet.onLineChange = { [weak self, weak sheet] in
            guard let fix = self?.fix else { return }
            sheet?.suggestBoarding(latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude)
        }
        if let fix { sheet.suggestBoarding(latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude) }
        view.addSubview(sheet)
        let safe = view.safeAreaLayoutGuide
        let aboveTools = sheet.bottomAnchor.constraint(equalTo: ticketButton.bottomAnchor)
        aboveTools.priority = UILayoutPriority(730)   // gives way (down over the stop panel) on short screens
        let width = sheet.widthAnchor.constraint(equalToConstant: 420); width.priority = .defaultLow
        var constraints = [aboveTools, width,
            sheet.bottomAnchor.constraint(lessThanOrEqualTo: safe.bottomAnchor, constant: -8),
            sheet.trailingAnchor.constraint(lessThanOrEqualTo: safe.trailingAnchor, constant: -12),
            sheet.leadingAnchor.constraint(equalTo: landscape == true ? topPanel.trailingAnchor : safe.leadingAnchor, constant: 12)]
        if landscape == true {
            constraints.append(sheet.topAnchor.constraint(greaterThanOrEqualTo: safe.topAnchor, constant: 8))
        } else {
            constraints.append(sheet.topAnchor.constraint(greaterThanOrEqualTo: topPanel.bottomAnchor, constant: 8))
            constraints.append(sheet.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -12))
        }
        NSLayoutConstraint.activate(constraints)
        ticketSheet = sheet
        ticketButton.layer.borderWidth = 3
        ticketButton.layer.borderColor = ticketButton.tintColor.cgColor
        UIAccessibility.post(notification: .layoutChanged, argument: sheet)
    }
    private func closeTicketSheet() {
        ticketSheet?.removeFromSuperview(); ticketSheet = nil
        ticketButton.layer.borderWidth = 0
    }
    func mapView(_ mapView:MKMapView,rendererFor overlay:MKOverlay) -> MKOverlayRenderer {
        let renderer = MKPolylineRenderer(overlay:overlay); renderer.strokeColor = .systemBlue; renderer.lineWidth = 8; renderer.lineCap = .round; renderer.lineJoin = .round; return renderer
    }
    func mapView(_ mapView:MKMapView,viewFor annotation:MKAnnotation) -> MKAnnotationView? {
        guard !(annotation is MKUserLocation) else { return nil }
        if annotation === puck {
            let view = (mapView.dequeueReusableAnnotationView(withIdentifier: NavigationPuckView.identifier) as? NavigationPuckView)
                ?? NavigationPuckView(annotation: annotation, reuseIdentifier: NavigationPuckView.identifier)
            view.annotation = annotation
            view.accessibilityLabel = simulated ? "Posizione simulata" : "Posizione attuale"
            puckView = view
            orientPuck()
            return view
        }
        let pin = MKMarkerAnnotationView(annotation:annotation,reuseIdentifier:"stop"); pin.markerTintColor = .systemBlue; pin.glyphImage = UIImage(systemName:"bus.fill"); pin.canShowCallout = true; pin.displayPriority = .defaultLow; return pin
    }
    // Keep the arrow pointing along the road while the driver rotates or tilts the map.
    func mapViewDidChangeVisibleRegion(_ mapView: MKMapView) { orientPuck() }
}

/// Blue navigation arrow with a white outline, lying on the road like the Apple Maps puck.
final class NavigationPuckView: MKAnnotationView {
    static let identifier = "navigationPuck"
    private static let size: CGFloat = 54
    private let arrow = UIImageView(image: NavigationPuckView.arrowImage)

    static let arrowImage: UIImage = {
        let side = NavigationPuckView.size
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { context in
            let path = UIBezierPath()
            path.move(to: CGPoint(x: side * 0.5, y: side * 0.10))
            path.addLine(to: CGPoint(x: side * 0.84, y: side * 0.86))
            path.addLine(to: CGPoint(x: side * 0.5, y: side * 0.69))
            path.addLine(to: CGPoint(x: side * 0.16, y: side * 0.86))
            path.close()
            path.lineJoinStyle = .round
            path.lineWidth = 7
            context.cgContext.setShadow(offset: CGSize(width: 0, height: 1.5), blur: 5,
                                        color: UIColor.black.withAlphaComponent(0.35).cgColor)
            UIColor.white.setStroke(); path.stroke()
            context.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
            UIColor(red: 0.0, green: 0.48, blue: 1.0, alpha: 1).setFill(); path.fill()
        }
    }()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: Self.size, height: Self.size)
        arrow.frame = bounds
        addSubview(arrow)
        canShowCallout = false
        isAccessibilityElement = true
        accessibilityIdentifier = "navigationArrow"
        displayPriority = .required
        zPriority = .max
        collisionMode = .circle
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// Rotates the arrow towards the direction of travel and lays it on the tilted map.
    func orient(heading: CLLocationDirection, mapHeading: CLLocationDirection, pitch: CGFloat) {
        let angle = CGFloat((heading - mapHeading) * .pi / 180)
        var perspective = CATransform3DIdentity
        perspective.m34 = -1 / 500
        let tilt = CATransform3DMakeRotation(min(max(pitch, 0), 60) * .pi / 180 * 0.8, 1, 0, 0)
        arrow.layer.transform = CATransform3DConcat(CATransform3DConcat(CATransform3DMakeRotation(angle, 0, 0, 1), tilt), perspective)
    }
}
