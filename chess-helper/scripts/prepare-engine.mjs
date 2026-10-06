import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const directory = path.resolve("resources/stockfish");
const lockFile = path.join(directory, "engine-lock.json");
const lock = JSON.parse(await fs.readFile(lockFile, "utf8"));
const pin = process.argv.includes("--pin");
if ((!lock.archiveSha256 || !lock.sourceSha256) && !pin)
  throw new Error(
    "Engine hashes have not been recorded. First run npm run engine:prepare -- --pin, review the official release, and commit engine-lock.json.",
  );
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function download(url, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok)
    throw new Error(`Official engine download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expected && sha(bytes) !== expected)
    throw new Error("Pinned engine download checksum mismatch");
  return bytes;
}
function extract(archive, target, compressed) {
  const entries = execFileSync("tar", [compressed ? "-tzf" : "-tf", archive], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  if (
    entries.some(
      (entry) => entry.startsWith("/") || entry.split("/").includes(".."),
    )
  )
    throw new Error("Unsafe engine archive");
  execFileSync("tar", [compressed ? "-xzf" : "-xf", archive, "-C", target]);
}
async function find(directory, predicate) {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) {
      const result = await find(file, predicate);
      if (result) return result;
    } else if (item.isFile() && predicate(item.name)) return file;
  }
  return null;
}
const temporary = await fs.mkdtemp(path.join(directory, ".prepare-"));
try {
  const archive = await download(lock.archiveURL, lock.archiveSha256),
    source = await download(lock.sourceURL, lock.sourceSha256);
  const archiveFile = path.join(temporary, "release.tar"),
    sourceFile = path.join(temporary, "source.tar.gz");
  await fs.writeFile(archiveFile, archive);
  await fs.writeFile(sourceFile, source);
  await fs.mkdir(path.join(temporary, "binary"));
  await fs.mkdir(path.join(temporary, "source"));
  extract(archiveFile, path.join(temporary, "binary"), false);
  extract(sourceFile, path.join(temporary, "source"), true);
  const executable = await find(
    path.join(temporary, "binary"),
    (name) => name === `stockfish-${lock.architecture}`,
  );
  const license = await find(
    path.join(temporary, "source"),
    (name) => name === "Copying.txt" || name === "COPYING",
  );
  const evaluate = await find(
    path.join(temporary, "source"),
    (name) => name === "evaluate.h",
  );
  if (!executable || !license || !evaluate)
    throw new Error(
      "Official release is missing executable, license, or matching source",
    );
  const networks = [
    ...new Set(
      (await fs.readFile(evaluate, "utf8")).match(/nn-[a-f0-9]{12}\.nnue/g) ??
        [],
    ),
  ];
  if (!networks.length)
    throw new Error(
      "Could not identify required NNUE networks from the pinned source",
    );
  for (const name of networks) {
    const bytes = await download(
      `https://tests.stockfishchess.org/api/nn/${name}`,
      lock.networks[name],
    );
    const digest = sha(bytes);
    if (!digest.startsWith(name.slice(3, 15)))
      throw new Error("NNUE filename checksum mismatch");
    if (!pin && !lock.networks[name]) throw new Error("Network is not pinned");
    await fs.writeFile(path.join(directory, name), bytes);
    lock.networks[name] = digest;
  }
  await fs.copyFile(executable, path.join(directory, "stockfish"));
  await fs.chmod(path.join(directory, "stockfish"), 0o755);
  await fs.copyFile(license, path.join(directory, "COPYING.txt"));
  await fs.rm(path.join(directory, "source"), { recursive: true, force: true });
  await fs.rename(
    path.join(temporary, "source"),
    path.join(directory, "source"),
  );
  await fs.copyFile(sourceFile, path.join(directory, "source.tar.gz"));
  if (pin) {
    lock.archiveSha256 = sha(archive);
    lock.sourceSha256 = sha(source);
    lock.binarySha256 = sha(
      await fs.readFile(path.join(directory, "stockfish")),
    );
    await fs.writeFile(lockFile, JSON.stringify(lock, null, 2) + "\n");
  }
  await import("./verify-engine.mjs");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
