import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("Native capture packaging requires Apple Silicon macOS and Xcode.");
const directory = "resources/native";
await fs.rm(directory, { recursive: true, force: true }); // Generated build output only.
await fs.mkdir(directory, { recursive: true });
const source = "src/native/board-capture.mm";
const binary = path.join(directory, "board-capture.node");
const headers = path.resolve(path.dirname(process.execPath), "../include/node");
await fs.access(path.join(headers, "node_api.h"));
execFileSync("xcrun", ["clang++", "-std=c++17", "-fobjc-arc", "-fblocks", "-O2", "-shared", "-undefined", "dynamic_lookup",
  "-target", "arm64-apple-macos14.0", "-I", headers,
  "-framework", "Foundation", "-framework", "ScreenCaptureKit", "-framework", "CoreGraphics", "-framework", "ImageIO",
  source, "-o", binary], { stdio: "inherit" });
execFileSync("codesign", ["--force", "--sign", "-", binary], { stdio: "inherit" });
const check = createRequire(import.meta.url)(path.resolve(binary)).selfTest();
if (!check.ready || !check.cursorExcluded) throw new Error("Native capture self-check failed");
await fs.copyFile(source, path.join(directory, "board-capture.mm"));
const hash = async file => createHash("sha256").update(await fs.readFile(file)).digest("hex");
await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify({ minimumMacOS: "14.0", nodeApi: 8,
  sourceSha256: await hash(source), binarySha256: await hash(binary) }, null, 2) + "\n");
console.log("Built and loaded in-process native capture module; no capture performed.");
