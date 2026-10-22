'use strict';
// textbrain (Misi 7): the shared Indonesian chat reader. Sensei's own
// test sentence is the contract: "sprt ny ak akn klh" must be read as
// "sepertinya aku akan kalah" — vowel-stripped slang included.
const test = require('node:test');
const assert = require('node:assert/strict');
const TB = require('../game/textbrain.js');
const PC = require('../game/personachat.js');

test('normalisasi: huruf kecil, tanda baca hilang, huruf dobel dilipat', () => {
  const { tokens, question } = TB.normalize('Kalahhh BANGET, ya?!');
  assert.deepEqual(tokens, ['kalah', 'banget', 'ya']);
  assert.equal(question, true);
});

test('kerangka konsonan: sprt = seperti, klh = kalah, akn = akan', () => {
  const ex = TB.expandTokens(['sprt', 'akn', 'klh']);
  assert.ok(ex.has('seperti'));
  assert.ok(ex.has('akan'));
  assert.ok(ex.has('kalah'));
});

test('kalimat Sensei: "sprt ny ak akn klh" terbaca sebagai merasa kalah', () => {
  const a = TB.analyze('sprt ny ak akn klh', PC.INTENTS);
  assert.equal(a.intent, 'playerLosing');
  // and the fully spelled-out form reads the same way
  assert.equal(TB.analyze('sepertinya aku akan kalah', PC.INTENTS).intent, 'playerLosing');
});

test('kamus singkatan: "lu beneran gemini?" terbaca sebagai tes identitas', () => {
  assert.equal(TB.analyze('lu beneran gemini?', PC.INTENTS).intent, 'identity');
});

test('tanya nama terbaca sebagai nameAsk, bukan identity', () => {
  assert.equal(TB.analyze('coba sebut namaku siapa?', PC.INTENTS).intent, 'nameAsk');
});

test('makian terdeteksi: utuh, disingkat, dan dieja berulang', () => {
  assert.equal(TB.analyze('dasar anjing', []).abuse, true);
  assert.equal(TB.analyze('anjg lu', []).abuse, true);
  assert.equal(TB.analyze('anjiiing banget mainnya', []).abuse, true);
  assert.equal(TB.analyze('mainnya bagus banget', []).abuse, false);
});

test('gibberish terdeteksi; kalimat wajar tidak', () => {
  assert.equal(TB.analyze('asdfgh qwerty zxc', PC.INTENTS).gibberish, true);
  assert.equal(TB.analyze('halo, apa kabar?', PC.INTENTS).gibberish, false);
});
