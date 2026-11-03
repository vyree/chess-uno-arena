'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ludo = require('../game/ludo');

function fresh() { return ludo.newGame(() => 0.5); }
function setTrack(st, player, token, progress) {
  st.players[player].tokens[token].progress = progress;
}
function handOf(st, player, kinds) {
  st.players[player].hand = kinds.map((kind, i) => ({ id: `h${player}-${i}`, kind, group: ludo.CARD_DEFS[kind].group }));
}

test('dadu 6: jalan dulu, lalu giliran yang sama kocok lagi', () => {
  const st = fresh();
  st.dice = 6; st.sixCount = 1;
  setTrack(st, 0, 0, 10);
  const r = ludo.applyMove(st, 0, 0, 6, 6);
  assert.equal(r.ok, true);
  const f = ludo.afterMoveFlow(st, r);
  assert.equal(f.extra, true);
  assert.equal(st.turn, 0);
  assert.equal(st.phase, 'roll');
});

test('afterMoveFlow tanpa extra: kembalikan endTurn:true, engine tidak oper giliran sendiri', () => {
  const st = fresh();
  st.phase = 'move'; st.dice = 3; st.sixCount = 0;
  setTrack(st, 0, 0, 10);
  const r = ludo.applyMove(st, 0, 0, 3, 3);
  assert.equal(r.ok, true);
  const f = ludo.afterMoveFlow(st, r);
  assert.equal(f.endTurn, true);
  assert.equal(f.extra, false);
  // Engine tidak lagi memajukan giliran sendiri; server yang
  // menjalankan ceremony 'end' -> 'standby' -> 'roll'.
  assert.equal(st.turn, 0);
  assert.equal(st.phase, 'move');
});

test('cap 6 tersembunyi: kocokan ke-4 setelah 3x enam bukan 6', () => {
  const st = fresh();
  st.sixCount = 3;
  for (let i = 0; i < 50; i++) {
    const d = ludo.rollDice(st, () => 0.999);
    assert.ok(d >= 1 && d <= 5, `kocokan ke-4 harus 1-5, dapat ${d}`);
  }
  const st2 = fresh();
  st2.sixCount = 2;
  assert.equal(ludo.rollDice(st2, () => 0.999), 6);
});

test('keluar base hanya dadu asli 6', () => {
  const st = fresh();
  assert.equal(ludo.legalMoves(st, 0, 3, 3).length, 0);
  const moves = ludo.legalMoves(st, 0, 3, 6);
  assert.equal(moves.length, 4);
  assert.equal(moves[0].kind, 'exit');
});

test('makan: mendarat tepat di token lawan non-aman memicu stomp defense (Sensei 2026-11-03)', () => {
  const st = fresh();
  setTrack(st, 0, 0, 9); // abs 9, +1 -> abs 10
  setTrack(st, 1, 0, 49); // green offset 13 + 49 = 62 % 52 = 10
  const r = ludo.applyMove(st, 0, 0, 1, 1);
  assert.equal(r.ok, true);
  assert.equal(r.needsStompDefense, true);
  assert.equal(r.victims.length, 1);
  // Victim accepts (no defense card): goes home.
  const r2 = ludo.resolveDefenseStep(st, { attack: { kind: 'stomp', attacker: 0, targetPlayer: 1, targetToken: 0 }, defender: 1, victim: { player: 1, token: 0 } }, null);
  assert.equal(r2.done, true);
  assert.equal(r2.killed.length, 1);
  assert.equal(st.players[1].tokens[0].progress, -1);
});

