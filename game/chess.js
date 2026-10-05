'use strict';
/**
 * Chess engine: full standard rules, server-authoritative.
 * Board: Array(64), index = rank*8 + file (rank 0 = white back rank).
 * Piece: { t: 'p'|'n'|'b'|'r'|'q'|'k', c: 'w'|'b' } | null
 */

// ---------- helpers ----------
const KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const BISHOP_D = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const FILES = 'abcdefgh';

const rankOf = (i) => i >> 3;
const fileOf = (i) => i & 7;
const onBoard = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;
const opp = (c) => (c === 'w' ? 'b' : 'w');
const sqName = (i) => FILES[fileOf(i)] + (rankOf(i) + 1);
const parseSq = (s) => {
  if (!/^[a-h][1-8]$/.test(s)) return -1;
  return (parseInt(s[1], 10) - 1) * 8 + FILES.indexOf(s[0]);
};

function newGame() {
  const board = new Array(64).fill(null);
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let f = 0; f < 8; f++) {
    board[f] = { t: back[f], c: 'w' };
    board[8 + f] = { t: 'p', c: 'w' };
    board[48 + f] = { t: 'p', c: 'b' };
    board[56 + f] = { t: back[f], c: 'b' };
  }
  const st = {
    board, turn: 'w',
    castling: { K: true, Q: true, k: true, q: true },
    ep: null, half: 0, full: 1,
    history: [], lastMove: null, over: null,
  };
  st.history.push(posKey(st));
  return st;
}

function posKey(st) {
  let s = st.turn;
  for (let i = 0; i < 64; i++) {
    const p = st.board[i];
    s += p ? (p.c === 'w' ? p.t.toUpperCase() : p.t) : '.';
  }
  const c = st.castling;
  s += (c.K ? 'K' : '') + (c.Q ? 'Q' : '') + (c.k ? 'k' : '') + (c.q ? 'q' : '');
  s += st.ep === null ? '-' : String(st.ep);
  return s;
}

function findKing(board, color) {
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.t === 'k' && p.c === color) return i;
  }
  return -1;
}

function isAttacked(board, sq, by) {
  const r = rankOf(sq), f = fileOf(sq);
  // pawns
  const pr = by === 'w' ? r - 1 : r + 1;
  for (const df of [-1, 1]) {
    if (onBoard(pr, f + df)) {
      const p = board[pr * 8 + f + df];
      if (p && p.t === 'p' && p.c === by) return true;
    }
  }
  // knights
  for (const [dr, df] of KNIGHT_D) {
    if (onBoard(r + dr, f + df)) {
      const p = board[(r + dr) * 8 + f + df];
      if (p && p.t === 'n' && p.c === by) return true;
    }
  }
  // king
  for (const [dr, df] of KING_D) {
    if (onBoard(r + dr, f + df)) {
      const p = board[(r + dr) * 8 + f + df];
      if (p && p.t === 'k' && p.c === by) return true;
    }
  }
  // sliders
  const rays = [
    [BISHOP_D, ['b', 'q']],
    [ROOK_D, ['r', 'q']],
  ];
  for (const [dirs, types] of rays) {
    for (const [dr, df] of dirs) {
      let rr = r + dr, ff = f + df;
      while (onBoard(rr, ff)) {
        const p = board[rr * 8 + ff];
        if (p) {
          if (p.c === by && types.includes(p.t)) return true;
          break;
        }
        rr += dr; ff += df;
      }
    }
  }
  return false;
}

function inCheck(board, color) {
  const k = findKing(board, color);
  return k >= 0 && isAttacked(board, k, opp(color));
}

// Apply a move to a board array (mutates). move: {from,to,promo?,epCapture?,castle?}
function rawMove(board, move) {
  const piece = board[move.from];
  board[move.to] = move.promo ? { t: move.promo, c: piece.c } : piece;
  board[move.from] = null;
  if (move.epCapture) board[move.epSquare] = null;
  if (move.castle) {
    const r = rankOf(move.from);
    if (move.castle === 'K') { board[r * 8 + 5] = board[r * 8 + 7]; board[r * 8 + 7] = null; }
    if (move.castle === 'Q') { board[r * 8 + 3] = board[r * 8 + 0]; board[r * 8 + 0] = null; }
  }
}

