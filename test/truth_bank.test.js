'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../game/questions.js');

test('bank soal: 4 nuansa x 50 = 200 soal gabungan', () => {
  assert.equal(Q.SANTAI.length, 50);
  assert.equal(Q.NOSTALGIA.length, 50);
  assert.equal(Q.MENDALAM.length, 50);
  assert.equal(Q.CAMPURAN.length, 50);
  assert.equal(Q.ALL.length, 200);
});

test('bank soal: semua pertanyaan sah dan unik', () => {
  const seen = new Set();
  for (const q of Q.ALL) {
    assert.equal(typeof q, 'string');
    const t = q.trim();
    assert.ok(t.endsWith('?'), 'harus diakhiri tanda tanya: ' + t);
    assert.ok(t.length >= 12 && t.length <= 200, 'panjang wajar: ' + t);
    const key = t.toLowerCase();
    assert.ok(!seen.has(key), 'duplikat: ' + t);
    seen.add(key);
  }
  assert.equal(seen.size, 200);
});
