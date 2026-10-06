# Chess Helper

An independent Electron / React / TypeScript / Vite macOS menu-bar app for chess coaching where live assistance is permitted. No website injection, automatic clicks, or move execution.

## Develop on Apple Silicon

```sh
cd chess-helper
npm install
npm run engine:prepare -- --pin
npm test
npm run build
npm run dev
```

The first engine preparation downloads the pinned official Stockfish 17.1 Apple Silicon release, corresponding source distribution, GPL license, and required NNUE files. Review and commit the generated SHA-256 lock before distributing. Later preparations verify it. The source distribution and license are included alongside the binary in packaged app resources. No other project, credentials, or identity is used.

Commit the generated package-lock.json after the initial network-enabled installation; subsequent clean builds use `npm ci`. The current offline checkout does not yet have a complete dependency lock.

Set your own OpenAI API key in Settings. It is encrypted using Electron `safeStorage` in `~/Library/Application Support/com.colesladowsky.chesshelper/preferences.json`. It is never returned to the renderer. All session positions, capture frames, and results remain in memory. No screenshot logging or telemetry is enabled.

## Use

1. Enter a position through Correct Position (FEN, PGN, the normal starting position, or the piece editor), or Select Board to choose an explicit browser window and crop its 8 × 8 board.
2. Confirm the board orientation, coached side, pieces, turn, castling, and en passant information. Unknown history never supplies draw claims or inferred special-move rights.
3. The panel shows Stockfish results first; cloud explanations arrive afterwards. Scores use White's perspective. Opponent-to-move lines are clearly labeled.
4. Rescan reads two stable samples. Ambiguous recognition, resizing, flips, missed moves, closed windows, permission loss, and engine failure clear recommendations and show a recovery action.
5. Start/Pause and Rescan are available in the menu and as rebindable shortcuts. Defaults: Command+Shift+H, Command+Shift+P, Command+Shift+R.

Automatic tracking is implemented but gated off until a complete recorded Chess.com / Lichess corpus passes recognition qualification. See [fixture requirements](tests/fixtures/README.md). An empty corpus is a failed gate, never a passing accuracy result. Manual position analysis and manual rescans remain available.

The main process owns Stockfish and OpenAI; the sandboxed renderer has only a typed preload bridge. Capture is video only, locally cropped before IPC and cloud upload. Each asynchronous analysis carries a session ID and revision. Recognition and explanation each have one active request and one replaceable pending job. Pausing and detected board changes remove actionable results immediately.

## Build

```sh
npm run package:dir   # development .app
npm run package:mac   # Apple Silicon .dmg + .zip
```

Packaging refuses an unpinned or missing engine, networks, license, or source. Electron Builder uses product name Chess Helper and ID `com.colesladowsky.chesshelper`. A public, trusted distribution needs the distributor's own Apple signing/notarization setup (CSC credentials and Apple API credentials); development builds can be unsigned. See [validation status](docs/VALIDATION.md).

The coaching, settings, and selection windows apply Electron content protection. macOS ScreenCaptureKit can still capture them. Invisibility is not guaranteed; screen-sharing compatibility is intentionally untested.
