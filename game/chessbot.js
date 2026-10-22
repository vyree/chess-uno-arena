'use strict';
/**
 * Chess "AI" personas (Misi 6, Sensei 2026-10-22): ONE lightweight
 * negamax engine wearing four costumes — the UI presents them as AI
 * opponents and never calls them bots. Strength differs by search
 * depth, capture extension (quiescence) and deliberate blunder rate:
 *   Gemini = Normal (shallow, blunders often), GPT = Hard,
 *   Meta = Hell, Claude = Hell + capture search (the strongest).
 * Thinking time is theatre on top: pickThinkMs deals mostly 5-10 s,
 * sometimes longer, rarely right up to the buzzer — but always safely
 * inside the turn limit, so the AI never loses on time.
 */
const chess = require('./chess');

const PERSONAS = {
  gemini: { name: 'Gemini', level: 'Normal', depth: 1, blunder: 0.35, jitter: 150, extendCaptures: false },
  gpt: { name: 'GPT', level: 'Hard', depth: 2, blunder: 0.08, jitter: 60, extendCaptures: false },
  meta: { name: 'Meta', level: 'Hell', depth: 3, blunder: 0, jitter: 25, extendCaptures: false },
  claude: { name: 'Claude', level: 'Hell', depth: 3, blunder: 0, jitter: 10, extendCaptures: true },
};

const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;
const NODE_MAX = 90000;

// Static evaluation in centipawns, from White's perspective. Material
// plus simple positional nudges: pawns advance, knights/bishops seek
// the centre, rooks like the 7th rank, the king hides toward a corner.
function evaluate(st) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = st.board[i];
    if (!p) continue;
    const f = i % 8;
    const r = Math.floor(i / 8);
    const adv = p.c === 'w' ? r : 7 - r; // 0 at home rank, grows forward
    const cd = Math.abs(f - 3.5) + Math.abs(r - 3.5); // centre distance 0..7
    let v = VALUES[p.t];
    if (p.t === 'p') v += adv * 5 + (f === 3 || f === 4 ? 4 : 0);
    else if (p.t === 'n') v += (7 - cd) * 4;
    else if (p.t === 'b') v += (7 - cd) * 3;
    else if (p.t === 'r') v += adv === 6 ? 10 : 0;
    else if (p.t === 'q') v += (7 - cd) * 1;
    else if (p.t === 'k') v += cd * 3;
    score += p.c === 'w' ? v : -v;
  }
  return score;
}

function sideScore(st) {
  return (st.turn === 'w' ? 1 : -1) * evaluate(st);
}

function isCapture(st, m) {
  return !!st.board[m.to] || !!m.epCapture;
}

// Captures first (biggest victim first) + promotions: cheap move
// ordering that makes alpha-beta pruning bite.
function orderMoves(st, moves) {
  return moves.slice().sort((a, b) => moveRank(st, b) - moveRank(st, a));
}
function moveRank(st, m) {
  let rank = 0;
  const victim = st.board[m.to];
  if (victim) rank += 10000 + VALUES[victim.t] * 10 - VALUES[st.board[m.from].t];
  else if (m.epCapture) rank += 10000 + 100 * 10 - 100;
  if (m.promo) rank += 9000 + VALUES[m.promo];
  return rank;
}

// Score of a finished game from the perspective of the side that just
// moved (moverColor): a win is mate-distance discounted so faster
// mates win and slower losses are preferred.
function statusScore(status, moverColor, ply) {
  if (!status || !status.result || status.result === '1/2-1/2') return 0;
  const winner = status.result === '1-0' ? 'w' : 'b';
  return winner === moverColor ? MATE - ply : -MATE + ply;
}

function search(st, depth, alpha, beta, ply, persona, budget) {
  if (budget.nodes++ > budget.max) return sideScore(st);
  if (depth <= 0) {
    return persona.extendCaptures ? captureSearch(st, alpha, beta, ply, budget) : sideScore(st);
  }
  const moves = chess.allLegalMoves(st, st.turn);
  if (!moves.length) return chess.inCheck(st.board, st.turn) ? -MATE + ply : 0;
  let best = -Infinity;
  for (const m of orderMoves(st, moves)) {
    const child = structuredClone(st);
    const res = chess.applyMove(child, m.from, m.to, m.promo);
    const score = res.status
      ? statusScore(res.status, st.turn, ply)
      : -search(child, depth - 1, -beta, -alpha, ply + 1, persona, budget);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// Captures-only quiescence (Claude's edge): settles tactical noise so
// a queen "won" into a recapture is not mistaken for a free queen.
function captureSearch(st, alpha, beta, ply, budget) {
  if (budget.nodes++ > budget.max || ply > 8) return sideScore(st);
  const stand = sideScore(st);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  const caps = chess.allLegalMoves(st, st.turn).filter((m) => isCapture(st, m));
  for (const m of orderMoves(st, caps)) {
    const child = structuredClone(st);
    const res = chess.applyMove(child, m.from, m.to, m.promo);
    const score = res.status
      ? statusScore(res.status, st.turn, ply)
      : -captureSearch(child, -beta, -alpha, ply + 1, budget);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// Pick the persona's move for the side to move. Returns a move object
// from chess.allLegalMoves ({ from, to, promo? }) or null when the
// game has no legal moves.
function chooseMove(st, personaKey, rand) {
  const persona = PERSONAS[personaKey] || PERSONAS.gemini;
  const r = rand || Math.random;
  const moves = chess.allLegalMoves(st, st.turn);
  if (!moves.length) return null;
  if (r() < persona.blunder) return moves[Math.floor(r() * moves.length)];
  const budget = { nodes: 0, max: NODE_MAX };
  let best = -Infinity;
  const scored = [];
  for (const m of orderMoves(st, moves)) {
    const child = structuredClone(st);
    const res = chess.applyMove(child, m.from, m.to, m.promo);
    const score = res.status
      ? statusScore(res.status, st.turn, 0)
      : -search(child, persona.depth - 1, -Infinity, Infinity, 1, persona, budget);
    scored.push({ move: m, score });
    if (score > best) best = score;
  }
  const pool = scored.filter((s) => s.score >= best - persona.jitter);
  return pool[Math.floor(r() * pool.length)].move;
}

// Thinking-time theatre (Sensei's spec): most moves 5-10 s, sometimes
// 10-20 s, sometimes 20-40 s, rarely right up to the buzzer — but the
// cap keeps a safety margin inside `limitMs` so the AI moves in time.
function pickThinkMs(rand, limitMs) {
  const r = rand || Math.random;
  const cap = Math.max(3000, (limitMs || 60000) - 2500);
  const roll = r();
  let ms;
  if (roll < 0.60) ms = 5000 + r() * 5000;
  else if (roll < 0.80) ms = 10000 + r() * 10000;
  else if (roll < 0.92) ms = 20000 + r() * 20000;
  else ms = cap - r() * 2000;
  return Math.round(Math.min(ms, cap));
}

module.exports = { PERSONAS, evaluate, chooseMove, pickThinkMs };
