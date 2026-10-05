'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../game/uno.js');

// deterministic RNG for tests
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('deck berisi 108 kartu standar', () => {
  const d = U.buildDeck();
  assert.equal(d.length, 108);
  const wilds = d.filter((c) => c.kind === 'wild').length;
  const wild4s = d.filter((c) => c.kind === 'wild4').length;
  assert.equal(wilds, 4);
  assert.equal(wild4s, 4);
  const ids = new Set(d.map((c) => c.id));
  assert.equal(ids.size, 108);
});

test('newGame: 7 kartu per pemain, starter kartu angka', () => {
  const st = U.newGame(4, rng(42));
  assert.equal(st.hands.length, 4);
  for (const h of st.hands) assert.equal(h.length, 7);
  assert.equal(st.deck.length, 108 - 28 - 1);
  assert.equal(U.topCard(st).kind, 'number');
  assert.equal(st.turn, 0);
});

test('newGame menolak jumlah pemain di luar 2-6', () => {
  assert.throws(() => U.newGame(1), /2-6/);
  assert.throws(() => U.newGame(7), /2-6/);
});

test('canPlay: cocok warna / angka / simbol / wild', () => {
  const st = U.newGame(2, rng(7));
  // paksa top card: red 5
  st.discard = [{ id: 't', color: 'red', kind: 'number', value: 5 }];
  st.currentColor = 'red';
  st.hands[0] = [
    { id: 'a', color: 'red', kind: 'number', value: 9 },    // warna cocok
    { id: 'b', color: 'blue', kind: 'number', value: 5 },   // angka cocok
    { id: 'c', color: 'green', kind: 'number', value: 3 },  // tidak cocok
    { id: 'd', color: null, kind: 'wild', value: null },   // wild selalu bisa
  ];
  assert.equal(U.canPlay(st, 0, st.hands[0][0]), true);
  assert.equal(U.canPlay(st, 0, st.hands[0][1]), true);
  assert.equal(U.canPlay(st, 0, st.hands[0][2]), false);
  assert.equal(U.canPlay(st, 0, st.hands[0][3]), true);
  assert.equal(U.canPlay(st, 1, st.hands[0][0]), false, 'bukan giliran');
});

test('kartu aksi cocok berdasarkan simbol', () => {
  const st = U.newGame(2, rng(7));
  st.discard = [{ id: 't', color: 'red', kind: 'skip', value: null }];
  st.currentColor = 'red';
  const blueSkip = { id: 's', color: 'blue', kind: 'skip', value: null };
  st.hands[0] = [blueSkip];
  assert.equal(U.canPlay(st, 0, blueSkip), true);
});

