'use strict';
// Misi 10 (Sensei 2026-10-23, built 2026-10-26): UNO Unlimited toggle +
// Reset (Hell x2) + Negate! (Hell x2). Deck baseline after the purple
// set: normal/hard 133, hell 159 (155 + Reset x2 + Negate! x2).
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../game/uno.js');
const bot = require('../game/bot.js');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const num = (id, color, value) => ({ id, color, kind: 'number', value });
const d2 = (id, color) => ({ id, color, kind: 'draw2', value: null });
const skip = (id, color) => ({ id, color, kind: 'skip', value: null });
const reset = (id) => ({ id, color: null, kind: 'reset', value: null });
const negate = (id) => ({ id, color: null, kind: 'negate', value: null });

// ---------- deck ----------

test('deck hell = 159: reset x2, negate x2, mode lain 133 tanpa keduanya', () => {
  const count = (deck, k) => deck.filter((c) => c.kind === k).length;
  const hell = U.buildDeck('hell');
  assert.equal(hell.length, 159);
  assert.equal(count(hell, 'reset'), 2);
  assert.equal(count(hell, 'negate'), 2);
  assert.equal(count(hell, 'draw2'), 20);
  assert.equal(count(hell, 'wild4'), 8);
  assert.equal(U.buildDeck('normal').length, 133);
  assert.equal(count(U.buildDeck('normal'), 'reset'), 0);
  assert.equal(count(U.buildDeck('normal'), 'negate'), 0);
  assert.equal(U.buildDeck('hard').length, 133);
});

// ---------- Reset (revised 2026-10-26: UNO! window card, NOT a pile answer) ----------

test('reset: mati di giliran biasa (tangan >1) DAN melawan tumpukan; hanya hidup di jendela Uno! atau sebagai kartu terakhir', () => {
  const st = U.newGame(4, { rand: rng(3), mode: 'hell' });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = 0;
  st.hands[0] = [reset('r1'), num('a', 'red', 1)];
  assert.equal(U.canPlay(st, 0, st.hands[0][0]), false);
  assert.equal(U.playCard(st, 0, 'r1', {}).error, 'reset hanya bisa dipakai saat ada yang teriak Uno! atau sebagai kartu terakhirmu');
  st.pendingDraw = 4;
  st.pendingKind = 'wild4';
  assert.equal(U.canPlay(st, 0, st.hands[0][0]), false);
  assert.equal(U.isStackCard(st, st.hands[0][0]), false);
  assert.equal(U.playCard(st, 0, 'r1', {}).error, 'reset hanya bisa dipakai saat ada yang teriak Uno! atau sebagai kartu terakhirmu');
  assert.equal(U.playReset(st, 0, 'r1').error, 'tidak ada jendela Uno!');
});

test('playReset: semua tangan + discard dikocok ulang, tumpukan ikut nol, pengaktif jalan duluan', () => {
  const st = U.newGame(4, { rand: rng(3), mode: 'hell' });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = 0;
  st.hands[0] = [num('a1', 'red', 9), num('a2', 'blue', 3)];
  const shout = U.playCard(st, 0, 'a1', { saidUno: true });
  assert.equal(shout.ok, true);
  assert.deepEqual(st.negateWindow, { victim: 0 });
  // a pile is still pending while the window is open (victim stacked to 1)
  st.pendingDraw = 6;
  st.pendingKind = 'wild4';
  st.hands[1] = [reset('r1'), num('b', 'blue', 2)];
  st.hands[2] = [num('c', 'green', 3)];
  st.hands[3] = [num('d', 'yellow', 4)];
  const r = U.playReset(st, 1, 'r1');
  assert.equal(r.ok, true);
  assert.equal(st.over, null);
  assert.equal(st.pendingDraw, 0);
  assert.equal(st.pendingKind, null);
  assert.equal(st.negateWindow, null);
  assert.equal(st.resetUses, 1);
  for (const h of st.hands) assert.equal(h.length, 7);
  assert.equal(U.topCard(st).kind, 'number');
  assert.equal(st.currentColor, U.topCard(st).color);
  assert.equal(st.turn, 1);
  assert.equal(r.events.some((e) => e.type === 'reset'), true);
});

test('playReset: ditolak — bukan reset / tangan 1 / jatah habis', () => {
  const st = U.newGame(4, { rand: rng(3), mode: 'hell' });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = 0;
  st.hands[0] = [num('a1', 'red', 9), num('a2', 'blue', 3)];
  U.playCard(st, 0, 'a1', { saidUno: true });
  st.hands[1] = [num('b', 'blue', 2), num('b2', 'green', 2)];
  assert.equal(U.playReset(st, 1, 'b').error, 'bukan kartu reset');
  st.hands[2] = [reset('r2')]; // kartu terakhir — tidak bisa jadi pengaktif
  assert.equal(U.playReset(st, 2, 'r2').error, 'reset butuh minimal 2 kartu di tangan');
  st.resetUses = 2;
  st.hands[3] = [reset('r3'), num('d', 'yellow', 4)];
  assert.equal(U.playReset(st, 3, 'r3').error, 'jatah reset habis');
});

