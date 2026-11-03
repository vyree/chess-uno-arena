'use strict';
/**
 * Ludo Jahat engine — pure server-side state, no DOM.
 * Board model: progress per token:
 *   -1 = base, 0..50 = main track steps from own start,
 *   51..56 = home column, 57 = home (finished).
 * Absolute main-track square = (startOffset + progress) % 52.
 * Locked rules live in docs/ludo-skill-rules.md; assumptions for
 * unlocked points live in TASK_INSTRUCTION.md (Ludo Jahat Fase 1).
 * Hidden rule (never sent to clients in text): the 6-cap below.
 */
// Clockwise seat order matching the design image: red top-left,
// green top-right, yellow bottom-right, blue bottom-left.
const PLAYER_COLORS = ['red', 'green', 'yellow', 'blue'];
const START_OFFSETS = [0, 13, 26, 39];
const SAFE_SQUARES = [0, 8, 13, 21, 26, 34, 39, 47];
const SKILL_BLOCKS = [5, 18, 31, 44];
const MAX_HAND = 3;
const MAX_SIXES_PER_TURN = 3;

const CARD_DEFS = {
  sniper: { group: 'attack', name: 'Sniper', desc: 'Tembak 1 bidak musuh di jalur utama sampai pulang ke base. Dipakai langsung saat didapat; tidak bisa menyerang bidak di petak aman, base, jalur home, atau rumah.' },
  ranjau: { group: 'attack', name: 'Ranjau', desc: 'Tanam ranjau di 1 petak jalur utama (kecuali petak aman). Meledak saat diinjak bidak siapapun, termasuk bidakmu sendiri — bidak yang menginjak hancur dan pulang ke base. Ranjau hangus setelah 1 ledakan.' },
  seret: { group: 'attack', name: 'Rantai Seret', desc: 'Tarik 1 bidak musuh mundur 10 petak di jalur utama. Dipakai langsung saat didapat.' },
  beku: { group: 'attack', name: 'Es Beku', desc: 'Bekukan 1 bidak musuh selama 2 giliran: bidak itu tidak bisa digerakkan. Dipakai langsung saat didapat.' },
  perisai: { group: 'defense', name: 'Perisai Baja', desc: 'Batalkan 1 serangan terhadap 1 bidakmu. Dipakai hanya saat bidakmu diserang; habis sekali pakai.' },
  antistep: { group: 'defense', name: 'Anti-Step', desc: 'Cegah 1x injakan: bidakmu tidak pulang ke base saat diinjak bidak lain. Kedua bidak menumpuk di petak itu. Habis sekali pakai.' },
  teleport: { group: 'defense', name: 'Teleport', desc: 'Saat diserang (semua jenis serangan termasuk injak), teleport bidakmu maks 3 petak ke depan atau ke belakang. Pendaratan teleport tidak menginjak bidak lain.' },
  escape: { group: 'defense', name: 'Escape', desc: 'Saat diserang, mundurkan bidakmu maks 3 petak (kamu pilih). Jika mendarat di bidak musuh, injak tetap berlaku.' },
  x2: { group: 'neutral', name: 'Langkah x2', desc: 'Langkah = 2 x dadu. Hanya mengubah langkah; tidak bisa dipakai untuk keluar base atau kocok lagi. Dipakai setelah kocok, sebelum jalan, maks 1 per kocokan.' },
  plus1: { group: 'neutral', name: '+1 Langkah', desc: 'Tambah 1 langkah. Hanya menambah langkah; tidak bisa dipakai untuk keluar base atau kocok lagi.' },
  plus2: { group: 'neutral', name: '+2 Langkah', desc: 'Tambah 2 langkah. Hanya menambah langkah; tidak bisa dipakai untuk keluar base atau kocok lagi.' },
  plus3: { group: 'neutral', name: '+3 Langkah', desc: 'Tambah 3 langkah. Hanya menambah langkah; tidak bisa dipakai untuk keluar base atau kocok lagi.' },
  bebas: { group: 'neutral', name: 'Bebas Pilih Langkah', desc: 'Pilih jumlah langkah 1-6. Ini langkah, bukan angka dadu: pilih 6 langkah pun tidak keluar base dan tidak kocok lagi. Injak tetap bisa terpicu. Hanya untuk diri sendiri.' },
};
const CARD_KINDS = Object.keys(CARD_DEFS);

