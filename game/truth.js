'use strict';
/**
 * Truth or Truth engine (Misi 3, Sensei 2026-10-22).
 * Pure turn state machine: TRULY RANDOM wheel with two hidden fairness
 * rules (Sensei): (1) whoever answered the previous spin sits out the
 * next one (cooldown), then re-enters; (2) a player who has received
 * MAX_QUESTIONS_PER_PLAYER questions is silently excluded for the rest
 * of the session. Neither rule is ever exposed to clients (snapshot
 * hides them) so the wheel feels natural. Plus ASK claims, card
 * questions, answers, reactions & points, end-game awards.
 * NO timers live here — the server drives time (spin ±10s, ASK window
 * 10s, answer 2 min) and calls the transitions below. Every mutator
 * validates the move and returns { ok, events } or { ok:false, error };
 * events are named so the server can broadcast the mandatory on-screen
 * notifications ("Putaran ke 2", "Player 1 bertanya", ...).
 */

const MIN_PLAYERS_TRUTH = 2;
const MAX_PLAYERS_TRUTH = 8;
const QUESTIONS_TOTAL_SMALL = 10; // rooms of 2-5 players (Sensei)
const QUESTIONS_TOTAL_LARGE = 16; // rooms of 6-8 players (Sensei)
// Host picks from these in the room's "Set Aturan" panel (Sensei).
const TOTAL_QUESTION_CHOICES = [8, 10, 12, 16, 20, 24];
const ASK_PER_GAME = 2;
const PASS_PER_GAME = 1;
const REACT_MAX_PER_ANSWER = 2;
const REACTIONS = ['lucu', 'nangis', 'lovely', 'marah'];
const REACTION_POINTS = { lucu: 10, nangis: 15, lovely: 10, marah: 15 };
const KURANG_GREGET_PENALTY = 5;
const MAX_QUESTIONS_PER_PLAYER = 5; // hidden cap, never shown in game
// Timing contract for the server layer (Fase 2) — single source of truth.
const SPIN_MS = 10000;
const ASK_WINDOW_MS = 10000;
const ANSWER_MS = 120000;

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function blankCurrent() {
  return {
    answererId: null, source: null, askerId: null, question: null,
    answer: null, passed: false,
    reactions: [], // { playerId, kind }
    kurangGregetBy: [],
  };
}

function createGame(opts) {
  const o = opts || {};
  const ids = Array.isArray(o.playerIds) ? o.playerIds.slice() : [];
  if (ids.length < MIN_PLAYERS_TRUTH) return { ok: false, error: 'minimal 2 pemain' };
  if (ids.length > MAX_PLAYERS_TRUTH) return { ok: false, error: 'maksimal 8 pemain' };
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'pemain duplikat' };
  if (ids.some((id) => typeof id !== 'string' || !id)) {
    return { ok: false, error: 'id pemain tidak valid' };
  }
  const questions = Array.isArray(o.questions) ? o.questions.slice() : [];
  // Default total by room size (Sensei, 22 Okt): 2-5 players -> 10,
  // 6-8 players -> 16. The host may override it from the room's
  // "Set Aturan" panel with one of TOTAL_QUESTION_CHOICES.
  let totalTurns = ids.length <= 5
    ? QUESTIONS_TOTAL_SMALL : QUESTIONS_TOTAL_LARGE;
  if (o.totalQuestions !== undefined) {
    if (!TOTAL_QUESTION_CHOICES.includes(o.totalQuestions)) {
      return { ok: false, error: 'batas pertanyaan tidak valid' };
    }
    totalTurns = o.totalQuestions;
  }
  if (questions.length < totalTurns) {
    return { ok: false, error: 'bank soal terlalu sedikit' };
  }
  // Explicit Mode: cards come from the explicit deck only, ASK is off.
  const explicitMode = o.explicitMode === true;
  const rand = typeof o.rand === 'function' ? o.rand : Math.random;
  const state = {
    phase: 'ask_window', // ask_window -> answering -> reacting -> ... -> finished
    players: ids.map((id) => ({
      id, points: 0, askLeft: ASK_PER_GAME, passLeft: PASS_PER_GAME,
      askedCount: 0, // hidden fairness counter — never leaves the server
    })),
    round: 1,
    lastAnswererId: null,
    turnNumber: 1,
    totalTurns,
    explicitMode,
    deck: shuffle(questions, rand),
    deckDrawn: 0,
    current: blankCurrent(),
    history: [],
    awards: null,
    rand,
  };
  state.current.answererId = pickAnswerer(state);
  return { ok: true, state };
}

// Truly random pick from the eligible pool. Hidden rules: the previous
// answerer sits this spin out (cooldown), and anyone who already
// received MAX_QUESTIONS_PER_PLAYER questions is out for the session.
// If the cooldown alone would empty the pool, the cooldown is relaxed
// before the cap is. Returns null only when everyone is capped.
function pickAnswerer(state) {
  const underCap = state.players.filter(
    (p) => p.askedCount < MAX_QUESTIONS_PER_PLAYER);
  let pool = underCap.filter((p) => p.id !== state.lastAnswererId);
  if (pool.length === 0) pool = underCap;
  if (pool.length === 0) return null;
  const pick = pool[Math.floor(state.rand() * pool.length)];
  pick.askedCount += 1;
  state.lastAnswererId = pick.id;
  return pick.id;
}

