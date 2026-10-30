'use strict';
// Misi 2 (Sensei 2026-10-21): strict +2/+4 stacking, 2-8 players.
// Misi 5 (Sensei 2026-10-22): mode rules CORRECTED — normal: +4 can never
// be stacked; hard (was "ekstrim"): +2 escalates to +4, +4 answers +4
// only; hell: hard rules + fatter deck + Reverse Black & Null White.
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../game/uno.js');

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

// 4-player game, red 5 on top, crafted hands for stacking scenarios
function stackGame(opts) {
  const st = U.newGame(4, { rand: rng(99), ...(opts || {}) });
  st.discard = [num('t', 'red', 5)];
  st.currentColor = 'red';
  st.hands[0] = [d2('a1', 'red'), num('a2', 'red', 1), num('a3', 'blue', 2)];
  st.hands[1] = [d2('b1', 'blue'), num('b2', 'green', 3), num('b3', 'yellow', 4)];
  st.hands[2] = [w4('c1'), num('c2', 'red', 5), num('c3', 'green', 6)];
  st.hands[3] = [num('d1', 'red', 7), num('d2x', 'blue', 8), num('d3', 'green', 9)];
  st.turn = 0;
  return st;
}

test('8 pemain: 7 kartu each, deck cukup', () => {
  const st = U.newGame(8, rng(5));
  assert.equal(st.hands.length, 8);
  for (const h of st.hands) assert.equal(h.length, 7);
  assert.equal(st.deck.length, 108 - 56 - 1);
});

test('+2 memulai tumpukan: pendingKind tercatat, giliran maju', () => {
  const st = stackGame();
  const r = U.playCard(st, 0, 'a1', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(st.pendingDraw, 2);
  assert.equal(st.pendingKind, 'draw2');
  assert.equal(st.turn, 1);
});

test('stacking ketat: +2 beda warna BOLEH menumpuk +2', () => {
  const st = stackGame();
  U.playCard(st, 0, 'a1', { saidUno: true });
  const r = U.playCard(st, 1, 'b1', { saidUno: true }); // blue +2 on red +2 pile
  assert.equal(r.ok, true);
  assert.equal(st.pendingDraw, 4);
  assert.equal(st.pendingKind, 'draw2');
  assert.equal(st.turn, 2);
  assert.ok(r.events.some((e) => e.type === 'stack' && e.total === 4));
});

test('stacking ketat: +4 TIDAK bisa menumpuk tumpukan +2', () => {
  const st = stackGame();
  U.playCard(st, 0, 'a1', { saidUno: true });
  U.playCard(st, 1, 'b1', { saidUno: true });
  const r = U.playCard(st, 2, 'c1', { saidUno: true, wildColor: 'red' });
  assert.equal(r.ok, false);
  assert.match(r.error, /sejenis/);
  const r2 = U.playCard(st, 2, 'c2', { saidUno: true }); // kartu biasa juga ditolak
  assert.equal(r2.ok, false);
});

test('pemain tanpa kartu penumpuk mengambil TOTAL tumpukan & kehilangan giliran', () => {
  const st = stackGame();
  U.playCard(st, 0, 'a1', { saidUno: true });
  U.playCard(st, 1, 'b1', { saidUno: true });
  const before = st.hands[2].length;
  const r = U.drawCard(st, 2);
  assert.equal(r.ok, true);
  assert.equal(r.drew, 4);
  assert.equal(r.lostTurn, true);
  assert.equal(st.hands[2].length, before + 4);
  assert.equal(st.pendingDraw, 0);
  assert.equal(st.pendingKind, null);
  assert.equal(st.turn, 3);
  assert.ok(r.events.some((e) => e.type === 'drawPenalty' && e.n === 4));
});

test('mode hard: rantai +4 — +4 menumpuk +4 (total 8), +2 ditolak', () => {
  const st = stackGame({ mode: 'hard' });
  st.hands[0] = [w4('a1'), num('a2', 'red', 1), num('a3', 'blue', 2)];
  st.hands[1] = [w4('b1'), num('b2', 'green', 3), num('b3', 'yellow', 4)];
  const r1 = U.playCard(st, 0, 'a1', { saidUno: true, wildColor: 'red' });
  assert.equal(r1.ok, true);
  assert.equal(st.pendingDraw, 4);
  assert.equal(st.pendingKind, 'wild4');
  const r2 = U.playCard(st, 1, 'b1', { saidUno: true, wildColor: 'blue' });
  assert.equal(r2.ok, true);
  assert.equal(st.pendingDraw, 8);
  assert.equal(st.currentColor, 'blue');
  st.hands[2] = [d2('c9', 'red'), num('c2', 'red', 5), num('c3', 'green', 6)];
  const r3 = U.playCard(st, 2, 'c9', { saidUno: true }); // +2 tidak bisa menjawab +4
  assert.equal(r3.ok, false);
  assert.match(r3.error, /dijawab \+4/);
});

test('mode normal: +4 TIDAK bisa ditumpuk sama sekali — korban langsung ambil 4', () => {
  const st = stackGame(); // default mode: normal
  assert.equal(st.mode, 'normal');
  st.hands[0] = [w4('a1'), num('a2', 'red', 1), num('a3', 'blue', 2)];
  const r1 = U.playCard(st, 0, 'a1', { saidUno: true, wildColor: 'red' });
  assert.equal(r1.ok, true);
  assert.equal(st.pendingDraw, 4);
  // pemain 1 pegang +4 juga — tetap tidak bisa menumpuk di mode normal
  st.hands[1] = [w4('b1'), num('b2', 'green', 3), num('b3', 'yellow', 4)];
  assert.equal(U.canPlay(st, 1, st.hands[1][0]), false);
  const r2 = U.playCard(st, 1, 'b1', { saidUno: true, wildColor: 'blue' });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /mode normal/);
  const r3 = U.drawCard(st, 1);
  assert.equal(r3.drew, 4);
  assert.equal(st.pendingDraw, 0);
});

