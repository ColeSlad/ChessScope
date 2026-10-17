import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { listPackage } from "@electron/asar";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const application = path.resolve(
  process.argv[2] ?? "release/mac-arm64/ChessHelper.app",
);
const contents = path.join(application, "Contents");
const plist = path.join(contents, "Info.plist");
if (!fs.existsSync(plist))
  throw new Error(
    "The packaged application does not exist. Run package:dir or package:mac first.",
  );
function property(name) {
  return execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Print :${name}`, plist],
    { encoding: "utf8" },
  ).trim();
}
if (
  property("CFBundleIdentifier") !== "com.colesladowsky.chesshelper" ||
  property("CFBundleDisplayName") !== "Chess Helper" ||
  property("LSUIElement") !== "true"
)
  throw new Error(
    "Packaged application identity or menu-bar behavior is incorrect",
  );
const executable = path.join(contents, "MacOS", property("CFBundleExecutable"));
if (!execFileSync("file", [executable], { encoding: "utf8" }).includes("arm64"))
  throw new Error("The packaged application is not Apple Silicon");
const archive = path.join(contents, "Resources/app.asar");
const files = listPackage(archive);
for (const file of [
  "/dist/main/main.cjs",
  "/dist/preload/preload.cjs",
  "/dist/renderer/index.html",
])
  if (!files.includes(file))
    throw new Error(`Packaged application is missing ${file}`);
if (!fs.existsSync(path.join(contents, "Resources/trayTemplate.png")))
  throw new Error("The packaged application is missing its native tray icon");
const native = path.join(contents, "Resources/native");
const nativeManifest = JSON.parse(fs.readFileSync(path.join(native, "manifest.json"), "utf8"));
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (nativeManifest.sourceSha256 !== hash("src/native/board-capture.mm") ||
    nativeManifest.sourceSha256 !== hash(path.join(native, "board-capture.mm")) ||
    nativeManifest.binarySha256 !== hash(path.join(native, "board-capture.node")) ||
    property("LSMinimumSystemVersion") !== "14.0")
  throw new Error("Packaged native capture helper does not match its source/build");
const nativeCheck = createRequire(import.meta.url)(path.join(native, "board-capture.node")).selfTest();
if (!nativeCheck.ready || !nativeCheck.cursorExcluded) throw new Error("Native capture self-check failed");
execFileSync(
  process.execPath,
  [
    "scripts/verify-engine.mjs",
    "--directory",
    path.join(contents, "Resources/stockfish"),
  ],
  { stdio: "inherit" },
);
console.log(
  "Verified packaged identity, arm64 executable, renderer/preload, tray, cursor-free capture helper and bundled engine resources.",
);