function playerOf(state, playerId) {
  return state.players.find((p) => p.id === playerId) || null;
}

function turnEvents(state, extra) {
  return [{ type: 'turn_started', playerId: state.current.answererId,
    turnNumber: state.turnNumber, totalTurns: state.totalTurns,
    round: state.round }].concat(extra || []);
}

// Another player claims the right to ask a free-form question this turn.
// Exclusive: the first claim wins; the card stays locked for the turn.
function claimAsk(state, playerId) {
  if (state.explicitMode) {
    return { ok: false, error: 'ASK nonaktif di Mode Eksplisit' };
  }
  if (state.phase !== 'ask_window') return { ok: false, error: 'bukan jendela ASK' };
  const p = playerOf(state, playerId);
  if (!p) return { ok: false, error: 'pemain tidak dikenal' };
  if (playerId === state.current.answererId) {
    return { ok: false, error: 'penjawab tidak bisa bertanya ke diri sendiri' };
  }
  if (state.current.askerId) return { ok: false, error: 'ASK sudah diklaim pemain lain' };
  if (p.askLeft <= 0) return { ok: false, error: 'jatah ASK habis' };
  p.askLeft -= 1;
  state.current.askerId = playerId;
  state.current.source = 'ask';
  return { ok: true, events: [{ type: 'ask_claimed', playerId }] };
}

function submitAskQuestion(state, playerId, text) {
  if (state.phase !== 'ask_window') return { ok: false, error: 'bukan jendela ASK' };
  if (playerId !== state.current.askerId) {
    return { ok: false, error: 'hanya penanya yang bisa mengirim pertanyaan' };
  }
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length < 3 || t.length > 200) {
    return { ok: false, error: 'pertanyaan harus 3-200 karakter' };
  }
  state.current.question = t;
  state.phase = 'answering';
  return { ok: true, events: [{ type: 'question_ready', source: 'ask', playerId }] };
}

// No ASK claim within the window: the top card opens automatically.
function openCard(state) {
  if (state.phase !== 'ask_window') return { ok: false, error: 'bukan jendela ASK' };
  if (state.current.askerId) return { ok: false, error: 'kartu terkunci: ada ASK aktif' };
  if (state.deckDrawn >= state.deck.length) {
    return { ok: false, error: 'bank soal habis' };
  }
  state.current.question = state.deck[state.deckDrawn];
  state.deckDrawn += 1;
  state.current.source = 'card';
  state.phase = 'answering';
  return { ok: true, events: [{ type: 'card_opened', question: state.current.question }] };
}

function submitAnswer(state, playerId, text) {
  if (state.phase !== 'answering') return { ok: false, error: 'belum waktunya menjawab' };
  if (playerId !== state.current.answererId) {
    return { ok: false, error: 'hanya penjawab yang bisa menjawab' };
  }
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length < 1 || t.length > 1000) {
    return { ok: false, error: 'jawaban harus 1-1000 karakter' };
  }
  state.current.answer = t;
  state.phase = 'reacting';
  return { ok: true, events: [{ type: 'answer_submitted', playerId }] };
}

function closeTurn(state, passed) {
  const c = state.current;
  const counts = { lucu: 0, nangis: 0, lovely: 0, marah: 0 };
  for (const r of c.reactions) counts[r.kind] += 1;
  let earned = -KURANG_GREGET_PENALTY * c.kurangGregetBy.length;
  for (const kind of REACTIONS) earned += counts[kind] * REACTION_POINTS[kind];
  state.history.push({
    turnNumber: state.turnNumber, round: state.round,
    answererId: c.answererId, askerId: c.askerId, source: c.source,
    question: c.question, answer: c.answer, passed: !!passed,
    counts, kurangGreget: c.kurangGregetBy.length, pointsEarned: passed ? 0 : earned,
  });
  if (state.turnNumber >= state.totalTurns) {
    state.phase = 'finished';
    state.awards = computeAwards(state);
    return { ok: true, events: [{ type: 'game_over', awards: state.awards }] };
  }
  state.turnNumber += 1;
  state.round = state.turnNumber; // each spin IS a "putaran" (Sensei)
  state.current = blankCurrent();
  const next = pickAnswerer(state);
  if (next === null) { // everyone hit the hidden cap: end the game early
    state.phase = 'finished';
    state.awards = computeAwards(state);
    return { ok: true, events: [{ type: 'game_over', awards: state.awards }] };
  }
  state.current.answererId = next;
  state.phase = 'ask_window';
  return { ok: true, events: turnEvents(state) };
}

// Voluntary PASS: consumes the player's single pass token.
function passTurn(state, playerId) {
  if (state.phase !== 'answering') return { ok: false, error: 'belum ada pertanyaan' };
  if (playerId !== state.current.answererId) {
    return { ok: false, error: 'hanya penjawab yang bisa pass' };
  }
  const p = playerOf(state, playerId);
  if (p.passLeft <= 0) return { ok: false, error: 'jatah PASS habis' };
  p.passLeft -= 1;
  state.current.passed = true;
  const done = closeTurn(state, true);
  return { ok: true, events: [{ type: 'passed', playerId }].concat(done.events) };
}