function pseudoMoves(st, s) {
  const board = st.board;
  const piece = board[s];
  if (!piece || piece.c !== st.turn) return [];
  const moves = [];
  const r = rankOf(s), f = fileOf(s);
  const add = (to, extra) => moves.push(Object.assign({ from: s, to }, extra || {}));

  const slide = (dirs) => {
    for (const [dr, df] of dirs) {
      let rr = r + dr, ff = f + df;
      while (onBoard(rr, ff)) {
        const t = board[rr * 8 + ff];
        if (!t) add(rr * 8 + ff);
        else { if (t.c !== piece.c) add(rr * 8 + ff); break; }
        rr += dr; ff += df;
      }
    }
  };

  if (piece.t === 'p') {
    const dir = piece.c === 'w' ? 1 : -1;
    const startRank = piece.c === 'w' ? 1 : 6;
    const lastRank = piece.c === 'w' ? 7 : 0;
    const oneR = r + dir;
    if (onBoard(oneR, f) && !board[oneR * 8 + f]) {
      if (oneR === lastRank) {
        for (const pr of ['q', 'r', 'b', 'n']) add(oneR * 8 + f, { promo: pr });
      } else {
        add(oneR * 8 + f);
        const twoR = r + 2 * dir;
        if (r === startRank && !board[twoR * 8 + f]) add(twoR * 8 + f, { double: true });
      }
    }
    for (const df of [-1, 1]) {
      const tr = r + dir, tf = f + df;
      if (!onBoard(tr, tf)) continue;
      const t = board[tr * 8 + tf];
      const isPromo = tr === lastRank;
      if (t && t.c !== piece.c) {
        if (isPromo) { for (const pr of ['q', 'r', 'b', 'n']) add(tr * 8 + tf, { promo: pr }); }
        else add(tr * 8 + tf);
      } else if (!t && st.ep === tr * 8 + tf) {
        add(tr * 8 + tf, { epCapture: true, epSquare: r * 8 + tf });
      }
    }
  } else if (piece.t === 'n') {
    for (const [dr, df] of KNIGHT_D) {
      if (!onBoard(r + dr, f + df)) continue;
      const t = board[(r + dr) * 8 + f + df];
      if (!t || t.c !== piece.c) add((r + dr) * 8 + f + df);
    }
  } else if (piece.t === 'k') {
    for (const [dr, df] of KING_D) {
      if (!onBoard(r + dr, f + df)) continue;
      const t = board[(r + dr) * 8 + f + df];
      if (!t || t.c !== piece.c) add((r + dr) * 8 + f + df);
    }
    // castling
    const home = piece.c === 'w' ? 0 : 7;
    if (r === home && f === 4 && !inCheck(board, piece.c)) {
      const rights = piece.c === 'w' ? ['K', 'Q'] : ['k', 'q'];
      const enemy = opp(piece.c);
      // kingside
      if (st.castling[rights[0]] && !board[home * 8 + 5] && !board[home * 8 + 6] &&
          !isAttacked(board, home * 8 + 5, enemy) && !isAttacked(board, home * 8 + 6, enemy)) {
        add(home * 8 + 6, { castle: 'K' });
      }
      // queenside
      if (st.castling[rights[1]] && !board[home * 8 + 1] && !board[home * 8 + 2] && !board[home * 8 + 3] &&
          !isAttacked(board, home * 8 + 3, enemy) && !isAttacked(board, home * 8 + 2, enemy)) {
        add(home * 8 + 2, { castle: 'Q' });
      }
    }
  } else {
    if (piece.t === 'b' || piece.t === 'q') slide(BISHOP_D);
    if (piece.t === 'r' || piece.t === 'q') slide(ROOK_D);
  }
  return moves;
}

