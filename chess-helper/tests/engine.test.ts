import { it, expect } from "vitest";
import { DEFAULT_POSITION } from "chess.js";
import { parseInfo, Stockfish } from "../src/main/engine";
import { importPosition } from "../src/core/position";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
it("parses MultiPV and converts black scores to White perspective", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
  const info = parseInfo(
    "info depth 17 multipv 2 score cp 42 nodes 500 pv e7e5 g1f3",
    fen,
  );
  expect(info?.rank).toBe(2);
  expect(info?.candidate.score).toEqual({ type: "cp", value: -42 });
  expect(info?.candidate.variation.map((m) => m.san)).toEqual(["e5", "Nf3"]);
});
it("rejects bounded scores, malformed output and illegal moves", () => {
  expect(
    parseInfo("info depth 12 score cp 3 lowerbound pv e2e4", DEFAULT_POSITION),
  ).toBeNull();
  expect(
    parseInfo("info depth 12 score mate -2 pv a2a5", DEFAULT_POSITION),
  ).toBeNull();
  expect(parseInfo("info string diagnostics", DEFAULT_POSITION)).toBeNull();
});
it("drains obsolete searches through bestmove and readyok before accepting another revision", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "chess-helper-uci-")),
    file = path.join(directory, "fake-engine");
  writeFileSync(
    file,
    `#!${process.execPath}\nconst readline=require('node:readline');let timer;readline.createInterface({input:process.stdin}).on('line',line=>{if(line==='uci')console.log('uciok');if(line==='isready')console.log('readyok');if(line.startsWith('go ')){console.log('info depth 9 multipv 1 score cp 35 pv e2e4 e7e5');console.log('info depth 9 multipv 2 score cp 30 pv d2d4 d7d5');console.log('info depth 9 multipv 3 score cp 25 pv g1f3 d7d5');console.log('info depth 10 multipv 1 score cp 36 pv e2e4 e7e5');timer=setTimeout(()=>console.log('bestmove e2e4'),80);}if(line==='stop'){clearTimeout(timer);setTimeout(()=>console.log('bestmove e2e4'),5);}if(line==='quit')process.exit(0);});\n`,
    { mode: 0o755 },
  );
  const engine = new Stockfish(file, directory);
  try {
    const position = importPosition(
      {
        sessionId: "00000000-0000-4000-8000-000000000001",
        revision: 0,
        format: "start",
        text: "",
        coachedSide: "w",
        orientation: "white-bottom",
        confirmed: true,
      },
      0,
    );
    const controller = new AbortController();
    const first = engine.analyze(position, controller.signal);
    const rejection = expect(first).rejects.toThrow();
    setTimeout(() => controller.abort(), 40);
    const second = engine.analyze(
      { ...position, revision: 1 },
      new AbortController().signal,
    );
    await rejection;
    const result = await second;
    expect(result.revision).toBe(1);
    expect(result.candidates[0].id).toBe("e2e4");
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((candidate) => candidate.depth === 9)).toBe(
      true,
    );
  } finally {
    engine.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("reports an engine process crash and recovers through explicit restart", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "chess-helper-crash-"));
  const file = path.join(directory, "fake-engine");
  writeFileSync(
    file,
    `#!${process.execPath}
const fs=require('node:fs');
const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
  if(line==='uci')console.log('uciok');
  if(line==='isready')console.log('readyok');
  if(line.startsWith('go ')){
    if(!fs.existsSync('crashed-once')){fs.writeFileSync('crashed-once','1');process.exit(42);}
    console.log('info depth 8 multipv 1 score cp 30 pv e2e4 e7e5');
    console.log('bestmove e2e4');
  }
  if(line==='quit')process.exit(0);
});

`,
    { mode: 0o755 },
  );
  let failures = 0;
  const engine = new Stockfish(file, directory, () => failures++);
  const position = importPosition(
    {
      sessionId: "00000000-0000-4000-8000-000000000001",
      revision: 4,
      format: "start",
      text: "",
      coachedSide: "w",
      orientation: "white-bottom",
      confirmed: true,
    },
    4,
  );
  try {
    await expect(
      engine.analyze(position, new AbortController().signal),
    ).rejects.toThrow("Stockfish stopped");
    expect(failures).toBe(1);
    await engine.restart();
    const result = await engine.analyze(
      { ...position, revision: 5 },
      new AbortController().signal,
    );
    expect(result.revision).toBe(5);
    expect(result.candidates[0].id).toBe("e2e4");
  } finally {
    engine.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});


it("keeps a coherent complete report when the final partial iteration changes recommendation", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "chess-helper-report-"));
  const file = path.join(directory, "fake-engine");
  writeFileSync(file, `#!${process.execPath}
const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
  if(line==='uci')console.log('uciok');
  if(line==='isready')console.log('readyok');
  if(line.startsWith('go ')){
    console.log('info depth 9 multipv 1 score cp 35 pv e2e4 e7e5');
    console.log('info depth 9 multipv 2 score cp 30 pv d2d4 d7d5');
    console.log('info depth 9 multipv 3 score cp 25 pv g1f3 d7d5');
    console.log('info depth 10 multipv 1 score cp 38 pv d2d4 d7d5');
    console.log('info depth 10 multipv 2 score cp 34 pv e2e4 e7e5');
    console.log('info depth 10 multipv 3 score cp 26 pv g1f3 d7d5');
    console.log('info depth 11 multipv 1 score cp 39 pv e2e4 e7e5');
    console.log('info depth 11 multipv 2 score cp 32 upperbound pv d2d4 d7d5');
    console.log('info depth 10 multipv 3 score cp 26 pv g1f3 d7d5');
    console.log('bestmove e2e4');
  }
  if(line==='quit')process.exit(0);
});
`, { mode: 0o755 });
  const engine = new Stockfish(file, directory);
  try {
    const position = importPosition({
      sessionId: "00000000-0000-4000-8000-000000000001", revision: 0,
      format: "start", text: "", coachedSide: "w", orientation: "white-bottom", confirmed: true,
    }, 0);
    const result = await engine.analyze(position, new AbortController().signal);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["e2e4", "d2d4", "g1f3"]);
    expect(result.candidates.map((candidate) => candidate.depth)).toEqual([9, 9, 9]);
    expect(result.candidates.map((candidate) => candidate.score.value)).toEqual([35, 30, 25]);
  } finally {
    engine.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});