function shuffle(arr, rand) {
  const r = rand || Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck(rand) {
  const deck = [];
  let n = 0;
  // Deck composition (Sensei 2026-11-03): attack 4x4=16, defense 4x4=16,
  // neutral 32 (x2/+1/+2/+3 @6 each, bebas @8). Total 64.
  const NEUTRAL_COUNTS = { x2: 6, plus1: 6, plus2: 6, plus3: 6, bebas: 8 };
  for (const kind of CARD_KINDS) {
    const count = CARD_DEFS[kind].group === 'neutral' ? (NEUTRAL_COUNTS[kind] || 4) : 4;
    for (let c = 0; c < count; c++) deck.push({ id: `c${n++}`, kind, group: CARD_DEFS[kind].group });
  }
  return shuffle(deck, rand);
}

function newGame(rand) {
  return {
    players: [0, 1, 2, 3].map((p) => ({
      color: PLAYER_COLORS[p],
      tokens: [0, 1, 2, 3].map(() => ({ progress: -1 })),
      hand: [],
    })),
    turn: 0,
    phase: 'roll',
    dice: null,
    lastRoll: null, // last dice value, preserved across endTurn so the
    steps: null,    // client can animate no-move rolls (Sensei 2026-11-03)
    playerRolls: [null, null, null, null], // last roll per player, for yard dice (Sensei 2026-11-03)
    neutralUsed: false,
    boosterDecisionPending: false, // strict gate: must answer "mau booster?" before moving (Sensei 2026-11-03)
    log: [], // persistent action log: {text, cardKind, t} (Sensei 2026-11-03)
    pendingCaptureChoice: null, // {victims:[{player,token}], moveResult} when 2+ victims (Sensei 2026-11-03)
    pendingDrawCeremony: null, // {stage:'prompt'|'reveal', card, moveResult, abs} (Sensei 2026-11-03)
    drawBurned: null, // {kind, name} one-shot burn notice (Sensei 2026-11-03)
    sixCount: 0,
    pendingAttack: null,
    pendingDefense: null,
    pendingDraw: null,
    pendingPlant: null, // {player} while choosing a block for Ranjau (Sensei 2026-11-03)
    pendingTeleport: null, // {defender, token} while choosing teleport destination (Sensei 2026-11-03)
    pendingEscape: null, // {defender, token} while choosing escape destination (Sensei 2026-11-03)
    pendingStomp: null, // {attacker, victims:[{player,token}]} for stomp defense (Sensei 2026-11-03)
    pendingMineBlast: null, // {mineId, victim:{player,token}} when a mine explodes (Sensei 2026-11-03)
    mines: [], // planted Ranjau: [{id, abs, owner}] (Sensei 2026-11-03)
    animEvents: [], // one-shot client animation events: [{id, type, ...}] (Sensei 2026-11-03)
    blockCooldown: {},
    frozen: [],
    winner: null,
    over: false,
    deck: buildDeck(rand),
    lastEvent: null,
  };
}

function absOf(player, progress) {
  if (progress < 0 || progress > 50) return null;
  return (START_OFFSETS[player] + progress) % 52;
}
function isSafeAbs(abs) { return abs !== null && SAFE_SQUARES.includes(abs); }
function isFrozen(st, player, token) {
  return st.frozen.some((f) => f.player === player && f.token === token);
}
function clearFrozenForTurn(st, player) {
  // Frozen pawns thaw after missing 2 of their owner's turns
  // (Sensei 2026-11-03; was: thawed after 1 turn).
  st.frozen = st.frozen
    .map((f) => (f.player === player ? { ...f, turns: (f.turns ?? 1) - 1 } : f))
    .filter((f) => (f.turns ?? 1) > 0);
}
function clearFrozenToken(st, player, token) {
  st.frozen = st.frozen.filter((f) => !(f.player === player && f.token === token));
}
function tokensAtAbs(st, abs) {
  const out = [];
  st.players.forEach((pl, pi) => pl.tokens.forEach((t, ti) => {
    if (absOf(pi, t.progress) === abs) out.push({ player: pi, token: ti, progress: t.progress });
  }));
  return out;
}
function homeCount(st, player) {
  return st.players[player].tokens.filter((t) => t.progress === 57).length;
}
function nextPlayer(st) { return (st.turn + 1) % 4; }

function rollDice(st, rand) {
  const r = rand || Math.random;
  if (st.sixCount >= MAX_SIXES_PER_TURN) return Math.floor(r() * 5) + 1;
  return Math.floor(r() * 6) + 1;
}

// Legal moves for a rolled step count. originalDice decides base exit.
function legalMoves(st, player, steps, originalDice) {
  const moves = [];
  const pl = st.players[player];
  pl.tokens.forEach((t, ti) => {
    if (isFrozen(st, player, ti)) return;
    if (t.progress === 57) return;
    if (t.progress === -1) {
      if (originalDice === 6) moves.push({ token: ti, from: -1, to: 0, kind: 'exit' });
      return;
    }
    const to = t.progress + steps;
    if (to > 57) return;
    const kind = to === 57 ? 'home' : 'move';
    moves.push({ token: ti, from: t.progress, to, kind });
  });
  return moves;
}

function applyMove(st, player, tokenIdx, steps, originalDice) {
  const moves = legalMoves(st, player, steps, originalDice);
  const mv = moves.find((m) => m.token === tokenIdx);
  if (!mv) return { ok: false, error: 'langkah tidak valid' };
  const tok = st.players[player].tokens[tokenIdx];
  const wasProgress = tok.progress;
  tok.progress = mv.to;
  const result = { ok: true, move: mv, captured: [], landedSkill: false, enteredHome: mv.kind === 'home' };
  if (mv.kind === 'move' && mv.to <= 50) {
    const abs = absOf(player, mv.to);
    // Ranjau check FIRST: mine explodes when stepped on (Sensei 2026-11-03).
    // Stomp is deferred until the blast resolves.
    const mine = mineAt(st, abs);
    if (mine) {
      result.mineBlast = { mineId: mine.id, mineOwner: mine.owner, victim: { player, token: tokenIdx }, abs };
      return result;
    }
    if (!isSafeAbs(abs)) {
      const victims = tokensAtAbs(st, abs).filter((v) => v.player !== player);
      if (victims.length > 0) {
        // Stomp now requires defense (Sensei 2026-11-03): victims get
        // a chance to use Perisai / Teleport / Escape / Anti-Step.
        // The mover is placed; victims stay until defense resolves.
        result.needsStompDefense = true;
        result.victims = victims;
        result.stompAbs = abs;
        return result;
      }
    }
    if (SKILL_BLOCKS.includes(abs)) result.landedSkill = true;
  }
  if (wasProgress === -1 && mv.kind === 'exit') result.exited = true;
  return result;
}

// Check if an attack card has any valid target right now (Sensei 2026-11-03).
// Used by the draw ceremony to decide use-vs-burn.
function isAttackUsable(st, attacker, card) {
  if (card.kind === 'ranjau') {
    return validRanjauBlocks(st).length > 0;
  }
  if (card.kind === 'sniper') {
    const onTrack = st.players[attacker].tokens.some((x) => x.progress >= 0 && x.progress <= 50);
    if (!onTrack) return false;
  }
  return attackTargets(st, attacker, card.kind).length > 0;
}
// Resolve a deferred multi-victim capture choice (Sensei 2026-11-03).
// Captures ONLY the chosen victim; others stay on the square.
function resolveCaptureChoice(st, player, targetPlayer, targetToken) {
  const pending = st.pendingCaptureChoice;
  if (!pending) return { ok: false, error: 'tidak ada pilihan makan yang menunggu' };
  if (st.turn !== player) return { ok: false, error: 'bukan giliranmu' };
  const victim = pending.victims.find((v) => v.player === targetPlayer && v.token === targetToken);
  if (!victim) return { ok: false, error: 'target tidak valid' };
  st.players[targetPlayer].tokens[targetToken].progress = -1;
  clearFrozenToken(st, targetPlayer, targetToken);
  const moveResult = pending.moveResult;
  moveResult.captured = [{ player: targetPlayer, token: targetToken }];
  st.pendingCaptureChoice = null;
  return { ok: true, moveResult };
}
function drawCard(st) {
  if (!st.deck.length) return null;
  return st.deck.shift();
}
function returnHangus(st, card) {
  if (!card) return;
  st.deck.push(card);
  shuffle(st.deck, Math.random);
}
function checkWinner(st) {
  for (let p = 0; p < 4; p++) {
    if (homeCount(st, p) === 4) { st.winner = p; st.over = true; st.phase = 'over'; return p; }
  }
  return null;
}
function endTurn(st) {
  clearFrozenForTurn(st, st.turn);
  st.turn = nextPlayer(st);
  st.phase = 'roll';
  st.dice = null;
  st.steps = null;
  st.neutralUsed = false;
  st.boosterDecisionPending = false;
  st.sixCount = 0;
  st.pendingAttack = null;
  st.pendingDefense = null;
  st.pendingDraw = null;
  st.pendingCaptureChoice = null;
  st.pendingDrawCeremony = null;
}
// Advance after a completed move: extra roll on 6/capture/home,
// otherwise the turn should end. The CALLER drives the end-of-turn
// ceremony (ludoTurnTransition); the engine no longer ends the turn
// itself, so the 'end' -> 'standby' -> 'roll' beats stay visible.
function afterMoveFlow(st, moveResult) {
  if (checkWinner(st) !== null) return { extra: false, over: true };
  const extra = st.dice === 6 || moveResult.captured.length > 0 || moveResult.enteredHome;
  if (extra) {
    st.phase = 'roll';
    st.dice = null;
    st.steps = null;
    st.neutralUsed = false;
    st.boosterDecisionPending = false;
    st.pendingCaptureChoice = null;
    st.pendingDrawCeremony = null;
    st.pendingAttack = null;
    st.pendingDefense = null;
    st.pendingDraw = null;
    return { extra: true, over: false };
  }
  return { endTurn: true, extra: false, over: false };
}
function startBlockCooldown(st, abs) {
  st.blockCooldown[abs] = 4; // sleeps while all 4 seats take a turn
}
function tickBlockCooldown(st) {
  for (const k of Object.keys(st.blockCooldown)) {
    st.blockCooldown[k] -= 1;
    if (st.blockCooldown[k] <= 0) delete st.blockCooldown[k];
  }
}
function onTurnStart(st) { tickBlockCooldown(st); }

// Neutral step modifiers: returns {steps} or {error}. Original dice
// is never rewritten, so base exit / extra roll still read it.
function neutralSteps(kind, dice, choice) {
  if (kind === 'x2') return { steps: dice * 2 };
  if (kind === 'plus1') return { steps: dice + 1 };
  if (kind === 'plus2') return { steps: dice + 2 };
  if (kind === 'plus3') return { steps: dice + 3 };
  if (kind === 'bebas') {
    if (!Number.isInteger(choice) || choice < 1 || choice > 6) {
      return { error: 'bebas pilih harus 1-6' };
    }
    return { steps: choice };
  }
  return { error: 'kartu netral tidak dikenal' };
}
function useNeutral(st, player, cardId, choice) {
  if (st.phase !== 'move' || st.turn !== player) return { ok: false, error: 'bukan waktunya pakai kartu netral' };
  if (st.neutralUsed) return { ok: false, error: 'sudah pakai 1 kartu netral di kocokan ini' };
  const hand = st.players[player].hand;
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx < 0) return { ok: false, error: 'kartu tidak ada di tangan' };
  const card = hand[idx];
  if (card.group !== 'neutral') return { ok: false, error: 'hanya kartu netral ungu yang bisa dipakai di sini' };
  const r = neutralSteps(card.kind, st.dice, choice);
  if (r.error) return { ok: false, error: r.error };
  hand.splice(idx, 1);
  st.steps = r.steps;
  st.neutralUsed = true;
  return { ok: true, card, steps: r.steps };
}

