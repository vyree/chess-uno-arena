'use strict';
/**
 * UNO engine: standard 108-card rules (simplified per PRD).
 * Simplifications (documented): no wild+4 challenge.
 * UNO declaration via saidUno flag (forget = draw 2 penalty).
 * House rules (Misi 2, Sensei 2026-10-21): 2-8 players; STRICT stacking —
 * +2 stacks only on +2, +4 only on +4 (any color); in extreme mode +4
 * cannot be stacked at all (deadly), only +2 stacks.
 */

const COLORS = ['red', 'yellow', 'green', 'blue'];
const NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const ACTIONS = ['skip', 'reverse', 'draw2'];

let cardSeq = 0;
function mkCard(color, kind, value) {
  return { id: 'c' + (cardSeq++), color, kind, value };
}

function buildDeck() {
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

function newGame(numPlayers, opts) {
  // opts: { rand, extreme } — a bare function is treated as rand (legacy calls)
  if (typeof opts === 'function') opts = { rand: opts };
  opts = opts || {};
  if (numPlayers < 2 || numPlayers > 8) throw new Error('pemain harus 2-8');
  const deck = shuffle(buildDeck(), opts.rand);
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
    pendingKind: null,    // 'draw2' | 'wild4' — which kind started the pending pile
    extreme: !!opts.extreme, // extreme mode: +4 cannot be stacked (deadly)
    drawnCard: null,      // card drawn this turn (may be played or passed)
    drewThisTurn: false,
    over: null,
    round: 1,
  };
  return st;
}

function topCard(st) { return st.discard[st.discard.length - 1]; }

// While a draw pile is pending, only a same-kind draw card may answer it
// (strict stacking, any color). Extreme mode: a pending +4 has no answer.
function isStackCard(st, card) {
  if (!st.pendingKind || card.kind !== st.pendingKind) return false;
  if (st.extreme && st.pendingKind === 'wild4') return false;
  return true;
}

function canPlay(st, playerIdx, card) {
  if (st.over || st.turn !== playerIdx || st.drewThisTurn) return false;
  if (st.pendingDraw > 0) return isStackCard(st, card);
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
  if (c.kind === 'wild' || c.kind === 'wild4') return 50;
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
    // facing a draw pile: the only legal answer is a same-kind stack card
    if (st.extreme && st.pendingKind === 'wild4') {
      return { ok: false, error: 'mode ekstrim: +4 tidak bisa ditumpuk' };
    }
    if (card.kind !== st.pendingKind) {
      return { ok: false, error: 'hanya kartu sejenis yang bisa menumpuk' };
    }
  } else if (!canPlay(st, playerIdx, card)) {
    return { ok: false, error: 'kartu tidak cocok' };
  }
  if ((card.kind === 'wild' || card.kind === 'wild4') && !COLORS.includes(opts.wildColor)) {
    return { ok: false, error: 'pilih warna dulu' };
  }

  hand.splice(hi, 1);
  st.discard.push(card);
  st.currentColor = (card.kind === 'wild' || card.kind === 'wild4') ? opts.wildColor : card.color;
  const events = [{ type: 'play', player: playerIdx, kind: card.kind }];

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
  } else if (card.kind === 'draw2' || card.kind === 'wild4') {
    // start a new pile or stack onto the pending one (strict: same kind only)
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
    extreme: st.extreme,
    drewThisTurn: st.turn === playerIdx ? st.drewThisTurn : false,
    deckCount: st.deck.length,
    over: st.over,
    round: st.round,
    numPlayers: st.hands.length,
  };
}

module.exports = {
  COLORS, buildDeck, shuffle, newGame, canPlay, isStackCard, playCard, drawCard,
  passTurn, playDrawnCard, scoreRound, cardPoints, toClient, topCard,
};
