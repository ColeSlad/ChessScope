# Implementation steps

Each completed step receives a Git commit:

1. Independent Electron / React / TypeScript / Vite project and pinned dependencies.
2. Typed contracts, strict position validation, legal transitions, managed UCI engine.
3. Bounded, grounded Responses API recognition and explanations; encrypted settings.
4. Revision-safe session orchestration and local stable-frame processing.
5. Sandboxed desktop IPC, source selection, quiet windows, cursor polling, shortcuts.
6. Coaching panel, settings, board crop selection, confirmation and correction editor.
7. Adversarial tests, engine preparation and packaging, fixture release gate and documentation.

Automatic tracking remains disabled until a recorded, supported fixture corpus passes the checked release gate. Synthetic protocol tests cannot qualify a cloud vision model. Missing recorded fixtures or live API credentials are reported as unverified, never as passed.

## Documentation verified October 5, 2026

- [Sol model](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and [Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra): image input, Responses, structured outputs, low / medium / high / xhigh.
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses `text.format` and official SDK schema parsing.
- [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer): explicit source selection, no audio.
- [Electron content protection](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows): ScreenCaptureKit limitation; no invisibility guarantee.
- [chess.js](https://github.com/jhlywa/chess.js): positions and legal moves.
- [Stockfish UCI](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html): engine configuration and score semantics.

Screen-sharing compatibility testing is excluded. Signing/notarization requires the distributor's own Apple Developer identity.

## Capture permission repair

Step 29 fixes permission denial after selecting a browser window. Electron 42.5.2 first sends a `media` permission request with an empty `mediaTypes` array for display capture. The former policy rejected it before the display-source handler ran. The corrected policy permits this specific request only from trusted main frames with an explicitly selected source; camera and microphone requests remain denied. The source handler grants video only and rejects unavailable sources using Electron's supported `null` callback value.

`npm run test:capture-permission` reproduces the old rejection and verifies the corrected dispatch in separate native Electron processes. It deliberately declines the display source before any pixels are captured; this verifies permission routing, not macOS Screen Recording authorization or live browser capture.

Step 30 replaces generic capture errors with typed failure codes and actionable macOS authorization, device restriction, closed-source, frame-read and stability-timeout messages. Failed previews stop their streams and clear the crop; refreshing sources also refreshes the OS permission status. Permission-denial and pause cancellation are regression-tested in the capture renderer.

Step 31 fixes a real-engine regression exposed during the capture repair checks. A final partial MultiPV iteration can change back to an earlier recommendation while supplying only bound scores for an alternative. Searches now retain the latest complete report for each legal root recommendation and choose the report matching `bestmove`, with its original rank order, legal variations, scores and displayed depths. Bound lines start a new report but never become exact evaluations. A deterministic regression and the installed Stockfish checks pass; no additional engine budget is used.

Step 32 records the capture repair verification: strict typecheck, all 64 tests, real Electron permission dispatch, and rebuilt Apple Silicon app/DMG/ZIP pass. Packaged main, preload and renderer match the current build byte for byte; packaged engine provenance and UCI launch pass. The running app was replaced and reopened without touching saved preferences or the encrypted credential. Live browser capture and the broader recorded-fixture/native interaction acceptance remain unverified.

Step 33 fixes confirmation of a selected starting board while recognition is pending or unavailable. Explicitly confirmed manual chess state can initialize analysis without a vision result; known hidden/misaligned crops still require reselection. Late recognition is canceled and discarded. In manual mode, Analyze uses the confirmed position without a new cloud scan; Rescan remains the explicit screenshot action. The panel, menu and pause shortcut recognize in-progress capture, engine and explanation work. Reopening an existing correction editor no longer advances its revision and makes it stale.

Step 34 adds Move already played to the coaching panel. A user-entered SAN or UCI move updates the confirmed position through chess.js, preserves known history and special-move state, cancels obsolete work, and starts local engine analysis without cloud recognition. Invalid, stale and uninitialized updates fail without changing the position. The app records a move the user played; it performs no website or mouse action.

Step 35 resolves the user's exact confirmation error after vision rejects a crop. Manual FEN/PGN/editor/starting-position confirmation is independent of screenshot validation. If vision rejected the crop, the window resized, or permission was revoked, confirmation detaches capture and analyzes the explicit manual position. Automatic tracking cannot restart with that crop; the user must select it again. A pending initial scan can be canceled by explicit confirmation of the live-preview crop.

Step 36 reduces cloud recognition output to eight compact ranks, retaining high-detail image input, the selected model/thinking effort, orientation and uncertainty. The validated response is decoded into the unchanged piece-placement contract. Unknown squares stay uncertain; malformed rows, invalid symbols and excessive piece counts are rejected. This follows [official latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization) to reduce generated structured-output syntax. `npm run test:cloud -- --recognition-only` measures the new format separately from the original API report; it uses a synthetic image and does not qualify site fixtures.

Step 37 documents and rebuilds the faster scan and independent manual-position flow. All 78 tests and strict typecheck pass. Sol and Astra compact recognition both match the synthetic board at Low effort, with individual timings of 2.88 s and 2.23 s; historical original-format samples were 7.43 s and 6.01 s. These are not controlled benchmarks or guarantees. The Apple Silicon app, DMG and ZIP were rebuilt and verified; main/preload/renderer match the current build, and the app was reopened. Actual native interaction and recorded-site fixture qualification remain outstanding.

Step 41 records and visually reviews 46 real Chess.com and Lichess board crops through the approved Chrome browser surface. Both orientations cover ordinary and special legal transitions, midgame, missed moves, and terminal positions. Additional recordings cover highlights, actual resizing, incomplete crops, and moving pieces captured during real animations. Native Electron preflight passes all coverage, FEN, checksum, dimension, and duplicate checks. The notes distinguish CSS-normalized browser screenshots on the Retina display from native app capture. All 103 baseline tests pass; cloud corpus evaluation and live capture remain required, and automatic tracking remains disabled.

Step 42 repairs a real qualification failure: Sol/Low snapped an animating Lichess pawn to e3 during an e2-e4 move, producing a different legal position without requesting correction. The failed report is preserved in `fixture-report-gpt-6.1-sol-low-before-alignment-repair.json`. Compact structured vision now requires an explicit `piecesAligned` check, with instructions to inspect piece bases and grid offsets before assigning squares. Reported displacement makes the crop unusable even if the returned ranks form a legal move. A regression verifies this exact alternative-legal-move failure path, and missing alignment evidence fails parsing. Strict typecheck and all 105 tests pass. This repair still requires full recorded-corpus requalification and native capture acceptance; automatic tracking remains disabled.
