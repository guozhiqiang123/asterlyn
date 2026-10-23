// Native filesystem/bookmark operations for the local macOS installer. No UI automation.
import Foundation
import AppKit
import Darwin

func decodeHex(_ hex: String) throws -> Data {
    guard hex.count % 2 == 0 && hex.count <= 131_072 else { throw CocoaError(.fileReadCorruptFile) }
    var bytes = [UInt8]()
    var index = hex.startIndex
    while index < hex.endIndex {
        let end = hex.index(index, offsetBy: 2)
        guard let byte = UInt8(hex[index..<end], radix: 16) else { throw CocoaError(.fileReadCorruptFile) }
        bytes.append(byte)
        index = end
    }
    return Data(bytes)
}

func resolveBookmark(_ hex: String) throws -> (URL, Bool) {
    var stale = false
    let url = try URL(resolvingBookmarkData: decodeHex(hex), options: [.withoutUI, .withoutMounting],
                      relativeTo: nil, bookmarkDataIsStale: &stale)
    return (url, stale)
}

func output(_ value: Any) throws {
    print(String(data: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!)
}

do {
    let args = CommandLine.arguments
    guard args.count >= 2 else { throw CocoaError(.fileReadUnknown) }
    switch args[1] {
    case "swap":
        guard args.count == 4 else { throw CocoaError(.fileReadUnknown) }
        // Same-volume atomic exchange keeps the installed .app inode and its bookmark identity.
        guard renamex_np(args[2], args[3], UInt32(RENAME_SWAP)) == 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        try output(["swapped": true])
    case "bookmark":
        guard args.count == 3 else { throw CocoaError(.fileReadUnknown) }
        let url = URL(fileURLWithPath: args[2])
        guard try url.resourceValues(forKeys: [.isApplicationKey]).isApplication == true else {
            throw CocoaError(.fileReadUnsupportedScheme)
        }
        let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        try output(["path": url.path, "bookmarkHex": data.map { String(format: "%02x", $0) }.joined()])
    case "resolve", "open":
        let input = FileHandle.standardInput.readDataToEndOfFile()
        guard input.count <= 2 * 1024 * 1024,
              let records = try JSONSerialization.jsonObject(with: input) as? [[String: Any]],
              records.count <= 128 else { throw CocoaError(.fileReadCorruptFile) }
        var results = [[String: Any]]()
        for record in records {
            guard let hex = record["bookmarkHex"] as? String else { throw CocoaError(.fileReadCorruptFile) }
            do {
                let (url, stale) = try resolveBookmark(hex)
                let application = (try? url.resourceValues(forKeys: [.isApplicationKey]).isApplication) == true
                var result: [String: Any] = ["path": url.path, "stale": stale, "isApplication": application]
                if let id = record["item_id"] { result["item_id"] = id }
                if args[1] == "open" {
                    guard args.count == 3, url.standardizedFileURL.path == URL(fileURLWithPath: args[2]).standardizedFileURL.path,
                          application else { throw CocoaError(.fileReadCorruptFile) }
                    result["opened"] = NSWorkspace.shared.open(url)
                }
                results.append(result)
            } catch {
                if args[1] == "open" { throw error }
                results.append(["item_id": record["item_id"] ?? NSNull(), "unresolved": true])
            }
        }
        try output(results)
    default:
        throw CocoaError(.fileReadUnknown)
    }
} catch {
    fputs("macOS app operation failed: \(error)\n", stderr)
    exit(1)
}
