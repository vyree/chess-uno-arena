'use strict';
/**
 * UNO engine: standard 108-card rules (simplified per PRD).
 * Simplifications (documented): no wild+4 challenge.
 * UNO declaration via saidUno flag (forget = draw 2 penalty).
 * House rules (Misi 2, Sensei 2026-10-21): 2-8 players; strict stacking.
 * Mode rules (Misi 5, Sensei 2026-10-22 — CORRECTS the Misi 2 reading):
 * - normal: only +2 stacks; a pending +4 can never be answered.
 * - hard (formerly "ekstrim"): escalation — +2 may be answered by +2 or
 *   +4; +4 only by +4. Once +4 enters, the chain is locked to +4.
 * - hell: hard stacking + a fatter deck (+2 x4/color, wild4 x8) and two
 *   hell-only specials (4 each): Reverse Black (bounce a pending pile to
 *   the other direction) and Null White (erase the pile, uncounterable;
 *   EVERY player draws 2; caster picks the color). Both specials are
 *   dead cards outside a pending pile.
 */

const COLORS = ['red', 'yellow', 'green', 'blue'];
const NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const ACTIONS = ['skip', 'reverse', 'draw2'];

let cardSeq = 0;
function mkCard(color, kind, value) {
  return { id: 'c' + (cardSeq++), color, kind, value };
}

