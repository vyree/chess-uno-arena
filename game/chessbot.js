'use strict';
/**
 * Chess "AI" personas (Misi 6-8, Sensei 2026-10-22): ONE lightweight
 * negamax engine wearing four costumes — the UI presents them as AI
 * opponents and never calls them bots. Under the costumes they differ
 * by search depth, capture extension (quiescence), a little randomness
 * — and, since Misi 8, by TASTE: each persona scores positions with
 * its own flavour weights (evaluateFor) and re-ranks root moves with
 * one signature skill:
 *   Gemini = the glass cannon. NO blunders anymore, attacks only:
 *     heavy attack/fork/knight flavour, defence almost unweighted,
 *     "Pantang Mundur" (retreats are taxed) and the "2-Knight Parade"
 *     (his knights lead the charge and the army shields them).
 *   GPT = the methodist: balanced taste, strong defence weight, and
 *     an "Anti-Blunder Protocol" — a root move that hands the opponent
 *     a big free capture is demoted whenever a near-equal safe move
 *     exists.
 *   Meta = the sorcerer/trap-setter: attack-leaning taste, a chaos
 *     bonus for captures and checks, a sacrifice tolerance at the
 *     root, and a trap bonus for moves whose greedy-looking reply
 *     actually loses for the opponent.
 *   Claude = the grinder: deepest taste for defence and endgames;
 *     when ahead he steers into queen trades and won endgames, when
 *     behind he refuses them. Plus capture quiescence (strongest).
 * Thinking time is theatre on top: pickThinkMs deals mostly 5-10 s,
 * sometimes longer, rarely right up to the buzzer — but always safely
 * inside the turn limit, so the AI never loses on time.
 */
const chess = require('./chess');

const PERSONAS = {
  gemini: {
    name: 'Gemini', level: 'Normal', depth: 2, blunder: 0, jitter: 90, extendCaptures: false,
    weights: { attack: 2.2, fork: 2.0, knight: 2.2, defense: 0.1, endgame: 0.5 },
  },
  gpt: {
    name: 'GPT', level: 'Hard', depth: 2, blunder: 0.08, jitter: 40, extendCaptures: false,
    weights: { attack: 1.0, fork: 1.0, knight: 1.0, defense: 1.25, endgame: 1.0 },
  },
  meta: {
    name: 'Meta', level: 'Hell', depth: 3, blunder: 0, jitter: 25, extendCaptures: false, sacTolerance: 340,
    weights: { attack: 1.7, fork: 1.3, knight: 1.1, defense: 0.8, endgame: 0.8 },
  },
  claude: {
    name: 'Claude', level: 'Hell', depth: 3, blunder: 0, jitter: 10, extendCaptures: true,
    weights: { attack: 1.1, fork: 1.1, knight: 1.0, defense: 1.3, endgame: 1.8 },
  },
};

const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;
const NODE_MAX = 90000;
const KNIGHT_D = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];

function opp(c) { return c === 'w' ? 'b' : 'w'; }
function advOf(piece, sq) {
  const r = Math.floor(sq / 8);
  return piece.c === 'w' ? r : 7 - r; // 0 at home rank, grows forward
}
function cheb(a, b) {
  return Math.max(Math.abs((a % 8) - (b % 8)), Math.abs(Math.floor(a / 8) - Math.floor(b / 8)));
}

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
    if (p.t === 'p') v += adv * 5 + (f === 3 || f === 4 ? 8 : 0) + ((f === 3 || f === 4) && (r === 3 || r === 4) ? 10 : 0);
    else if (p.t === 'n') v += (7 - cd) * 4;
    else if (p.t === 'b') v += (7 - cd) * 3;
    else if (p.t === 'r') v += adv === 6 ? 10 : 0;
    else if (p.t === 'q') v += (7 - cd) * 1;
    else if (p.t === 'k') v += cd * 3;
    score += p.c === 'w' ? v : -v;
  }
  return score;
}