test('skip melewati 1 pemain', () => {
  const st = U.newGame(3, rng(7));
  st.discard = [{ id: 't', color: 'red', kind: 'number', value: 5 }];
  st.currentColor = 'red';
  st.hands[0] = [
    { id: 's', color: 'red', kind: 'skip', value: null },
    { id: 'x', color: 'red', kind: 'number', value: 1 },
    { id: 'y', color: 'blue', kind: 'number', value: 2 },
  ];
  const r = U.playCard(st, 0, 's', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(st.turn, 2, 'pemain 1 ter-skip, giliran ke pemain 2');
});

test('reverse membalik arah; di 2 pemain = skip', () => {
  const st = U.newGame(2, rng(7));
  st.discard = [{ id: 't', color: 'red', kind: 'number', value: 5 }];
  st.currentColor = 'red';
  st.hands[0] = [
    { id: 'r', color: 'red', kind: 'reverse', value: null },
    { id: 'x', color: 'red', kind: 'number', value: 1 },
    { id: 'y', color: 'blue', kind: 'number', value: 2 },
  ];
  const r = U.playCard(st, 0, 'r', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(st.dir, -1);
  assert.equal(st.turn, 0, '2 pemain: reverse = skip, giliran kembali');

  const st3 = U.newGame(3, rng(7));
  st3.discard = [{ id: 't', color: 'blue', kind: 'number', value: 5 }];
  st3.currentColor = 'blue';
  st3.hands[0] = [
    { id: 'r', color: 'blue', kind: 'reverse', value: null },
    { id: 'x', color: 'blue', kind: 'number', value: 1 },
    { id: 'y', color: 'red', kind: 'number', value: 2 },
  ];
  U.playCard(st3, 0, 'r', { saidUno: true });
  assert.equal(st3.dir, -1);
  assert.equal(st3.turn, 2, '3 pemain: arah balik ke pemain 2');
});

test('+2: pemain berikutnya ambil 2 & kehilangan giliran', () => {
  const st = U.newGame(2, rng(7));
  st.discard = [{ id: 't', color: 'red', kind: 'number', value: 5 }];
  st.currentColor = 'red';
  st.hands[0] = [
    { id: 'p', color: 'red', kind: 'draw2', value: null },
    { id: 'x', color: 'red', kind: 'number', value: 1 },
    { id: 'y', color: 'blue', kind: 'number', value: 2 },
  ];
  const before = st.hands[1].length;
  U.playCard(st, 0, 'p', { saidUno: true });
  assert.equal(st.pendingDraw, 2);
  assert.equal(st.turn, 1);
  const r = U.drawCard(st, 1);
  assert.equal(r.ok, true);
  assert.equal(r.drew, 2);
  assert.equal(r.lostTurn, true);
  assert.equal(st.hands[1].length, before + 2);
  assert.equal(st.turn, 0);
});

test('wild wajib pilih warna', () => {
  const st = U.newGame(2, rng(7));
  st.hands[0] = [
    { id: 'w', color: null, kind: 'wild', value: null },
    { id: 'x', color: 'red', kind: 'number', value: 1 },
    { id: 'y', color: 'blue', kind: 'number', value: 2 },
  ];
  assert.equal(U.playCard(st, 0, 'w', {}).ok, false, 'tanpa warna ditolak');
  const r = U.playCard(st, 0, 'w', { wildColor: 'green', saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(st.currentColor, 'green');
});

test('lupa bilang UNO = penalti ambil 2', () => {
  const st = U.newGame(2, rng(7));
  st.discard = [{ id: 't', color: 'red', kind: 'number', value: 5 }];
  st.currentColor = 'red';
  st.hands[0] = [
    { id: 'p', color: 'red', kind: 'number', value: 9 },
    { id: 'x', color: 'red', kind: 'number', value: 1 },
  ];
  const r = U.playCard(st, 0, 'p', { saidUno: false });
  assert.equal(r.ok, true);
  assert.equal(r.penalty, 2);
  assert.equal(st.hands[0].length, 3, '1 sisa + 2 penalti');
});

test('bilang UNO tepat waktu = tanpa penalti; menang saat kartu habis', () => {
  const st = U.newGame(2, rng(7));
  st.discard = [{ id: 't', color: 'red', kind: 'number', value: 5 }];
  st.currentColor = 'red';
  st.hands[0] = [{ id: 'p', color: 'red', kind: 'number', value: 9 }];
  st.hands[1] = [
    { id: 'a', color: 'blue', kind: 'number', value: 3 },
    { id: 'b', color: null, kind: 'wild', value: null },
  ];
  const r = U.playCard(st, 0, 'p', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(r.won, true);
  assert.equal(st.over.winner, 0);
  const scores = [0, 0];
  const pts = U.scoreRound(st, scores);
  assert.equal(pts, 3 + 50);
  assert.equal(scores[0], 53);
});

test('draw lalu pass; draw lalu mainkan kartu yang diambil', () => {
  const st = U.newGame(2, rng(7));
  st.discard = [{ id: 't', color: 'red', kind: 'number', value: 5 }];
  st.currentColor = 'red';
  st.hands[0] = [{ id: 'x', color: 'blue', kind: 'number', value: 1 }];
  // paksa deck: kartu atas tidak cocok
  st.deck = [{ id: 'z', color: 'green', kind: 'number', value: 7 }];
  const d = U.drawCard(st, 0);
  assert.equal(d.ok, true);
  assert.equal(d.playable, false);
  assert.equal(U.passTurn(st, 0).ok, true);
  assert.equal(st.turn, 1);

  // ronde baru: kartu yang diambil cocok
  const st2 = U.newGame(2, rng(7));
  st2.discard = [{ id: 't', color: 'red', kind: 'number', value: 5 }];
  st2.currentColor = 'red';
  st2.hands[0] = [{ id: 'x', color: 'blue', kind: 'number', value: 1 }];
  st2.deck = [{ id: 'z', color: 'red', kind: 'number', value: 7 }];
  U.drawCard(st2, 0);
  const r = U.playDrawnCard(st2, 0, 'z', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(U.topCard(st2).id, 'z');
});

test('toClient menyembunyikan kartu lawan', () => {
  const st = U.newGame(3, rng(7));
  const snap = U.toClient(st, 1);
  assert.equal(snap.hands[1].length, 7, 'kartu sendiri terlihat');
  assert.equal(snap.hands[0], 7, 'lawan hanya jumlah');
  assert.equal(snap.hands[2], 7);
  assert.doesNotThrow(() => JSON.stringify(snap));
});
