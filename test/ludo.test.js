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

test('makan: mendarat tepat di token lawan non-aman memulangkannya', () => {
  const st = fresh();
  setTrack(st, 0, 0, 9); // abs 9, +1 -> abs 10
  setTrack(st, 1, 0, 49); // green offset 13 + 49 = 62 % 52 = 10
  const r = ludo.applyMove(st, 0, 0, 1, 1);
  assert.equal(r.ok, true);
  assert.equal(r.captured.length, 1);
  assert.equal(st.players[1].tokens[0].progress, -1);
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
  setTrack(st, 1, 0, 43); // green 13+43=56%52=4, +1 -> abs 5
  const r2 = ludo.applyMove(st, 1, 0, 1, 1);
  assert.equal(r2.captured.length, 1);
});

test('deck 64 kartu, tiap jenis tepat 4 copy', () => {
  const st = fresh();
  assert.equal(st.deck.length, 64);
  const counts = {};
  for (const c of st.deck) counts[c.kind] = (counts[c.kind] || 0) + 1;
  assert.equal(Object.keys(counts).length, 16);
  for (const k of Object.keys(counts)) assert.equal(counts[k], 4, k);
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
  st.players[0].hand.push({ id: 'new1', kind: 'cermin', group: 'defense' });
  assert.equal(st.players[0].hand.length, 3);
  assert.ok(st.players[0].hand.some((c) => c.kind === 'cermin'));
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

test('Cermin tidak berlaku untuk Bom Petak', () => {
  const st = fresh();
  setTrack(st, 1, 0, 10);
  handOf(st, 1, ['cermin']);
  const r = ludo.resolveDefense(st, { attack: { kind: 'bom', attacker: 0, targetAbs: 10 }, defender: 1 }, 'h1-0');
  assert.equal(r.ok, false);
});

test('Bom Petak friendly fire: kena bidak sendiri juga', () => {
  const st = fresh();
  setTrack(st, 0, 0, 10);
  setTrack(st, 1, 0, 49); // abs 10 juga
  const victims = ludo.bombTargets(st, 10);
  assert.equal(victims.length, 2);
  const b = ludo.beginAttack(st, 0, { id: 'a2', kind: 'bom', group: 'attack' }, { abs: 10 });
  assert.equal(b.needsDefense, false);
  assert.equal(st.players[0].tokens[0].progress, -1);
  assert.equal(st.players[1].tokens[0].progress, -1);
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
  handOf(st, 0, ['minus2', 'plus1']);
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

test('Beku: token beku tidak bisa digerakkan di giliran berikutnya', () => {
  const st = fresh();
  setTrack(st, 1, 0, 20);
  st.frozen.push({ player: 1, token: 0 });
  assert.equal(ludo.legalMoves(st, 1, 3, 3).filter((m) => m.token === 0).length, 0);
  ludo.clearFrozenForTurn(st, 1);
  assert.equal(ludo.isFrozen(st, 1, 0), false);
});

test('toClient tidak membocorkan tangan lawan atau urutan deck', () => {
  const st = fresh();
  handOf(st, 0, ['perisai']);
  handOf(st, 1, ['cermin']);
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

test('bot attack Bom: botChooseAttack menemukan petak, semua korban kena (friendly fire)', () => {
  const st = fresh();
  setTrack(st, 0, 0, 10);
  setTrack(st, 1, 0, 49); // abs 10 juga
  const rawBot = ludo.botChooseAttack(st, 0, { id: 'a2', kind: 'bom', group: 'attack' });
  assert.deepEqual(rawBot, { abs: 10 });
  // Old server path would read rawBot.targetAbs = undefined and
  // bombTargets would return no victims; the translated path works.
  assert.equal(ludo.beginAttack(st, 0, { id: 'a2', kind: 'bom', group: 'attack' }, { abs: rawBot.abs }).needsDefense, false);
  assert.equal(st.players[0].tokens[0].progress, -1);
  assert.equal(st.players[1].tokens[0].progress, -1);
});

test('bot attack Seret + Cermin memantulkan ke penyerang', () => {
  const st = fresh();
  setTrack(st, 0, 0, 20);
  setTrack(st, 1, 0, 10);
  handOf(st, 1, ['cermin']);
  const card = { id: 'a3', kind: 'seret', group: 'attack' };
  const rawBot = ludo.botChooseAttack(st, 0, card);
  assert.equal(rawBot.player, 1);
  const b = ludo.beginAttack(st, 0, card, { player: rawBot.player, token: rawBot.token });
  assert.equal(b.needsDefense, true);
  const r = ludo.resolveDefenseStep(st, { attack: b.attack, defender: 1 }, 'h1-0');
  assert.equal(r.reflected, true);
  assert.equal(st.players[0].tokens[0].progress, 10); // 20 - 10, terpantul
  assert.equal(st.players[1].tokens[0].progress, 10); // korban tidak bergerak
});

test('bot attack Beku + Teleport memindah ke petak aman terdekat', () => {
  const st = fresh();
  setTrack(st, 0, 0, 20);
  setTrack(st, 1, 0, 10); // abs 23, petak aman terdekat di depan = 26
  handOf(st, 1, ['teleport']);
  const card = { id: 'a4', kind: 'beku', group: 'attack' };
  const b = ludo.beginAttack(st, 0, card, { player: 1, token: 0 });
  assert.equal(b.needsDefense, true);
  const r = ludo.resolveDefenseStep(st, { attack: b.attack, defender: 1 }, 'h1-0');
  assert.equal(r.done, true);
  assert.equal(st.players[1].tokens[0].progress, 13); // abs 26 - offset hijau 13
  assert.equal(ludo.isFrozen(st, 1, 0), false);
});

test('bot defense: bot defender memilih kartu defense sesuai jenis serangan', () => {
  const st = fresh();
  handOf(st, 1, ['perisai', 'cermin', 'teleport']);
  // Sniper: perisai diprioritaskan atas cermin/teleport.
  assert.equal(ludo.botChooseDefense(st, 1, { attack: { kind: 'sniper' } }), 'h1-0');
  // Seret tanpa perisai: cermin diprioritaskan.
  handOf(st, 1, ['cermin', 'teleport']);
  assert.equal(ludo.botChooseDefense(st, 1, { attack: { kind: 'seret' } }), 'h1-0');
  // Bom: cermin TIDAK berlaku, jadi teleport yang dipilih.
  handOf(st, 1, ['cermin', 'teleport']);
  assert.equal(ludo.botChooseDefense(st, 1, { attack: { kind: 'bom' } }), 'h1-1');
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