// Persona flavour for ONE colour, in centipawns "good for that
// colour": pressure around the enemy king (attack), knight forks and
// knight advancement (fork/knight), pawn shield + enemy pressure
// around the own king (defense), and endgame king activity + passed
// pawns (endgame). Gemini's near-zero defense weight is exactly how
// he "ignores defence"; his knight weight powers the parade.
function flavor(st, color, w) {
  const foe = opp(color);
  let myKing = -1;
  let foeKing = -1;
  let material = 0;
  for (let i = 0; i < 64; i++) {
    const p = st.board[i];
    if (!p) continue;
    if (p.t === 'k') { if (p.c === color) myKing = i; else foeKing = i; } else material += VALUES[p.t];
  }
  const endgame = material <= 2600;
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = st.board[i];
    if (!p) continue;
    if (p.c === foe) { // enemy pressure around my king: defence cares
      if (myKing >= 0 && p.t !== 'k' && p.t !== 'p' && cheb(i, myKing) <= 2) s -= 8 * w.defense;
      continue;
    }
    const f = i % 8;
    const r = Math.floor(i / 8);
    const adv = color === 'w' ? r : 7 - r;
    if (p.t === 'n') s += knightFlavor(st, i, foe, w);
    if (p.t !== 'k' && foeKing >= 0 && cheb(i, foeKing) <= 2) s += (p.t === 'p' ? 3 : 6) * w.attack;
    if (p.t === 'p') {
      if (myKing >= 0 && cheb(i, myKing) === 1) s += 5 * w.defense; // pawn shield
      if (endgame && isPassedPawn(st, i, color)) s += adv * 4 * w.endgame;
    }
  }
  if (endgame && myKing >= 0) {
    const cd = Math.abs((myKing % 8) - 3.5) + Math.abs(Math.floor(myKing / 8) - 3.5);
    s += (7 - cd) * 3 * w.endgame; // an active king wins endgames
  }
  return Math.round(s);
}

function knightFlavor(st, i, foe, w) {
  const f = i % 8;
  const r = Math.floor(i / 8);
  const piece = st.board[i];
  let s = advOf(piece, i) * 3 * w.knight;
  let valuable = 0;
  let hitsKing = false;
  for (const [dr, df] of KNIGHT_D) {
    const rr = r + dr;
    const ff = f + df;
    if (rr < 0 || rr > 7 || ff < 0 || ff > 7) continue;
    const q = st.board[rr * 8 + ff];
    if (q && q.c === foe) {
      if (q.t === 'k') hitsKing = true;
      else if (VALUES[q.t] >= 300) valuable++;
    }
  }
  if (valuable >= 2) s += 45 * w.fork; // a real fork brewing
  else if (valuable === 1 && hitsKing) s += 40 * w.fork; // check + prize
  return s;
}

function isPassedPawn(st, i, color) {
  const f = i % 8;
  const r = Math.floor(i / 8);
  for (let j = 0; j < 64; j++) {
    const p = st.board[j];
    if (!p || p.t !== 'p' || p.c === color) continue;
    const ahead = color === 'w' ? Math.floor(j / 8) > r : Math.floor(j / 8) < r;
    if (ahead && Math.abs((j % 8) - f) <= 1) return false;
  }
  return true;
}

// Evaluation from White's perspective with the bot persona's taste
// applied to the bot's own colour only: the persona hunts positions
// IT values, which is what makes the four costumes play differently.
function evaluateFor(st, personaKey, botColor) {
  const persona = PERSONAS[personaKey] || PERSONAS.gemini;
  const f = flavor(st, botColor, persona.weights);
  return evaluate(st) + (botColor === 'w' ? f : -f);
}

