'use strict';
// Misi 2 Fase 2: server-side UNO bot — legal moves, stacking-aware, UNO calls,
// and full bot-vs-bot games must always terminate with a valid winner.
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../game/uno.js');
const B = require('../game/bot.js');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const num = (id, color, value) => ({ id, color, kind: 'number', value });
const d2 = (id, color) => ({ id, color, kind: 'draw2', value: null });
const w4 = (id) => ({ id, color: null, kind: 'wild4', value: null });

// 4-player game, red 5 on top, bot sits at seat 0
function botGame(hands, opts) {
  const st = U.newGame(4, { rand: rng(7), ...(opts || {}) });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  hands.forEach((h, i) => { st.hands[i] = h; });
  st.turn = 0;
  st.pendingDraw = 0;
  st.pendingKind = null;
  return st;
}

test('bot memainkan kartu yang legal dan giliran maju', () => {
  const st = botGame([
    [num('a1', 'red', 7), num('a2', 'blue', 2), num('a3', 'green', 3)],
    [num('b1', 'red', 1)], [num('c1', 'red', 2)], [num('d1', 'red', 3)],
  ]);
  const log = B.takeTurn(st, 0);
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'play');
  assert.equal(log[0].r.ok, true);
  assert.equal(st.hands[0].length, 2);
  assert.notEqual(st.turn, 0);
});

test('bot menumpuk +2 saat menghadapi tumpukan dan punya kartu sejenis', () => {
  const st = botGame([
    [d2('a1', 'blue'), num('a2', 'green', 3), num('a3', 'yellow', 4)],
    [num('b1', 'red', 1)], [num('c1', 'red', 2)], [num('d1', 'red', 3)],
  ]);
  st.pendingDraw = 2;
  st.pendingKind = 'draw2';
  const log = B.takeTurn(st, 0);
  assert.equal(log[0].action, 'play');
  assert.equal(log[0].r.ok, true);
  assert.equal(st.pendingDraw, 4);
  assert.equal(st.pendingKind, 'draw2');
});

test('bot mengambil tumpukan bila tidak punya kartu penumpuk', () => {
  const st = botGame([
    [num('a1', 'red', 7), num('a2', 'blue', 2), num('a3', 'green', 3)],
    [num('b1', 'red', 1)], [num('c1', 'red', 2)], [num('d1', 'red', 3)],
  ]);
  st.pendingDraw = 2;
  st.pendingKind = 'draw2';
  const before = st.hands[0].length;
  const log = B.takeTurn(st, 0);
  assert.equal(log[0].action, 'draw');
  assert.equal(log[0].r.lostTurn, true);
  assert.equal(st.hands[0].length, before + 2);
  assert.equal(st.pendingDraw, 0);
});

test('bot mendeklarasikan UNO: turun ke 1 kartu tanpa penalti', () => {
  const st = botGame([
    [num('a1', 'red', 9), num('a2', 'blue', 2)],
    [num('b1', 'red', 1)], [num('c1', 'red', 2)], [num('d1', 'red', 3)],
  ]);
  const log = B.takeTurn(st, 0);
  assert.equal(log[0].action, 'play');
  assert.equal(st.hands[0].length, 1);
  assert.ok(!log[0].r.penalty);
  assert.ok(log[0].r.events.some((e) => e.type === 'uno'));
});

test('bot menyerang dengan +2 saat pemain berikutnya sisa 2 kartu', () => {
  const st = botGame([
    [num('a1', 'red', 9), d2('a2', 'red'), num('a3', 'green', 3)],
    [num('b1', 'red', 1), num('b2', 'blue', 2)],
    [num('c1', 'red', 2)], [num('d1', 'red', 3)],
  ]);
  const log = B.takeTurn(st, 0);
  assert.equal(log[0].action, 'play');
  assert.equal(st.pendingDraw, 2); // the draw2 was chosen over the red 9
});

test('chooseWildColor memilih warna terbanyak di tangan', () => {
  const st = botGame([
    [num('a1', 'blue', 1), num('a2', 'blue', 2), num('a3', 'red', 3), w4('a4')],
    [num('b1', 'red', 1)], [num('c1', 'red', 2)], [num('d1', 'red', 3)],
  ]);
  assert.equal(B.chooseWildColor(st, 0), 'blue');
});

test('bot-vs-bot: game selesai dengan pemenang valid di semua ukuran meja', () => {
  for (const n of [2, 4, 6, 8]) {
    for (const seed of [1, 2, 3]) {
      const st = U.newGame(n, { rand: rng(seed * 100 + n) });
      let steps = 0;
      while (!st.over && steps < 10000) {
        const log = B.takeTurn(st, st.turn);
        assert.ok(log.length >= 1, `n=${n} seed=${seed}: bot tidak bergerak`);
        for (const a of log) assert.equal(a.r.ok, true);
        steps++;
      }
      assert.ok(st.over, `n=${n} seed=${seed}: game tidak selesai dalam ${steps} langkah`);
      assert.ok(st.over.winner >= 0 && st.over.winner < n);
    }
  }
});

test('bot-vs-bot: mode ekstrim juga selesai normal', () => {
  const st = U.newGame(4, { rand: rng(42), extreme: true });
  let steps = 0;
  while (!st.over && steps < 10000) {
    B.takeTurn(st, st.turn);
    steps++;
  }
  assert.ok(st.over);
});