// Attack targeting: only main-track tokens, never safe/base/home/home-column.
function attackTargets(st, attacker, kind) {
  const targets = [];
  st.players.forEach((pl, pi) => pl.tokens.forEach((t, ti) => {
    if (t.progress < 0 || t.progress > 50) return;
    if (kind === 'sniper' || kind === 'seret' || kind === 'beku') {
      if (pi === attacker) return;
    }
    const abs = absOf(pi, t.progress);
    if (isSafeAbs(abs)) return;
    targets.push({ player: pi, token: ti, progress: t.progress, abs });
  }));
  return targets;
}
function mineAt(st, abs) {
  return st.mines.find((m) => m.abs === abs) || null;
}
// Valid blocks for planting Ranjau: main track, non-safe, no existing mine (Sensei 2026-11-03).
function validRanjauBlocks(st) {
  const blocks = [];
  for (let abs = 0; abs < 52; abs++) {
    if (isSafeAbs(abs)) continue;
    if (st.mines.some((m) => m.abs === abs)) continue;
    blocks.push(abs);
  }
  return blocks;
}
function applyAttackEffect(st, attack) {
  const { kind, attacker, targetPlayer, targetToken, targetAbs } = attack;
  if (kind === 'sniper') {
    st.players[targetPlayer].tokens[targetToken].progress = -1;
    clearFrozenToken(st, targetPlayer, targetToken);
    return { killed: [{ player: targetPlayer, token: targetToken }] };
  }
  // 'ranjau' is planted, not instant — no applyAttackEffect branch.
  // Mine blast is resolved via pendingMineBlast + defense.
  if (kind === 'seret') {
    const tok = st.players[targetPlayer].tokens[targetToken];
    const fromProgress = tok.progress;
    const fromAbs = absOf(targetPlayer, fromProgress);
    tok.progress = Math.max(0, tok.progress - 10);
    const toAbs = absOf(targetPlayer, tok.progress);
    // Chain animation: from destination back to origin, then pull (Sensei 2026-11-03).
    if (fromAbs !== null && toAbs !== null) {
      pushAnimEvent(st, 'chain', { player: targetPlayer, token: targetToken, fromAbs, toAbs });
    }
    return { moved: [{ player: targetPlayer, token: targetToken, progress: tok.progress }] };
  }
  if (kind === 'beku') {
    if (!isFrozen(st, targetPlayer, targetToken)) {
      st.frozen.push({ player: targetPlayer, token: targetToken, turns: 2 });
    }
    return { frozen: [{ player: targetPlayer, token: targetToken }] };
  }
  return {};
}
// Defense resolution (Sensei 2026-11-03). Returns {defended, ...}.
// The attack card itself is always consumed (terpakai) once resolved,
// even if the defense cancels it — the defender's card is also consumed.
// Teleport/Escape need a destination choice: they return
// {needsDest: 'teleport'|'escape'} and the card is consumed when the
// destination is confirmed (doTeleportDest / doEscapeDest).
// Validity matrix:
//   perisai: all attacks. teleport: all attacks incl. stomp & ranjau.
//   escape: killing attacks only (sniper, ranjau, stomp).
//   antistep: stomp only.
function resolveDefense(st, pending, defenseCardId) {
  const { attack, defender } = pending;
  const hand = st.players[defender].hand;
  const idx = defenseCardId ? hand.findIndex((c) => c.id === defenseCardId) : -1;
  if (defenseCardId && idx < 0) return { ok: false, error: 'kartu defense tidak ada di tangan' };
  const card = idx >= 0 ? hand[idx] : null;
  if (card && card.group !== 'defense') return { ok: false, error: 'hanya kartu defense yang bisa dipakai saat diserang' };
  if (card && card.kind === 'antistep' && attack.kind !== 'stomp') {
    return { ok: false, error: 'Anti-Step hanya berlaku untuk injakan' };
  }
  if (card && card.kind === 'escape' && (attack.kind === 'seret' || attack.kind === 'beku')) {
    return { ok: false, error: 'Escape hanya untuk serangan yang membunuh' };
  }
  // No card: accept the attack.
  if (!card) return { ok: true, defended: false, effect: applyAttackEffect(st, attack) };
  if (card.kind === 'perisai') {
    hand.splice(idx, 1);
    return { ok: true, defended: true, card };
  }
  if (card.kind === 'antistep') {
    // Stomp negated: both pawns stack on the square (Sensei 2026-11-03).
    hand.splice(idx, 1);
    return { ok: true, defended: true, card, antistep: true };
  }
  if (card.kind === 'teleport') {
    return { ok: true, needsDest: 'teleport', cardId: card.id, card };
  }
  if (card.kind === 'escape') {
    return { ok: true, needsDest: 'escape', cardId: card.id, card };
  }
  return { ok: true, defended: false };
}
// Valid teleport destinations: up to 3 forward or backward on the main
// track (Sensei 2026-11-03). Returns [{progress, abs}].
function validTeleportDests(st, player, token) {
  const cur = st.players[player].tokens[token].progress;
  if (cur < 0 || cur > 50) return [];
  const dests = [];
  for (let d = -3; d <= 3; d++) {
    if (d === 0) continue;
    const dest = cur + d;
    if (dest < 0 || dest > 50) continue;
    dests.push({ progress: dest, abs: absOf(player, dest) });
  }
  return dests;
}
// Valid escape destinations: 1-3 backward on the main track (Sensei 2026-11-03).
function validEscapeDests(st, player, token) {
  const cur = st.players[player].tokens[token].progress;
  if (cur < 0 || cur > 50) return [];
  const dests = [];
  for (let d = 1; d <= 3; d++) {
    const dest = cur - d;
    if (dest < 0) break;
    dests.push({ progress: dest, abs: absOf(player, dest) });
  }
  return dests;
}
// Confirm a teleport destination. Consumes the teleport card.
function doTeleportDest(st, player, token, cardId, abs) {
  if (st.phase !== 'teleportDest' || !st.pendingTeleport) return { ok: false, error: 'bukan waktunya teleport' };
  const pt = st.pendingTeleport;
  if (pt.defender !== player || pt.token !== token) return { ok: false, error: 'bukan bidakmu yang teleport' };
  const valid = validTeleportDests(st, player, token);
  if (!valid.some((d) => d.abs === abs)) return { ok: false, error: 'tujuan teleport tidak valid' };
  const hand = st.players[player].hand;
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx < 0 || hand[idx].kind !== 'teleport') return { ok: false, error: 'kartu teleport tidak ada' };
  const [card] = hand.splice(idx, 1);
  const dest = valid.find((d) => d.abs === abs);
  const fromAbs = absOf(player, st.players[player].tokens[token].progress);
  st.players[player].tokens[token].progress = dest.progress;
  clearFrozenToken(st, player, token);
  st.pendingTeleport = null;
  // Teleport landing never stomps (Sensei 2026-11-03).
  return { ok: true, card, fromAbs, toAbs: abs, progress: dest.progress };
}
// Confirm an escape destination. Consumes the escape card.
// If the pawn lands on enemies (non-safe), stomp applies (Sensei 2026-11-03).
function doEscapeDest(st, player, token, cardId, abs) {
  if (st.phase !== 'escapeDest' || !st.pendingEscape) return { ok: false, error: 'bukan waktunya escape' };
  const pe = st.pendingEscape;
  if (pe.defender !== player || pe.token !== token) return { ok: false, error: 'bukan bidakmu yang escape' };
  const valid = validEscapeDests(st, player, token);
  if (!valid.some((d) => d.abs === abs)) return { ok: false, error: 'tujuan escape tidak valid' };
  const hand = st.players[player].hand;
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx < 0 || hand[idx].kind !== 'escape') return { ok: false, error: 'kartu escape tidak ada' };
  const [card] = hand.splice(idx, 1);
  const dest = valid.find((d) => d.abs === abs);
  const fromAbs = absOf(player, st.players[player].tokens[token].progress);
  st.players[player].tokens[token].progress = dest.progress;
  clearFrozenToken(st, player, token);
  st.pendingEscape = null;
  // Escape landing CAN stomp (Sensei 2026-11-03).
  const victims = !isSafeAbs(abs) ? tokensAtAbs(st, abs).filter((v) => v.player !== player) : [];
  return { ok: true, card, fromAbs, toAbs: abs, progress: dest.progress, victims };
}
// Plant a Ranjau on a block. Consumes the ranjau card (Sensei 2026-11-03).
function plantRanjau(st, player, cardId, abs) {
  if (st.phase !== 'plantRanjau' || !st.pendingPlant || st.pendingPlant.player !== player) {
    return { ok: false, error: 'bukan waktunya menanam ranjau' };
  }
  if (!validRanjauBlocks(st).includes(abs)) return { ok: false, error: 'petak tidak valid untuk ranjau' };
  const hand = st.players[player].hand;
  const idx = hand.findIndex((c) => c.id === (cardId || st.pendingPlant.cardId));
  if (idx < 0 || hand[idx].kind !== 'ranjau') return { ok: false, error: 'kartu ranjau tidak ada' };
  const [card] = hand.splice(idx, 1);
  const mine = { id: `m${st.mines.length + 1}`, abs, owner: player };
  st.mines.push(mine);
  st.pendingPlant = null;
  return { ok: true, card, mine };
}

