import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/main/store";
import { CloudAI, cloudFailure } from "../src/main/cloud";
import { Stockfish } from "../src/main/engine";
import {
  importPosition,
  placementKey,
  placementsOf,
} from "../src/core/position";
import type { Settings } from "../src/shared/contracts";

const [imageFile, directory, reportFile, mode] = process.argv.slice(2);
if (!imageFile || !directory || !reportFile)
  throw new Error("Invalid cloud check arguments");
app.setName("Chess Helper");
const preferences = path.join(
  app.getPath("appData"),
  "com.colesladowsky.chesshelper",
);
app.setPath("userData", path.join(directory, "profile"));
app
  .whenReady()
  .then(async () => {
    app.dock?.hide();
    const store = new Store(preferences);
    if (!store.hasApiKey) {
      console.error(
        "No decryptable API key is saved in Chess Helper Settings.",
      );
      app.exit(1);
      return;
    }
    const cloud = new CloudAI(() => store.apiKey());
    const engineDirectory = path.resolve("resources/stockfish");
    const engine = new Stockfish(
      path.join(engineDirectory, "stockfish"),
      engineDirectory,
    );
    const position = importPosition(
      {
        sessionId: randomUUID(),
        revision: 0,
        format: "start",
        text: "",
        coachedSide: "w",
        orientation: "white-bottom",
        confirmed: true,
      },
      0,
    );
    const checks: Record<string, unknown>[] = [];
    let exitCode = 1;
    try {
      const analysis = mode === "recognition-only" ? null : await engine.analyze(
        position,
        new AbortController().signal,
      );
      for (const model of ["gpt-6.1-sol", "gpt-6-astra"] as const) {
        const kinds = mode === "recognition-only" ? ["recognition"] as const : ["recognition", "explanations"] as const;
        for (const kind of kinds) {
          const started = performance.now();
          const setting: Settings["recognition"] = {
            model,
            effort: kind === "recognition" ? "low" : "medium",
          };
          let syntheticPlacementMatches: boolean | null = null;
          try {
            if (kind === "recognition") {
              const result = await cloud.recognize(
                {
                  ...position,
                  frameId: 0,
                  image: `data:image/jpeg;base64,${fs.readFileSync(imageFile).toString("base64")}`,
                  signature: Array(4096).fill(0),
                  sourceWidth: 512,
                  sourceHeight: 512,
                },
                "white-bottom",
                setting,
                new AbortController().signal,
              );
              syntheticPlacementMatches =
                result.boardVisible &&
                result.cropAligned &&
                !result.uncertainSquares.length &&
                result.orientation === "white-bottom" &&
                placementKey(result.placements) ===
                  placementKey(placementsOf(position.fen));
              if (!syntheticPlacementMatches)
                throw new Error("Synthetic board recognition did not match the known position");
            } else {
              if (!analysis) throw new Error("No engine evidence for explanation test");
              const explanations = await cloud.explain(
                position,
                analysis,
                setting,
                new AbortController().signal,
              );
              if (explanations.length !== analysis.candidates.length)
                throw new Error("Incomplete explanations");
            }
            const check = {
              model,
              kind,
              effort: setting.effort,
              result: "passed",
              latencyMs: performance.now() - started,
              ...(kind === "recognition" ? { syntheticPlacementMatches } : {}),
            };
            checks.push(check);
            console.log(JSON.stringify(check));
          } catch (error) {
            const check = {
              model,
              kind,
              effort: setting.effort,
              result: "failed",
              message: cloudFailure(error),
              latencyMs: performance.now() - started,
              ...(kind === "recognition" ? { syntheticPlacementMatches } : {}),
            };
            checks.push(check);
            console.log(JSON.stringify(check));
          }
        }
      }
      fs.writeFileSync(
        reportFile,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            purpose:
              mode === "recognition-only"
                ? "Live compact-rank recognition timing using a synthetic board, one request per model. Historical original-format timings are in api-report.json. This is not a controlled latency benchmark, recorded-site qualification, or end-to-end capture timing."
                : "Live Responses/structured-output compatibility using a synthetic board and a confirmed engine position. This does not qualify recorded-site recognition or live capture latency.",
            recognitionFormat: "compact-ranks",
            checks,
          },
          null,
          2,
        ) + "\n",
      );
      exitCode = checks.some((check) => check.result !== "passed") ? 1 : 0;
    } finally {
      engine.shutdown();
      app.exit(exitCode);
    }
  })
  .catch(() => {
    console.error("Live cloud checks could not complete.");
    app.exit(1);
  });