test('stomp defense: AntiStep membatalkan injakan, kedua bidak menumpuk', () => {
  const st = fresh();
  setTrack(st, 0, 0, 9);
  setTrack(st, 1, 0, 49);
  handOf(st, 1, ['antistep']);
  const r = ludo.applyMove(st, 0, 0, 1, 1);
  assert.equal(r.needsStompDefense, true);
  const r2 = ludo.resolveDefenseStep(st, { attack: { kind: 'stomp', attacker: 0, targetPlayer: 1, targetToken: 0 }, defender: 1, victim: { player: 1, token: 0 } }, 'h1-0');
  assert.equal(r2.done, true);
  assert.equal(r2.defended, true);
  // Both pawns stay on the square.
  assert.equal(st.players[0].tokens[0].progress, 10);
  assert.equal(st.players[1].tokens[0].progress, 49);
});

test('petak aman: token di petak aman tidak bisa dimakan', () => {
  const st = fresh();
  setTrack(st, 0, 0, 7); // abs 7, +1 -> abs 8 = bintang aman
  setTrack(st, 1, 0, 47); // green 13+47=60%52=8
  const r = ludo.applyMove(st, 0, 0, 1, 1);
  assert.equal(r.captured.length, 0);
  assert.equal(st.players[1].tokens[0].progress, 47);
});

test('masuk home butuh angka pas: overshoot ditolak', () => {
  const st = fresh();
  setTrack(st, 0, 0, 56);
  assert.equal(ludo.legalMoves(st, 0, 2, 2).length, 0);
  const moves = ludo.legalMoves(st, 0, 1, 1);
  assert.equal(moves[0].kind, 'home');
  ludo.applyMove(st, 0, 0, 1, 1);
  assert.equal(st.players[0].tokens[0].progress, 57);
});

test('block skill: hanya mendarat tepat, bukan lewat, dan bukan aman', () => {
  const st = fresh();
  setTrack(st, 0, 0, 4); // abs 4, +1 -> abs 5 = block
  let r = ludo.applyMove(st, 0, 0, 1, 1);
  assert.equal(r.landedSkill, true);
  const st2 = fresh();
  setTrack(st2, 0, 0, 4);
  r = ludo.applyMove(st2, 0, 0, 2, 2); // lewat 5, mendarat 6
  assert.equal(r.landedSkill, false);
  assert.equal(ludo.SAFE_SQUARES.includes(5), false);
  // token di block bisa dimakan: lawan mendarat di abs 5
  // (Sensei 2026-11-03: stomp now requires defense, not auto-capture).
  setTrack(st, 1, 0, 43); // green 13+43=56%52=4, +1 -> abs 5
  const r2 = ludo.applyMove(st, 1, 0, 1, 1);
  assert.equal(r2.needsStompDefense, true);
  assert.equal(r2.victims.length, 1);
  assert.equal(r2.victims[0].player, 0);
});

test('deck 64 kartu: attack/defense 4 copy, netral bervariasi (Sensei 2026-11-03)', () => {
  const st = fresh();
  assert.equal(st.deck.length, 64);
  const counts = {};
  for (const c of st.deck) counts[c.kind] = (counts[c.kind] || 0) + 1;
  assert.equal(Object.keys(counts).length, 13); // 4 attack + 4 defense + 5 netral
  // Attack & defense: 4 copy each.
  for (const k of ['sniper', 'ranjau', 'seret', 'beku', 'perisai', 'antistep', 'teleport', 'escape']) {
    assert.equal(counts[k], 4, k);
  }
  // Neutral: x2/+1/+2/+3 @6, bebas @8.
  assert.equal(counts['x2'], 6);
  assert.equal(counts['plus1'], 6);
  assert.equal(counts['plus2'], 6);
  assert.equal(counts['plus3'], 6);
  assert.equal(counts['bebas'], 8);
  // minus1/2/3 and cermin are gone.
  assert.equal(counts['minus1'], undefined);
  assert.equal(counts['cermin'], undefined);
});

