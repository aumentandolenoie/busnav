import Foundation
import WebKit
import UniformTypeIdentifiers

// Bundled resources are served under a single custom origin. The GTFS ZIP is
// downloaded by native URLSession to avoid WKWebView custom-scheme CORS failures.
final class BundledSite: NSObject, WKURLSchemeHandler {
    private var downloads: [ObjectIdentifier: URLSessionDataTask] = [:]
    private let feed = URL(string: "https://proxy.busone.app/biv/gtfs.zip")!

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.host == "app" else {
            fail(urlSchemeTask, "Invalid bundled URL")
            return
        }
        let raw = url.path == "/" ? "index.html" : String(url.path.dropFirst())
        guard !raw.contains(".."), !raw.contains("\\"), !raw.hasPrefix("/") else {
            fail(urlSchemeTask, "Invalid bundled path")
            return
        }
        if raw == "gtfs.zip" {
            downloadGTFS(urlSchemeTask)
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
        let response = URLResponse(url: url, mimeType: mime, expectedContentLength: data.count,
            textEncodingName: ["html", "js", "css", "json"].contains(ext) ? "utf-8" : nil)
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let id = ObjectIdentifier(urlSchemeTask as AnyObject)
        downloads.removeValue(forKey: id)?.cancel()
    }

    private func downloadGTFS(_ urlSchemeTask: WKURLSchemeTask) {
        let id = ObjectIdentifier(urlSchemeTask as AnyObject)
        let task = URLSession.shared.dataTask(with: feed) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self, self.downloads.removeValue(forKey: id) != nil else { return }
                if let error {
                    self.fail(urlSchemeTask, "GTFS: \(error.localizedDescription)")
                    return
                }
                guard let data, data.count > 1000, let http = response as? HTTPURLResponse,
                      (200..<300).contains(http.statusCode),
                      let localURL = urlSchemeTask.request.url else {
                    self.fail(urlSchemeTask, "Download GTFS non riuscito")
                    return
                }
                let result = URLResponse(url: localURL, mimeType: "application/zip",
                    expectedContentLength: data.count, textEncodingName: nil)
                urlSchemeTask.didReceive(result)
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
            }
        }
        downloads[id] = task
        task.resume()
    }

    private func fail(_ task: WKURLSchemeTask, _ message: String) {
        task.didFailWithError(NSError(domain: "LineaPilot.Bundle", code: 404,
            userInfo: [NSLocalizedDescriptionKey: message]))
    }
}
