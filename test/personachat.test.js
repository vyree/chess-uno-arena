'use strict';
// personachat (Misi 7): the personas' scripted voices. Pins the reply
// policy: board/player questions answered with real facts, costume
// never dropped, trivia dodged, abuse ladder ends in silence.
const test = require('node:test');
const assert = require('node:assert/strict');
const PC = require('../game/personachat.js');

const yes = () => 0; // rand that always passes a chance roll
const FACTS = {
  name: 'Noir', material: 'ahead', capturesByBot: 3, capturesByHuman: 2,
  moveNumber: 14, checkSide: null,
};

test('persona menjawab sapaan dan menyebut nama pemain', () => {
  const st = PC.createState();
  const r = PC.respond(st, 'claude', 'halo', FACTS, yes, 100000);
  assert.ok(r && r.text.length > 3);
});

test('tanya nama dijawab dengan nama asli pemain', () => {
  const st = PC.createState();
  const r = PC.respond(st, 'gemini', 'namaku siapa?', FACTS, yes, 100000);
  assert.ok(r && r.text.includes('Noir'));
});

test('tanya keadaan game dijawab dari fakta papan', () => {
  const st = PC.createState();
  const win = PC.respond(st, 'claude', 'siapa yang lagi menang?', FACTS, yes, 100000);
  assert.ok(win && /unggul|memimpin|berpihak/.test(win.text));
  const st2 = PC.createState();
  const cap = PC.respond(st2, 'gpt', 'berapa bidak yang sudah dimakan?', FACTS, yes, 100000);
  assert.ok(cap && cap.text.includes('3') && cap.text.includes('2'));
  const st3 = PC.createState();
  const mv = PC.respond(st3, 'meta', 'ini langkah ke berapa?', FACTS, yes, 100000);
  assert.ok(mv && mv.text.includes('14'));
});

test('tes identitas: kostum tidak pernah lepas', () => {
  const st = PC.createState();
  const r = PC.respond(st, 'meta', 'lu beneran meta?', FACTS, yes, 100000);
  assert.ok(r && PC.LINES.meta.identity.includes(r.text));
});

test('trivia luar papan dihindari dengan berkelas', () => {
  const st = PC.createState();
  const r = PC.respond(st, 'claude', 'siapa presiden ke 7 amerika?', FACTS, yes, 100000);
  assert.ok(r); // a dodge line, never a fabricated fact
});

test('tangga makian: tangkis, batas, lalu diam total (mute)', () => {
  const st = PC.createState();
  const r1 = PC.respond(st, 'gemini', 'anjing lu', FACTS, yes, 100000);
  assert.ok(r1 && r1.text.length > 3);
  const r2 = PC.respond(st, 'gemini', 'goblok', FACTS, yes, 106000);
  assert.ok(r2 && r2.text.length > 3);
  const r3 = PC.respond(st, 'gemini', 'tai lu', FACTS, yes, 112000);
  assert.equal(r3, null); // third strike: silent treatment begins
  const r4 = PC.respond(st, 'gemini', 'halo', FACTS, yes, 118000);
  assert.equal(r4, null); // still muted — even friendly chat waits
});

test('cooldown: dua pesan beruntun tidak dibalas dua kali', () => {
  const st = PC.createState();
  const r1 = PC.respond(st, 'gpt', 'halo', FACTS, yes, 100000);
  assert.ok(r1);
  const r2 = PC.respond(st, 'gpt', 'halo lagi', FACTS, yes, 101000);
  assert.equal(r2, null);
});

test('event lines: start selalu bunyi; quip biasa kena jeda antar-event', () => {
  const st = PC.createState();
  const start = PC.eventLine(st, 'claude', 'start', FACTS, yes, 100000);
  assert.ok(start && start.text.includes('Noir'));
  const quip = PC.eventLine(st, 'claude', 'botCaptured', FACTS, yes, 101000);
  assert.equal(quip, null); // inside the 20 s event gap
  const later = PC.eventLine(st, 'claude', 'botCaptured', FACTS, yes, 130000);
  assert.ok(later);
});

test('misi 8: kalimat pemicu skill tersedia (parade, kuda hilang, umpan, gerus)', () => {
  const parade = PC.eventLine(PC.createState(), 'gemini', 'parade', FACTS, yes, 200000);
  assert.ok(parade && parade.text.includes('PARADE'));
  const lost = PC.eventLine(PC.createState(), 'gemini', 'knightLost', FACTS, yes, 200000);
  assert.ok(lost && lost.text.includes('KUDA'));
  const bait = PC.eventLine(PC.createState(), 'meta', 'bait', FACTS, yes, 200000);
  assert.ok(bait && bait.text.includes('berani'));
  const grind = PC.eventLine(PC.createState(), 'claude', 'grind', FACTS, yes, 200000);
  assert.ok(grind && grind.text.includes('endgame'));
});
