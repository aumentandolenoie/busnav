import XCTest
import UIKit
import MapKit
@testable import LineaPilot

@MainActor final class NavigationLayoutTests: XCTestCase {
    func testNavigationControlsStayInsideSafeAreaAndDoNotOverlap() throws {
        let payload: [String: Any] = [
            "name":"Prova layout", "points":[[45.0,11.0],[45.0,11.01]],
            "offsets":[700], "stops":["PADOVA AUTOSTAZIONE – CAPOLINEA PROVVISORIO VIALE DELLA STAZIONE"],
            "coverage":["ranges":[[0,700]],"complete":false,"percent":90], "speedLimits":[[0,200,50]],
            "turns":[["at":300,"side":"destra","text":"Alla prossima rotonda prendi la terza uscita in direzione Aeroporto Marco Polo e prosegui lungo il percorso ufficiale", "verifiedRoad":true]]
        ]
        let route = try JSONDecoder().decode(NativeRoute.self,from:JSONSerialization.data(withJSONObject:payload))
        for size in [CGSize(width:320,height:568),CGSize(width:375,height:667),CGSize(width:390,height:844),CGSize(width:440,height:956),CGSize(width:568,height:320),CGSize(width:956,height:440)] {
            for category in [UIContentSizeCategory.large,.accessibilityExtraExtraExtraLarge] {
                let root = UIViewController()
                let window = UIWindow(frame:CGRect(origin:.zero,size:size))
                window.rootViewController = root; window.isHidden = false
                root.view.frame = CGRect(origin:.zero,size:size)
                let landscape = size.width > size.height
                root.additionalSafeAreaInsets = landscape
                    ? UIEdgeInsets(top:0,left:44,bottom:21,right:44)
                    : UIEdgeInsets(top:62,left:0,bottom:34,right:0)
                let drive = DriveViewController(route:route,voiceEnabled:true)
                root.addChild(drive); root.view.addSubview(drive.view)
                drive.view.frame = root.view.bounds
                drive.didMove(toParent:root)
                root.setOverrideTraitCollection(UITraitCollection(preferredContentSizeCategory:category),forChild:drive)
                drive.message("GPS in verifica: attendere una posizione accurata prima degli annunci vocali.")
                drive.update(along:0,deviation:0,stop:0,reliable:true)
                root.view.setNeedsLayout(); root.view.layoutIfNeeded(); drive.view.layoutIfNeeded()
                let safe = drive.view.safeAreaLayoutGuide.layoutFrame
                if !landscape { XCTAssertGreaterThanOrEqual(safe.minY,62) }
                let ids = ["endNavigation","toggleVoice","recenter","repeatCue","compass"]
                let buttons = descendants(drive.view).filter { ids.contains($0.accessibilityIdentifier ?? "") }
                XCTAssertEqual(buttons.count,5)
                let frames = buttons.map { $0.convert($0.bounds,to:drive.view) }
                for (i,frame) in frames.enumerated() {
                    XCTAssertGreaterThanOrEqual(frame.width,43.9,"\(ids[i]) width at \(size)")
                    XCTAssertGreaterThanOrEqual(frame.height,43.9)
                    XCTAssertTrue(safe.insetBy(dx:-0.5,dy:-0.5).contains(frame),"Unsafe control \(buttons[i].accessibilityIdentifier ?? ""): \(frame) safe \(safe) at \(size)")
                    XCTAssertFalse(buttons[i].hasAmbiguousLayout,"Ambiguous control \(buttons[i].accessibilityIdentifier ?? "") at \(size)")
                    for other in frames.dropFirst(i+1) { XCTAssertFalse(frame.intersects(other),"Controls overlap at \(size)") }
                }
                let panels = descendants(drive.view).filter { ["instructionPanel","stopPanel"].contains($0.accessibilityIdentifier ?? "") }
                XCTAssertEqual(panels.count,2)
                XCTAssertFalse(panels[0].frame.intersects(panels[1].frame))
                if landscape {
                    XCTAssertGreaterThan(safe.maxX - panels.map { $0.frame.maxX }.max()!, safe.width * 0.45)
                }
                let sign = descendants(drive.view).first { $0.accessibilityIdentifier == "speedLimitSign" } as! UILabel
                XCTAssertFalse(sign.isHidden)
                XCTAssertEqual(sign.text,"50")
                XCTAssertTrue(safe.contains(sign.frame))
                for frame in frames { XCTAssertFalse(sign.frame.intersects(frame)) }
                for panel in panels { XCTAssertFalse(sign.frame.intersects(panel.frame)) }
                let image = UIGraphicsImageRenderer(size:size).image { _ in root.view.drawHierarchy(in:root.view.bounds,afterScreenUpdates:true) }
                let attachment = XCTAttachment(image:image); attachment.name = "Navigation-\(Int(size.width))-\(category.rawValue)"; attachment.lifetime = .keepAlways; add(attachment)
                drive.update(along:250,deviation:0,stop:0,reliable:true)
                XCTAssertTrue(sign.isHidden)
                drive.update(along:0,deviation:50,stop:0,reliable:true)
                XCTAssertTrue(sign.isHidden)
                drive.update(along:0,deviation:0,stop:0,reliable:false)
                XCTAssertTrue(sign.isHidden)
                window.isHidden = true
                drive.willMove(toParent:nil); drive.view.removeFromSuperview(); drive.removeFromParent()
            }
        }
    }
    func testPreparationUsesMapKitAndPreservesGpx() {
        let preview = RoutePreviewView(frame:CGRect(x:0,y:0,width:375,height:280))
        let points = [[45.0,11.0],[45.0,11.01],[45.01,11.01]]
        preview.show(["points":points,"stops":["Fermata"],"stopCoordinates":[[45.0,11.005]]])
        preview.layoutIfNeeded()
        XCTAssertTrue(preview.map is MKMapView)
        let line = preview.map.overlays.first as! MKPolyline
        XCTAssertEqual(line.pointCount,points.count)
        var actual = Array(repeating:CLLocationCoordinate2D(),count:points.count)
        line.getCoordinates(&actual,range:NSRange(location:0,length:points.count))
        for i in points.indices { XCTAssertEqual(actual[i].latitude,points[i][0],accuracy:0.000001); XCTAssertEqual(actual[i].longitude,points[i][1],accuracy:0.000001) }
        let fit = descendants(preview).first { $0.accessibilityIdentifier == "previewCenterGPS" }!
        XCTAssertGreaterThanOrEqual(fit.bounds.width,44); XCTAssertGreaterThanOrEqual(fit.bounds.height,44)
    }
    func testDraggingSuspendsCameraUntilPositionButtonIsPressed() throws {
        let data = "{\"name\":\"Test\",\"points\":[[45,11],[45,11.01]],\"offsets\":[],\"stops\":[],\"turns\":[]}".data(using:.utf8)!
        let route = try JSONDecoder().decode(NativeRoute.self,from:data)
        let drive = DriveViewController(route:route,voiceEnabled:false)
        drive.loadViewIfNeeded(); drive.view.frame = CGRect(x:0,y:0,width:390,height:844); drive.view.layoutIfNeeded()
        let map = descendants(drive.view).compactMap { $0 as? MKMapView }.first!
        let first = CLLocation(latitude:45,longitude:11)
        drive.location(first)
        let pan = BeganPan()
        drive.perform(NSSelectorFromString("mapGesture:"),with:pan)
        let before = map.camera.centerCoordinate
        drive.location(CLLocation(latitude:45.01,longitude:11.02))
        drive.update(along:100,deviation:0,stop:0,reliable:true)
        XCTAssertEqual(map.camera.centerCoordinate.latitude,before.latitude,accuracy:0.000001)
        XCTAssertEqual(map.camera.centerCoordinate.longitude,before.longitude,accuracy:0.000001)
        let center = descendants(drive.view).first { $0.accessibilityIdentifier == "recenter" } as! UIButton
        center.sendActions(for:.touchUpInside)
        let point = map.convert(CLLocationCoordinate2D(latitude:45.01,longitude:11.02),toPointTo:map)
        let top = descendants(drive.view).first { $0.accessibilityIdentifier == "instructionPanel" }!.frame.maxY + 8
        let bottom = descendants(drive.view).first { $0.accessibilityIdentifier == "stopPanel" }!.frame.minY - 8
        XCTAssertEqual(point.x,map.bounds.midX,accuracy:12)
        XCTAssertEqual(point.y,top + (bottom - top) * 0.63,accuracy:24)
        XCTAssertTrue(map.gestureRecognizers!.contains { $0 is UIPanGestureRecognizer && $0.delegate === drive })
    }
    private final class BeganPan: UIPanGestureRecognizer { override var state: UIGestureRecognizer.State { get { .began } set {} } }
    func testVoiceChainsTheNextEventInRouteOrder() throws {
        func route(stopAt: Double, secondAt: Double = 360, ranges: [[Double]] = [[0,700]]) throws -> NativeRoute {
            let payload: [String: Any] = [
                "points": [[45.0,11.0],[45.0,11.01]], "offsets": [stopAt], "stops": ["Padova Autostazione"],
                "coverage": ["ranges": ranges, "complete": false, "percent": 90],
                "turns": [
                    ["at": 300, "side": "rotatoria", "text": "Alla rotonda, prendi la seconda uscita.", "verifiedRoad": true],
                    ["at": secondAt, "side": "sinistra", "text": "Svolta a sinistra.", "verifiedRoad": true]
                ]
            ]
            return try JSONDecoder().decode(NativeRoute.self, from: JSONSerialization.data(withJSONObject: payload))
        }
        let stopFirst = try route(stopAt: 340)
        let stop = stopFirst.continuation(after: 0, from: 100, stopIndex: 0)
        XCTAssertEqual(stop?.isStop, true)
        XCTAssertEqual(stopFirst.voiceMessage(stopFirst.turns[0].text!, distance: 200, continuation: stop),
            "Tra circa 200 metri, alla rotonda, prendi la seconda uscita, poi prossima fermata: Padova Autostazione.")
        let turnFirst = try route(stopAt: 420)
        let turn = turnFirst.continuation(after: 0, from: 100, stopIndex: 0)
        XCTAssertEqual(turn?.isStop, false)
        XCTAssertEqual(turnFirst.voiceMessage("Svolta a destra.", distance: nil, continuation: turn),
            "Svolta a destra, poi svolta a sinistra.")
        XCTAssertNil(try route(stopAt: 280).continuation(after: 0, from: 100, stopIndex: 0))
        XCTAssertNil(try route(stopAt: 420, secondAt: 405).continuation(after: 0, from: 100, stopIndex: 0))
        XCTAssertNil(try route(stopAt: 420, ranges: [[0,320],[330,700]]).continuation(after: 0, from: 100, stopIndex: 0))
    }

    private func descendants(_ view: UIView) -> [UIView] {
        view.subviews.flatMap { [$0] + descendants($0) }
    }
}