test('jendela Uno!: respons pertama menang — reset setelah negate ditolak', () => {
  const st = U.newGame(4, { rand: rng(3), mode: 'hell' });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = 0;
  st.hands[0] = [num('a1', 'red', 9), num('a2', 'blue', 3)];
  U.playCard(st, 0, 'a1', { saidUno: true });
  st.hands[1] = [negate('n1'), num('b', 'blue', 2)];
  st.hands[2] = [reset('r2'), num('c', 'green', 3)];
  const n = U.playNegate(st, 1, 'n1');
  assert.equal(n.ok, true);
  assert.equal(st.negateWindow, null);
  assert.equal(U.playReset(st, 2, 'r2').error, 'tidak ada jendela Uno!');
});

// ---------- Negate! ----------

function unoWindowState() {
  const st = U.newGame(4, { rand: rng(7), mode: 'hell' });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = 0;
  st.hands[0] = [num('a1', 'red', 9), num('a2', 'blue', 3)];
  const r = U.playCard(st, 0, 'a1', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(r.events.some((e) => e.type === 'uno'), true);
  assert.deepEqual(st.negateWindow, { victim: 0 });
  return st;
}

test('jendela negate terbuka saat ada yang teriak UNO!', () => {
  const st = unoWindowState();
  assert.equal(st.negateSeq, 1);
  assert.equal(st.hands[0].length, 1);
});

test('playNegate: ditolak tanpa jendela / bukan negate / tangan 1 / jatah habis', () => {
  const st = U.newGame(4, { rand: rng(7), mode: 'hell' });
  st.hands[1] = [negate('n1'), num('b', 'blue', 2)];
  assert.match(U.playNegate(st, 1, 'n1').error, /tidak ada jendela/);
  st.negateWindow = { victim: 0 };
  assert.match(U.playNegate(st, 1, 'b').error, /bukan kartu negate/);
  st.hands[1] = [negate('n1')];
  assert.match(U.playNegate(st, 1, 'n1').error, /minimal 2 kartu/);
  st.hands[1] = [negate('n1'), num('b', 'blue', 2)];
  st.negateUses = 2;
  assert.match(U.playNegate(st, 1, 'n1').error, /jatah negate habis/);
});

test('playNegate + hadiah: semua non-korban memberi 1, korban +2', () => {
  const st = unoWindowState();
  st.hands[1] = [negate('n1'), num('b1', 'blue', 2)];
  st.hands[2] = [num('c1', 'green', 5), num('c2', 'red', 3)];
  st.hands[3] = [num('d1', 'yellow', 9), num('d2', 'blue', 1)];
  const r = U.playNegate(st, 1, 'n1');
  assert.equal(r.ok, true);
  assert.equal(st.negateWindow, null);
  assert.equal(st.negateUses, 1);
  assert.deepEqual(st.giftPhase.pending, [1, 2, 3]); // caster ikut memberi
  assert.equal(st.giftPhase.victim, 0);
  assert.equal(U.giveCard(st, 2, 'c1').ok, true);
  assert.equal(U.giveCard(st, 1, 'b1').ok, true);
  const last = U.giveCard(st, 3, 'd1');
  assert.equal(last.ok, true);
  assert.equal(st.giftPhase, null);
  // korban: 1 kartu sisa + 3 hadiah + 2 tarik = 6
  assert.equal(st.hands[0].length, 6);
  assert.equal(last.events.some((e) => e.type === 'negateResolved' && e.given === 3 && e.drawn === 2), true);
});

test('timeout hadiah: pending memberi kartu terendah otomatis', () => {
  const st = unoWindowState();
  st.hands[1] = [negate('n1'), num('b1', 'blue', 9), num('b2', 'blue', 2)];
  st.hands[2] = [num('c1', 'green', 5), num('c2', 'red', 3)];
  st.hands[3] = [num('d1', 'yellow', 9), num('d2', 'blue', 1)];
  assert.equal(U.playNegate(st, 1, 'n1').ok, true);
  const r = U.resolveGiftTimeout(st);
  assert.equal(r.ok, true);
  assert.equal(st.giftPhase, null);
  assert.equal(st.hands[0].length, 6);
  const victimIds = st.hands[0].map((c) => c.id);
  assert.equal(victimIds.includes('b2'), true); // terendah seat 1
  assert.equal(victimIds.includes('c2'), true); // terendah seat 2
  assert.equal(victimIds.includes('d2'), true); // terendah seat 3
});

test('cancelGiftPhase: hadiah kembali ke pemilik', () => {
  const st = unoWindowState();
  st.hands[1] = [negate('n1'), num('b1', 'blue', 2)];
  st.hands[2] = [num('c1', 'green', 5), num('c2', 'red', 3)];
  st.hands[3] = [num('d1', 'yellow', 9)];
  assert.equal(U.playNegate(st, 1, 'n1').ok, true);
  assert.equal(U.giveCard(st, 2, 'c1').ok, true);
  U.cancelGiftPhase(st);
  assert.equal(st.giftPhase, null);
  assert.equal(st.hands[2].map((c) => c.id).includes('c1'), true);
});

test('closeNegateWindow: tanpa negate, game lanjut', () => {
  const st = unoWindowState();
  assert.equal(U.closeNegateWindow(st), true);
  assert.equal(st.negateWindow, null);
  assert.equal(U.closeNegateWindow(st), false);
});

// ---------- Unlimited ----------

test('unlimited: finis bukan menang — skor = sisa lawan + bonus peringkat', () => {
  const st = U.newGame(4, { rand: rng(11), mode: 'normal', unlimited: true });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = 0;
  st.hands[0] = [num('a', 'red', 9)];
  st.hands[1] = [num('b', 'red', 3)];
  st.hands[2] = [num('c', 'red', 5)];
  st.hands[3] = [num('d1', 'red', 7), num('d2', 'blue', 1)];
  const r1 = U.playCard(st, 0, 'a', { saidUno: true });
  assert.equal(r1.ok, true);
  assert.equal(st.over, null);
  assert.deepEqual(r1.finished, { player: 0, rank: 1, score: 3 + 5 + 8 + 350 });
  assert.equal(st.turn, 1);
  const r2 = U.playCard(st, 1, 'b', { saidUno: true });
  assert.deepEqual(r2.finished, { player: 1, rank: 2, score: 5 + 8 + 300 });
  assert.equal(st.turn, 2);
  const r3 = U.playCard(st, 2, 'c', { saidUno: true });
  assert.equal(r3.gameOver, true);
  assert.deepEqual(r3.finished, { player: 2, rank: 3, score: 8 + 250 });
  assert.equal(st.over.reason, 'unlimited');
  assert.equal(st.over.winner, 0);
  assert.equal(st.over.loser, 3);
  assert.equal(st.scores[3], 0);
  const scores = [0, 0, 0, 0];
  assert.equal(U.scoreRound(st, scores), 366);
  assert.deepEqual(scores, [366, 313, 258, 0]);
});

test('unlimited: kartu skip sebagai finis tetap melewati 1 pemain aktif', () => {
  const st = U.newGame(3, { rand: rng(11), mode: 'normal', unlimited: true });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = 0;
  st.hands[0] = [skip('s', 'red')];
  st.hands[1] = [num('b', 'red', 1)];
  st.hands[2] = [num('c', 'red', 2), num('c2', 'blue', 2)];
  const r = U.playCard(st, 0, 's', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(st.over, null);
  assert.equal(st.turn, 2); // pemain 1 dilewati
});

// ---------- bot ----------

test('bot: reset tidak lagi menjawab tumpukan; lowestCard untuk hadiah', () => {
  const st = U.newGame(4, { rand: rng(3), mode: 'hell' });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = 1;
  st.pendingDraw = 6;
  st.pendingKind = 'wild4';
  st.hands[1] = [reset('r1'), num('a', 'red', 1), num('b', 'blue', 2)];
  const playable = st.hands[1].filter((c) => U.canPlay(st, 1, c));
  assert.deepEqual(playable, []); // reset keluar dari daftar playable tumpukan
  assert.equal(bot.lowestCard([num('x', 'red', 9), skip('y', 'blue'), num('z', 'green', 2)]).id, 'z');
});

// ---------- WS validate allowlist (regresi bug live 2026-10-27) ----------
// Penyebab bug: server.js memvalidasi SETIAP pesan lewat validateMessage
// SEBELUM routing; route uno_negate/uno_gift/uno_reset ada di switch tapi
// tidak ada di VALIDATORS, sehingga semua aksi jendela ditolak live dengan
// 'perintah tidak dikenal' — padahal tes engine/server lulus 143/143.
// Tes ini mengunci gerbang validasi untuk ketiga aksi jendela.

const { validateMessage } = require('../game/validate.js');

test('validateMessage: menerima uno_negate/uno_gift/uno_reset; menolak tipe asing', () => {
  for (const type of ['uno_negate', 'uno_gift', 'uno_reset']) {
    const r = validateMessage(JSON.stringify({ type, data: { cardId: 'c1' } }));
    assert.equal(r.ok, true, type);
    assert.equal(r.type, type);
    assert.equal(r.data.cardId, 'c1');
  }
  const bad = validateMessage(JSON.stringify({ type: 'uno_reset', data: {} }));
  assert.equal(bad.ok, false); // cardId wajib
  const unknown = validateMessage(JSON.stringify({ type: 'uno_curang', data: {} }));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'perintah tidak dikenal: uno_curang');
});
