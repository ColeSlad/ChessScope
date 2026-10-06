import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { Store } from "../src/main/store";
import { solAccessFailure } from "./sol-access-errors";

const [directory, reportFile] = process.argv.slice(2);
if (!directory || !reportFile) throw new Error("Invalid Sol access check arguments");
app.setName("Chess Helper");
const preferences = path.join(app.getPath("appData"), "com.colesladowsky.chesshelper");
app.setPath("userData", path.join(directory, "profile"));

app.whenReady().then(async () => {
  app.dock?.hide();
  const store = new Store(preferences);
  const apiKey = store.apiKey();
  if (!apiKey) {
    console.error("No decryptable API key is saved in Chess Helper Settings.");
    app.exit(1);
    return;
  }
  const recognition = { model: "gpt-6.1-sol", effort: "low" } as const;
  const started = performance.now();
  let result;
  try {
    const response = await new OpenAI({ apiKey, maxRetries: 0, timeout: 15000 }).responses.create({
      model: recognition.model, reasoning: { effort: recognition.effort }, store: false,
      max_output_tokens: 128, input: "Reply OK.",
    });
    result = { outcome: "request-accepted", responseStatus: response.status };
  } catch (error) {
    result = { outcome: "request-failed", ...solAccessFailure(error) };
  }
  const report = {
    generatedAt: new Date().toISOString(), recognition,
    purpose: "One bounded text-only Sol access diagnostic using the app's saved encrypted credential. This is not vision or fixture qualification.",
    attempts: 1, automaticRetries: 0, latencyMs: performance.now() - started, ...result,
    documentation: "https://developers.openai.com/api/docs/guides/error-codes",
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  app.exit(result.outcome === "request-accepted" ? 0 : 1);
}).catch(() => {
  console.error("The Sol access diagnostic could not complete.");
  app.exit(1);
});
