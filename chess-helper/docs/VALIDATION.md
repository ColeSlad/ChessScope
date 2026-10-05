# Validation status

This document distinguishes implementation from verified release acceptance. Update with actual results, never implied passes.

| Check | Current evidence |
| --- | --- |
| Independent identity and architecture | New project; no interview-assistant dependencies |
| Typecheck and production build | Pending dependency installation |
| Rules, UCI parsing, stale-result cancellation, bounded queues, cursor epochs | Automated tests provided; execution pending |
| Official Stockfish binary, NNUE, source, GPL, bundled launch | Preparation and checksum verification scripts provided; download blocked by environment network policy |
| OpenAI models / Responses / structured outputs | Official documentation verified October 5, 2026; live API checks pending user-supplied key |
| Recorded Chess.com / Lichess recognition | No fixtures supplied; accuracy and correction frequency unmeasured; automatic release gate closed |
| End-to-end live capture latency | Unmeasured; one-second engine budget excludes capture and cloud latency |
| macOS Screen Recording and source lifecycle | Implementation present; native permission and close-source checks pending |
| Native mouse click-through, shortcut conflict, encrypted credential restart | Implementation and pure-state tests present; native UI verification pending |
| Apple Silicon development and distributable build | Electron Builder configured; packaged launch pending |
| Screen-sharing invisibility / compatibility | Excluded by request; best effort and unverified |
| GitHub integration | Network blocked; step commits stored locally with temporary Git metadata |

The official model docs establish schema compatibility, not an account's access. Cloud failures are recoverable; engine recommendations remain when explanation-only requests fail. The engine recommendation is depth/budget limited, and prose is an AI interpretation.
