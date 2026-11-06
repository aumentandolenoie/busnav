import Foundation
import WebKit
import UniformTypeIdentifiers

// Serves the exact PWA files bundled at build time without relying on Vercel.
// WKURLSchemeHandler serves HTML, JSON, JS, CSS and icons from the signed app.
final class BundledSite: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              url.host == "app" else {
            fail(urlSchemeTask, "Invalid bundled URL")
            return
        }
        let raw = url.path == "/" ? "index.html" : String(url.path.dropFirst())
        guard !raw.contains(".."), !raw.contains("\\"),
              !raw.hasPrefix("/") else {
            fail(urlSchemeTask, "Invalid bundled path")
            return
        }
        let bundle = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true)
        let file = bundle.appendingPathComponent(raw)
        guard let data = try? Data(contentsOf: file) else {
            fail(urlSchemeTask, "File not found: \(raw)")
            return
        }
        let ext = file.pathExtension.lowercased()
        let mime: String
        switch ext {
        case "html": mime = "text/html"
        case "js": mime = "application/javascript"
        case "css": mime = "text/css"
        case "json", "webmanifest": mime = "application/json"
        case "svg": mime = "image/svg+xml"
        default: mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        }
        let response = URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: ext == "html" || ext == "js" || ext == "css" || ext == "json" ? "utf-8" : nil)
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func fail(_ task: WKURLSchemeTask, _ message: String) {
        task.didFailWithError(NSError(domain: "LineaPilot.Bundle", code: 404, userInfo: [NSLocalizedDescriptionKey: message]))
    }
}