function legalMoves(st, s) {
  const out = [];
  for (const m of pseudoMoves(st, s)) {
    const b2 = st.board.slice();
    rawMove(b2, m);
    if (!inCheck(b2, st.turn)) out.push(m);
  }
  return out;
}

function allLegalMoves(st, color) {
  const saved = st.turn;
  st.turn = color;
  const out = [];
  for (let i = 0; i < 64; i++) {
    if (st.board[i] && st.board[i].c === color) {
      for (const m of legalMoves(st, i)) out.push(m);
    }
  }
  st.turn = saved;
  return out;
}

// Apply a validated move to the state (mutates). Returns info about the new position.
function applyMove(st, from, to, promo) {
  if (st.over) return { ok: false, error: 'permainan sudah selesai' };
  const piece = st.board[from];
  if (!piece || piece.c !== st.turn) return { ok: false, error: 'bukan bidakmu' };
  const legal = legalMoves(st, from).filter((m) => m.to === to);
  if (legal.length === 0) return { ok: false, error: 'langkah tidak legal' };
  let move = legal[0];
  if (move.promo) {
    const p = (promo || 'q').toLowerCase();
    const chosen = legal.find((m) => m.promo === p) || legal.find((m) => m.promo === 'q');
    move = chosen;
  }

  const captured = st.board[to] || (move.epCapture ? st.board[move.epSquare] : null);
  const wasPawn = piece.t === 'p';
  rawMove(st.board, move);

  // castling rights
  if (piece.t === 'k') {
    if (piece.c === 'w') { st.castling.K = false; st.castling.Q = false; }
    else { st.castling.k = false; st.castling.q = false; }
  }
  // castling rights: clear when king/rook moves, or a rook is captured on its home square
  const clearRook = (sq, color) => {
    if (sq === 0 && color === 'w') st.castling.Q = false;
    if (sq === 7 && color === 'w') st.castling.K = false;
    if (sq === 56 && color === 'b') st.castling.q = false;
    if (sq === 63 && color === 'b') st.castling.k = false;
  };
  clearRook(from, piece.c);
  if (captured && captured.t === 'r') clearRook(to, captured.c);

  st.ep = move.double ? (rankOf(from) + rankOf(to)) / 2 * 8 + fileOf(from) : null;
  st.half = (wasPawn || captured) ? 0 : st.half + 1;
  if (st.turn === 'b') st.full += 1;
  st.lastMove = { from: sqName(from), to: sqName(to), promo: move.promo || null };
  st.turn = opp(st.turn);
  st.history.push(posKey(st));

  return { ok: true, status: computeStatus(st) };
}

function repetitionCount(st) {
  const key = st.history[st.history.length - 1];
  let n = 0;
  for (const k of st.history) if (k === key) n++;
  return n;
}

function computeStatus(st) {
  if (st.over) return st.over;
  const moves = allLegalMoves(st, st.turn);
  const chk = inCheck(st.board, st.turn);
  if (moves.length === 0) {
    st.over = chk
      ? { result: st.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' }
      : { result: '1/2-1/2', reason: 'stalemate' };
  } else if (st.half >= 100) {
    st.over = { result: '1/2-1/2', reason: 'fifty' };
  } else if (repetitionCount(st) >= 3) {
    st.over = { result: '1/2-1/2', reason: 'repetition' };
  }
  return st.over;
}

// Lightweight serializable snapshot for clients.
function toClient(st) {
  return {
    board: st.board.map((p) => (p ? p.c + p.t : null)),
    turn: st.turn,
    over: st.over,
    lastMove: st.lastMove,
    inCheck: inCheck(st.board, st.turn),
    fullmove: st.full,
  };
}

module.exports = {
  newGame, legalMoves, allLegalMoves, applyMove, computeStatus,
  toClient, sqName, parseSq, inCheck, FILES,
};