test('mode hard: +2 dieskalasi +4 (total 6), lalu rantai terkunci di +4', () => {
  const st = stackGame({ mode: 'hard' });
  st.hands[1] = [w4('b1'), num('b2', 'green', 3), num('b3', 'yellow', 4)];
  U.playCard(st, 0, 'a1', { saidUno: true }); // +2
  const r = U.playCard(st, 1, 'b1', { saidUno: true, wildColor: 'green' }); // eskalasi +4
  assert.equal(r.ok, true);
  assert.equal(st.pendingDraw, 6);
  assert.equal(st.pendingKind, 'wild4');
  const r2 = U.playCard(st, 2, 'c1', { saidUno: true, wildColor: 'red' }); // +4 lagi
  assert.equal(r2.ok, true);
  assert.equal(st.pendingDraw, 10);
});

test('tanpa tumpukan: aturan normal utuh (+2 beda warna & beda simbol ditolak)', () => {
  const st = stackGame();
  const r = U.playCard(st, 0, 'a3', { saidUno: true }); // blue 2 di atas red 5
  assert.equal(r.ok, false);
  assert.match(r.error, /tidak cocok/);
});

test('event uno terbit saat pemain mencapai 1 kartu', () => {
  const st = stackGame();
  st.hands[0] = [num('a1', 'red', 9), num('a2', 'blue', 2)];
  const r = U.playCard(st, 0, 'a1', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(st.hands[0].length, 1);
  assert.ok(r.events.some((e) => e.type === 'uno' && e.player === 0));
  assert.ok(r.events.some((e) => e.type === 'play'));
});

test('simulasi 6 pemain dengan stacking: game selesai, invariant pending terjaga', () => {
  const st = U.newGame(6, { rand: rng(2024) });
  let steps = 0;
  while (!st.over && steps < 20000) {
    steps++;
    if (st.pendingDraw > 0) assert.ok(st.pendingKind, 'pendingDraw tanpa pendingKind');
    if (st.pendingDraw === 0) assert.equal(st.pendingKind, null);
    const p = st.turn;
    const hand = st.hands[p];
    const playable = hand.filter((c) => U.canPlay(st, p, c));
    if (playable.length) {
      const c = playable[0];
      const r = U.playCard(st, p, c.id, { saidUno: hand.length === 2, wildColor: 'red' });
      assert.equal(r.ok, true, 'playCard gagal di simulasi: ' + r.error);
    } else {
      const r = U.drawCard(st, p);
      assert.equal(r.ok, true, 'drawCard gagal di simulasi: ' + r.error);
      if (!r.lostTurn) {
        if (r.playable) {
          const r2 = U.playDrawnCard(st, p, r.card.id, { saidUno: st.hands[p].length === 2, wildColor: 'red' });
          assert.equal(r2.ok, true);
        } else {
          assert.equal(U.passTurn(st, p).ok, true);
        }
      }
    }
  }
  assert.ok(st.over, 'game tidak selesai dalam 20000 langkah');
});

// ---------- Misi 5: Hell mode + Reverse Black + Null White ----------
const rb = (id) => ({ id, color: null, kind: 'reverseBlack', value: null });
const nw = (id) => ({ id, color: null, kind: 'nullWhite', value: null });

test('deck hell = 159: +2 x20, +4 x8, reverseBlack x4, nullWhite x4, reset x2, negate x2 (normal/hard 108, chaos 139)', () => {
  const count = (deck, k) => deck.filter((c) => c.kind === k).length;
  const hell = U.buildDeck('hell');
  assert.equal(hell.length, 159);
  assert.equal(count(hell, 'draw2'), 20);
  assert.equal(count(hell, 'wild4'), 8);
  assert.equal(count(hell, 'reverseBlack'), 4);
  assert.equal(count(hell, 'nullWhite'), 4);
  assert.equal(count(hell, 'reset'), 2);
  assert.equal(count(hell, 'negate'), 2);
  assert.equal(hell.filter((c) => c.color === 'purple').length, 27);
  assert.equal(U.buildDeck('normal').length, 108);
  assert.equal(U.buildDeck('hard').length, 108);
  assert.equal(count(U.buildDeck('normal'), 'reverseBlack'), 0);
});

test('reverse black: mati di giliran biasa, memantul vs tumpukan (arah & korban berbalik)', () => {
  const st = stackGame({ mode: 'hell' });
  st.hands[0] = [d2('a1', 'red'), rb('a9'), num('a2', 'red', 1)];
  // giliran biasa: tidak bisa dimainkan sama sekali
  assert.equal(U.canPlay(st, 0, st.hands[0][1]), false);
  const r0 = U.playCard(st, 0, 'a9', { saidUno: true });
  assert.equal(r0.ok, false);
  assert.match(r0.error, /spesial/);
  U.playCard(st, 0, 'a1', { saidUno: true }); // +2 ke pemain 1
  st.hands[1] = [rb('b1'), num('b2', 'green', 3), num('b3', 'yellow', 4)];
  const r = U.playCard(st, 1, 'b1', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(st.dir, -1); // arah berbalik
  assert.equal(st.pendingDraw, 2); // tumpukan utuh
  assert.equal(st.pendingKind, 'draw2');
  assert.equal(st.turn, 0); // kembali ke pemain 0
  assert.ok(r.events.some((e) => e.type === 'bounce' && e.total === 2));
  // pemain 0 memantulkan balik dengan reverse black-nya sendiri
  const r2 = U.playCard(st, 0, 'a9', { saidUno: true });
  assert.equal(r2.ok, true);
  assert.equal(st.dir, 1);
  assert.equal(st.turn, 1);
  assert.equal(st.pendingDraw, 2);
});

test('null white: tumpukan lenyap final, SEMUA +2 termasuk pemilik, pemilik pilih warna', () => {
  const st = stackGame({ mode: 'hell' });
  st.hands[0] = [w4('a1'), num('a2', 'red', 1), num('a3', 'blue', 2)];
  U.playCard(st, 0, 'a1', { saidUno: true, wildColor: 'red' }); // +4 menggantung
  st.hands[1] = [nw('b1'), num('b2', 'green', 3), num('b3', 'yellow', 4)];
  const before = st.hands.map((h) => h.length);
  const rBad = U.playCard(st, 1, 'b1', { saidUno: true }); // tanpa warna -> ditolak
  assert.equal(rBad.ok, false);
  assert.match(rBad.error, /pilih warna/);
  const r = U.playCard(st, 1, 'b1', { saidUno: true, wildColor: 'green' });
  assert.equal(r.ok, true);
  assert.equal(st.pendingDraw, 0);
  assert.equal(st.pendingKind, null);
  assert.equal(st.currentColor, 'green');
  st.hands.forEach((h, i) => assert.equal(h.length, before[i] + (i === 1 ? 1 : 2))); // pemilik: -1 kartu +2
  assert.ok(r.events.some((e) => e.type === 'nullify' && e.nulled === 4 && e.affected.length === 4));
  assert.equal(st.turn, 2); // pemain berikutnya bebas, tidak menghadapi apa pun
});

test('null white sebagai kartu terakhir TIDAK memenangkan ronde (pajak +2 mengisi lagi)', () => {
  const st = stackGame({ mode: 'hell' });
  st.hands[0] = [w4('a1'), num('a2', 'red', 1), num('a3', 'blue', 2)];
  U.playCard(st, 0, 'a1', { saidUno: true, wildColor: 'red' });
  st.hands[1] = [nw('b1')]; // satu-satunya kartu pemain 1
  const r = U.playCard(st, 1, 'b1', { saidUno: true, wildColor: 'blue' });
  assert.equal(r.ok, true);
  assert.equal(st.over, null);
  assert.equal(st.hands[1].length, 2);
});

test('kartu spesial bernilai 50 poin bila tersisa di tangan', () => {
  assert.equal(U.cardPoints(rb('x')), 50);
  assert.equal(U.cardPoints(nw('y')), 50);
});

test('simulasi hell 6 pemain: game selesai, invariant pending terjaga', () => {
  const st = U.newGame(6, { rand: rng(777), mode: 'hell' });
  let steps = 0;
  while (!st.over && steps < 30000) {
    steps++;
    if (st.pendingDraw > 0) assert.ok(st.pendingKind, 'pendingDraw tanpa pendingKind');
    if (st.pendingDraw === 0) assert.equal(st.pendingKind, null);
    const p = st.turn;
    const hand = st.hands[p];
    const playable = hand.filter((c) => U.canPlay(st, p, c));
    if (playable.length) {
      const c = playable[0];
      const r = U.playCard(st, p, c.id, { saidUno: hand.length === 2, wildColor: 'red' });
      assert.equal(r.ok, true, 'playCard gagal di simulasi hell: ' + r.error);
    } else {
      const r = U.drawCard(st, p);
      assert.equal(r.ok, true, 'drawCard gagal di simulasi hell: ' + r.error);
      if (!r.lostTurn) {
        if (r.playable) {
          const r2 = U.playDrawnCard(st, p, r.card.id, { saidUno: st.hands[p].length === 2, wildColor: 'red' });
          assert.equal(r2.ok, true);
        } else {
          assert.equal(U.passTurn(st, p).ok, true);
        }
      }
    }
  }
  assert.ok(st.over, 'game hell tidak selesai dalam 30000 langkah');
});