// ---- attack / defense flow (server drives these steps) ----
// Begin an attack card. Returns {ok, needsDefense, attack, defender}
// when a defender must choose, {ok, needsPlant} for Ranjau (planting
// is a separate phase), otherwise applies immediately.
function beginAttack(st, attacker, card, target) {
  const kind = card.kind;
  if (kind === 'ranjau') {
    // Planting happens in the 'plantRanjau' phase; card consumed on plant.
    if (!validRanjauBlocks(st).length) return { ok: false, error: 'tidak ada petak valid untuk ranjau' };
    st.pendingPlant = { player: attacker, cardId: card.id };
    st.phase = 'plantRanjau';
    return { ok: true, needsPlant: true, attack: { kind, attacker } };
  }
  const targets = attackTargets(st, attacker, kind);
  const t = targets.find((x) => x.player === target.player && x.token === target.token);
  if (!t) return { ok: false, error: 'target serangan tidak valid' };
  if (kind === 'sniper') {
    const pl = st.players[attacker];
    const onTrack = pl.tokens.some((x) => x.progress >= 0 && x.progress <= 50);
    if (!onTrack) return { ok: false, error: 'Sniper butuh minimal 1 bidak di jalur utama' };
  }
  const attack = { kind, attacker, targetPlayer: t.player, targetToken: t.token };
  // Every target is notified and may choose to defend, even with an
  // empty defense hand (Sensei 2026-11-03); bots auto-decline.
  return { ok: true, needsDefense: true, attack, defender: t.player, victim: t };
}
// Resolve one defense step. Single victim per step (Sensei 2026-11-03);
// the caller advances the queue.
function resolveDefenseStep(st, pending, defenseCardId) {
  const attack = pending.attack;
  const victim = pending.victim || { player: pending.defender, token: attack.targetToken };
  const r = resolveDefense(st, { attack, defender: victim.player }, defenseCardId);
  if (!r.ok) return r;
  if (r.needsDest) {
    // Teleport/Escape: destination choice comes next; card not yet consumed.
    return { ok: true, done: false, needsDest: r.needsDest, cardId: r.cardId, card: r.card };
  }
  if (!r.defended) {
    // Accepted (or no card): apply the attack effect.
    if (attack.kind === 'stomp') {
      st.players[victim.player].tokens[victim.token].progress = -1;
      clearFrozenToken(st, victim.player, victim.token);
      return { ok: true, done: true, card: null, killed: [victim] };
    }
    if (attack.kind === 'ranjau') {
      // Mine blast: victim shattered to base, mine consumed (Sensei 2026-11-03).
      st.players[victim.player].tokens[victim.token].progress = -1;
      clearFrozenToken(st, victim.player, victim.token);
      consumeMine(st, attack.mineId);
      return { ok: true, done: true, card: null, killed: [victim], mineBlast: true };
    }
    // r.effect already applied by resolveDefense for non-defended.
    return { ok: true, done: true, card: null, defended: false, effect: r.effect || null };
  }
  // Defended.
  if (attack.kind === 'ranjau') {
    // Mine consumed even when defended (it exploded) (Sensei 2026-11-03).
    consumeMine(st, attack.mineId);
  }
  if (attack.kind === 'stomp') {
    // perisai/antistep: victim stays, attacker stacks (Sensei 2026-11-03).
    return { ok: true, done: true, card: r.card, defended: true };
  }
  return { ok: true, done: true, card: r.card || null, defended: r.defended, effect: r.effect || null };
}
// Push a one-shot animation event for the client (Sensei 2026-11-03).
function pushAnimEvent(st, type, data) {
  st.animEvents.push({ id: `ae${st.animEvents.length + 1}_${Date.now()}`, type, ...data });
  // Bound the list; client tracks seen IDs.
  if (st.animEvents.length > 20) st.animEvents = st.animEvents.slice(-20);
}
// Remove a mine by id (consumed after explosion).
function consumeMine(st, mineId) {
  st.mines = st.mines.filter((m) => m.id !== mineId);
}

