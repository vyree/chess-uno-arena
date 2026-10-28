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
  bom: { group: 'attack', name: 'Bom Petak', desc: 'Pilih 1 petak jalur utama: semua bidak di petak itu pulang ke base, termasuk bidak sendiri (kecuali petak aman). Sekali pakai, instan, bukan ranjau.' },
  seret: { group: 'attack', name: 'Rantai Seret', desc: 'Tarik 1 bidak musuh mundur 10 petak di jalur utama. Dipakai langsung saat didapat.' },
  beku: { group: 'attack', name: 'Es Beku', desc: 'Bekukan 1 bidak musuh: bidak itu tidak bisa digerakkan di giliran pemiliknya berikutnya. Dipakai langsung saat didapat.' },
  perisai: { group: 'defense', name: 'Perisai Baja', desc: 'Batalkan 1 serangan terhadap 1 bidakmu. Dipakai hanya saat bidakmu diserang; habis sekali pakai.' },
  cermin: { group: 'defense', name: 'Cermin Pantul', desc: 'Pantulkan serangan target-tunggal (Sniper, Rantai Seret, Es Beku) ke 1 bidak penyerang. Tidak berlaku untuk Bom Petak.' },
  teleport: { group: 'defense', name: 'Teleport Darurat', desc: 'Saat diserang, bidakmu pindah ke petak aman terdekat di depan; kalau tidak ada, ke petak start warnanya.' },
  kulit: { group: 'defense', name: 'Kulit Batu', desc: 'Serangan yang seharusnya membunuh diubah jadi mundur 6 petak saja, bukan pulang ke base.' },
  x2: { group: 'neutral', name: 'Langkah x2', desc: 'Langkah = 2 x dadu. Hanya mengubah langkah; tidak bisa dipakai untuk keluar base atau kocok lagi. Dipakai setelah kocok, sebelum jalan, maks 1 per kocokan.' },
  plus1: { group: 'neutral', name: '+1 Langkah', desc: 'Tambah 1 langkah. Hanya menambah langkah; tidak bisa dipakai untuk keluar base atau kocok lagi.' },
  plus2: { group: 'neutral', name: '+2 Langkah', desc: 'Tambah 2 langkah. Hanya menambah langkah; tidak bisa dipakai untuk keluar base atau kocok lagi.' },
  plus3: { group: 'neutral', name: '+3 Langkah', desc: 'Tambah 3 langkah. Hanya menambah langkah; tidak bisa dipakai untuk keluar base atau kocok lagi.' },
  minus1: { group: 'neutral', name: '-1 Langkah', desc: 'Kurangi 1 langkah sendiri (alat presisi, misal pas masuk home). Hanya untuk diri sendiri; langkah akhir tidak boleh di bawah 1.' },
  minus2: { group: 'neutral', name: '-2 Langkah', desc: 'Kurangi 2 langkah sendiri (alat presisi). Hanya untuk diri sendiri; langkah akhir tidak boleh di bawah 1.' },
  minus3: { group: 'neutral', name: '-3 Langkah', desc: 'Kurangi 3 langkah sendiri (alat presisi). Hanya untuk diri sendiri; langkah akhir tidak boleh di bawah 1.' },
  bebas: { group: 'neutral', name: 'Bebas Pilih Langkah', desc: 'Pilih jumlah langkah 1-6. Ini langkah, bukan angka dadu: pilih 6 langkah pun tidak keluar base dan tidak kocok lagi. Hanya untuk diri sendiri.' },
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
  for (const kind of CARD_KINDS) {
    for (let c = 0; c < 4; c++) deck.push({ id: `c${n++}`, kind, group: CARD_DEFS[kind].group });
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
    steps: null,
    neutralUsed: false,
    sixCount: 0,
    pendingAttack: null,
    pendingDefense: null,
    pendingDraw: null,
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
  st.frozen = st.frozen.filter((f) => f.player !== player);
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
    if (!isSafeAbs(abs)) {
      const victims = tokensAtAbs(st, abs).filter((v) => v.player !== player);
      for (const v of victims) {
        st.players[v.player].tokens[v.token].progress = -1;
        clearFrozenToken(st, v.player, v.token);
        result.captured.push(v);
      }
    }
    if (SKILL_BLOCKS.includes(abs)) result.landedSkill = true;
  }
  if (wasProgress === -1 && mv.kind === 'exit') result.exited = true;
  return result;
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
  st.sixCount = 0;
  st.pendingAttack = null;
  st.pendingDefense = null;
  st.pendingDraw = null;
}
// Advance after a completed move: extra roll on 6/capture/home,
// otherwise pass the turn. Caller handles skill draw first.
function afterMoveFlow(st, moveResult) {
  if (checkWinner(st) !== null) return { extra: false, over: true };
  const extra = st.dice === 6 || moveResult.captured.length > 0 || moveResult.enteredHome;
  if (extra) {
    st.phase = 'roll';
    st.dice = null;
    st.steps = null;
    st.neutralUsed = false;
    st.pendingAttack = null;
    st.pendingDefense = null;
    st.pendingDraw = null;
    return { extra: true, over: false };
  }
  endTurn(st);
  return { extra: false, over: false };
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
  if (kind === 'minus1' || kind === 'minus2' || kind === 'minus3') {
    const n = Number(kind.slice(5));
    if (dice - n < 1) return { error: 'langkah akhir tidak boleh di bawah 1' };
    return { steps: dice - n };
  }
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
function bombTargets(st, abs) {
  if (abs === null || abs < 0 || abs > 51 || isSafeAbs(abs)) return [];
  return tokensAtAbs(st, abs);
}
function applyAttackEffect(st, attack) {
  const { kind, attacker, targetPlayer, targetToken, targetAbs } = attack;
  if (kind === 'sniper') {
    st.players[targetPlayer].tokens[targetToken].progress = -1;
    clearFrozenToken(st, targetPlayer, targetToken);
    return { killed: [{ player: targetPlayer, token: targetToken }] };
  }
  if (kind === 'bom') {
    const victims = bombTargets(st, targetAbs);
    for (const v of victims) {
      st.players[v.player].tokens[v.token].progress = -1;
      clearFrozenToken(st, v.player, v.token);
    }
    return { killed: victims };
  }
  if (kind === 'seret') {
    const tok = st.players[targetPlayer].tokens[targetToken];
    tok.progress = Math.max(0, tok.progress - 10);
    return { moved: [{ player: targetPlayer, token: targetToken, progress: tok.progress }] };
  }
  if (kind === 'beku') {
    if (!isFrozen(st, targetPlayer, targetToken)) {
      st.frozen.push({ player: targetPlayer, token: targetToken });
    }
    return { frozen: [{ player: targetPlayer, token: targetToken }] };
  }
  return {};
}
// Defense resolution. Returns {defended, reflected, ...}. The attack
// card itself is always consumed (terpakai) once resolved, even if
// the defense cancels it — the defender's card is also consumed.
function resolveDefense(st, pending, defenseCardId) {
  const { attack, defender } = pending;
  const hand = st.players[defender].hand;
  const idx = defenseCardId ? hand.findIndex((c) => c.id === defenseCardId) : -1;
  if (defenseCardId && idx < 0) return { ok: false, error: 'kartu defense tidak ada di tangan' };
  const card = idx >= 0 ? hand[idx] : null;
  if (card && card.group !== 'defense') return { ok: false, error: 'hanya kartu defense yang bisa dipakai saat diserang' };
  if (card && card.kind === 'cermin' && attack.kind === 'bom') {
    return { ok: false, error: 'Cermin Pantul tidak berlaku untuk Bom Petak' };
  }
  if (idx >= 0) hand.splice(idx, 1);
  if (!card) return { ok: true, defended: false, effect: applyAttackEffect(st, attack) };
  if (card.kind === 'perisai') return { ok: true, defended: true, card };
  if (card.kind === 'cermin') {
    const attackers = attackTargets(st, defender, attack.kind)
      .filter((t) => t.player === attack.attacker);
    if (!attackers.length) return { ok: true, defended: true, card };
    const back = attackers[0];
    const reflected = { ...attack, targetPlayer: back.player, targetToken: back.token };
    return { ok: true, defended: true, reflected: true, card, effect: applyAttackEffect(st, reflected) };
  }
  if (card.kind === 'teleport') {
    const tok = st.players[defender].tokens[attack.targetToken];
    const cur = tok.progress;
    let dest = null;
    if (cur >= 0 && cur <= 50) {
      const curAbs = absOf(defender, cur);
      const ahead = SAFE_SQUARES.filter((s) => {
        const dist = (s - curAbs + 52) % 52;
        return dist > 0;
      }).sort((a, b) => ((a - curAbs + 52) % 52) - ((b - curAbs + 52) % 52));
      if (ahead.length) {
        const abs = ahead[0];
        dest = (abs - START_OFFSETS[defender] + 52) % 52;
      }
    }
    if (dest === null) dest = 0;
    tok.progress = dest;
    return { ok: true, defended: true, card, teleported: dest };
  }
  if (card.kind === 'kulit') {
    if (attack.kind === 'sniper' || attack.kind === 'bom') {
      const tok = st.players[attack.targetPlayer].tokens[attack.targetToken];
      if (attack.kind === 'bom') {
        // Kulit Batu saves only its own token from a bomb: that token
        // steps back 6 instead of dying; other tokens on the square
        // are still handled by the caller through bombRemaining.
        tok.progress = Math.max(0, tok.progress - 6);
        return { ok: true, defended: true, card, partial: true };
      }
      tok.progress = Math.max(0, tok.progress - 6);
      return { ok: true, defended: true, card };
    }
    return { ok: true, defended: true, card, effect: applyAttackEffect(st, attack) };
  }
  return { ok: true, defended: false };
}

// ---- attack / defense flow (server drives these steps) ----
// Begin an attack card. Returns {ok, needsDefense, attack, defender}
// when a defender must choose, otherwise applies immediately.
function beginAttack(st, attacker, card, target) {
  const kind = card.kind;
  if (kind === 'bom') {
    const victims = bombTargets(st, target.abs);
    if (!victims.length) return { ok: false, error: 'tidak ada bidak di petak itu' };
    const attack = { kind, attacker, targetAbs: target.abs, victims: victims.slice() };
    const next = nextBombDefender(st, attack);
    if (next) return { ok: true, needsDefense: true, attack, defender: next.player, victim: next };
    for (const v of victims) {
      st.players[v.player].tokens[v.token].progress = -1;
      clearFrozenToken(st, v.player, v.token);
    }
    return { ok: true, needsDefense: false, attack, killed: victims };
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
  const defenderHas = st.players[t.player].hand.some((c) => c.group === 'defense');
  if (defenderHas) return { ok: true, needsDefense: true, attack, defender: t.player, victim: t };
  const effect = applyAttackEffect(st, attack);
  return { ok: true, needsDefense: false, attack, effect };
}
function nextBombDefender(st, attack) {
  for (const v of attack.victims) {
    if (st.players[v.player].hand.some((c) => c.group === 'defense')) return v;
  }
  return null;
}
// Resolve one defense step. For bombs, victims without a defense are
// killed as the queue advances; victims with a defense get a choice.
function resolveDefenseStep(st, pending, defenseCardId) {
  const attack = pending.attack;
  if (attack.kind === 'bom') {
    const victim = attack.victims[0];
    if (!victim) return { ok: true, done: true };
    const r = resolveDefense(st, { attack, defender: victim.player }, defenseCardId);
    if (!r.ok) return r;
    if (r.defended && r.card && r.card.kind === 'kulit') {
      // token already stepped back by resolveDefense; it survives
    } else if (r.defended) {
      // perisai / teleport: token survives unchanged (teleport moved it)
    } else {
      st.players[victim.player].tokens[victim.token].progress = -1;
      clearFrozenToken(st, victim.player, victim.token);
    }
    attack.victims.shift();
    // Kill victims who have no defense without asking them.
    while (attack.victims.length) {
      const nxt = attack.victims[0];
      if (st.players[nxt.player].hand.some((c) => c.group === 'defense')) break;
      st.players[nxt.player].tokens[nxt.token].progress = -1;
      clearFrozenToken(st, nxt.player, nxt.token);
      attack.victims.shift();
    }
    if (!attack.victims.length) return { ok: true, done: true, card: r.card || null };
    const nxt = attack.victims[0];
    return { ok: true, done: false, defender: nxt.player, victim: nxt, card: r.card || null };
  }
  const r = resolveDefense(st, pending, defenseCardId);
  if (!r.ok) return r;
  return { ok: true, done: true, card: r.card || null, defended: r.defended, reflected: r.reflected || false, effect: r.effect || null };
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
    dice: st.dice,
    steps: st.steps,
    neutralUsed: st.neutralUsed,
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
    } : null,
    pendingDefense: st.pendingDefense ? {
      defender: st.pendingDefense.defender,
      attackKind: st.pendingDefense.attack.kind,
      targetPlayer: st.pendingDefense.attack.targetPlayer,
      targetToken: st.pendingDefense.attack.targetToken,
      targetAbs: st.pendingDefense.attack.targetAbs,
    } : null,
    pendingDraw: (st.pendingDraw && st.pendingDraw.player === seat) ? st.pendingDraw.card : null,
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
  if (card.kind === 'bom') {
    let best = null;
    for (let abs = 0; abs < 52; abs++) {
      if (isSafeAbs(abs)) continue;
      const vs = bombTargets(st, abs);
      const enemies = vs.filter((v) => v.player !== attacker);
      if (!enemies.length) continue;
      const own = vs.filter((v) => v.player === attacker).length;
      const score = enemies.length * 10 - own * 8;
      if (!best || score > best.score) best = { abs, score };
    }
    return best && best.score > 0 ? { abs: best.abs } : null;
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
  if (kind === 'bom') return (byKind('perisai') || byKind('teleport') || byKind('kulit') || hand[0]).id;
  if (kind === 'sniper') return (byKind('perisai') || byKind('cermin') || byKind('teleport') || byKind('kulit') || hand[0]).id;
  return (byKind('cermin') || byKind('perisai') || byKind('teleport') || hand[0]).id;
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
  onTurnStart, neutralSteps, useNeutral, attackTargets, bombTargets,
  applyAttackEffect, resolveDefense, beginAttack, nextBombDefender,
  resolveDefenseStep, toClient, botChooseMove, botChooseAttack,
  botChooseDefense, botChooseNeutral, botSwapChoice,
};