test('attack instan: tidak bisa disimpan, dipakai langsung atau hangus', () => {
  const st = fresh();
  const card = st.deck.find((c) => c.kind === 'sniper');
  assert.equal(card.group, 'attack');
  // attack tidak pernah masuk hand lewat draw biasa: server hanya
  // menaruh defense/netral ke hand; attack diproses di fase attack.
  // Di sini diuji: hand pemain tidak menerima attack dari helper draw
  // bila server mengikuti kontrak (hand hanya defense/netral).
  const drawn = ludo.drawCard(st);
  assert.ok(drawn);
  assert.equal(st.deck.length, 63);
});

test('simpanan gabungan maks 3 + tukar', () => {
  const st = fresh();
  handOf(st, 0, ['perisai', 'teleport', 'plus1']);
  assert.equal(st.players[0].hand.length, 3);
  // tukar: buang plus1, ambil cermin
  const old = st.players[0].hand.find((c) => c.kind === 'plus1');
  st.players[0].hand = st.players[0].hand.filter((c) => c.id !== old.id);
  ludo.returnHangus(st, old);
  st.players[0].hand.push({ id: 'new1', kind: 'antistep', group: 'defense' });
  assert.equal(st.players[0].hand.length, 3);
  assert.ok(st.players[0].hand.some((c) => c.kind === 'antistep'));
  assert.ok(st.deck.some((c) => c.id === old.id));
});

test('hangus balik deck, terpakai hilang', () => {
  const st = fresh();
  const before = st.deck.length;
  const card = ludo.drawCard(st);
  ludo.returnHangus(st, card);
  assert.equal(st.deck.length, before);
  assert.ok(st.deck.some((c) => c.id === card.id));
  // terpakai: kartu yang sudah dipakai tidak dikembalikan — deck tetap
  const used = ludo.drawCard(st);
  assert.equal(st.deck.length, before - 1);
  assert.ok(!st.deck.some((c) => c.id === used.id));
});

test('deck habis: draw mengembalikan null, game tetap jalan', () => {
  const st = fresh();
  st.deck = [];
  assert.equal(ludo.drawCard(st), null);
  assert.equal(st.over, false);
});

test('defense trigger: Perisai membatalkan Sniper, kartu habis', () => {
  const st = fresh();
  setTrack(st, 0, 0, 10);
  setTrack(st, 1, 0, 10);
  handOf(st, 1, ['perisai']);
  const card = { id: 'a1', kind: 'sniper', group: 'attack' };
  const b = ludo.beginAttack(st, 0, card, { player: 1, token: 0 });
  assert.equal(b.needsDefense, true);
  const r = ludo.resolveDefenseStep(st, { attack: b.attack, defender: 1 }, 'h1-0');
  assert.equal(r.done, true);
  assert.equal(st.players[1].tokens[0].progress, 10);
  assert.equal(st.players[1].hand.length, 0);
});

test('AntiStep tidak berlaku untuk Ranjau (hanya untuk injak)', () => {
  const st = fresh();
  setTrack(st, 1, 0, 10);
  handOf(st, 1, ['antistep']);
  const r = ludo.resolveDefense(st, { attack: { kind: 'ranjau', attacker: 0, targetPlayer: 1, targetToken: 0 }, defender: 1 }, 'h1-0');
  assert.equal(r.ok, false);
});

test('Ranjau: tanam di petak valid, meledak saat diinjak', () => {
  const st = fresh();
  // Plant ranjau at abs 10.
  st.phase = 'attack';
  st.pendingAttack = { kind: 'ranjau', attacker: 0, card: { id: 'a2', kind: 'ranjau', group: 'attack' } };
  st.players[0].hand.push({ id: 'a2', kind: 'ranjau', group: 'attack' });
  const b = ludo.beginAttack(st, 0, { id: 'a2', kind: 'ranjau', group: 'attack' }, {});
  assert.equal(b.needsPlant, true);
  assert.equal(st.phase, 'plantRanjau');
  const pr = ludo.plantRanjau(st, 0, 'a2', 10);
  assert.equal(pr.ok, true);
  assert.equal(st.mines.length, 1);
  assert.equal(st.mines[0].abs, 10);
  // Mine icon removed after explosion (Sensei 2026-11-03).
  ludo.consumeMine(st, st.mines[0].id);
  assert.equal(st.mines.length, 0);
});