// ---- client snapshot (never leaks other hands or the deck order) ----
function toClient(st, seat) {
  return {
    players: st.players.map((pl, pi) => ({
      color: pl.color,
      tokens: pl.tokens.map((t) => ({ progress: t.progress })),
      handCount: pl.hand.length,
      hand: pi === seat ? pl.hand.slice() : undefined,
      frozen: st.frozen.filter((f) => f.player === pi).map((f) => f.token),
    })),
    turn: st.turn,
    phase: st.phase,
    // TURN phase machine (Sensei 2026-11-03): every player always has
    // an explicit phase. The turn holder's phase is st.phase; anyone
    // else is 'waiting', except the defender who is 'defense'.
    myPhase: seat === st.turn ? st.phase
      : (st.pendingDefense && st.pendingDefense.defender === seat ? 'defense' : 'waiting'),
    dice: st.dice,
    lastRoll: st.lastRoll,
    playerRolls: st.playerRolls.slice(),
    steps: st.steps,
    neutralUsed: st.neutralUsed,
    boosterDecisionPending: st.boosterDecisionPending,
    log: st.log.slice(-50), // last 50 entries only, to bound payload
    pendingCaptureChoice: st.pendingCaptureChoice ? {
      victims: st.pendingCaptureChoice.victims.map((v) => ({ player: v.player, token: v.token })),
    } : null,
    pendingDrawCeremony: st.pendingDrawCeremony ? {
      stage: st.pendingDrawCeremony.stage,
      card: st.pendingDrawCeremony.card || null,
    } : null,
    drawBurned: st.drawBurned || null,
    sixCount: st.sixCount,
    winner: st.winner,
    over: st.over,
    deckCount: st.deck.length,
    blockCooldown: { ...st.blockCooldown },
    skillBlocks: SKILL_BLOCKS.slice(),
    safeSquares: SAFE_SQUARES.slice(),
    pendingAttack: st.pendingAttack ? {
      kind: st.pendingAttack.kind, attacker: st.pendingAttack.attacker,
      targetPlayer: st.pendingAttack.targetPlayer, targetToken: st.pendingAttack.targetToken,
      targetAbs: st.pendingAttack.targetAbs,
      // Valid targets/blocks for client marking (Sensei 2026-11-03).
      validTargets: st.pendingAttack.card && ['sniper', 'seret', 'beku'].includes(st.pendingAttack.kind)
        ? attackTargets(st, st.pendingAttack.attacker, st.pendingAttack.kind).map((t) => ({ player: t.player, token: t.token }))
        : [],
      validBlocks: st.pendingAttack.kind === 'ranjau' ? validRanjauBlocks(st) : [],
    } : null,
    pendingDefense: st.pendingDefense ? {
      defender: st.pendingDefense.defender,
      attackKind: st.pendingDefense.attack.kind,
      targetPlayer: st.pendingDefense.attack.targetPlayer,
      targetToken: st.pendingDefense.attack.targetToken,
      targetAbs: st.pendingDefense.attack.targetAbs,
    } : null,
    // Ranjau planting (Sensei 2026-11-03).
    mines: st.mines.map((m) => ({ abs: m.abs, owner: m.owner })),
    pendingPlant: st.pendingPlant && st.pendingPlant.player === seat ? {
      validBlocks: validRanjauBlocks(st),
    } : null,
    // Teleport/Escape destination choice (Sensei 2026-11-03).
    pendingTeleport: st.pendingTeleport && st.pendingTeleport.defender === seat ? {
      token: st.pendingTeleport.token,
      validDests: validTeleportDests(st, seat, st.pendingTeleport.token).map((d) => d.abs),
    } : null,
    pendingEscape: st.pendingEscape && st.pendingEscape.defender === seat ? {
      token: st.pendingEscape.token,
      validDests: validEscapeDests(st, seat, st.pendingEscape.token).map((d) => d.abs),
    } : null,
    // Stomp defense (Sensei 2026-11-03).
    pendingStomp: st.pendingStomp ? {
      attacker: st.pendingStomp.attacker,
      victims: st.pendingStomp.victims.map((v) => ({ player: v.player, token: v.token })),
    } : null,
    // One-shot animation events (Sensei 2026-11-03).
    animEvents: st.animEvents.slice(-20),
    pendingDraw: (st.pendingDraw && st.pendingDraw.player === seat) ? st.pendingDraw.card : null,
    pendingConfirm: st.pendingConfirm ? { noMove: !!st.pendingConfirm.noMove } : null,
    // Legal moves are server-computed for the current player only;
    // the client never derives rules, it only renders this list.
    legalMoves: (st.phase === 'move' && st.turn === seat && st.steps !== null)
      ? legalMoves(st, seat, st.steps, st.dice) : [],
    cardInfo: CARD_DEFS,
  };
}

