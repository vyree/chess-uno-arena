'use strict';
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

// Force a simple table: top = red 5, currentColor red, turn 0.
function table(numPlayers) {
  const st = U.newGame(numPlayers, rng(7));
  st.discard = [{ id: 't', color: 'red', kind: 'number', value: 5 }];
  st.currentColor = 'red';
  st.turn = 0;
  st.dir = 1;
  return st;
}

test('newGame: turnCount 0, turnNumber 1, toClient mengekspos keduanya', () => {
  const st = U.newGame(2, rng(7));
  assert.equal(st.turnCount, 0);
  const c = U.toClient(st, 0);
  assert.equal(c.turnCount, 0);
  assert.equal(c.turnNumber, 1);
});

test('main kartu biasa = 1 turn; main gagal tidak dihitung', () => {
  const st = table(2);
  st.hands[0] = [
    { id: 'a', color: 'red', kind: 'number', value: 9 },
    { id: 'b', color: 'blue', kind: 'number', value: 3 },
  ];
  const bad = U.playCard(st, 0, 'b', { saidUno: true });
  assert.equal(bad.ok, false);
  assert.equal(st.turnCount, 0);
  const r = U.playCard(st, 0, 'a', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(st.turnCount, 1);
  assert.equal(U.toClient(st, 1).turnNumber, 2);
});

test('skip = 1 turn untuk pemain yang main, pemain yang diskip tidak dapat turn', () => {
  const st = table(3);
  st.hands[0] = [
    { id: 'a', color: 'red', kind: 'skip', value: null },
    { id: 'b', color: 'blue', kind: 'number', value: 3 },
  ];
  const r = U.playCard(st, 0, 'a', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(st.turnCount, 1);
  assert.equal(st.turn, 2, 'skip melompati pemain 1');
});

test('reverse = 1 turn untuk pemain yang main, arah berbalik', () => {
  const st = table(3);
  st.hands[0] = [
    { id: 'a', color: 'red', kind: 'reverse', value: null },
    { id: 'b', color: 'blue', kind: 'number', value: 3 },
  ];
  const r = U.playCard(st, 0, 'a', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(st.turnCount, 1);
  assert.equal(st.dir, -1);
  assert.equal(st.turn, 2);
});

test('reverse di 2 pemain = 1 turn, giliran kembali ke pemain yang sama', () => {
  const st = table(2);
  st.hands[0] = [
    { id: 'a', color: 'red', kind: 'reverse', value: null },
    { id: 'b', color: 'blue', kind: 'number', value: 3 },
  ];
  const r = U.playCard(st, 0, 'a', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(st.turnCount, 1);
  assert.equal(st.turn, 0);
});

test('ambil kartu saja belum dihitung; lewati setelah ambil = 1 turn', () => {
  const st = table(2);
  st.hands[0] = [{ id: 'a', color: 'blue', kind: 'number', value: 3 }];
  st.deck = [{ id: 'd', color: 'green', kind: 'number', value: 1 }];
  const d = U.drawCard(st, 0);
  assert.equal(d.ok, true);
  assert.equal(st.turnCount, 0, 'draw saja masih di tengah turn');
  const p = U.passTurn(st, 0);
  assert.equal(p.ok, true);
  assert.equal(st.turnCount, 1);
  assert.equal(st.turn, 1);
});

test('tarik penalti +N = 1 turn (turn korban habis oleh penalti)', () => {
  const st = table(2);
  st.pendingDraw = 2;
  st.pendingKind = 'draw2';
  const d = U.drawCard(st, 0);
  assert.equal(d.ok, true);
  assert.equal(d.lostTurn, true);
  assert.equal(st.turnCount, 1);
  assert.equal(st.turn, 1);
});

test('kartu kemenangan dihitung sebagai 1 turn; turnNumber akhir = total', () => {
  const st = table(2);
  st.hands[0] = [{ id: 'a', color: 'red', kind: 'number', value: 9 }];
  const r = U.playCard(st, 0, 'a', { saidUno: true });
  assert.equal(r.ok, true);
  assert.equal(r.won, true);
  assert.equal(st.turnCount, 1);
  assert.equal(U.toClient(st, 0).turnNumber, 1);
});

test('Negate! dan Reset! di jendela UNO! bukan turn, tidak menambah hitungan', () => {
  const st = table(3);
  st.negateWindow = { victim: 0 };
  st.negateSeq = 1;
  st.hands[1] = [
    { id: 'n', color: null, kind: 'negate', value: null },
    { id: 'x', color: 'blue', kind: 'number', value: 3 },
  ];
  const n = U.playNegate(st, 1, 'n');
  assert.equal(n.ok, true);
  assert.equal(st.turnCount, 0);

  const st2 = table(3);
  st2.negateWindow = { victim: 0 };
  st2.negateSeq = 1;
  st2.hands[1] = [
    { id: 'r', color: null, kind: 'reset', value: null },
    { id: 'x', color: 'blue', kind: 'number', value: 3 },
  ];
  const r = U.playReset(st2, 1, 'r');
  assert.equal(r.ok, true);
  assert.equal(st2.turnCount, 0);
  assert.equal(st2.turn, 1, 'pengaktif Reset jalan duluan, tapi Reset sendiri bukan turn');
});
