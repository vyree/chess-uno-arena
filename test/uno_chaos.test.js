'use strict';
// 2026-10-30 (Sensei): level Chaos baru + normal/hard tanpa ungu.
// - normal/hard: 4 warna (tanpa purple), deck 108.
// - chaos: 5 warna, wild x5, wild4 x5, reverseBlack x2, nullWhite x2,
//   TANPA negate/reset, TANPA extra draw2 -> deck 139. Aturan tumpukan
//   ikut hard (eskalasi). Jendela teriakan UNO! tetap ada.
// - hell: tidak berubah (159).
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

const count = (deck, k) => deck.filter((c) => c.kind === k).length;
const num = (id, color, value) => ({ id, color, kind: 'number', value });
const wild = (id) => ({ id, color: null, kind: 'wild', value: null });

// ---------- modeColors ----------

test('modeColors: normal/hard 4 warna tanpa purple; chaos/hell 5 warna', () => {
  assert.deepEqual(U.modeColors('normal'), ['red', 'yellow', 'green', 'blue']);
  assert.deepEqual(U.modeColors('hard'), ['red', 'yellow', 'green', 'blue']);
  assert.deepEqual(U.modeColors('chaos'), ['red', 'yellow', 'green', 'blue', 'purple']);
  assert.deepEqual(U.modeColors('hell'), ['red', 'yellow', 'green', 'blue', 'purple']);
  assert.deepEqual(U.MODES, ['normal', 'hard', 'chaos', 'hell']);
});

// ---------- deck composition ----------

test('deck normal/hard = 108: tanpa purple sama sekali', () => {
  for (const mode of ['normal', 'hard']) {
    const d = U.buildDeck(mode);
    assert.equal(d.length, 108, mode);
    assert.equal(d.filter((c) => c.color === 'purple').length, 0, mode);
    assert.equal(count(d, 'wild'), 4, mode);
    assert.equal(count(d, 'wild4'), 4, mode);
    assert.equal(count(d, 'draw2'), 8, mode); // 2 per warna x 4 warna
  }
});

test('deck chaos = 139: wild x5, wild4 x5, hitam/putih x2, tanpa negate/reset', () => {
  const d = U.buildDeck('chaos');
  assert.equal(d.length, 139);
  assert.equal(count(d, 'wild'), 5);
  assert.equal(count(d, 'wild4'), 5);
  assert.equal(count(d, 'reverseBlack'), 2);
  assert.equal(count(d, 'nullWhite'), 2);
  assert.equal(count(d, 'reset'), 0);
  assert.equal(count(d, 'negate'), 0);
  assert.equal(count(d, 'draw2'), 10); // 2 per warna x 5 warna, tanpa extra
  assert.equal(d.filter((c) => c.color === 'purple').length, 25); // 1 set ungu
  const ids = new Set(d.map((c) => c.id));
  assert.equal(ids.size, 139);
});

test('deck hell tetap 159 (tidak berubah)', () => {
  assert.equal(U.buildDeck('hell').length, 159);
});

// ---------- pile rules: chaos follows hard ----------

function pileGame(mode) {
  const st = U.newGame(3, { rand: rng(7), mode });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = 0;
  // force a +2 pile
  st.hands[0] = [num('a', 'red', 1), { id: 'p1', color: 'red', kind: 'draw2', value: null }];
  st.hands[1] = [num('b', 'blue', 2)];
  st.hands[2] = [num('c', 'green', 3)];
  const r = U.playCard(st, 0, 'p1', {});
  assert.equal(r.ok, true);
  assert.equal(st.pendingKind, 'draw2');
  assert.equal(st.pendingDraw, 2);
  return st;
}

test('chaos: tumpukan +2 bisa dieskalasi +4 seperti hard', () => {
  for (const mode of ['hard', 'chaos']) {
    const st = pileGame(mode);
    st.turn = 1;
    st.hands[1] = [{ id: 'w4', color: null, kind: 'wild4', value: null }, num('b', 'blue', 2)];
    const stackable = st.hands[1].filter((c) => U.isStackCard(st, c)).map((c) => c.kind);
    assert.deepEqual(stackable, ['wild4'], mode);
  }
});

test('normal: tumpukan +2 TIDAK bisa dijawab +4', () => {
  const st = pileGame('normal');
  st.turn = 1;
  st.hands[1] = [{ id: 'w4', color: null, kind: 'wild4', value: null }, num('b', 'blue', 2)];
  const stackable = st.hands[1].filter((c) => U.isStackCard(st, c));
  assert.equal(stackable.length, 0);
});

// ---------- wildColor legality per mode ----------

function wildPlay(mode, color) {
  const st = U.newGame(2, { rand: rng(11), mode });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.turn = 0;
  st.hands[0] = [wild('w1'), num('a', 'red', 1)];
  return U.playCard(st, 0, 'w1', { wildColor: color });
}

test('wildColor purple ditolak di normal/hard, diterima di chaos/hell', () => {
  assert.match(wildPlay('normal', 'purple').error, /pilih warna dulu/);
  assert.match(wildPlay('hard', 'purple').error, /pilih warna dulu/);
  assert.equal(wildPlay('chaos', 'purple').ok, true);
  assert.equal(wildPlay('hell', 'purple').ok, true);
  assert.equal(wildPlay('normal', 'blue').ok, true);
});

// ---------- bot color choice respects mode ----------

test('bot chooseWildColor tidak pernah pilih purple di normal/hard', () => {
  for (const mode of ['normal', 'hard']) {
    const st = U.newGame(2, { rand: rng(13), mode });
    // rig hand: only purple + red cards so a naive bot would pick purple
    st.hands[0] = [
      num('p1', 'purple', 3), num('p2', 'purple', 7),
      num('r1', 'red', 1),
    ];
    // chaos/hell deck would have purple; force-check the chooser directly
    const pick = bot.chooseWildColor(st, 0);
    assert.notEqual(pick, 'purple', mode);
  }
  const stc = U.newGame(2, { rand: rng(13), mode: 'chaos' });
  stc.hands[0] = [num('p1', 'purple', 3), num('p2', 'purple', 7), num('r1', 'red', 1)];
  assert.equal(bot.chooseWildColor(stc, 0), 'purple');
});
