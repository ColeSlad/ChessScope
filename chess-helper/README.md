# Chess Helper

An independent Electron / React / TypeScript / Vite macOS menu-bar app for chess coaching where live assistance is permitted. No website injection, automatic clicks, or move execution.

## Develop on Apple Silicon

```sh
cd chess-helper
npm ci
npm run engine:prepare
npm test
npm run build
npm run dev
```

Engine preparation downloads the pinned official Stockfish 17.1 Apple Silicon release, corresponding source distribution, GPL license, and required NNUE files, and verifies the committed SHA-256 lock. Use `--pin` only when deliberately reviewing an engine update. The source distribution and license are included alongside the binary in packaged app resources. No other project, credentials, or identity is used.

All direct dependencies have exact versions and the complete dependency tree is committed in `package-lock.json`. Use `npm ci` for clean builds.

Set your own OpenAI API key in Settings. It is encrypted using Electron `safeStorage` in `~/Library/Application Support/com.colesladowsky.chesshelper/preferences.json`. It is never returned to the renderer. All session positions, capture frames, and results remain in memory. No screenshot logging or telemetry is enabled.

## Use

1. Enter a position through Correct Position (FEN, PGN, the normal starting position, or the piece editor), or Select Board to choose an explicit browser window and crop its 8 × 8 board.
2. Confirm the board orientation, coached side, pieces, turn, castling, and en passant information. Unknown history never supplies draw claims or inferred special-move rights.
3. The panel shows Stockfish results first; cloud explanations arrive afterwards. Scores use White's perspective. Opponent-to-move lines are clearly labeled.
4. Rescan reads two stable samples. Ambiguous recognition, resizing, flips, missed moves, closed windows, permission loss, and engine failure clear recommendations and show a recovery action.
5. Start/Pause and Rescan are available in the menu and as rebindable shortcuts. Defaults: Command+Shift+H, Command+Shift+P, Command+Shift+R.

Automatic tracking is implemented but gated off until a complete recorded Chess.com / Lichess corpus passes recognition qualification. See [fixture requirements](tests/fixtures/README.md). An empty corpus is a failed gate, never a passing accuracy result. Manual position analysis and manual rescans remain available.

For the fastest path, open **Correct Position → Starting Position**, check the confirmation box, and choose **Confirm & Analyze**. Manual FEN/PGN and piece editing also work without a successful scan. A rejected or resized capture is disconnected when you confirm a manual position; use Select Board to reconnect it. **Analyze** searches the confirmed position locally, while **Rescan** reads the browser board.

After each move you play or observe, enter it in **Move already played** and choose **Update**. SAN (`e4`, `Nf3`, `O-O`) and UCI (`e2e4`, `e7e8q`) are accepted only when legal in the confirmed position. This uses chess.js and Stockfish without cloud recognition, preserves the known move history and special-move state, and does not play anything on the website. Correct Position is required if moves were missed. The engine's one-second search budget is separate from optional cloud explanation latency.

Cloud scans now use compact rank strings. Individual synthetic-board checks measured Sol/Low at 2.88 s and Astra/Low at 2.23 s, compared with historical original-format samples of 7.43 s and 6.01 s. This is not a controlled benchmark or an end-to-end latency guarantee; see the [recognition timing report](docs/recognition-speed-report.json). Recorded-site qualification remains outstanding.

The main process owns Stockfish and OpenAI; the sandboxed renderer has only a typed preload bridge. Capture is video only, locally cropped before IPC and cloud upload. Each asynchronous analysis carries a session ID and revision. Recognition and explanation each have one active request and one replaceable pending job. Pausing and detected board changes remove actionable results immediately.

## Build

If macOS denies capture, use the source picker's **Screen Recording Settings** button. In System Settings → Privacy & Security → Screen & System Audio Recording (called Screen Recording on older macOS versions), enable **Chess Helper**, then quit and reopen it. Development runs may appear as **Electron**. Refresh Windows and reselect the browser after restarting. Manual position entry is available without screen capture.

```sh
npm run package:dir   # development .app
npm run package:mac   # Apple Silicon .dmg + .zip
npm run package:verify # packaged identity, preload, renderer, and engine launch
```

Packaging refuses an unpinned or missing engine, networks, license, or source. Electron Builder uses product name Chess Helper and ID `com.colesladowsky.chesshelper`. A public, trusted distribution needs the distributor's own Apple signing/notarization setup (CSC credentials and Apple API credentials); development builds can be unsigned. See [validation status](docs/VALIDATION.md).

The coaching, settings, and selection windows apply Electron content protection. macOS ScreenCaptureKit can still capture them. Invisibility is not guaranteed; screen-sharing compatibility is intentionally untested.

## Verification

```sh
npm test                 # rules, revisions, queues, UCI, and installed-engine integration
npm run typecheck
npm run test:native-storage # macOS encryption and persistence across process launches
npm run test:capture-permission # real Electron permission dispatch; captures no pixels
npm run test:cloud          # explicit live API checks using the key saved in this app
npm run test:cloud -- --recognition-only # compact-output scan timing; skips explanations
```

`test:cloud` incurs API usage and uses a synthetic board only to check Responses and structured-output compatibility. Its report is separate from recorded Chess.com / Lichess qualification. Neither this check nor unit tests unlock automatic tracking. See [actual verification results](docs/VALIDATION.md) and [remaining acceptance work](docs/RESUME.md).

Local build output is `release/mac-arm64/ChessHelper.app`, `release/Chess-Helper-0.1.0-arm64.dmg`, and `release/Chess-Helper-0.1.0-arm64.zip`. These generated artifacts are ignored by Git. The app's displayed product name is Chess Helper.