function buildDeck(mode) {
  const deck = [];
  for (const color of COLORS) {
    deck.push(mkCard(color, 'number', 0));
    for (let n = 1; n <= 9; n++) {
      deck.push(mkCard(color, 'number', n));
      deck.push(mkCard(color, 'number', n));
    }
    for (const a of ACTIONS) {
      deck.push(mkCard(color, a, null));
      deck.push(mkCard(color, a, null));
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push(mkCard(null, 'wild', null));
    deck.push(mkCard(null, 'wild4', null));
  }
  if (mode === 'hell') {
    // Hell-only composition (Misi 5): draw cards doubled so piles ignite
    // more often (+2 x4 per color = 16 total, wild4 x8), plus the two
    // hell specials, 4 copies each. Total: 128 cards.
    for (const color of COLORS) {
      deck.push(mkCard(color, 'draw2', null));
      deck.push(mkCard(color, 'draw2', null));
    }
    for (let i = 0; i < 4; i++) deck.push(mkCard(null, 'wild4', null));
    for (let i = 0; i < 4; i++) {
      deck.push(mkCard(null, 'reverseBlack', null));
      deck.push(mkCard(null, 'nullWhite', null));
    }
  }
  return deck;
}

function shuffle(arr, rand) {
  const r = rand || Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const MODES = ['normal', 'hard', 'hell'];

function newGame(numPlayers, opts) {
  // opts: { rand, mode } — a bare function is treated as rand (legacy
  // calls); the Misi 2 boolean `extreme` maps to 'hard' (legacy calls).
  if (typeof opts === 'function') opts = { rand: opts };
  opts = opts || {};
  if (numPlayers < 2 || numPlayers > 8) throw new Error('pemain harus 2-8');
  const mode = MODES.includes(opts.mode) ? opts.mode : (opts.extreme ? 'hard' : 'normal');
  const deck = shuffle(buildDeck(mode), opts.rand);
  const hands = [];
  for (let p = 0; p < numPlayers; p++) hands.push(deck.splice(0, 7));
  // flip starter: must be a number card (bury action cards back into deck)
  let starter;
  for (;;) {
    const c = deck.pop();
    if (c.kind === 'number') { starter = c; break; }
    deck.unshift(c);
  }
  const st = {
    deck, discard: [starter], hands,
    turn: 0, dir: 1,
    currentColor: starter.color,
    pendingDraw: 0,       // next player draws this many & loses turn
    pendingKind: null,    // 'draw2' | 'wild4' — kind of the pile's current top answer level
    mode,                 // 'normal' | 'hard' | 'hell' (Misi 5)
    drawnCard: null,      // card drawn this turn (may be played or passed)
    drewThisTurn: false,
    over: null,
    round: 1,
  };
  return st;
}

function topCard(st) { return st.discard[st.discard.length - 1]; }

// Pile answers by mode (Misi 5):
// - normal: a +2 pile answers only with +2; a +4 pile has NO answer.
// - hard/hell: a +2 pile answers with +2 or +4 (escalation); a +4 pile
//   answers only with +4.
// The hell specials (Reverse Black / Null White) answer ANY pending pile.
function isStackCard(st, card) {
  if (!st.pendingKind) return false;
  if (card.kind === 'reverseBlack' || card.kind === 'nullWhite') return true;
  if (st.mode === 'normal') return st.pendingKind === 'draw2' && card.kind === 'draw2';
  if (st.pendingKind === 'draw2') return card.kind === 'draw2' || card.kind === 'wild4';
  return card.kind === 'wild4';
}

// Why a would-be stack answer is rejected (user-facing, mapped in server).
function stackError(st, card) {
  if (st.pendingKind === 'wild4') {
    if (st.mode === 'normal') return '+4 tidak bisa ditumpuk di mode normal';
    if (card.kind === 'draw2') return 'tumpukan +4 hanya bisa dijawab +4';
  }
  return 'hanya kartu sejenis yang bisa menumpuk';
}

function canPlay(st, playerIdx, card) {
  if (st.over || st.turn !== playerIdx || st.drewThisTurn) return false;
  if (st.pendingDraw > 0) return isStackCard(st, card);
  // hell specials are dead cards outside a pending pile
  if (card.kind === 'reverseBlack' || card.kind === 'nullWhite') return false;
  const top = topCard(st);
  if (card.kind === 'wild' || card.kind === 'wild4') return true;
  if (card.color === st.currentColor) return true;
  if (card.kind === 'number' && top.kind === 'number' && card.value === top.value) return true;
  if (card.kind !== 'number' && card.kind === top.kind) return true;
  return false;
}

function replenish(st) {
  if (st.deck.length > 0) return;
  const top = st.discard.pop();
  st.deck = shuffle(st.discard);
  st.discard = [top];
}

function advanceTurn(st, skip) {
  const n = st.hands.length;
  st.turn = (((st.turn + st.dir * skip) % n) + n) % n;
}

function cardPoints(c) {
  if (c.kind === 'number') return c.value;
  if (c.kind === 'wild' || c.kind === 'wild4' || c.kind === 'reverseBlack' || c.kind === 'nullWhite') return 50;
  return 20;
}

// Play a card from hand. opts: { saidUno: bool, wildColor: color }
function playCard(st, playerIdx, cardId, opts) {
  opts = opts || {};
  if (st.over) return { ok: false, error: 'ronde sudah selesai' };
  if (st.turn !== playerIdx) return { ok: false, error: 'bukan giliranmu' };
  if (st.drewThisTurn) return { ok: false, error: 'kamu sudah ambil kartu, mainkan atau lewati' };
  const hand = st.hands[playerIdx];
  const hi = hand.findIndex((c) => c.id === cardId);
  if (hi < 0) return { ok: false, error: 'kartu tidak ada di tanganmu' };
  const card = hand[hi];
  const stacking = st.pendingDraw > 0;
  if (stacking) {
    // facing a draw pile: only the mode's stack answers (Misi 5) are legal
    if (!isStackCard(st, card)) return { ok: false, error: stackError(st, card) };
  } else if (card.kind === 'reverseBlack' || card.kind === 'nullWhite') {
    return { ok: false, error: 'kartu spesial hanya bisa dipakai melawan tumpukan' };
  } else if (!canPlay(st, playerIdx, card)) {
    return { ok: false, error: 'kartu tidak cocok' };
  }
  if ((card.kind === 'wild' || card.kind === 'wild4' || card.kind === 'nullWhite') && !COLORS.includes(opts.wildColor)) {
    return { ok: false, error: 'pilih warna dulu' };
  }

  hand.splice(hi, 1);
  st.discard.push(card);
  // wild-class plays set the color; Reverse Black (colorless) preserves it
  st.currentColor = (card.kind === 'wild' || card.kind === 'wild4' || card.kind === 'nullWhite')
    ? opts.wildColor : (card.color || st.currentColor);
  const events = [{ type: 'play', player: playerIdx, kind: card.kind }];

  if (card.kind === 'nullWhite') {
    // Null White (hell): the pile vanishes at once — final, nothing can
    // counter it — and EVERY player (caster included) draws 2. Resolved
    // BEFORE the UNO/win checks so the tax is part of the play itself:
    // you cannot go out by casting Null.
    const nulled = st.pendingDraw;
    st.pendingDraw = 0;
    st.pendingKind = null;
    const affected = [];
    for (let p = 0; p < st.hands.length; p++) {
      replenish(st);
      for (let i = 0; i < 2 && st.deck.length; i++) st.hands[p].push(st.deck.pop());
      affected.push(p);
    }
    events.push({ type: 'nullify', player: playerIdx, nulled, affected });
  }

  // UNO penalty: forgot to declare with 1 card left
  let penalty = 0;
  if (hand.length === 1 && !opts.saidUno) {
    penalty = 2;
    replenish(st);
    for (let i = 0; i < 2 && st.deck.length; i++) hand.push(st.deck.pop());
  }
  if (hand.length === 1) events.push({ type: 'uno', player: playerIdx });

  // win?
  if (hand.length === 0) {
    st.over = { winner: playerIdx, reason: 'habis' };
    return { ok: true, won: true, penalty, events };
  }

  // action effects
  let skip = 1;
  if (card.kind === 'skip') skip = 2;
  else if (card.kind === 'reverse') {
    st.dir *= -1;
    skip = st.hands.length === 2 ? 2 : 1; // reverse = skip in 2-player
  } else if (card.kind === 'reverseBlack') {
    // Reverse Black (hell): flip direction; the pile itself is untouched
    // (same amount, same kind) — the player in the NEW direction now
    // faces it. With 2 players that simply hands the pile back.
    st.dir *= -1;
    events.push({ type: 'bounce', player: playerIdx, total: st.pendingDraw });
  } else if (card.kind === 'draw2' || card.kind === 'wild4') {
    // start a new pile or stack onto the pending one (the played kind
    // becomes the pile's answer level — this is what locks an escalated
    // +2 pile to +4-only afterwards)
    st.pendingDraw += card.kind === 'draw2' ? 2 : 4;
    st.pendingKind = card.kind;
    if (stacking) events.push({ type: 'stack', player: playerIdx, total: st.pendingDraw });
  }
  advanceTurn(st, skip);
  return { ok: true, penalty, events };
}

// Draw 1 card. If pendingDraw > 0, draws the penalty pile and loses turn.
function drawCard(st, playerIdx) {
  if (st.over) return { ok: false, error: 'ronde sudah selesai' };
  if (st.turn !== playerIdx) return { ok: false, error: 'bukan giliranmu' };
  if (st.drewThisTurn) return { ok: false, error: 'sudah ambil kartu giliran ini' };
  replenish(st);
  if (st.deck.length === 0) return { ok: false, error: 'deck habis' };

  if (st.pendingDraw > 0) {
    const n = st.pendingDraw;
    st.pendingDraw = 0;
    st.pendingKind = null;
    for (let i = 0; i < n && st.deck.length; i++) st.hands[playerIdx].push(st.deck.pop());
    advanceTurn(st, 1);
    return { ok: true, drew: n, lostTurn: true, events: [{ type: 'drawPenalty', player: playerIdx, n }] };
  }
  const card = st.deck.pop();
  st.hands[playerIdx].push(card);
  st.drewThisTurn = true;
  st.drawnCard = card.id;
  return { ok: true, drew: 1, card, playable: canPlayAfterDraw(st, playerIdx, card), events: [{ type: 'draw', player: playerIdx, n: 1 }] };
}

function canPlayAfterDraw(st, playerIdx, card) {
  const top = topCard(st);
  if (card.kind === 'reverseBlack' || card.kind === 'nullWhite') return false; // pile-only specials
  if (card.kind === 'wild' || card.kind === 'wild4') return true;
  if (card.color === st.currentColor) return true;
  if (card.kind === 'number' && top.kind === 'number' && card.value === top.value) return true;
  if (card.kind !== 'number' && card.kind === top.kind) return true;
  return false;
}

// After drawing, player may play the drawn card (via playCard after reset)
// or pass the turn.
function passTurn(st, playerIdx) {
  if (st.over) return { ok: false, error: 'ronde sudah selesai' };
  if (st.turn !== playerIdx) return { ok: false, error: 'bukan giliranmu' };
  if (!st.drewThisTurn) return { ok: false, error: 'ambil kartu dulu atau mainkan kartumu' };
  st.drewThisTurn = false;
  st.drawnCard = null;
  advanceTurn(st, 1);
  return { ok: true };
}

// Allow playing the just-drawn card: temporarily lift the drewThisTurn block.
function playDrawnCard(st, playerIdx, cardId, opts) {
  if (st.drawnCard !== cardId) return { ok: false, error: 'hanya kartu yang baru diambil' };
  st.drewThisTurn = false;
  const r = playCard(st, playerIdx, cardId, opts);
  if (!r.ok) { st.drewThisTurn = true; return r; }
  st.drewThisTurn = false;
  st.drawnCard = null;
  return r;
}

// Score a finished round into the scores array. Returns points gained by winner.
function scoreRound(st, scores) {
  if (!st.over) return 0;
  let pts = 0;
  st.hands.forEach((hand, i) => {
    if (i !== st.over.winner) for (const c of hand) pts += cardPoints(c);
  });
  scores[st.over.winner] += pts;
  return pts;
}

function toClient(st, playerIdx) {
  const hand = st.hands[playerIdx] || [];
  const myTurn = st.turn === playerIdx && !st.over;
  const playable = hand.map((c) => {
    if (!myTurn) return false;
    if (st.drewThisTurn) {
      return c.id === st.drawnCard && canPlayAfterDraw(st, playerIdx, c);
    }
    return canPlay(st, playerIdx, c);
  });
  return {
    hands: st.hands.map((h, i) => (i === playerIdx ? h : h.length)),
    playable,
    top: topCard(st),
    currentColor: st.currentColor,
    turn: st.turn,
    dir: st.dir,
    pendingDraw: st.pendingDraw,
    pendingKind: st.pendingKind,
    mode: st.mode,
    drewThisTurn: st.turn === playerIdx ? st.drewThisTurn : false,
    deckCount: st.deck.length,
    over: st.over,
    round: st.round,
    numPlayers: st.hands.length,
  };
}

module.exports = {
  COLORS, MODES, buildDeck, shuffle, newGame, canPlay, isStackCard, playCard, drawCard,
  passTurn, playDrawnCard, scoreRound, cardPoints, toClient, topCard,
};