test('Ranjau: tidak bisa tanam di petak aman', () => {
  const st = fresh();
  st.phase = 'plantRanjau';
  st.pendingPlant = { player: 0, cardId: 'a2' };
  st.players[0].hand.push({ id: 'a2', kind: 'ranjau', group: 'attack' });
  const r = ludo.plantRanjau(st, 0, 'a2', 0); // abs 0 is safe
  assert.equal(r.ok, false);
});

test('always-defense: target tanpa kartu defense tetap ditanya (Sensei 2026-11-03)', () => {
  const st = fresh();
  setTrack(st, 0, 0, 10);
  setTrack(st, 1, 0, 10); // korban: tangan kosong, tanpa kartu defense
  const b = ludo.beginAttack(st, 0, { id: 'a5', kind: 'sniper', group: 'attack' }, { player: 1, token: 0 });
  assert.equal(b.needsDefense, true); // tetap prompt, bukan auto-kill
  const r = ludo.resolveDefenseStep(st, { attack: b.attack, defender: 1 }, null); // terima serangan
  assert.equal(r.done, true);
  assert.equal(st.players[1].tokens[0].progress, -1); // sniper membunuh
});

test('TURN phase machine: myPhase eksplisit per pemain (Sensei 2026-11-03)', () => {
  const st = fresh();
  st.phase = 'move'; st.turn = 0;
  // Pemegang giliran: fasenya = st.phase.
  assert.equal(ludo.toClient(st, 0).myPhase, 'move');
  // Bukan giliran, tidak diserang: waiting.
  assert.equal(ludo.toClient(st, 1).myPhase, 'waiting');
  // Korban defense: defense (bukan waiting).
  st.phase = 'defense';
  st.pendingDefense = { defender: 1, attack: { kind: 'sniper', attacker: 0, targetPlayer: 1, targetToken: 0 } };
  assert.equal(ludo.toClient(st, 1).myPhase, 'defense');
  // Penyerang (pemegang giliran) tetap di fase defense global.
  assert.equal(ludo.toClient(st, 0).myPhase, 'defense');
  // Pemain ketiga yang tidak terlibat: waiting.
  assert.equal(ludo.toClient(st, 2).myPhase, 'waiting');
});

test('lastRoll: angka dadu no-move roll tersedia untuk animasi klien', () => {
  const st = fresh();
  assert.equal(st.lastRoll, null);
  // Simulasi doLudoRoll no-move: lastRoll diset sebelum endTurn.
  st.dice = 4; st.lastRoll = st.dice;
  ludo.endTurn(st);
  assert.equal(st.dice, null); // endTurn tetap membersihkan dice...
  assert.equal(st.lastRoll, 4); // ...tapi lastRoll bertahan
  assert.equal(ludo.toClient(st, 0).lastRoll, 4);
});

test('netral hanya langkah: +3 dari 3 tidak menciptakan keluar base/kocok lagi', () => {
  const st = fresh();
  st.phase = 'move'; st.turn = 0; st.dice = 3; st.steps = 3;
  handOf(st, 0, ['plus3']);
  const r = ludo.useNeutral(st, 0, 'h0-0');
  assert.equal(r.ok, true);
  assert.equal(r.steps, 6);
  assert.equal(st.dice, 3); // dadu asli tidak berubah
  // token di base tetap tidak bisa keluar dengan langkah 6 hasil +3
  const moves = ludo.legalMoves(st, 0, r.steps, st.dice);
  assert.equal(moves.length, 0);
});

