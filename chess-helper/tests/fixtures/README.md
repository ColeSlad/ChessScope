# Recorded fixture corpus

No recordings were supplied with the handoff. The manifest is deliberately empty. Synthetic legal-move tests are separate and do not qualify cloud vision accuracy.

Add explicitly recorded board crops, with permission to retain them, to this directory. Do not record private surrounding browser content. Each entry requires:

```json
{
  "id": "lichess-white-retina-castling",
  "site": "lichess",
  "tags": ["white-bottom", "retina", "castling"],
  "image": "lichess-white-retina-castling.jpg",
  "sha256": "64-character SHA-256 of the JPEG",
  "orientation": "white-bottom",
  "beforeFen": "complete prior FEN or null for initial recognition",
  "expectedFen": "complete ground-truth FEN or null if unreadable",
  "expectsCorrection": false
}
```

Both sites must cover both orientations, default 2D themes, Retina, resize, highlights, animation, normal moves, capture, castling, en passant, promotion, checkmate, stalemate, midgame, missed moves, and ambiguous recognition. Represent animation/occlusion/missed moves with `expectsCorrection: true` unless a complete stable legal position is available.

Run `OPENAI_API_KEY=... npm run fixtures:evaluate` explicitly; this incurs API usage. Keys and image pixels are never printed or put in the report. The app never reads this environment key. Record the model, thinking level, fixture checksums, accuracy, correction frequency, and latency. Inspect every incorrect result and correct the implementation, then rerun. A report cannot qualify an unsupported model or settings combination. Recorded capture input does not measure live capture delay; separately measure live capture-to-ready latency with the same corpus and device.

The release gate in main remains false until a maintainer reviews a passing, complete report and live-capture measurements. User confirmation remains mandatory for initialization even after qualification. No screen-sharing compatibility checks are required or claimed.
