'use strict';
// VS AI chess personas (Misi 6): one engine, four costumes. These
// tests pin the contract: every persona returns legal moves, the
// strong ones find mate-in-1 and take a hanging queen, and the
// thinking-time theatre stays inside its promised bounds.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../game/chess.js');
const CB = require('../game/chessbot.js');

const mv = (st, from, to, promo) => C.applyMove(st, C.parseSq(from), C.parseSq(to), promo);
// Deterministic rng that never rolls a blunder (returns 0.99).
const calm = () => 0.99;

test('empat persona terdaftar dengan nama & level yang benar', () => {
  assert.deepEqual(Object.keys(CB.PERSONAS).sort(), ['claude', 'gemini', 'gpt', 'meta']);
  assert.equal(CB.PERSONAS.gemini.name, 'Gemini');
  assert.equal(CB.PERSONAS.gemini.level, 'Normal');
  assert.equal(CB.PERSONAS.gpt.level, 'Hard');
  assert.equal(CB.PERSONAS.meta.level, 'Hell');
  assert.equal(CB.PERSONAS.claude.level, 'Hell');
});

test('setiap persona mengembalikan langkah legal dari posisi awal', () => {
  for (const key of Object.keys(CB.PERSONAS)) {
    const st = C.newGame();
    const m = CB.chooseMove(st, key, calm);
    assert.ok(m, key + ' harus punya langkah');
    const legal = C.allLegalMoves(st, 'w');
    assert.ok(legal.some((x) => x.from === m.from && x.to === m.to), key + ' langkah legal');
  }
});

test("claude menemukan skakmat 1 langkah (scholar's mate)", () => {
  const st = C.newGame();
  mv(st, 'e2', 'e4'); mv(st, 'e7', 'e5'); mv(st, 'f1', 'c4');
  mv(st, 'b8', 'c6'); mv(st, 'd1', 'h5'); mv(st, 'g8', 'f6');
  const m = CB.chooseMove(st, 'claude', calm);
  const r = C.applyMove(st, m.from, m.to, m.promo);
  assert.deepEqual(r.status, { result: '1-0', reason: 'checkmate' });
});

test('gpt memakan ratu yang tergantung (exd5)', () => {
  const st = C.newGame();
  st.board.fill(null);
  st.board[C.parseSq('e1')] = { t: 'k', c: 'w' };
  st.board[C.parseSq('e8')] = { t: 'k', c: 'b' };
  st.board[C.parseSq('e4')] = { t: 'p', c: 'w' };
  st.board[C.parseSq('d5')] = { t: 'q', c: 'b' };
  st.turn = 'w'; st.history = [];
  const m = CB.chooseMove(st, 'gpt', calm);
  assert.equal(C.sqName(m.from), 'e4');
  assert.equal(C.sqName(m.to), 'd5');
});

test('waktu mikir: selalu di dalam batas aman & bucket sesuai spek', () => {
  let s = 11;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const samples = Array.from({ length: 400 }, () => CB.pickThinkMs(rng, 60000));
  assert.ok(Math.max(...samples) <= 57500, 'tidak pernah melewati batas giliran');
  assert.ok(Math.min(...samples) >= 5000, 'lantai 5 detik');
  assert.ok(samples.some((x) => x >= 5000 && x <= 10000), 'bucket utama 5-10 dtk ada');
  assert.ok(samples.some((x) => x > 20000), 'bucket >20 dtk ada');
  assert.ok(samples.some((x) => x > 50000), 'bucket dramatis dekat bel ada');
});

test('waktu mikir v2: kasus khusus mengalahkan aturan fase', () => {
  let s = 21;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const many = (ctx) => Array.from({ length: 200 }, () => CB.pickThinkMs(rng, 60000, ctx));
  // forced move: <= 3 s even in the endgame
  assert.ok(Math.max(...many({ moveNumber: 40, legalCount: 1 })) <= 3000);
  // in check: <= 7 s
  assert.ok(Math.max(...many({ moveNumber: 20, inCheck: true, legalCount: 12 })) <= 7000);
  // few options (2-3 legal): <= 5 s
  assert.ok(Math.max(...many({ moveNumber: 20, legalCount: 3 })) <= 5000);
  // obvious recapture: 2-5 s
  const recap = many({ moveNumber: 20, legalCount: 15, canRecapture: true });
  assert.ok(Math.max(...recap) <= 5000 && Math.min(...recap) >= 2000);
  // opening (moves 1-7): 5-10 s
  const open = many({ moveNumber: 4, legalCount: 20 });
  assert.ok(Math.max(...open) <= 10000 && Math.min(...open) >= 5000);
  // middlegame (8-30): never over the 30 s cap
  assert.ok(Math.max(...many({ moveNumber: 18, legalCount: 30 })) <= 30000);
  // endgame (31+): the drama bucket (>40 s) exists again
  assert.ok(Math.max(...many({ moveNumber: 45, legalCount: 12 })) > 40000);
});

test('game bot lawan bot selesai tanpa langkah ilegal', () => {
  let s = 7;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const st = C.newGame();
  let plies = 0;
  while (!st.over && plies < 120) {
    const persona = st.turn === 'w' ? 'gemini' : 'gpt';
    const m = CB.chooseMove(st, persona, rng);
    assert.ok(m, 'selalu ada langkah selama game berjalan');
    const r = C.applyMove(st, m.from, m.to, m.promo);
    assert.equal(r.ok, true);
    plies++;
  }
  assert.ok(plies > 10, 'game berjalan wajar (' + plies + ' ply)');
});
