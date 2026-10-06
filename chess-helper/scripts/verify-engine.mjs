import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
const directory = path.resolve("resources/stockfish");
const lock = JSON.parse(
  fs.readFileSync(path.join(directory, "engine-lock.json"), "utf8"),
);
const hash = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (!lock.binarySha256 || !lock.archiveSha256 || !lock.sourceSha256)
  throw new Error(
    "Engine is not installed and pinned. Run engine:prepare -- --pin and commit its lock.",
  );
if (
  hash(path.join(directory, "stockfish")) !== lock.binarySha256 ||
  hash(path.join(directory, "source.tar.gz")) !== lock.sourceSha256
)
  throw new Error("Engine or corresponding source checksum mismatch");
for (const [name, digest] of Object.entries(lock.networks))
  if (hash(path.join(directory, name)) !== digest)
    throw new Error("Bundled NNUE checksum mismatch");
if (
  !fs.existsSync(path.join(directory, "COPYING.txt")) ||
  !fs.existsSync(path.join(directory, "source"))
)
  throw new Error("GPL license or corresponding source is missing");
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("v1 engine packaging requires Apple Silicon macOS");
const child = spawn(path.join(directory, "stockfish"), [], { cwd: directory });
let output = "";
let analyzed = false;
const timeout = setTimeout(() => {
  child.kill();
  throw new Error("Bundled Stockfish launch timed out");
}, 10000);
child.on("error", (error) => {
  clearTimeout(timeout);
  throw error;
});
child.stdout.on("data", (data) => {
  output += data.toString();
  if (output.includes("uciok") && !analyzed) {
    analyzed = true;
    child.stdin.write("isready\nposition startpos\ngo movetime 100\n");
  }
  if (/bestmove [a-h][1-8][a-h][1-8]/.test(output)) child.stdin.end("quit\n");
});
child.on("exit", (code) => {
  clearTimeout(timeout);
  if (
    code !== 0 ||
    !output.includes("readyok") ||
    !output.includes("bestmove ")
  )
    throw new Error("Bundled engine failed its UCI smoke check");
  console.log(
    `Verified ${lock.release}: Apple Silicon launch, UCI, NNUE, license, matching source.`,
  );
});
child.stdin.write("uci\n");
