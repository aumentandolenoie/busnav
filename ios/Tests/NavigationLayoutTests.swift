import XCTest
import UIKit
@testable import LineaPilot

@MainActor final class NavigationLayoutTests: XCTestCase {
    func testNavigationControlsStayInsideSafeAreaAndDoNotOverlap() throws {
        let payload: [String: Any] = [
            "name":"Prova layout", "points":[[45.0,11.0],[45.0,11.01]],
            "offsets":[700], "stops":["PADOVA AUTOSTAZIONE – CAPOLINEA PROVVISORIO VIALE DELLA STAZIONE"],
            "turns":[["at":300,"side":"destra","text":"Alla prossima rotonda prendi la terza uscita in direzione Aeroporto Marco Polo e prosegui lungo il percorso ufficiale", "verifiedRoad":true]]
        ]
        let route = try JSONDecoder().decode(NativeRoute.self,from:JSONSerialization.data(withJSONObject:payload))
        for size in [CGSize(width:320,height:568),CGSize(width:375,height:667),CGSize(width:390,height:844),CGSize(width:440,height:956)] {
            for category in [UIContentSizeCategory.large,.accessibilityExtraExtraExtraLarge] {
                let root = UIViewController()
                let window = UIWindow(frame:CGRect(origin:.zero,size:size))
                window.rootViewController = root; window.isHidden = false
                root.view.frame = CGRect(origin:.zero,size:size)
                root.additionalSafeAreaInsets = UIEdgeInsets(top:62,left:0,bottom:34,right:0)
                let drive = DriveViewController(route:route,voiceEnabled:true)
                root.addChild(drive); root.view.addSubview(drive.view)
                drive.view.frame = root.view.bounds
                drive.didMove(toParent:root)
                root.setOverrideTraitCollection(UITraitCollection(preferredContentSizeCategory:category),forChild:drive)
                drive.message("GPS in verifica: attendere una posizione accurata prima degli annunci vocali.")
                drive.update(along:0,deviation:0,stop:0,reliable:true)
                root.view.setNeedsLayout(); root.view.layoutIfNeeded(); drive.view.layoutIfNeeded()
                let safe = drive.view.safeAreaLayoutGuide.layoutFrame
                XCTAssertGreaterThanOrEqual(safe.minY,62)
                let ids = ["endNavigation","toggleVoice","recenter","repeatCue","compass"]
                let buttons = descendants(drive.view).compactMap { $0 as? UIControl }.filter { ids.contains($0.accessibilityIdentifier ?? "") }
                XCTAssertEqual(buttons.count,5)
                let frames = buttons.map { $0.convert($0.bounds,to:drive.view) }
                for (i,frame) in frames.enumerated() {
                    XCTAssertGreaterThanOrEqual(frame.width,43.9,"\(ids[i]) width at \(size)")
                    XCTAssertGreaterThanOrEqual(frame.height,43.9)
                    XCTAssertTrue(safe.insetBy(dx:-0.5,dy:-0.5).contains(frame),"Unsafe control \(buttons[i].accessibilityIdentifier ?? ""): \(frame) safe \(safe) at \(size)")
                    XCTAssertFalse(buttons[i].hasAmbiguousLayout)
                    for other in frames.dropFirst(i+1) { XCTAssertFalse(frame.intersects(other),"Controls overlap at \(size)") }
                }
                let panels = descendants(drive.view).filter { ["instructionPanel","stopPanel"].contains($0.accessibilityIdentifier ?? "") }
                XCTAssertEqual(panels.count,2)
                XCTAssertFalse(panels[0].frame.intersects(panels[1].frame))
                let image = UIGraphicsImageRenderer(size:size).image { _ in root.view.drawHierarchy(in:root.view.bounds,afterScreenUpdates:true) }
                let attachment = XCTAttachment(image:image); attachment.name = "Navigation-\(Int(size.width))-\(category.rawValue)"; attachment.lifetime = .keepAlways; add(attachment)
                window.isHidden = true
                drive.willMove(toParent:nil); drive.view.removeFromSuperview(); drive.removeFromParent()
            }
        }
    }
    private func descendants(_ view: UIView) -> [UIView] {
        view.subviews.flatMap { [$0] + descendants($0) }
    }
}
