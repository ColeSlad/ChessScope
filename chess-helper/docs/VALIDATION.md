# Validation status

This document distinguishes implementation from verified release acceptance. Update with actual results, never implied passes.

| Check | Current evidence |
| --- | --- |
| Independent identity and architecture | New project; no interview-assistant dependencies |
| Typecheck and production build | Blocked by uncached `chess.js` 1.4.0; TypeScript reports the missing module and its dependent type inference. The complete dependency lock remains pending network-enabled installation. |
| Rules, UCI parsing, stale-result cancellation, bounded queues, cursor epochs | Desktop/cursor/queue/stability and persistence subset: 8 tests passed. Chess, engine, AI-schema, and session suites remain blocked by `chess.js`. |
| Official Stockfish binary, NNUE, source, GPL, bundled launch | Preparation and checksum verification scripts provided; download blocked by environment network policy |
| OpenAI models / Responses / structured outputs | Official documentation verified October 5, 2026; live API checks pending user-supplied key |
| Recorded Chess.com / Lichess recognition | No fixtures supplied; accuracy and correction frequency unmeasured; automatic release gate closed |
| End-to-end live capture latency | Unmeasured; one-second engine budget excludes capture and cloud latency |
| macOS Screen Recording and source lifecycle | Implementation present; native permission and close-source checks pending |
| Native mouse click-through, shortcut conflict, encrypted credential restart | Cursor epoch and polling tests passed; persistence tests passed with mocked encryption. Native click-through, shortcut conflicts, and macOS Keychain checks remain pending. |
| Apple Silicon development and distributable build | Electron Builder configured; packaged launch pending |
| Screen-sharing invisibility / compatibility | Excluded by request; best effort and unverified |
| GitHub integration | Network blocked; every completed step committed in `/private/tmp/chessscope-git-metadata`; portable history exported to `ChessScope.bundle` at the workspace root. |

The official model docs establish schema compatibility, not an account's access. Cloud failures are recoverable; engine recommendations remain when explanation-only requests fail. The engine recommendation is depth/budget limited, and prose is an AI interpretation.

## Actual checks

- `vitest run tests/desktop.test.ts tests/store.test.ts`: 2 files, 8 tests passed. This does not verify native Keychain encryption, only the store’s encrypted-payload workflow and file permissions.
- `npm run typecheck`: blocked by missing `chess.js` dependency; no full build is claimed.
- `npm run fixtures:evaluate`: fails explicitly because no recorded corpus exists; automatic tracking stays disabled.
- Offline packages came from the local public npm cache. No application source or identity was reused. The partial toolchain lock was kept outside the project rather than delivered as a falsely complete lockfile.
