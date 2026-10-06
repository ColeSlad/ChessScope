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
