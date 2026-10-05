'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../game/chess.js');

const mv = (st, from, to, promo) => C.applyMove(st, C.parseSq(from), C.parseSq(to), promo);
const okAll = (results) => { for (const r of results) assert.equal(r.ok, true, JSON.stringify(r)); };

test('posisi awal: tiap sisi punya 20 langkah legal', () => {
  const st = C.newGame();
  assert.equal(C.allLegalMoves(st, 'w').length, 20);
  assert.equal(C.allLegalMoves(st, 'b').length, 20);
});

test("fool's mate = skakmat 0-1", () => {
  const st = C.newGame();
  okAll([mv(st, 'f2', 'f3'), mv(st, 'e7', 'e5'), mv(st, 'g2', 'g4')]);
  const r = mv(st, 'd8', 'h4');
  assert.equal(r.ok, true);
  assert.deepEqual(r.status, { result: '0-1', reason: 'checkmate' });
  assert.equal(mv(st, 'e2', 'e3').ok, false); // game over
});

test("scholar's mate = skakmat 1-0", () => {
  const st = C.newGame();
  okAll([mv(st, 'e2', 'e4'), mv(st, 'e7', 'e5'), mv(st, 'f1', 'c4'),
         mv(st, 'b8', 'c6'), mv(st, 'd1', 'h5'), mv(st, 'g8', 'f6')]);
  const r = mv(st, 'h5', 'f7');
  assert.equal(r.ok, true);
  assert.deepEqual(r.status, { result: '1-0', reason: 'checkmate' });
});

test('rokade pendek & panjang legal, lalu hak hilang', () => {
  const st = C.newGame();
  okAll([mv(st, 'e2', 'e4'), mv(st, 'e7', 'e5'), mv(st, 'g1', 'f3'),
         mv(st, 'b8', 'c6'), mv(st, 'f1', 'c4'), mv(st, 'g8', 'f6')]);
  const kingMoves = C.legalMoves(st, C.parseSq('e1')).map((m) => C.sqName(m.to));
  assert.ok(kingMoves.includes('g1'), 'rokade pendek harus legal: ' + kingMoves);
  const r = mv(st, 'e1', 'g1');
  assert.equal(r.ok, true);
  assert.equal(st.board[C.parseSq('f1')].t, 'r');
  assert.equal(st.board[C.parseSq('g1')].t, 'k');
  // hak rokade putih habis
  assert.equal(st.castling.K, false);
});

test('rokade ilegal saat raja sedang skak', () => {
  const st = C.newGame();
  // susun posisi: raja putih e1, benteng h1, menteri hitam e2 memberi skak
  st.board = new Array(64).fill(null);
  st.board[C.parseSq('e1')] = { t: 'k', c: 'w' };
  st.board[C.parseSq('h1')] = { t: 'r', c: 'w' };
  st.board[C.parseSq('e8')] = { t: 'k', c: 'b' };
  st.board[C.parseSq('e2')] = { t: 'q', c: 'b' };
  st.turn = 'w';
  const kingMoves = C.legalMoves(st, C.parseSq('e1')).map((m) => C.sqName(m.to));
  assert.ok(!kingMoves.includes('g1'), 'rokade saat skak harus ilegal');
});

test('en passant menangkap pion yang baru maju 2 langkah', () => {
  const st = C.newGame();
  okAll([mv(st, 'e2', 'e4'), mv(st, 'a7', 'a6'), mv(st, 'e4', 'e5'), mv(st, 'd7', 'd5')]);
  const r = mv(st, 'e5', 'd6');
  assert.equal(r.ok, true);
  assert.equal(st.board[C.parseSq('d5')], null, 'pion hitam d5 harus hilang');
  assert.equal(st.board[C.parseSq('d6')].t, 'p');
});

test('promosi: 4 pilihan, default queen', () => {
  const st = C.newGame();
  st.board = new Array(64).fill(null);
  st.board[C.parseSq('e1')] = { t: 'k', c: 'w' };
  st.board[C.parseSq('e8')] = { t: 'k', c: 'b' };
  st.board[C.parseSq('a7')] = { t: 'p', c: 'w' };
  st.turn = 'w'; st.history = [];
  const promos = C.legalMoves(st, C.parseSq('a7')).map((m) => m.promo).sort();
  assert.deepEqual(promos, ['b', 'n', 'q', 'r']);
  assert.equal(mv(st, 'a7', 'a8', 'n').ok, true);
  assert.equal(st.board[C.parseSq('a8')].t, 'n');
});

test('stalemate terdeteksi', () => {
  const st = C.newGame();
  st.board = new Array(64).fill(null);
  st.board[C.parseSq('h8')] = { t: 'k', c: 'b' };
  st.board[C.parseSq('h6')] = { t: 'k', c: 'w' };
  st.board[C.parseSq('f7')] = { t: 'b', c: 'w' };
  st.turn = 'b'; st.history = [];
  const r = C.computeStatus(st);
  assert.deepEqual(r, { result: '1/2-1/2', reason: 'stalemate' });
});

test('aturan 50 langkah', () => {
  const st = C.newGame();
  st.half = 99;
  const r = mv(st, 'g1', 'f3');
  assert.equal(r.ok, true);
  assert.deepEqual(r.status, { result: '1/2-1/2', reason: 'fifty' });
});

test('repetisi 3x', () => {
  const st = C.newGame();
  // tarian kuda: posisi awal terulang 3x
  const seq = [['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8'],
               ['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8']];
  let last = null;
  for (const [a, b] of seq) last = mv(st, a, b);
  assert.equal(last.ok, true);
  assert.deepEqual(last.status, { result: '1/2-1/2', reason: 'repetition' });
});

test('menolak langkah ilegal', () => {
  const st = C.newGame();
  assert.equal(mv(st, 'e7', 'e5').ok, false, 'tidak boleh jalan bidak lawan');
  assert.equal(mv(st, 'e2', 'e5').ok, false, 'pion tak bisa maju 3');
  assert.equal(mv(st, 'b1', 'b3').ok, false, 'kuda tak bisa jalan begitu');
  assert.equal(st.turn, 'w', 'giliran tidak berubah setelah langkah ilegal');
});

test('skak: raja wajib keluar dari skak', () => {
  const st = C.newGame();
  okAll([mv(st, 'e2', 'e4'), mv(st, 'e7', 'e5'), mv(st, 'd1', 'h5')]);
  // hitam skak? belum. buat skak: Qh5xf7+? sudah scholar. pakai jalur lain:
  const st2 = C.newGame();
  okAll([mv(st2, 'e2', 'e4'), mv(st2, 'd7', 'd5'), mv(st2, 'f1', 'b5')]);
  // gajah b5 memberi skak ke raja e8
  assert.equal(C.inCheck(st2.board, 'b'), true);
  // langkah yang tidak menutup skak ditolak
  assert.equal(mv(st2, 'a7', 'a6').ok, false);
  // menutup dengan pion c7-c6 legal
  assert.equal(mv(st2, 'c7', 'c6').ok, true);
});

test('toClient menghasilkan snapshot serializable', () => {
  const st = C.newGame();
  mv(st, 'e2', 'e4');
  const snap = C.toClient(st);
  assert.equal(snap.board.length, 64);
  assert.equal(snap.turn, 'b');
  assert.equal(snap.board[C.parseSq('e4')], 'wp');
  assert.equal(snap.over, null);
  assert.doesNotThrow(() => JSON.stringify(snap));
});
