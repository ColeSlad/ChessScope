# Continue after enabling access

Source is saved in the workspace. Commit metadata lives in `/private/tmp/chessscope-git-metadata` because the current session denies `.git` writes. `ChessScope.bundle` at the workspace root is the portable history backup. Never force-push over an unknown remote history.

1. Select a permission mode that allows network operations and Git writes. In ChatGPT desktop, enable Full access in Settings → General → Permissions if needed, then select it beneath the composer. If applicable, enable Work network access in Settings → Data controls. Alternatively permit the specific Git/network operations with Ask for approval.
2. Inspect the existing remote before integrating. The initial SSH clone failed; no remote commits were read, changed, or pushed.
3. Restore Git metadata from the temporary directory, or import the bundle into a fresh checkout and replay its implementation commits onto the actual remote branch. Preserve workspace edits; do not overwrite any existing `.git` directory.
4. Run `npm install` in `chess-helper`. Resolve and commit the complete package-lock.json, including pinned chess.js and Electron Builder, before switching subsequent installations to `npm ci`.
5. Run the full tests and typecheck; fix real failures. Execute `npm run engine:prepare -- --pin`, verify the official release hashes, source/NNUE/license resources, and commit the engine lock. Then run engine:verify and build.
6. Exercise the native Electron UI, focus, capture permissions, source closure, cropping, editor, quiet windows, shortcut conflicts, credential restart, and native pointer recovery. Record actual outcomes in VALIDATION.md.
7. Record explicitly permitted Chess.com / Lichess fixture crops with the required coverage. Evaluate with an explicitly supplied API key, capture live latency measurements, and inspect every incorrect result. Keep automatic tracking disabled until correct-or-correction qualification passes. Account model access still needs live checks.
8. Build and launch the Apple Silicon development app and distributable; use the distributor’s Apple credentials for signed/notarized delivery if available. Commit each completed step and integrate with the requested GitHub repository without rewriting unrelated work.

Screen-sharing compatibility testing remains excluded. Do not claim invisibility or concealment.
