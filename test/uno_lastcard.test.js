'use strict';
// 2026-10-30 (Sensei, additive rule): Negate!/Reset! gain a last-card play
// path. On your own turn with exactly 1 card left (the special itself) and
// no pending pile, they play like a Wild: effect disabled, caster picks the
// color, then finish (unlimited) or win (normal). The UNO! window path is
// unchanged (still needs 2+ cards in hand).
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
const reset = (id) => ({ id, color: null, kind: 'reset', value: null });
const negate = (id) => ({ id, color: null, kind: 'negate', value: null });

function hellTurn(seed, n, seat) {
  const st = U.newGame(n, { rand: rng(seed), mode: 'hell' });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = seat;
  return st;
}

test('canPlay: spesial hidup hanya sebagai kartu terakhir di giliran sendiri tanpa tumpukan', () => {
  const st = hellTurn(11, 4, 0);
  st.hands[0] = [negate('n1')];
  assert.equal(U.canPlay(st, 0, st.hands[0][0]), true);
  st.hands[0] = [negate('n1'), num('a', 'red', 1)];
  assert.equal(U.canPlay(st, 0, st.hands[0][0]), false);
  st.hands[0] = [negate('n1')];
  st.pendingDraw = 2; st.pendingKind = 'draw2';
  assert.equal(U.canPlay(st, 0, st.hands[0][0]), false);
  st.pendingDraw = 0; st.pendingKind = null;
  st.turn = 1;
  assert.equal(U.canPlay(st, 0, st.hands[0][0]), false);
  st.turn = 0;
  st.negateUses = 2;
  assert.equal(U.canPlay(st, 0, st.hands[0][0]), false);
});

test('playCard: kartu terakhir negate tanpa warna ditolak; dengan warna menang (normal)', () => {
  const st = hellTurn(12, 3, 0);
  st.hands[0] = [negate('n1')];
  assert.equal(U.playCard(st, 0, 'n1', {}).error, 'pilih warna dulu');
  const r = U.playCard(st, 0, 'n1', { wildColor: 'blue' });
  assert.equal(r.ok, true);
  assert.equal(r.won, true);
  assert.equal(st.over.winner, 0);
  assert.equal(st.currentColor, 'blue');
  assert.equal(st.negateUses, 1);
  assert.equal(st.turnCount, 1);
});

test('playCard: kartu terakhir reset — efek DISABLED (tangan lawan utuh), finis di unlimited', () => {
  const st = U.newGame(3, { rand: rng(13), mode: 'hell', unlimited: true });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = 0;
  st.hands[0] = [reset('r1')];
  const before1 = st.hands[1].map((c) => c.id);
  const before2 = st.hands[2].map((c) => c.id);
  const r = U.playCard(st, 0, 'r1', { wildColor: 'purple' });
  assert.equal(r.ok, true);
  assert.equal(r.finished.rank, 1);
  assert.equal(st.currentColor, 'purple');
  assert.equal(st.resetUses, 1);
  // effect disabled: no reshuffle — opponents keep their exact cards
  assert.deepEqual(st.hands[1].map((c) => c.id), before1);
  assert.deepEqual(st.hands[2].map((c) => c.id), before2);
  // game continues with the next active seat
  assert.equal(st.over, null);
  assert.equal(st.turn, 1);
});

test('playCard: jatah habis — kartu terakhir spesial ditolak', () => {
  const st = hellTurn(14, 3, 0);
  st.hands[0] = [negate('n1')];
  st.negateUses = 2;
  assert.equal(U.playCard(st, 0, 'n1', { wildColor: 'red' }).error, 'jatah kartu spesial ini sudah habis');
});

test('playCard: spesial bukan kartu terakhir tetap ditolak di giliran biasa', () => {
  const st = hellTurn(15, 3, 0);
  st.hands[0] = [reset('r1'), num('a', 'green', 3)];
  const r = U.playCard(st, 0, 'r1', { wildColor: 'green' });
  assert.equal(r.ok, false);
  assert.match(r.error, /sebagai kartu terakhirmu/);
});

test('bot: kartu terakhir spesial dimainkan dengan warna valid', () => {
  const st = hellTurn(16, 3, 1);
  st.hands[1] = [reset('r1')];
  const log = bot.takeTurn(st, 1);
  assert.equal(log[0].action, 'play');
  assert.equal(log[0].r.ok, true);
  assert.ok(U.COLORS.includes(st.currentColor));
  assert.equal(st.resetUses, 1);
});

test('toClient: playable menandai kartu terakhir spesial; window tetap tertutup', () => {
  const st = hellTurn(17, 3, 0);
  st.hands[0] = [negate('n1')];
  const c = U.toClient(st, 0);
  assert.equal(c.playable[0], true);
  assert.equal(c.canNegate, false);
  assert.equal(c.canReset, false);
});
