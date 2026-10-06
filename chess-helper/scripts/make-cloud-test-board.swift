import AppKit
import Foundation
// A synthetic connectivity sample, never a recorded-site qualification fixture.
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 512, pixelsHigh: 512,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
let rows = ["rnbqkbnr", "pppppppp", "        ", "        ", "        ", "        ", "PPPPPPPP", "RNBQKBNR"]
let glyphs: [Character: String] = ["r":"♜", "n":"♞", "b":"♝", "q":"♛", "k":"♚", "p":"♟"]
for row in 0..<8 {
    for (column, piece) in rows[row].enumerated() {
        let square = NSRect(x: column * 64, y: (7-row) * 64, width: 64, height: 64)
        (row + column) % 2 == 0 ? NSColor(calibratedWhite: 0.90, alpha: 1).setFill() : NSColor(calibratedRed: 0.47, green: 0.58, blue: 0.68, alpha: 1).setFill()
        NSBezierPath(rect: square).fill()
        if piece != " " {
            let glyph = glyphs[Character(String(piece).lowercased())]!
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont(name: "Apple Symbols", size: 58)!, .foregroundColor: piece.isUppercase ? NSColor.white : NSColor.black, .strokeColor: NSColor.black, .strokeWidth: -1.5]
            let text = NSAttributedString(string: glyph, attributes: attrs)
            let size = text.size()
            text.draw(at: NSPoint(x: square.midX - size.width/2, y: square.midY - size.height/2))
        }
    }
}
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.9])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