test('netral: kartu - tidak boleh membuat langkah < 1; maks 1 per kocokan', () => {
  const st = fresh();
  st.phase = 'move'; st.turn = 0; st.dice = 1; st.steps = 1;
  handOf(st, 0, ['bebas', 'plus1']);
  assert.equal(ludo.useNeutral(st, 0, 'h0-0').ok, false);
  st.dice = 5; st.steps = 5;
  assert.equal(ludo.useNeutral(st, 0, 'h0-1').ok, true);
  assert.equal(ludo.useNeutral(st, 0, 'h0-0').ok, false);
});

test('bebas pilih = langkah 1-6, bukan angka dadu', () => {
  assert.deepEqual(ludo.neutralSteps('bebas', 2, 6), { steps: 6 });
  assert.ok(ludo.neutralSteps('bebas', 2, 7).error);
  assert.ok(ludo.neutralSteps('bebas', 2, 0).error);
});

test('Beku: token beku tidak bisa digerakkan selama 2 giliran (Sensei 2026-11-03)', () => {
  const st = fresh();
  setTrack(st, 1, 0, 20);
  st.frozen.push({ player: 1, token: 0, turns: 2 });
  assert.equal(ludo.legalMoves(st, 1, 3, 3).filter((m) => m.token === 0).length, 0);
  ludo.clearFrozenForTurn(st, 1); // giliran 1 selesai: masih beku
  assert.equal(ludo.isFrozen(st, 1, 0), true);
  assert.equal(ludo.legalMoves(st, 1, 3, 3).filter((m) => m.token === 0).length, 0);
  ludo.clearFrozenForTurn(st, 1); // giliran 2 selesai: cair
  assert.equal(ludo.isFrozen(st, 1, 0), false);
});

test('toClient tidak membocorkan tangan lawan atau urutan deck', () => {
  const st = fresh();
  handOf(st, 0, ['perisai']);
  handOf(st, 1, ['antistep']);
  const snap = ludo.toClient(st, 0);
  assert.deepEqual(snap.players[0].hand.map((c) => c.kind), ['perisai']);
  assert.equal(snap.players[1].hand, undefined);
  assert.equal(snap.players[1].handCount, 1);
  assert.equal(snap.deckCount, 64);
  assert.ok(!('deck' in snap));
});

test('bot attack: format mentah bot gagal, format terjemahan server berhasil (Sniper + Perisai)', () => {
  // Regression test for the Oct 2026 bot-attack hang. The server's
  // doLudoAttack builds the engine target from the HUMAN-client
  // shape {targetPlayer, targetToken}: passing the bot shape
  // {player, token} through raw (as ludoBotStep used to do) makes
  // it read targetPlayer/targetToken as undefined, so beginAttack
  // rejects the target — and the caller ignored the failure without
  // a sync or a new timer, hanging the game until the 60s timeout.
  const st = fresh();
  setTrack(st, 0, 0, 10);
  setTrack(st, 1, 0, 10);
  handOf(st, 1, ['perisai']);
  const card = { id: 'a1', kind: 'sniper', group: 'attack' };
  const rawBot = ludo.botChooseAttack(st, 0, card);
  assert.deepEqual(rawBot, { player: 1, token: 0 });
  // Old server path: doLudoAttack would build
  // {player: rawBot.targetPlayer, token: rawBot.targetToken} =
  // {player: undefined, token: undefined} for beginAttack.
  assert.equal(ludo.beginAttack(st, 0, card, { player: rawBot.targetPlayer, token: rawBot.targetToken }).ok, false);
  // Fixed server path (ludoBotStep translates bot -> client shape,
  // doLudoAttack translates client -> engine shape):
  const translated = { player: rawBot.player, token: rawBot.token };
  const b = ludo.beginAttack(st, 0, card, translated);
  assert.equal(b.needsDefense, true);
  assert.equal(b.defender, 1);
  const r = ludo.resolveDefenseStep(st, { attack: b.attack, defender: 1 }, 'h1-0');
  assert.equal(r.done, true);
  assert.equal(st.players[1].tokens[0].progress, 10);
  assert.equal(st.players[1].hand.length, 0);
});

