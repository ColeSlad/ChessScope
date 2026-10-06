import AppKit
import Foundation

// Original vector artwork, rendered with macOS tools; no downloaded icon assets.
let output = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("resources")
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor(calibratedRed: 0.10, green: 0.17, blue: 0.26, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 64, y: 64, width: 896, height: 896), xRadius: 196, yRadius: 196).fill()
let knight = NSBezierPath()
let points: [(CGFloat, CGFloat)] = [
    (5, 20), (20, 20), (18, 17), (17, 13), (20, 10), (20, 8),
    (17, 4), (12, 3), (12, 6), (8, 8), (5, 13), (8, 15),
    (12, 11), (13, 14), (10, 17), (7, 17)
]
func point(_ pair: (CGFloat, CGFloat)) -> NSPoint {
    NSPoint(x: 120 + pair.0 * 31, y: 884 - pair.1 * 31)
}
knight.move(to: point(points[0]))
for pair in points.dropFirst() { knight.line(to: point(pair)) }
knight.close()
NSColor(calibratedRed: 0.93, green: 0.92, blue: 0.86, alpha: 1).setFill()
knight.fill()
NSColor(calibratedRed: 0.10, green: 0.17, blue: 0.26, alpha: 1).setFill()
let eye = point((16.5, 8))
NSBezierPath(ovalIn: NSRect(x: eye.x - 15, y: eye.y - 15, width: 30, height: 30)).fill()
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent("app-icon.png"))
let iconset = output.appendingPathComponent("app-icon.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
func run(_ executable: String, _ args: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = args
    process.standardOutput = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()
    if process.terminationStatus != 0 { fatalError("Icon conversion failed") }
}
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = String(size * scale)
        let name = "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"
        try run("/usr/bin/sips", ["-z", pixels, pixels, output.appendingPathComponent("app-icon.png").path,
            "--out", iconset.appendingPathComponent(name).path])
    }
}
try run("/usr/bin/iconutil", ["-c", "icns", iconset.path, "-o", output.appendingPathComponent("app-icon.icns").path])
try FileManager.default.removeItem(at: iconset)
print("Generated Chess Helper app icon.")