// ---- simple, honest bot helpers (no peeking at hands or deck) ----
function botChooseMove(st, player, moves) {
  function score(m) {
    let s = 0;
    if (m.kind === 'exit') s += 40;
    if (m.kind === 'home') s += 100;
    const tok = st.players[player].tokens[m.token];
    if (tok.progress >= 0 && tok.progress <= 50) {
      const abs = absOf(player, m.to);
      if (abs !== null && !isSafeAbs(abs)) {
        const victims = tokensAtAbs(st, abs).filter((v) => v.player !== player);
        if (victims.length) s += 60;
      }
      if (abs !== null && SKILL_BLOCKS.includes(abs)) s += 30;
      if (abs !== null && isSafeAbs(abs)) s += 20;
    }
    s += m.to;
    return s;
  }
  return moves.slice().sort((a, b) => score(b) - score(a))[0] || null;
}
function botChooseAttack(st, attacker, card) {
  if (card.kind === 'ranjau') {
    // Plant near enemies: prefer blocks close to enemy pawns (Sensei 2026-11-03).
    const blocks = validRanjauBlocks(st);
    if (!blocks.length) return null;
    let best = null;
    for (const abs of blocks) {
      let score = 0;
      st.players.forEach((pl, pi) => {
        if (pi === attacker) return;
        pl.tokens.forEach((t) => {
          if (t.progress < 0 || t.progress > 50) return;
          const tAbs = absOf(pi, t.progress);
          const dist = (tAbs - abs + 52) % 52;
          if (dist > 0 && dist <= 6) score += (7 - dist);
        });
      });
      if (!best || score > best.score) best = { abs, score };
    }
    return best ? { abs: best.abs } : null;
  }
  const targets = attackTargets(st, attacker, card.kind);
  if (!targets.length) return null;
  const nearHome = targets.slice().sort((a, b) => b.progress - a.progress)[0];
  return { player: nearHome.player, token: nearHome.token };
}
function botChooseDefense(st, defender, pending) {
  const hand = st.players[defender].hand.filter((c) => c.group === 'defense');
  if (!hand.length) return null;
  const kind = pending.attack.kind;
  const byKind = (k) => hand.find((c) => c.kind === k);
  // Priority: perisai > teleport > escape > antistep (Sensei 2026-11-03).
  if (kind === 'ranjau') return (byKind('perisai') || byKind('teleport') || byKind('escape') || hand[0]).id;
  if (kind === 'sniper') return (byKind('perisai') || byKind('teleport') || byKind('escape') || hand[0]).id;
  if (kind === 'stomp') return (byKind('perisai') || byKind('antistep') || byKind('teleport') || byKind('escape') || hand[0]).id;
  return (byKind('perisai') || byKind('teleport') || hand[0]).id;
}
// Bot destination choice for teleport/escape (Sensei 2026-11-03).
function botChooseDest(st, player, token, dests, kind) {
  if (!dests.length) return null;
  if (kind === 'escape') {
    // Escape: go as far back as possible.
    return dests[dests.length - 1];
  }
  // Teleport: prefer backward if enemies nearby, else forward.
  const cur = st.players[player].tokens[token].progress;
  const curAbs = absOf(player, cur);
  let threat = false;
  st.players.forEach((pl, pi) => {
    if (pi === player) return;
    pl.tokens.forEach((t) => {
      if (t.progress < 0 || t.progress > 50) return;
      const tAbs = absOf(pi, t.progress);
      const dist = (curAbs - tAbs + 52) % 52;
      if (dist > 0 && dist <= 6) threat = true;
    });
  });
  const sorted = dests.slice().sort((a, b) => threat ? a.progress - b.progress : b.progress - a.progress);
  return sorted[0];
}
function botChooseNeutral(st, player) {
  const hand = st.players[player].hand.filter((c) => c.group === 'neutral');
  if (!hand.length || st.dice === null) return null;
  const needHome = st.players[player].tokens.some((t) => t.progress >= 51 && t.progress < 57);
  const distHome = st.players[player].tokens
    .filter((t) => t.progress >= 0 && t.progress < 57)
    .map((t) => 57 - t.progress);
  const smallest = distHome.length ? Math.min(...distHome) : 99;
  for (const c of hand) {
    const r = neutralSteps(c.kind, st.dice, smallest >= 1 && smallest <= 6 ? smallest : 1);
    if (!r.error && r.steps === smallest) return { cardId: c.id, choice: c.kind === 'bebas' ? smallest : undefined };
  }
  if (needHome) {
    const plus = hand.find((c) => c.kind === 'plus3' || c.kind === 'plus2' || c.kind === 'plus1');
    if (plus) return { cardId: plus.id };
  }
  return null;
}
function botSwapChoice(st, player, newCard) {
  const hand = st.players[player].hand;
  if (hand.length < MAX_HAND) return null;
  const defIdx = hand.findIndex((c) => c.group === 'neutral');
  const old = hand[defIdx >= 0 ? defIdx : 0];
  return old ? old.id : null;
}

module.exports = {
  PLAYER_COLORS, START_OFFSETS, SAFE_SQUARES, SKILL_BLOCKS, MAX_HAND, CARD_DEFS,
  newGame, buildDeck, shuffle, absOf, isSafeAbs, isFrozen, clearFrozenForTurn, clearFrozenToken, tokensAtAbs,
  homeCount, rollDice, legalMoves, applyMove, drawCard, returnHangus,
  checkWinner, endTurn, afterMoveFlow, startBlockCooldown, tickBlockCooldown,
  onTurnStart, neutralSteps, useNeutral, attackTargets, mineAt, validRanjauBlocks,
  applyAttackEffect, resolveDefense, beginAttack,
  resolveDefenseStep, resolveCaptureChoice, isAttackUsable,
  validTeleportDests, validEscapeDests, doTeleportDest, doEscapeDest, plantRanjau, consumeMine, pushAnimEvent,
  toClient, botChooseMove, botChooseAttack,
  botChooseDefense, botChooseDest, botChooseNeutral, botSwapChoice,
};
