# Recorded fixture corpus

The version 2 manifest contains 46 real Chrome recordings taken on October 6, 2026 from public Chess.com analysis/position-editor and Lichess analysis boards. Both sites use their default 2D pieces and board themes. Legal moves, captures, castling, en passant, promotion, checkmate, stalemate, midgame, and missed moves cover both orientations. Last-move highlights, actual board resizing, incomplete crops, and transient frames from real pawn animations are included. Synthetic legal-move and evaluator tests remain separate.

All crops were visually reviewed against their ground-truth positions. `npm run fixtures:evaluate -- --preflight` passes with 46 recordings and no missing coverage. The browser's JPEG screenshot API normalizes pixels to CSS dimensions on this devicePixelRatio=2 Retina display; the recording notes preserve that distinction. This corpus does not establish native display-capture resolution or latency. Packaged app capture must still be measured and reviewed before the release gate can open.

Add explicitly recorded board crops, with permission to retain them, to this directory. Do not record private surrounding browser content. Each entry requires:

```json
{
  "id": "lichess-white-retina-castling",
  "site": "lichess",
  "tags": ["default-2d", "white-bottom", "retina", "castling"],
  "image": "lichess-white-retina-castling.jpg",
  "sha256": "64-character SHA-256 of the JPEG",
  "orientation": "white-bottom",
  "beforeFen": "complete prior FEN or null for initial recognition",
  "expectedFen": "complete ground-truth FEN or null if unreadable",
  "expectsCorrection": false,
  "recording": {
    "recordedAt": "ISO 8601 UTC timestamp",
    "url": "public analysis/editor URL on the recorded site",
    "theme": "default-2d",
    "pixelWidth": 1024,
    "pixelHeight": 1024,
    "scaleFactor": 2,
    "notes": "What was captured, including move animation or occlusion details"
  }
}
```

Both sites must cover both orientations, default 2D themes, Retina, resize, highlights, animation, normal moves, capture, castling, en passant, promotion, checkmate, stalemate, midgame, missed moves, and ambiguous recognition. Represent animation/occlusion/missed moves with `expectsCorrection: true` unless a complete stable legal position is available.

Run `npm run fixtures:evaluate -- --preflight` first. It checks metadata, full FENs, legal-transition coverage tags, both-site coverage, actual image dimensions, and file checksums without cloud requests. Duplicate recordings cannot count as independent fixtures. Incomplete coverage stops evaluation before API usage.

Save the API key directly in Chess Helper Settings, then run `npm run fixtures:evaluate` explicitly; this incurs API usage. The evaluator runs inside Electron and reads the same safeStorage-encrypted credential as the app. It does not require copying the key into a shell, chat, or environment. Keys and image pixels are never printed or put in reports. The default is Sol/Low; select another combination with `RECOGNITION_MODEL=gpt-6-astra RECOGNITION_EFFORT=low npm run fixtures:evaluate`.

Reports are saved separately by model and effort in `docs/fixture-report-<model>-<effort>.json`, with fixture and implementation checksums, accuracy, correction frequency, recognition/validation/engine timings, and sanitized failures. After a legal transition, all six FEN fields must match ground truth. A falsely recognized board that happens to match a different legal move fails the gate. Initial recognition checks placement only and still requires human confirmation of full chess state.

Inspect every incorrect result, correct the implementation, then rerun. A report cannot qualify an unsupported model or settings combination. A passing recorded-input report sets `recordedFixturesPassed`; it leaves `qualified` false because it does not measure live capture delay. Separately measure live capture-to-ready latency with the same corpus and device.

The release gate in main remains false until a maintainer reviews a passing, complete report and live-capture measurements. User confirmation remains mandatory for initialization even after qualification. No screen-sharing compatibility checks are required or claimed.
