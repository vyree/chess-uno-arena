'use strict';
/**
 * UNO engine: 133-card rules, 5 colors (simplified per PRD).
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
 * Misi 10 (Sensei 2026-10-23, built 2026-10-26):
 * - unlimited toggle (all modes): emptying your hand FINISHES you
 *   (rank + score) instead of ending the game; the last player left
 *   is the loser (0). Finish score = opponents' remaining cards +
 *   rank bonus (1st +350, 2nd +300, -50 per rank).
 * - Reset (hell x2, max 2 uses/game; REVISED 2026-10-26 late night,
 *   Sensei: trigger moved from pile-answer to UNO! window): played
 *   ONLY inside a UNO! window (like Negate!, first response wins, holder
 *   needs 2+ cards). Effect: collects every hand + the discard pile back
 *   into the deck, reshuffles, redeals 7 to each active player, flips a
 *   new starter, and the caster moves first. Any pending pile is cleared
 *   with the reshuffle (the pile's cards no longer exist as hands).
 * - Negate! (hell x2, max 2 uses/game, holder needs 2+ cards): played
 *   only during the 5-second window after someone shouts UNO! (hand
 *   reaches 1). It voids the UNO: every other active player gives 1
 *   card to the victim (10-second parallel gift phase; timeout picks
 *   each giver's lowest card), then the victim draws +2.
 * Clock policy (engine is a pure state machine; the server owns the
 * clock): the engine RECORDS negateWindow/giftPhase but never blocks
 * play/draw/pass on them — the server pauses turns and runs the 5s/10s
 * timers, and bots act through the same engine functions.
 */

const COLORS = ['red', 'yellow', 'green', 'blue', 'purple'];
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
    // more often (+2 x4 per color = 20 total, wild4 x8), plus the two
    // hell specials, 4 copies each. Misi 10 adds Reset x2 + Negate! x2.
    // Total: 159 cards.
    for (const color of COLORS) {
      deck.push(mkCard(color, 'draw2', null));
      deck.push(mkCard(color, 'draw2', null));
    }
    for (let i = 0; i < 4; i++) deck.push(mkCard(null, 'wild4', null));
    for (let i = 0; i < 4; i++) {
      deck.push(mkCard(null, 'reverseBlack', null));
      deck.push(mkCard(null, 'nullWhite', null));
    }
    for (let i = 0; i < 2; i++) {
      deck.push(mkCard(null, 'reset', null));
      deck.push(mkCard(null, 'negate', null));
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
  // opts: { rand, mode, unlimited } — a bare function is treated as rand
  // (legacy calls); the Misi 2 boolean `extreme` maps to 'hard' (legacy).
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
    unlimited: !!opts.unlimited, // Misi 10: finish instead of win
    finished: [],         // Misi 10 unlimited: [{ player, rank, score }]
    scores: new Array(numPlayers).fill(0), // Misi 10 unlimited: final scores
    resetUses: 0,         // Misi 10: Reset capped at 2 per game
    negateUses: 0,        // Misi 10: Negate! capped at 2 per game
    negateWindow: null,   // Misi 10: { victim } while a UNO! window is open
    negateSeq: 0,         // Misi 10: window counter (client dismiss tracking)
    giftPhase: null,      // Misi 10: { victim, caster, pending, given }
    drawnCard: null,      // card drawn this turn (may be played or passed)
    drewThisTurn: false,
    over: null,
    round: 1,
    // Playing time + turn marker (2026-10-27, Sensei): turnCount counts
    // COMPLETED turns only. A play, a pass after drawing, a penalty
    // draw, and a timeout-advanced turn each count as 1. A skip or
    // reverse counts as 1 for the caster only — the skipped player
    // gets no turn and adds nothing. Negate!/Reset!/gift actions are
    // window interventions, not turns, and never count. Failed plays
    // never count. Playing time itself is server-owned (room.uno
    // startedAt/endedAt in server.js); the engine only owns the count.
    turnCount: 0,
  };
  return st;
}

function isFinished(st, idx) {
  return st.finished.some((f) => f.player === idx);
}

function activeSeats(st) {
  const out = [];
  for (let i = 0; i < st.hands.length; i++) if (!isFinished(st, i)) out.push(i);
  return out;
}

function topCard(st) { return st.discard[st.discard.length - 1]; }