// Answer timer ran out: counts as a pass, but the token is NOT consumed.
function timeoutTurn(state) {
  if (state.phase !== 'answering') return { ok: false, error: 'belum ada pertanyaan' };
  state.current.passed = true;
  const done = closeTurn(state, true);
  return { ok: true, events: [{ type: 'answer_timeout', playerId: state.history[state.history.length - 1].answererId }].concat(done.events) };
}

function react(state, playerId, kind) {
  if (state.phase !== 'reacting') return { ok: false, error: 'belum waktunya reaksi' };
  if (!REACTIONS.includes(kind)) return { ok: false, error: 'reaksi tidak dikenal' };
  if (!playerOf(state, playerId)) return { ok: false, error: 'pemain tidak dikenal' };
  if (playerId === state.current.answererId) {
    return { ok: false, error: 'tidak bisa mereaksi jawaban sendiri' };
  }
  const mine = state.current.reactions.filter((r) => r.playerId === playerId).length;
  if (mine >= REACT_MAX_PER_ANSWER) {
    return { ok: false, error: 'maksimal 2 reaksi per jawaban' };
  }
  state.current.reactions.push({ playerId, kind });
  playerOf(state, state.current.answererId).points += REACTION_POINTS[kind];
  return { ok: true, events: [{ type: 'reacted', playerId, kind }] };
}

function kurangGreget(state, playerId) {
  if (state.phase !== 'reacting') return { ok: false, error: 'belum waktunya reaksi' };
  if (!playerOf(state, playerId)) return { ok: false, error: 'pemain tidak dikenal' };
  if (playerId === state.current.answererId) {
    return { ok: false, error: 'tidak bisa kurang-greget ke jawaban sendiri' };
  }
  if (state.current.kurangGregetBy.includes(playerId)) {
    return { ok: false, error: 'kurang greget hanya 1x per pertanyaan' };
  }
  state.current.kurangGregetBy.push(playerId);
  playerOf(state, state.current.answererId).points -= KURANG_GREGET_PENALTY;
  return { ok: true, events: [{ type: 'kurang_greget', playerId }] };
}

// Reaction window closed by the server: finalize the turn.
function endTurn(state) {
  if (state.phase !== 'reacting') return { ok: false, error: 'belum waktunya ganti giliran' };
  return closeTurn(state, false);
}

function bestAnswer(state, kind) {
  let best = null;
  for (const h of state.history) {
    if (h.passed || h.counts[kind] <= 0) continue;
    if (!best || h.counts[kind] > best.counts[kind] ||
        (h.counts[kind] === best.counts[kind] && h.pointsEarned > best.pointsEarned)) {
      best = h;
    }
  }
  return best ? { playerId: best.answererId, count: best.counts[kind],
    question: best.question, answer: best.answer } : null;
}

function computeAwards(state) {
  let top = null;
  for (const p of state.players) {
    if (!top || p.points > top.points) top = { playerId: p.id, points: p.points };
  }
  return {
    topScorer: top,
    funniest: bestAnswer(state, 'lucu'),
    saddest: bestAnswer(state, 'nangis'),
    loveliest: bestAnswer(state, 'lovely'),
    mostEmotional: bestAnswer(state, 'marah'),
  };
}

function snapshot(state) {
  const c = state.current;
  const counts = { lucu: 0, nangis: 0, lovely: 0, marah: 0 };
  for (const r of c.reactions) counts[r.kind] += 1;
  return {
    phase: state.phase,
    round: state.round,
    turnNumber: state.turnNumber,
    totalTurns: state.totalTurns,
    explicitMode: state.explicitMode,
    deckLeft: state.deck.length - state.deckDrawn,
    players: state.players.map((p) => ({ id: p.id, points: p.points,
      askLeft: p.askLeft, passLeft: p.passLeft })),
    current: {
      answererId: c.answererId, source: c.source, askerId: c.askerId,
      question: c.question, answer: c.answer, passed: c.passed,
      reactionCounts: counts, kurangGreget: c.kurangGregetBy.length,
    },
    awards: state.awards,
  };
}

module.exports = {
  MIN_PLAYERS_TRUTH, MAX_PLAYERS_TRUTH,
  QUESTIONS_TOTAL_SMALL, QUESTIONS_TOTAL_LARGE, TOTAL_QUESTION_CHOICES,
  ASK_PER_GAME, PASS_PER_GAME, REACT_MAX_PER_ANSWER,
  REACTIONS, REACTION_POINTS, KURANG_GREGET_PENALTY, MAX_QUESTIONS_PER_PLAYER,
  SPIN_MS, ASK_WINDOW_MS, ANSWER_MS,
  createGame, claimAsk, submitAskQuestion, openCard,
  submitAnswer, passTurn, timeoutTurn, react, kurangGreget,
  endTurn, computeAwards, snapshot,
};
