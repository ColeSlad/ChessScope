import type { Orientation, Placement } from "../shared/contracts";
export const GLYPHS: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};
const NAMES: Record<string, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};
export function Board({
  placements,
  orientation,
  arrow,
  uncertain = [],
  onSquare,
}: {
  placements: Placement[];
  orientation: Orientation;
  arrow?: string;
  uncertain?: string[];
  onSquare?: (square: string) => void;
}) {
  const files = orientation === "white-bottom" ? "abcdefgh" : "hgfedcba";
  const ranks =
    orientation === "white-bottom"
      ? [8, 7, 6, 5, 4, 3, 2, 1]
      : [1, 2, 3, 4, 5, 6, 7, 8];
  const point = (square: string) => [
    files.indexOf(square[0]) + 0.5,
    ranks.indexOf(Number(square[1])) + 0.5,
  ];
  const from = arrow ? point(arrow.slice(0, 2)) : null,
    to = arrow ? point(arrow.slice(2, 4)) : null;
  return (
    <div
      className="mini-board"
      role={onSquare ? "group" : "img"}
      aria-label={
        onSquare
          ? "Position editor"
          : `Position preview, ${orientation.replace("-", " ")}. ${placements.map((p) => `${p.square}: ${p.piece === p.piece.toUpperCase() ? "White" : "Black"} ${NAMES[p.piece.toLowerCase()]}`).join("; ")}`
      }
    >
      {ranks.flatMap((rank, row) =>
        Array.from(files).map((file, col) => {
          const square = `${file}${rank}`,
            piece = placements.find((p) => p.square === square)?.piece;
          const label = `${square}: ${piece ? `${piece === piece.toUpperCase() ? "White" : "Black"} ${NAMES[piece.toLowerCase()]}` : "empty"}${uncertain.includes(square) ? ", uncertain" : ""}`;
          const content = (
            <>
              {col === 0 && <span className="rank">{rank}</span>}
              {row === 7 && <span className="file">{file}</span>}
              <span
                className={`piece ${piece === piece?.toUpperCase() ? "white-piece" : "black-piece"}`}
              >
                {piece ? GLYPHS[piece] : ""}
              </span>
              {uncertain.includes(square) && (
                <span className="uncertain">?</span>
              )}
            </>
          );
          const className = `square ${(row + col) % 2 ? "dark-square" : "light-square"}`;
          return onSquare ? (
            <button
              key={square}
              type="button"
              className={className}
              onClick={() => onSquare(square)}
              aria-label={label}
            >
              {content}
            </button>
          ) : (
            <div key={square} className={className} aria-label={label}>
              {content}
            </div>
          );
        }),
      )}
      {from && to && (
        <svg className="board-arrow" viewBox="0 0 8 8" aria-hidden="true">
          <defs>
            <marker
              id="arrow"
              markerWidth="2.5"
              markerHeight="2.5"
              refX="1.6"
              refY="1.25"
              orient="auto"
            >
              <path d="M0 0L2 1.25L0 2.5z" fill="var(--arrow)" />
            </marker>
          </defs>
          <line
            x1={from[0]}
            y1={from[1]}
            x2={to[0]}
            y2={to[1]}
            stroke="var(--arrow)"
            strokeWidth=".18"
            markerEnd="url(#arrow)"
          />
        </svg>
      )}
    </div>
  );
}
