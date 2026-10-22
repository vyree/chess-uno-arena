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

// ----- Misi 8: persona skills (Sensei, 2026-10-22) -----
// Board surgery helper: place exactly these pieces, side to move.
function surgery(pieces, turn, full) {
  const st = C.newGame();
  st.board.fill(null);
  for (const [sq, t, c] of pieces) st.board[C.parseSq(sq)] = { t, c };
  st.turn = turn;
  st.full = full || 12;
  st.history = [];
  st.castling = { K: false, Q: false, k: false, q: false };
  return st;
}
const zero = () => 0; // deterministic rng: first pool/book candidate
const moveName = (st, key, rng) => {
  const m = CB.chooseMove(st, key, rng);
  return m ? C.sqName(m.from) + C.sqName(m.to) : null;
};

test('misi 8: gemini blunder nol — tetap memakan ratu tergantung (rng 0)', () => {
  const st = surgery([
    ['e1', 'k', 'w'], ['e8', 'k', 'b'], ['e4', 'p', 'w'], ['d5', 'q', 'b'],
  ], 'w', 9);
  assert.equal(moveName(st, 'gemini', zero), 'e4d5');
});

test("misi 8: gemini menemukan skakmat 1 langkah (scholar's mate)", () => {
  const st = C.newGame();
  mv(st, 'e2', 'e4'); mv(st, 'e7', 'e5'); mv(st, 'f1', 'c4');
  mv(st, 'b8', 'c6'); mv(st, 'd1', 'h5'); mv(st, 'g8', 'f6');
  const m = CB.chooseMove(st, 'gemini', calm);
  const r = C.applyMove(st, m.from, m.to, m.promo);
  assert.deepEqual(r.status, { result: '1-0', reason: 'checkmate' });
});

test('misi 8: buku pembuka — langkah pertama tiap persona selalu masuk akal', () => {
  const book = {
    gemini: ['e2e4', 'd2d4', 'g1f3', 'b1c3', 'f2f4', 'c2c4', 'g2g4'],
    gpt: ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'b1c3'],
    meta: ['e2e4', 'd2d4', 'c2c4', 'g1f3', 'f2f4', 'b2b4'],
    claude: ['d2d4', 'e2e4', 'g1f3', 'c2c4', 'b1c3'],
  };
  for (const key of Object.keys(book)) {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
      const pick = moveName(C.newGame(), key, () => roll);
      assert.ok(book[key].includes(pick), key + ' membuka dengan ' + pick);
    }
  }
});

test('misi 8: pantang mundur — gemini menerjang, gpt mundur dengan rapi', () => {
  const pos = () => surgery([
    ['e1', 'k', 'w'], ['d5', 'n', 'w'], ['b4', 'b', 'w'], ['a2', 'b', 'w'],
    ['e8', 'k', 'b'], ['h8', 'r', 'b'], ['h6', 'n', 'b'], ['c6', 'p', 'b'], ['e6', 'p', 'b'],
  ], 'w');
  assert.ok(['d5f6', 'd5b6', 'd5e7'].includes(moveName(pos(), 'gemini', zero)), 'gemini harus maju');
  assert.ok(['d5f4', 'd5e3'].includes(moveName(pos(), 'gpt', calm)), 'gpt boleh mundur');
});

test('misi 8: parade kuda — gemini menggerakkan kudanya lebih dulu', () => {
  const st = surgery([
    ['e1', 'k', 'w'], ['d4', 'p', 'w'],
    ['e8', 'k', 'b'], ['b8', 'n', 'b'], ['g8', 'n', 'b'], ['d5', 'p', 'b'],
  ], 'b');
  const pick = moveName(st, 'gemini', zero);
  assert.ok(pick.startsWith('b8') || pick.startsWith('g8'), 'kuda yang bergerak: ' + pick);
});

test('misi 8: pengawal parade — gemini membela kuda kesayangannya yang tergantung', () => {
  const st = surgery([
    ['e1', 'k', 'w'], ['b3', 'b', 'w'], ['a3', 'p', 'w'], ['b2', 'p', 'w'], ['e4', 'p', 'w'], ['e5', 'p', 'w'], ['f2', 'p', 'w'], ['g3', 'p', 'w'], ['a7', 'p', 'w'],
    ['e8', 'k', 'b'], ['d5', 'n', 'b'], ['g8', 'n', 'b'], ['c8', 'b', 'b'], ['c7', 'p', 'b'], ['e7', 'p', 'b'],
  ], 'b', 14);
  assert.ok(['c7c6', 'e7e6'].includes(moveName(st, 'gemini', zero)), 'bidak lain harus membela sang kuda');
});

test('misi 8: meta mengorbankan gajah ala greek gift — gpt menolaknya', () => {
  const pos = () => surgery([
    ['g1', 'k', 'w'], ['d1', 'q', 'w'], ['d3', 'b', 'w'], ['f3', 'n', 'w'], ['d4', 'p', 'w'], ['e3', 'p', 'w'], ['f2', 'p', 'w'], ['g2', 'p', 'w'], ['h2', 'p', 'w'], ['a2', 'p', 'w'], ['a1', 'r', 'w'], ['f1', 'r', 'w'],
    ['g8', 'k', 'b'], ['d8', 'q', 'b'], ['f6', 'n', 'b'], ['h7', 'p', 'b'], ['g7', 'p', 'b'], ['f7', 'p', 'b'], ['e7', 'p', 'b'], ['a7', 'p', 'b'], ['b7', 'p', 'b'], ['a8', 'r', 'b'], ['f8', 'r', 'b'], ['c8', 'b', 'b'],
  ], 'w', 15);
  assert.equal(moveName(pos(), 'meta', zero), 'd3h7');
  assert.notEqual(moveName(pos(), 'gpt', calm), 'd3h7');
});

test('misi 8: claude si penggerus — menukar ratu saat unggul, menolak saat tertinggal', () => {
  const ahead = () => surgery([
    ['e1', 'k', 'w'], ['d1', 'q', 'w'], ['g1', 'n', 'w'], ['a1', 'r', 'w'], ['a2', 'p', 'w'], ['b2', 'p', 'w'], ['h4', 'p', 'w'],
    ['e8', 'k', 'b'], ['d5', 'q', 'b'], ['a5', 'r', 'b'], ['c8', 'b', 'b'], ['e6', 'p', 'b'], ['a7', 'p', 'b'],
  ], 'w', 18);
  const behind = () => surgery([
    ['e1', 'k', 'w'], ['d1', 'q', 'w'], ['g1', 'n', 'w'], ['a1', 'r', 'w'], ['a2', 'p', 'w'],
    ['e8', 'k', 'b'], ['d5', 'q', 'b'], ['a5', 'r', 'b'], ['c8', 'b', 'b'], ['e6', 'p', 'b'], ['a7', 'p', 'b'],
  ], 'w', 18);
  assert.equal(moveName(ahead(), 'claude', zero), 'd1d5');
  assert.notEqual(moveName(behind(), 'claude', zero), 'd1d5');
});

test('misi 8: rasa garpu — gemini menilai posisi garpu jauh lebih tinggi dari gpt', () => {
  const st = surgery([
    ['e1', 'k', 'w'], ['e2', 'q', 'w'], ['c2', 'b', 'w'],
    ['e8', 'k', 'b'], ['d4', 'n', 'b'],
  ], 'w', 20);
  assert.ok(CB.evaluateFor(st, 'gemini', 'b') < CB.evaluateFor(st, 'gpt', 'b') - 30,
    'garpu kuda adalah bahasa cinta gemini');
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
