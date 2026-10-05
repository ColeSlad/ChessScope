import { Chess, DEFAULT_POSITION, type Square, type Move } from 'chess.js';
import type { ConfirmedPosition, Correction, Placement, VisionResult, Candidate, EngineScore } from '../shared/contracts';

export const sameToken = (a: { sessionId: string; revision: number }, b: { sessionId: string; revision: number }) => a.sessionId === b.sessionId && a.revision === b.revision;
export const placementKey = (placements: Placement[]) => placements.map(p => `${p.square}:${p.piece}`).sort().join(',');
export function placementsOf(fen: string): Placement[] {
  const chess = new Chess(fen);
  return chess.board().flatMap(row => row.flatMap(piece => piece ? [{ square: piece.square, piece: (piece.color === 'w' ? piece.type.toUpperCase() : piece.type) as Placement['piece'] }] : []));
}
export function placementFen(placements: Placement[]): string {
  if (new Set(placements.map(p => p.square)).size !== placements.length) throw new Error('Duplicate squares in recognition');
  const map = new Map(placements.map(p => [p.square, p.piece]));
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = ''; let empty = 0;
    for (const file of 'abcdefgh') { const piece = map.get(`${file}${rank}`); if (piece) { if (empty) row += empty; empty = 0; row += piece; } else empty++; }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}
export function validatePosition(fen: string): Chess {
  if (fen.trim().split(/\s+/).length !== 6) throw new Error('Provide all six FEN fields, including turn, castling, en passant, and clocks.');
  const chess = new Chess(fen);
  const fields = fen.split(/\s+/);
  const pieces = placementsOf(chess.fen());
  for (const side of ['w', 'b'] as const) {
    const own = pieces.filter(p => (p.piece === p.piece.toUpperCase()) === (side === 'w'));
    if (own.length > 16 || own.filter(p => p.piece.toLowerCase() === 'p').length > 8) throw new Error('Too many pieces for one side.');
  }
  for (const [right, kingSquare, rookSquare, king, rook] of [['K','e1','h1','K','R'],['Q','e1','a1','K','R'],['k','e8','h8','k','r'],['q','e8','a8','k','r']]) {
    if (fields[2].includes(right) && (!pieces.some(p => p.square === kingSquare && p.piece === king) || !pieces.some(p => p.square === rookSquare && p.piece === rook))) throw new Error('Castling rights require the king and rook on their starting squares.');
  }
  const ep = fields[3];
  if (ep !== '-') {
    const whiteTurn = fields[1] === 'w';
    if (ep[1] !== (whiteTurn ? '6' : '3') || chess.get(ep as Square) || !pieces.some(p => p.square === `${ep[0]}${whiteTurn ? '5' : '4'}` && p.piece === (whiteTurn ? 'p' : 'P')) || chess.get(`${ep[0]}${whiteTurn ? '7' : '2'}` as Square)) throw new Error('En passant must describe the opponent’s immediately preceding two-square pawn move.');
  }
  const otherTurn = `${fields[0]} ${fields[1] === 'w' ? 'b' : 'w'} - - 0 1`;
  if (new Chess(otherTurn).isCheck()) throw new Error('The side that just moved cannot still be in check.');
  return chess;
}
export const uciOf = (move: Move) => move.from + move.to + (move.promotion ?? '');
export function moveUci(chess: Chess, uci: string): Move {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Invalid UCI move');
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
}
export function importPosition(correction: Correction, revision: number): ConfirmedPosition {
  let chess: Chess; let initialFen: string; let moves: string[] = []; let historyComplete = false;
  if (correction.format === 'start') { chess = new Chess(); initialFen = DEFAULT_POSITION; historyComplete = true; }
  else if (correction.format === 'fen') { chess = validatePosition(correction.text.trim()); initialFen = chess.fen({ forceEnpassantSquare: true }); }
  else {
    chess = new Chess(); chess.loadPgn(correction.text, { strict: true });
    if (chess.history().length === 0 && !chess.getHeaders().FEN) throw new Error('PGN contains no moves or setup position.');
    const history = chess.history({ verbose: true });
    initialFen = history[0]?.before ?? chess.fen({ forceEnpassantSquare: true });
    validatePosition(initialFen); validatePosition(chess.fen({ forceEnpassantSquare: true }));
    moves = history.map(uciOf); historyComplete = initialFen === DEFAULT_POSITION;
  }
  return { sessionId: correction.sessionId, revision, fen: chess.fen({ forceEnpassantSquare: true }), initialFen, moves, historyComplete, coachedSide: correction.coachedSide, orientation: correction.orientation };
}
export function matchObservation(position: ConfirmedPosition, observation: VisionResult): { kind: 'unchanged' } | { kind: 'move'; position: ConfirmedPosition } | { kind: 'correction'; reason: string } {
  if (!observation.boardVisible || !observation.cropAligned) return { kind: 'correction', reason: 'The board is hidden or the crop moved. Select Board again.' };
  if (observation.orientation !== position.orientation) return { kind: 'correction', reason: 'The board flipped. Confirm the orientation and crop again.' };
  if (observation.uncertainSquares.length) return { kind: 'correction', reason: 'Some squares are uncertain. Correct or rescan the position.' };
  try { placementFen(observation.placements); } catch { return { kind: 'correction', reason: 'Recognition contains duplicate squares.' }; }
  const target = placementKey(observation.placements);
  if (target === placementKey(placementsOf(position.fen))) return { kind: 'unchanged' };
  const chess = new Chess(position.fen); const matches: Move[] = [];
  for (const move of chess.moves({ verbose: true })) {
    chess.move(move); if (placementKey(placementsOf(chess.fen())) === target) matches.push(move); chess.undo();
  }
  if (matches.length !== 1) return { kind: 'correction', reason: 'The board does not match exactly one legal move. Import FEN/PGN or correct the position.' };
  const move = chess.move(matches[0]);
  return { kind: 'move', position: { ...position, fen: chess.fen({ forceEnpassantSquare: true }), moves: [...position.moves, uciOf(move)] } };
}
const pieceNames: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export function plainMove(move: Move): string {
  if (move.isKingsideCastle()) return 'castle kingside';
  if (move.isQueensideCastle()) return 'castle queenside';
  return `${move.captured ? 'capture with' : 'move'} the ${pieceNames[move.piece]} ${move.captured ? 'on' : 'to'} ${move.to}${move.promotion ? ` and promote to ${pieceNames[move.promotion]}` : ''}`;
}
export function legalCandidate(fen: string, id: string, score: EngineScore, depth: number, pv: string[]): Candidate {
  if (!pv.length || pv[0] !== id) throw new Error('Variation does not begin with candidate');
  const chess = new Chess(fen); let first: Move | undefined;
  const variation = pv.map(uci => { const move = moveUci(chess, uci); first ??= move; return { uci, san: move.san }; });
  return { id, san: first!.san, plain: plainMove(first!), score, depth, variation };
}
export function whiteScore(score: EngineScore, turn: 'w' | 'b'): EngineScore { return { ...score, value: turn === 'w' ? score.value : -score.value }; }
export function displayScore(score: EngineScore): string { return score.type === 'mate' ? `Mate ${score.value < 0 ? 'Black' : 'White'} in ${Math.abs(score.value)}` : `${score.value >= 0 ? '+' : ''}${(score.value / 100).toFixed(2)}`; }