// Pile answers by mode (Misi 5):
// - normal: a +2 pile answers only with +2; a +4 pile has NO answer.
// - hard/hell: a +2 pile answers with +2 or +4 (escalation); a +4 pile
//   answers only with +4.
// The hell specials (Reverse Black / Null White) answer ANY pending pile.
// Reset is NOT a pile answer anymore (revised 2026-10-26: it answers a
// UNO! window via playReset, like Negate! via playNegate).
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
  // hell specials are dead cards outside a pending pile; Negate! is
  // never played via canPlay — it only fires inside a UNO! window
  // (playNegate), so it is dead here in every situation.
  if (card.kind === 'reverseBlack' || card.kind === 'nullWhite'
    || card.kind === 'reset' || card.kind === 'negate') return false;
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
  // Move `skip` ACTIVE seats forward (Misi 10: finished seats are
  // skipped, so a skip card skips the next player still in the game).
  const n = st.hands.length;
  let steps = skip;
  while (steps-- > 0) {
    let guard = 0;
    do {
      st.turn = (((st.turn + st.dir) % n) + n) % n;
    } while (isFinished(st, st.turn) && ++guard <= n);
  }
}

function cardPoints(c) {
  if (c.kind === 'number') return c.value;
  if (c.kind === 'wild' || c.kind === 'wild4' || c.kind === 'reverseBlack' || c.kind === 'nullWhite'
    || c.kind === 'reset' || c.kind === 'negate') return 50;
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
  if (card.kind === 'negate') {
    // Negate! never goes through a normal play — it only fires inside
    // a UNO! window (playNegate). This keeps its trigger unambiguous.
    return { ok: false, error: 'negate hanya bisa dipakai saat ada yang teriak Uno!' };
  }
  if (card.kind === 'reset') {
    // Reset never goes through a normal play either (revised 2026-10-26):
    // it only fires inside a UNO! window (playReset).
    return { ok: false, error: 'reset hanya bisa dipakai saat ada yang teriak Uno!' };
  }
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

  // (Reset no longer resolves here: since 2026-10-26 it answers a UNO!
  // window via playReset, like Negate! via playNegate.)

  // UNO penalty: forgot to declare with 1 card left
  let penalty = 0;
  if (hand.length === 1 && !opts.saidUno) {
    penalty = 2;
    replenish(st);
    for (let i = 0; i < 2 && st.deck.length; i++) hand.push(st.deck.pop());
  }
  if (hand.length === 1) {
    events.push({ type: 'uno', player: playerIdx });
    // Misi 10: every UNO! shout opens a response window (Negate! or
    // Reset — first response wins; the server pauses turns and runs
    // the 5-second clock; see the header note).
    st.negateWindow = { victim: playerIdx };
    st.negateSeq++;
  }

  // win?
  let finishedInfo = null;
  if (hand.length === 0) {
    if (st.unlimited) {
      // Misi 10: finishing does NOT end the game — the finisher banks
      // opponents' remaining cards + a rank bonus, then leaves the
      // rotation. The last player left is the loser (score 0).
      const rank = st.finished.length + 1;
      let pts = 0;
      st.hands.forEach((h, i) => {
        if (i !== playerIdx && !isFinished(st, i)) for (const c of h) pts += cardPoints(c);
      });
      pts += Math.max(0, 350 - (rank - 1) * 50);
      st.scores[playerIdx] = pts;
      st.finished.push({ player: playerIdx, rank, score: pts });
      finishedInfo = { player: playerIdx, rank, score: pts };
      events.push({ type: 'finish', player: playerIdx, rank, score: pts });
      const left = activeSeats(st);
      if (left.length <= 1) {
        st.over = { winner: st.finished[0].player, loser: left[0] ?? -1, reason: 'unlimited' };
        st.turnCount++;
        return { ok: true, finished: finishedInfo, gameOver: true, penalty, events };
      }
      // game continues: the finishing card's effects still apply, then
      // the turn moves on (advanceTurn skips finished seats below).
    } else {
      st.over = { winner: playerIdx, reason: 'habis' };
      st.turnCount++;
      return { ok: true, won: true, penalty, events };
    }
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
  // The caster's turn counts as exactly 1, whatever the card did:
  // skip advances 2 seats but the skipped seat gets no turn, reverse
  // flips direction but is still the caster's single turn.
  st.turnCount++;
  return { ok: true, penalty, events, finished: finishedInfo };
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
    // The victim's turn is consumed by the penalty draw, so it counts
    // as 1 completed turn even though no card was played.
    st.turnCount++;
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
  if (card.kind === 'reverseBlack' || card.kind === 'nullWhite'
    || card.kind === 'reset' || card.kind === 'negate') return false; // pile/window-only specials
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
  // Draw-then-pass completes here (the draw alone is mid-turn, so it
  // must not count); playing the drawn card counts via playCard.
  st.turnCount++;
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

// ---------- Misi 10: Negate! window + gift phase ----------
// Play a Negate! card during an open UNO! window. The holder must hold
// 2+ cards (Negate can never be your last card) and the game must have
// Negate uses left. Opens the parallel gift phase: every other ACTIVE
// player owes the victim 1 card (the victim never gives).
function playNegate(st, playerIdx, cardId) {
  if (st.over) return { ok: false, error: 'ronde sudah selesai' };
  if (!st.negateWindow) return { ok: false, error: 'tidak ada jendela negate' };
  if (st.negateUses >= 2) return { ok: false, error: 'jatah negate habis' };
  const hand = st.hands[playerIdx];
  const hi = hand.findIndex((c) => c.id === cardId);
  if (hi < 0) return { ok: false, error: 'kartu tidak ada di tanganmu' };
  const card = hand[hi];
  if (card.kind !== 'negate') return { ok: false, error: 'bukan kartu negate' };
  if (hand.length < 2) return { ok: false, error: 'negate butuh minimal 2 kartu di tangan' };
  hand.splice(hi, 1);
  st.discard.push(card);
  st.negateUses++;
  const victim = st.negateWindow.victim;
  st.negateWindow = null;
  st.giftPhase = {
    victim,
    caster: playerIdx,
    pending: activeSeats(st).filter((s) => s !== victim),
    given: [],
  };
  return { ok: true, events: [{ type: 'negate', player: playerIdx, victim }] };
}

// Play Reset inside an open UNO! window (revised 2026-10-26: Reset is a
// window card, NOT a pile answer). Mirrors playNegate's guards, then
// reshuffles the whole table: every hand + the discard pile back into
// the deck, 7 fresh cards to each still-in seat, a new number starter,
// and the caster moves first. Any pending pile dies with the reshuffle.
// Resolves immediately (no gift phase); the window closes on the first
// response, so a Reset after a Negate (or vice versa) is rejected.
function playReset(st, playerIdx, cardId) {
  if (st.over) return { ok: false, error: 'ronde sudah selesai' };
  if (!st.negateWindow) return { ok: false, error: 'tidak ada jendela Uno!' };
  if (st.resetUses >= 2) return { ok: false, error: 'jatah reset habis' };
  const hand = st.hands[playerIdx];
  const hi = hand.findIndex((c) => c.id === cardId);
  if (hi < 0) return { ok: false, error: 'kartu tidak ada di tanganmu' };
  const card = hand[hi];
  if (card.kind !== 'reset') return { ok: false, error: 'bukan kartu reset' };
  if (hand.length < 2) return { ok: false, error: 'reset butuh minimal 2 kartu di tangan' };
  hand.splice(hi, 1);
  st.discard.push(card);
  st.resetUses++;
  st.pendingDraw = 0;
  st.pendingKind = null;
  st.negateWindow = null;
  const held = st.hands.map((h) => h.length);
  const pool = [...st.deck, ...st.discard];
  for (const h of st.hands) pool.push(...h.splice(0, h.length));
  st.deck = shuffle(pool);
  st.discard = [];
  for (let p = 0; p < st.hands.length; p++) {
    // only seats still in the game redraw: finished seats
    // (unlimited) and emptied inactive seats stay out.
    if (p !== playerIdx && held[p] === 0) continue;
    for (let i = 0; i < 7 && st.deck.length; i++) st.hands[p].push(st.deck.pop());
  }
  let starter;
  for (;;) {
    const c = st.deck.pop();
    if (c.kind === 'number') { starter = c; break; }
    st.deck.unshift(c);
  }
  st.discard = [starter];
  st.currentColor = starter.color;
  st.turn = playerIdx;
  st.drewThisTurn = false;
  st.drawnCard = null;
  return { ok: true, events: [{ type: 'reset', player: playerIdx }] };
}

// Give 1 card to the victim during an open gift phase. When the last
// pending giver submits, the phase resolves at once: the victim gains
// the gifted cards, then draws +2, and the game unpauses.
function giveCard(st, playerIdx, cardId) {
  if (st.over) return { ok: false, error: 'ronde sudah selesai' };
  const gp = st.giftPhase;
  if (!gp) return { ok: false, error: 'tidak ada fase hadiah negate' };
  if (!gp.pending.includes(playerIdx)) return { ok: false, error: 'kamu tidak perlu memberi kartu' };
  const hand = st.hands[playerIdx];
  const hi = hand.findIndex((c) => c.id === cardId);
  if (hi < 0) return { ok: false, error: 'kartu tidak ada di tanganmu' };
  const card = hand.splice(hi, 1)[0];
  gp.given.push({ from: playerIdx, card });
  gp.pending = gp.pending.filter((s) => s !== playerIdx);
  const events = [{ type: 'gifted', player: playerIdx, victim: gp.victim }];
  if (gp.pending.length === 0) events.push(...resolveGift(st));
  return { ok: true, events };
}

// Move gifted cards to the victim, then the victim draws +2. Shared by
// giveCard (last giver) and resolveGiftTimeout (clock expiry).
function resolveGift(st) {
  const gp = st.giftPhase;
  if (!gp) return [];
  for (const g of gp.given) st.hands[gp.victim].push(g.card);
  const n = gp.given.length;
  st.giftPhase = null;
  replenish(st);
  for (let i = 0; i < 2 && st.deck.length; i++) st.hands[gp.victim].push(st.deck.pop());
  return [{ type: 'negateResolved', player: gp.caster, victim: gp.victim, given: n, drawn: 2 }];
}

// Gift-phase clock expiry: every pending giver auto-gives their lowest
// card (ties: first in hand), then the phase resolves as usual.
function resolveGiftTimeout(st) {
  const gp = st.giftPhase;
  if (!gp) return { ok: false, events: [] };
  for (const seat of [...gp.pending]) {
    const hand = st.hands[seat];
    if (!hand.length) continue;
    let low = hand[0];
    for (const c of hand) if (cardPoints(c) < cardPoints(low)) low = c;
    gp.given.push({ from: seat, card: low });
    st.hands[seat] = hand.filter((c) => c.id !== low.id);
  }
  gp.pending = [];
  return { ok: true, events: resolveGift(st) };
}

// UNO! window clock expiry: nobody negated — the game simply continues.
function closeNegateWindow(st) {
  if (!st.negateWindow) return false;
  st.negateWindow = null;
  return true;
}

// Cancel an open gift phase (used when the phase can no longer complete,
// e.g. the victim leaves): gifted cards return to their owners.
function cancelGiftPhase(st) {
  const gp = st.giftPhase;
  if (!gp) return;
  for (const g of gp.given) st.hands[g.from].push(g.card);
  st.giftPhase = null;
}

// Score a finished round into the scores array. Returns points gained by winner.
// Unlimited games already banked their scores at finish time (st.scores),
// so this just distributes those instead of winner-takes-all.
function scoreRound(st, scores) {
  if (!st.over) return 0;
  if (st.unlimited) {
    st.scores.forEach((s, i) => { scores[i] += s; });
    return st.finished.length ? st.scores[st.finished[0].player] : 0;
  }
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
    // Turn marker (2026-10-27): turnCount = completed turns; the turn
    // currently in progress is turnCount + 1 (at game over it is just
    // turnCount, since no turn is in progress anymore).
    turnCount: st.turnCount || 0,
    turnNumber: st.over ? (st.turnCount || 0) : (st.turnCount || 0) + 1,
    numPlayers: st.hands.length,
    // Misi 10 (client reads only its own eligibility — never others'):
    unlimited: !!st.unlimited,
    finished: st.finished || [],
    scores: st.scores || [],
    negateWindow: st.negateWindow ? { victim: st.negateWindow.victim } : null,
    negateSeq: st.negateSeq || 0,
    canNegate: !!st.negateWindow && st.negateUses < 2 && hand.length >= 2
      && hand.some((c) => c.kind === 'negate'),
    canReset: !!st.negateWindow && st.resetUses < 2 && hand.length >= 2
      && hand.some((c) => c.kind === 'reset'),
    giftPhase: st.giftPhase ? {
      victim: st.giftPhase.victim,
      caster: st.giftPhase.caster,
      pending: [...st.giftPhase.pending],
      amPending: st.giftPhase.pending.includes(playerIdx),
    } : null,
  };
}

module.exports = {
  COLORS, MODES, buildDeck, shuffle, newGame, canPlay, isStackCard, playCard, drawCard,
  passTurn, playDrawnCard, scoreRound, cardPoints, toClient, topCard,
  playNegate, playReset, giveCard, resolveGiftTimeout, closeNegateWindow, cancelGiftPhase,
  isFinished, activeSeats,
};