function sideScoreFor(st, ctx) {
  const v = evaluateFor(st, ctx.key, ctx.botColor);
  return st.turn === 'w' ? v : -v;
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

function search(st, depth, alpha, beta, ply, ctx) {
  if (ctx.budget.nodes++ > ctx.budget.max) return sideScoreFor(st, ctx);
  if (depth <= 0) {
    return ctx.persona.extendCaptures ? captureSearch(st, alpha, beta, ply, ctx) : sideScoreFor(st, ctx);
  }
  const moves = chess.allLegalMoves(st, st.turn);
  if (!moves.length) return chess.inCheck(st.board, st.turn) ? -MATE + ply : 0;
  let best = -Infinity;
  for (const m of orderMoves(st, moves)) {
    const child = structuredClone(st);
    const res = chess.applyMove(child, m.from, m.to, m.promo);
    const score = res.status
      ? statusScore(res.status, st.turn, ply)
      : -search(child, depth - 1, -beta, -alpha, ply + 1, ctx);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// Captures-only quiescence (Claude's edge): settles tactical noise so
// a queen "won" into a recapture is not mistaken for a free queen.
function captureSearch(st, alpha, beta, ply, ctx) {
  if (ctx.budget.nodes++ > ctx.budget.max || ply > 8) return sideScoreFor(st, ctx);
  const stand = sideScoreFor(st, ctx);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  const caps = chess.allLegalMoves(st, st.turn).filter((m) => isCapture(st, m));
  for (const m of orderMoves(st, caps)) {
    const child = structuredClone(st);
    const res = chess.applyMove(child, m.from, m.to, m.promo);
    const score = res.status
      ? statusScore(res.status, st.turn, ply)
      : -captureSearch(child, -beta, -alpha, ply + 1, ctx);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// ----- signature skills: root-move re-ranking per persona -----

// Squares the given colour could move to — a good-enough attack map
// for root-level tactical checks (toy engine, root only).
function attackSet(st, color) {
  const set = new Set();
  for (const m of chess.allLegalMoves(st, color)) set.add(m.to);
  return set;
}

// How many of `color`'s pieces cover square `sq` (occupied by one of
// their own): swap in an enemy pawn and count captures onto it.
function defendersOf(st, sq, color) {
  if (!st.board[sq]) return 0;
  const clone = structuredClone(st);
  clone.board[sq] = { t: 'p', c: opp(color) };
  let n = 0;
  for (const m of chess.allLegalMoves(clone, color)) if (m.to === sq) n++;
  return n;
}

// Gemini — "Pantang Mundur" + "2-Knight Parade": non-capturing
// retreats are taxed, knight moves lead, a knight landing en prise is
// taxed, and a move that saves or shields an attacked knight (the
// army bodyguarding the princes) is rewarded; ignoring a hanging
// knight is the one defensive sin even Gemini is punished for.
function geminiAdjust(st, scored) {
  const botColor = st.turn;
  const foe = opp(botColor);
  const foeAttacks = attackSet(st, foe);
  const attackedKnights = [];
  for (let i = 0; i < 64; i++) {
    const p = st.board[i];
    if (p && p.t === 'n' && p.c === botColor && foeAttacks.has(i)) attackedKnights.push(i);
  }
  const hangingPre = attackedKnights.map((sq) => defendersOf(st, sq, botColor) === 0);
  for (const s of scored) {
    if (Math.abs(s.score) > MATE / 2) continue;
    const piece = st.board[s.move.from];
    if (!isCapture(st, s.move) && advOf(piece, s.move.to) < advOf(piece, s.move.from)) s.score -= 120;
    const childFoe = attackSet(s.child, foe);
    if (piece.t === 'n') {
      s.score += 30;
      const victim = st.board[s.move.to];
      if (childFoe.has(s.move.to) && defendersOf(s.child, s.move.to, botColor) === 0
        && (!victim || VALUES[victim.t] < VALUES.n)) s.score -= 80;
    }
    attackedKnights.forEach((ksq, idx) => {
      if (s.move.from === ksq) return; // the prince moved himself away
      if (!childFoe.has(ksq) || defendersOf(s.child, ksq, botColor) > 0) s.score += 50;
      else if (hangingPre[idx]) s.score -= 60;
    });
  }
}

// The biggest net material loss the opponent can inflict in one move
// from this child position (capture value minus what we recapture).
function maxNetLoss(childSt, botColor) {
  const foe = opp(botColor);
  let worst = 0;
  for (const m of chess.allLegalMoves(childSt, foe)) {
    const victim = childSt.board[m.to] || (m.epCapture ? childSt.board[m.epSquare] : null);
    if (!victim || victim.c !== botColor) continue;
    let net = VALUES[victim.t];
    const post = structuredClone(childSt);
    chess.applyMove(post, m.from, m.to, m.promo);
    if (attackSet(post, botColor).has(m.to)) net -= VALUES[childSt.board[m.from].t];
    if (net > worst) worst = net;
  }
  return worst;
}

// GPT — "Anti-Blunder Protocol": if any near-best move is safe, a
// move that allows a >= 200 cp free net capture is heavily demoted.
function gptAdjust(st, scored) {
  const botColor = st.turn;
  let best = -Infinity;
  for (const s of scored) if (s.score > best) best = s.score;
  const danger = new Map();
  let anySafe = false;
  for (const s of scored) {
    const d = Math.abs(s.score) > MATE / 2 ? 0 : maxNetLoss(s.child, botColor);
    danger.set(s, d);
    if (s.score >= best - 60 && d < 200) anySafe = true;
  }
  if (!anySafe) return;
  for (const s of scored) if (danger.get(s) >= 200) s.score -= 400;
}

// Meta's trap bonus: for one candidate child position, compare the
// bot's static score after the opponent's BEST reply with the score
// after their GREEDIEST capture. A big gap means the bait is poisoned.
function trapBonus(childSt, botColor) {
  const foe = opp(botColor);
  const replies = chess.allLegalMoves(childSt, foe);
  if (!replies.length) return 0;
  let bestForFoe = Infinity;
  let greedyV = null;
  let greedyGain = -1;
  for (const r of replies) {
    const pos = structuredClone(childSt);
    chess.applyMove(pos, r.from, r.to, r.promo);
    const v = (botColor === 'w' ? 1 : -1) * evaluateFor(pos, 'meta', botColor);
    if (v < bestForFoe) bestForFoe = v;
    const victim = childSt.board[r.to];
    if (victim && victim.c === botColor && VALUES[victim.t] > greedyGain) {
      greedyGain = VALUES[victim.t];
      greedyV = v;
    }
  }
  if (greedyV === null) return 0;
  return Math.max(0, Math.round((greedyV - bestForFoe) * 0.5));
}

// Meta — chaos flavour (Tal's ghost): inside his sacrifice
// tolerance, captures earn a bonus, checks a big one, and a true
// sacrifice (a piece worth 300+ grabbing less than its own value)
// the biggest — enough to make a Greek-Gift-style shot his first
// choice while the methodical personas decline it. Plus the trap
// bonus for poisoned bait.
function metaAdjust(st, scored) {
  const botColor = st.turn;
  let best = -Infinity;
  for (const s of scored) if (s.score > best) best = s.score;
  // Every move inside the tolerance is bonus-eligible (a sacrifice's
  // raw score is low BY DEFINITION — a top-N slice would never reach
  // it); the expensive trap bonus is computed for the best few only.
  const eligible = scored
    .filter((s) => s.score >= best - (PERSONAS.meta.sacTolerance || 260) && Math.abs(s.score) <= MATE / 2);
  for (const s of eligible) {
    const attacker = st.board[s.move.from];
    const victim = st.board[s.move.to];
    if (victim) {
      s.score += 40;
      if (VALUES[attacker.t] >= 300 && VALUES[victim.t] < VALUES[attacker.t]) s.score += 170;
    }
    if (chess.inCheck(s.child.board, opp(botColor))) s.score += 130;
  }
  eligible.sort((a, b) => b.score - a.score);
  for (const s of eligible.slice(0, 6)) s.score += trapBonus(s.child, botColor);
}

// Claude — "the Grinder": ahead -> steer into queen trades (and the
// endgame his flavour values); behind -> refuse the same trades.
function claudeAdjust(st, scored) {
  const botColor = st.turn;
  const now = (botColor === 'w' ? 1 : -1) * evaluateFor(st, 'claude', botColor);
  if (Math.abs(now) <= 60) return;
  for (const s of scored) {
    const victim = st.board[s.move.to];
    const moved = st.board[s.move.from];
    const queenTrade = (victim && victim.t === 'q') || (moved.t === 'q' && !!victim);
    if (queenTrade) s.score += now > 60 ? 45 : -35;
  }
}

function adjustScores(st, scored, key) {
  if (key === 'gemini') geminiAdjust(st, scored);
  else if (key === 'gpt') gptAdjust(st, scored);
  else if (key === 'meta') metaAdjust(st, scored);
  else if (key === 'claude') claudeAdjust(st, scored);
}

// A tiny hand-written opening book (what real engines ship too): in
// the first moves, while the position is quiet (no capture on offer),
// each persona picks from its own weighted favourites — sensible
// centre play with a personal tint (Gemini spices in f4/g4 lunges,
// Claude leads with d4). Square names are White's perspective; for
// Black they are rank-mirrored (e2e4 -> e7e5, g1f3 -> g8f6).
const BOOK = {
  gemini: [['e2e4', 26], ['d2d4', 22], ['g1f3', 16], ['b1c3', 10], ['f2f4', 12], ['c2c4', 8], ['g2g4', 6]],
  gpt: [['e2e4', 30], ['d2d4', 30], ['g1f3', 20], ['c2c4', 12], ['b1c3', 8]],
  meta: [['e2e4', 26], ['d2d4', 24], ['c2c4', 18], ['g1f3', 18], ['f2f4', 8], ['b2b4', 6]],
  claude: [['d2d4', 34], ['e2e4', 24], ['g1f3', 22], ['c2c4', 12], ['b1c3', 8]],
};

function mirrorName(name) {
  return name[0] + (9 - Number(name[1])) + name[2] + (9 - Number(name[3]));
}

function pickBookMove(st, key, r, moves) {
  if (st.full > 4) return null;
  if (moves.some((m) => isCapture(st, m))) return null; // tactics rule
  const legal = new Map(moves.map((m) => [chess.sqName(m.from) + chess.sqName(m.to), m]));
  const options = [];
  for (const [names, weight] of BOOK[key] || []) {
    const mv = legal.get(st.turn === 'b' ? mirrorName(names) : names);
    if (mv) options.push([mv, weight]);
  }
  if (!options.length) return null;
  let total = 0;
  for (const [, w] of options) total += w;
  let roll = r() * total;
  for (const [mv, w] of options) { roll -= w; if (roll <= 0) return mv; }
  return options[options.length - 1][0];
}

// Opening-principles prior for root moves (first 10 full moves): a
// shallow search with a coarse eval cannot feel a wasted tempo, so
// sane development is nudged directly — centre pawns and developing
// knights/bishops up, rim landings, flank double-pushes, early queen
// sorties and king walks down. Small (±20 cp): tactics always win.
function openingPrior(st, m) {
  if (st.full > 10) return 0;
  const piece = st.board[m.from];
  if (!piece) return 0;
  const tf = m.to % 8;
  const tr = Math.floor(m.to / 8);
  let s = 0;
  if (piece.t === 'n' || piece.t === 'b') {
    if (advOf(piece, m.from) === 0 && advOf(piece, m.to) > 0) s += 12;
    if (piece.t === 'n' && (tf === 0 || tf === 7)) s -= 8; // a knight on the rim...
  }
  if (piece.t === 'p') {
    if (tf === 3 || tf === 4) s += 8;
    if ((tf === 3 || tf === 4) && (tr === 3 || tr === 4)) s += 8;
    if ((tf === 0 || tf === 7) && Math.abs(tr - Math.floor(m.from / 8)) === 2) s -= 6;
  }
  if (piece.t === 'q') s -= 10;
  if (piece.t === 'k' && !m.castle) s -= 15;
  return s;
}

// Pick the persona's move for the side to move. Returns a move object
// from chess.allLegalMoves ({ from, to, promo? }) or null when the
// game has no legal moves.
function chooseMove(st, personaKey, rand) {
  const key = PERSONAS[personaKey] ? personaKey : 'gemini';
  const persona = PERSONAS[key];
  const r = rand || Math.random;
  const moves = chess.allLegalMoves(st, st.turn);
  if (!moves.length) return null;
  const bookMove = pickBookMove(st, key, r, moves);
  if (bookMove) return bookMove;
  if (persona.blunder > 0 && r() < persona.blunder) return moves[Math.floor(r() * moves.length)];
  const ctx = {
    persona, key, botColor: st.turn, budget: { nodes: 0, max: NODE_MAX },
  };
  const scored = [];
  for (const m of orderMoves(st, moves)) {
    const child = structuredClone(st);
    const res = chess.applyMove(child, m.from, m.to, m.promo);
    const score = res.status
      ? statusScore(res.status, st.turn, 0)
      : -search(child, persona.depth - 1, -Infinity, Infinity, 1, ctx) + openingPrior(st, m);
    scored.push({ move: m, score, child });
  }
  adjustScores(st, scored, key);
  let best = -Infinity;
  for (const s of scored) if (s.score > best) best = s.score;
  const pool = scored.filter((s) => s.score >= best - persona.jitter);
  return pool[Math.floor(r() * pool.length)].move;
}

// Thinking-time theatre v2 (Sensei's spec, Misi 7): the pause follows
// the shape of a real game. Special cases beat phase rules: a forced
// move (1 legal) <= 3 s, escaping check <= 7 s, few options (2-3
// legal) <= 5 s, an obvious recapture 2-5 s. Opening (moves 1-7)
// stays in the 5-10 s book range; the middlegame (8-30) is capped at
// 30 s; only the endgame (31+) may drift toward the buzzer. The hard
// cap (limit - 2.5 s) always applies: timeout is a loss in chess, so
// the AI is never actually late. ctx: { moveNumber, inCheck,
// legalCount, canRecapture } — all optional; no ctx = full drama.
function pickThinkMs(rand, limitMs, ctx) {
  const r = rand || Math.random;
  const c = ctx || {};
  const cap = Math.max(3000, (limitMs || 60000) - 2500);
  let ms;
  if (c.legalCount === 1) ms = 1000 + r() * 2000;
  else if (c.inCheck) ms = 3000 + r() * 4000;
  else if (c.legalCount && c.legalCount <= 3) ms = 2000 + r() * 3000;
  else if (c.canRecapture) ms = 2000 + r() * 3000;
  else if (c.moveNumber && c.moveNumber <= 7) ms = 5000 + r() * 5000;
  else if (c.moveNumber && c.moveNumber <= 30) ms = middleThinkMs(r);
  else ms = dramaThinkMs(r, cap);
  return Math.round(Math.min(ms, cap));
}

function middleThinkMs(r) {
  const roll = r();
  if (roll < 0.60) return 5000 + r() * 7000;
  if (roll < 0.85) return 12000 + r() * 8000;
  return 20000 + r() * 10000;
}

function dramaThinkMs(r, cap) {
  const roll = r();
  if (roll < 0.60) return 5000 + r() * 5000;
  if (roll < 0.80) return 10000 + r() * 10000;
  if (roll < 0.92) return 20000 + r() * 20000;
  return cap - r() * 2000;
}

module.exports = { PERSONAS, evaluate, evaluateFor, chooseMove, pickThinkMs };
