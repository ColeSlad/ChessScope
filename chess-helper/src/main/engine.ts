import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Chess } from 'chess.js';
import type { ConfirmedPosition, EngineAnalysis, Candidate } from '../shared/contracts';
import { legalCandidate, whiteScore } from '../core/position';

export function parseInfo(line: string, fen: string): { rank: number; candidate: Candidate } | null {
  const depth = /\bdepth (\d+)/.exec(line); const score = /\bscore (cp|mate) (-?\d+)/.exec(line); const pv = /\bpv (.+)$/.exec(line);
  if (!line.startsWith('info ') || !depth || !score || !pv || /\b(lowerbound|upperbound)\b/.test(line)) return null;
  const moves = pv[1].trim().split(/\s+/);
  try { return { rank: Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1), candidate: legalCandidate(fen, moves[0], whiteScore({ type: score[1] as 'cp' | 'mate', value: Number(score[2]) }, new Chess(fen).turn()), Number(depth[1]), moves) }; } catch { return null; }
}
export class Stockfish {
  private child: ChildProcessWithoutNullStreams | null = null;
  private listeners = new Set<(line: string) => void>();
  private failureListeners = new Set<(error: Error) => void>();
  private ready: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private stopping = false;
  constructor(private executable: string, private cwd: string, private onFailure: () => void = () => {}) {}
  private write(command: string) { if (!this.child || !this.child.stdin.writable) throw new Error('Stockfish is unavailable'); this.child.stdin.write(command + '\n'); }
  private waitFor(predicate: (line: string) => boolean, timeout = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Stockfish did not respond')), timeout);
      const fail = (error: Error) => finish(error);
      const listener = (line: string) => { if (predicate(line)) finish(null, line); };
      const finish = (error: Error | null, line = '') => { clearTimeout(timer); this.listeners.delete(listener); this.failureListeners.delete(fail); error ? reject(error) : resolve(line); };
      this.listeners.add(listener); this.failureListeners.add(fail);
    });
  }
  async initialize(): Promise<void> {
    if (this.ready) return this.ready;
    this.stopping = false;
    this.ready = (async () => {
      const child = spawn(this.executable, [], { cwd: this.cwd, stdio: 'pipe' }); this.child = child;
      const failed = () => { if (this.child !== child) return; const error = new Error('Stockfish stopped. Restart the engine.'); this.ready = null; this.child = null; for (const fail of [...this.failureListeners]) fail(error); if (!this.stopping) this.onFailure(); };
      this.child.on('error', failed); this.child.on('exit', failed);
      createInterface({ input: this.child.stdout }).on('line', line => { for (const listener of [...this.listeners]) listener(line); });
      // Drain stderr; do not log game positions or engine diagnostics containing data.
      this.child.stderr.on('data', () => {});
      const uci = this.waitFor(line => line === 'uciok'); this.write('uci'); await uci;
      this.write('setoption name Threads value 2'); this.write('setoption name Hash value 128'); this.write('setoption name MultiPV value 3');
      const ready = this.waitFor(line => line === 'readyok'); this.write('isready'); await ready;
    })();
    try { await this.ready; } catch (error) { this.shutdown(); throw error; }
  }
  analyze(position: ConfirmedPosition, signal: AbortSignal): Promise<EngineAnalysis> {
    const work = this.queue.catch(() => {}).then(() => this.search(position, signal)); this.queue = work; return work;
  }
  private async search(position: ConfirmedPosition, signal: AbortSignal): Promise<EngineAnalysis> {
    signal.throwIfAborted(); await this.initialize(); signal.throwIfAborted();
    const chess = new Chess(position.fen);
    const token = { sessionId: position.sessionId, revision: position.revision };
    if (!chess.moves().length) return { ...token, candidates: [], elapsedMs: 0, terminal: chess.isCheckmate() ? 'checkmate' : 'stalemate' };
    const started = performance.now(); const candidates = new Map<number, Candidate>();
    const listener = (line: string) => { if (signal.aborted) return; const parsed = parseInfo(line, position.fen); if (parsed && parsed.rank >= 1 && parsed.rank <= 3) candidates.set(parsed.rank, parsed.candidate); };
    this.listeners.add(listener);
    const bestmove = this.waitFor(line => line.startsWith('bestmove '), 8000);
    void bestmove.catch(() => {}); let drained = false;
    const abort = () => { try { this.write('stop'); } catch { /* failure waiter owns recovery */ } };
    signal.addEventListener('abort', abort, { once: true });
    try {
      // The queue waits for the previous bestmove AND readyok before this position command.
      this.write(`position fen ${position.initialFen}${position.moves.length ? ` moves ${position.moves.join(' ')}` : ''}`);
      this.write('go movetime 1000');
      const line = await bestmove;
      const ready = this.waitFor(value => value === 'readyok'); this.write('isready'); await ready; drained = true;
      signal.throwIfAborted();
      const recommendation = line.split(' ')[1];
      const first = candidates.get(1);
      if (!first || first.id !== recommendation) throw new Error('Stockfish did not produce a validated final recommendation');
      const finalDepth = first.depth;
      const results = [...candidates.entries()].sort(([a],[b]) => a - b).map(([,candidate]) => candidate).filter(candidate => candidate.depth === finalDepth);
      if (new Set(results.map(c => c.id)).size !== results.length) throw new Error('Stockfish returned duplicate candidates');
      return { ...token, candidates: results, elapsedMs: performance.now() - started, terminal: null };
    } catch (error) { if (!drained || !signal.aborted) this.shutdown(); throw error; }
    finally { signal.removeEventListener('abort', abort); this.listeners.delete(listener); }
  }
  shutdown() {
    this.stopping = true; const child = this.child; this.child = null; this.ready = null;
    for (const fail of [...this.failureListeners]) fail(new Error('Engine stopped'));
    if (child) { child.stdin.end('quit\n'); const timer = setTimeout(() => child.kill('SIGKILL'), 1000); timer.unref(); child.once('exit', () => clearTimeout(timer)); }
  }
  async restart() { this.shutdown(); await this.queue.catch(() => {}); await this.initialize(); }
}
