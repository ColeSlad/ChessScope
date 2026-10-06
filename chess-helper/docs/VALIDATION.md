# Validation status

Verified October 5, 2026 on Apple Silicon macOS. This records actual results separately from outstanding release acceptance.

| Check | Evidence |
| --- | --- |
| Independent identity | New project; `com.colesladowsky.chesshelper`, dedicated application-data directory, original app/tray artwork, no interview-assistant dependency |
| TypeScript and production build | Full strict typecheck and Vite/main/preload production builds pass |
| Rules, UCI, queues, revisions, desktop epochs, capture failures, encrypted-payload workflow | 9 test files, 78 tests passed, including 3 tests against the installed official engine |
| Official engine provenance | Stockfish 17.1 Apple Silicon binary, release archive, matching source archive, and both NNUE assets SHA-256 pinned; GPL license and corresponding source included |
| Engine behavior | Real White/Black searches yield legal ranked candidates; White-perspective mate scores, checkmate/stalemate, cancellation and explicit restart pass. Restart also advances the revision and removes prior explanations before reanalysis. Timed searches preserve the latest complete MultiPV report matching the final recommendation, including when a partial iteration changes back to an earlier move; replaced-process output is ignored. Process-crash recovery is also tested with a controlled fake UCI process. |
| Native credential encryption | Electron safeStorage encryption, plaintext absence, mode 0600, settings persistence, and decryption pass across two separate macOS process launches |
| Live cloud compatibility | Sol and Astra both pass Responses structured vision at Low and grounded explanations at Medium, using the user’s encrypted app credential. Synthetic starting-board placements match for both. See [API report](api-report.json). High/xhigh support was verified against official documentation; Astra xhigh structured request construction is transport-tested with a simulated response. |
| API latency sample | Vision: Sol 7.43 s, Astra 6.01 s. Explanations: Sol 10.59 s, Astra 8.32 s. One request per model/operation, not an accuracy benchmark or percentile estimate. |
| Compact recognition timing | New compact-rank structured vision matched the same synthetic starting board: Sol/Low 2.88 s, Astra/Low 2.23 s. One new request per model, compared with the historical original-format samples above; not a controlled benchmark, site accuracy result or end-to-end capture latency. See [recognition report](recognition-speed-report.json). |
| Manual confirmation and played-move path | A manually confirmed starting board analyzes while vision is pending. Vision-rejected, resized and permission-revoked captures detach when confirming manual state. Late recognition cannot replace it. Analyze does not rescan when automatic tracking is unavailable. Legal SAN/UCI updates preserve FEN/history, reject invalid/stale/missed-position updates, and request no recognition. |
| Recorded Chess.com / Lichess recognition | No recorded fixtures exist; recognition accuracy and correction frequency remain unmeasured. Fixture evaluator rejects the empty corpus and automatic tracking remains disabled. |
| Real capture-to-ready latency | Unmeasured; synthetic API timing does not include live capture, frame stability, or the complete coaching pipeline |
| Capture permission routing | The user reported denial after clicking a browser window. Native Electron 42.5.2 tests reproduced the former policy blocking the display-source handler, then verified the fixed policy reaches it. Sources are deliberately declined with `null`; no pixels are captured. Unit tests verify camera/microphone denial, trusted-frame/source restrictions, capture failure reporting, and stale failure rejection after pause. |
| macOS capture permissions and lifecycle | Recovery messages and failed-preview cleanup implemented. Actual OS authorization, browser capture, selection, resize/flip and source-closure acceptance checks remain pending; permission dispatch testing does not establish these. |
| Mouse, focus, shortcuts, geometry, desktop behavior | Cursor polling/visibility epochs/bounds logic tested. Native visual and interaction checks remain pending because Computer Use denied app access. The user saved a key through the Settings UI; this is not a complete desktop acceptance pass. |
| Apple Silicon packaging | Development `.app` plus `.dmg` and `.zip` rebuilt successfully after the capture permission and scan-latency/confirmation repairs; packaged arm64 identity, LSUIElement, main/renderer/preload/tray resources, source/network hashes and bundled UCI launch verified. Main/preload/renderer match the current build byte for byte. The updated app was reopened. Signing/notarization credentials were not supplied. |
| Screen-sharing invisibility / compatibility | Excluded by request; protection remains best effort and unverified |
| GitHub | Complete step-by-step commit history pushed to `ColeSlad/ChessScope` `main` over authenticated HTTPS. SSH key is read-only; no force push used. |

## Commands and artifacts

- `npm ci --no-audit --no-fund`: clean lockfile installation passed.
- `npm test`: 78 passing tests. Installed-engine integration skips explicitly when the engine is absent; the recorded run included it.
- `npm run typecheck`, `npm run build`, `npm run engine:verify`, `npm run package:mac`, `npm run package:verify`: passed.
- `npm run test:native-storage`: native write/read checks passed in separate processes, using a disposable test credential in a temporary profile.
- `npm run test:capture-permission`: old-policy rejection and fixed-policy dispatch passed in separate native Electron processes, with no source granted or pixels captured.
- `npm run test:cloud`: four live checks passed. Only report metadata is retained; the synthetic image is deleted, and no key or screenshot pixels appear in the report.
- `npm run test:cloud -- --recognition-only`: both compact-rank vision checks passed with known placements matching. Only metadata is retained; the encrypted key and synthetic pixels are not included in the report. The harness now fails explicitly on a known incorrect synthetic recognition.
- `npm run fixtures:evaluate`: deliberately fails with an actionable empty-corpus error. No release qualification is claimed.
- Generated output: `release/mac-arm64/ChessHelper.app`, `release/Chess-Helper-0.1.0-arm64.dmg`, and `release/Chess-Helper-0.1.0-arm64.zip`.

Official model documentation establishes API features, and live checks establish this account's tested model access. Engine recommendations are limited by search depth/budget. Free-form explanations are AI interpretations, not independently proven chess facts. Recorded recognition and native capture acceptance must pass before automatic tracking is released.