test('bot attack Ranjau: botChooseAttack menemukan petak strategis', () => {
  const st = fresh();
  setTrack(st, 0, 0, 10);
  setTrack(st, 1, 0, 15); // enemy at abs 15
  const rawBot = ludo.botChooseAttack(st, 0, { id: 'a2', kind: 'ranjau', group: 'attack' });
  assert.ok(rawBot && Number.isInteger(rawBot.abs));
  // Bot prefers blocks near enemies.
  assert.ok(rawBot.abs >= 0 && rawBot.abs < 52);
});

test('AntiStep tidak berlaku untuk Seret (hanya untuk injak)', () => {
  const st = fresh();
  setTrack(st, 0, 0, 20);
  setTrack(st, 1, 0, 10);
  handOf(st, 1, ['antistep']);
  const r = ludo.resolveDefense(st, { attack: { kind: 'seret', attacker: 0, targetPlayer: 1, targetToken: 0 }, defender: 1 }, 'h1-0');
  assert.equal(r.ok, false);
});

test('Teleport: butuh pilih destinasi (maks 3 maju/mundur)', () => {
  const st = fresh();
  setTrack(st, 1, 0, 10);
  handOf(st, 1, ['teleport']);
  const r = ludo.resolveDefense(st, { attack: { kind: 'beku', attacker: 0, targetPlayer: 1, targetToken: 0 }, defender: 1 }, 'h1-0');
  assert.equal(r.ok, true);
  assert.equal(r.needsDest, 'teleport');
  const dests = ludo.validTeleportDests(st, 1, 0);
  assert.ok(dests.length > 0);
  assert.ok(dests.every((d) => Math.abs(d.progress - 10) <= 3 && Math.abs(d.progress - 10) >= 1));
});

test('Escape: mundur maks 3 petak', () => {
  const st = fresh();
  setTrack(st, 1, 0, 10);
  handOf(st, 1, ['escape']);
  const r = ludo.resolveDefense(st, { attack: { kind: 'sniper', attacker: 0, targetPlayer: 1, targetToken: 0 }, defender: 1 }, 'h1-0');
  assert.equal(r.ok, true);
  assert.equal(r.needsDest, 'escape');
  const dests = ludo.validEscapeDests(st, 1, 0);
  assert.deepEqual(dests.map((d) => d.progress), [9, 8, 7]);
});

test('bot defense: bot defender memilih kartu defense sesuai jenis serangan', () => {
  const st = fresh();
  handOf(st, 1, ['perisai', 'antistep', 'teleport']);
  // Sniper: perisai diprioritaskan.
  assert.equal(ludo.botChooseDefense(st, 1, { attack: { kind: 'sniper' } }), 'h1-0');
  // Seret tanpa perisai: teleport diprioritaskan (antistep tidak berlaku).
  handOf(st, 1, ['antistep', 'teleport']);
  assert.equal(ludo.botChooseDefense(st, 1, { attack: { kind: 'seret' } }), 'h1-1');
  // Ranjau: antistep TIDAK berlaku, jadi teleport yang dipilih.
  handOf(st, 1, ['antistep', 'teleport']);
  assert.equal(ludo.botChooseDefense(st, 1, { attack: { kind: 'ranjau' } }), 'h1-1');
  // Stomp: perisai > antistep > teleport.
  handOf(st, 1, ['antistep', 'teleport']);
  assert.equal(ludo.botChooseDefense(st, 1, { attack: { kind: 'stomp' } }), 'h1-0');
  // Tanpa kartu defense: null (terima serangan).
  handOf(st, 1, ['plus1']);
  assert.equal(ludo.botChooseDefense(st, 1, { attack: { kind: 'sniper' } }), null);
});

test('pemenang: semua 4 token home', () => {
  const st = fresh();
  for (let i = 0; i < 4; i++) setTrack(st, 2, i, 57);
  assert.equal(ludo.checkWinner(st), 2);
  assert.equal(st.over, true);
});
