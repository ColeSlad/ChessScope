import { createServer } from "vite";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
await import("./build-electron.mjs");
const server = await createServer();
await server.listen();
const electron = createRequire(import.meta.url)("electron");
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, CHESS_HELPER_DEV_URL: "http://127.0.0.1:5173" },
});
const stop = async () => {
  child.kill();
  await server.close();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
