'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../game/truth.js');
const V = require('../game/validate.js');
const Q = require('../game/questions.js');

// deterministic RNG for tests (same pattern as uno.test.js)
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BANK = Array.from({ length: 40 }, (_, i) => 'Soal nomor ' + (i + 1) + '?');

function newGame(ids, extra) {
  const r = T.createGame(Object.assign(
    { playerIds: ids, questions: BANK, rand: rng(42) }, extra || {}));
  assert.equal(r.ok, true, r.error);
  return r.state;
}

function others(s, id) {
  return s.players.map((p) => p.id).filter((x) => x !== id);
}

function playSimpleTurn(s) {
  assert.equal(T.openCard(s).ok, true);
  const ans = T.snapshot(s).current.answererId;
  assert.equal(T.submitAnswer(s, ans, 'jawaban tes yang cukup panjang').ok, true);
  assert.equal(T.endTurn(s).ok, true);
}

test('createGame menolak jumlah pemain di luar 2-8', () => {
  assert.equal(T.createGame({ playerIds: ['a'], questions: BANK }).ok, false);
  const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  assert.equal(T.createGame({ playerIds: nine, questions: BANK }).ok, false);
  assert.equal(T.createGame({ playerIds: ['a', 'a'], questions: BANK }).ok, false);
  assert.equal(T.createGame({ playerIds: ['a', 'b'], questions: ['satu?'] }).ok, false);
  const s = newGame(['a', 'b']);
  assert.equal(s.totalTurns, 10); // 2-5 pemain -> 10 pertanyaan (Sensei)
  assert.equal(newGame(['a', 'b', 'c', 'd', 'e']).totalTurns, 10);
  assert.equal(newGame(['a', 'b', 'c', 'd', 'e', 'f']).totalTurns, 16);
  assert.equal(newGame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).totalTurns, 16);
  assert.equal(T.snapshot(s).deckLeft, BANK.length);
  assert.equal(s.phase, 'ask_window');
});

test('roda acak + cooldown: penjawab tidak pernah sama dua giliran berurutan', () => {
  const s = newGame(['a', 'b', 'c', 'd']);
  let prev = null;
  for (let i = 0; i < 10; i++) {
    const cur = T.snapshot(s).current.answererId;
    assert.notEqual(cur, prev); // yang baru menjawab duduk dulu 1 putaran
    prev = cur;
    playSimpleTurn(s);
  }
  assert.equal(s.phase, 'finished');
  assert.ok(s.awards);
  assert.equal(s.history.length, 10);
});

test('roda 2 pemain: cooldown memaksa bergantian', () => {
  const s = newGame(['a', 'b']);
  const seq = [];
  for (let i = 0; i < 4; i++) {
    seq.push(T.snapshot(s).current.answererId);
    playSimpleTurn(s);
  }
  assert.notEqual(seq[0], seq[1]);
  assert.equal(seq[0], seq[2]);
  assert.equal(seq[1], seq[3]);
});

test('batas tersembunyi: maksimal 5 pertanyaan per pemain per sesi', () => {
  // rand selalu 0 -> selalu ambil kandidat pertama yang memenuhi syarat
  const r = T.createGame({ playerIds: ['a', 'b', 'c'],
    questions: BANK, rand: () => 0 });
  assert.equal(r.ok, true);
  const s = r.state;
  while (s.phase !== 'finished') playSimpleTurn(s);
  assert.equal(s.history.length, 10); // 3 pemain -> total 10 pertanyaan
  // a & b bergantian sampai menyentuh batas 5x; c tidak pernah terpilih
  // karena rand kaku — yang penting: TIDAK ADA yang melewati 5x
  const counts = Object.fromEntries(s.players.map((p) => [p.id, p.askedCount]));
  assert.deepEqual(counts, { a: 5, b: 5, c: 0 });
  for (const p of s.players) assert.ok(p.askedCount <= 5);
  // aturan ini rahasia: snapshot ke client TIDAK memuat askedCount
  for (const p of T.snapshot(s).players) {
    assert.equal('askedCount' in p, false);
  }
});

test('ASK: eksklusif, mengunci kartu, hanya penanya yang bisa kirim soal', () => {
  const s = newGame(['a', 'b', 'c']);
  const ans = T.snapshot(s).current.answererId;
  const [x, y] = others(s, ans);
  assert.equal(T.claimAsk(s, ans).ok, false); // penjawab tidak bisa
  assert.equal(T.claimAsk(s, x).ok, true);
  assert.equal(T.snapshot(s).players.find((p) => p.id === x).askLeft, 1);
  assert.equal(T.claimAsk(s, y).ok, false); // sudah diklaim
  assert.equal(T.openCard(s).ok, false); // kartu terkunci
  assert.equal(T.submitAskQuestion(s, y, 'pertanyaan dari y?').ok, false);
  assert.equal(T.submitAskQuestion(s, x, 'pertanyaan bebas dari x?').ok, true);
  assert.equal(s.phase, 'answering');
  assert.equal(T.submitAnswer(s, ans, 'baiklah kujawab').ok, true);
  assert.equal(s.phase, 'reacting');
});

test('ASK: jatah 2x per pemain per game', () => {
  const s = newGame(['a', 'b', 'c']);
  let attempts = 0;
  while (s.phase !== 'finished') {
    const ans = T.snapshot(s).current.answererId;
    if (ans !== 'a' && attempts < 3) {
      attempts += 1;
      const r = T.claimAsk(s, 'a');
      if (attempts <= 2) {
        assert.equal(r.ok, true);
        assert.equal(T.submitAskQuestion(s, 'a', 'soal dari a?').ok, true);
      } else {
        assert.equal(r.ok, false); // jatah ketiga ditolak
        assert.equal(T.openCard(s).ok, true);
      }
    } else {
      assert.equal(T.openCard(s).ok, true);
    }
    assert.equal(T.submitAnswer(s, ans, 'jawaban').ok, true);
    assert.equal(T.endTurn(s).ok, true);
  }
  assert.equal(attempts, 3);
  assert.equal(T.snapshot(s).players.find((p) => p.id === 'a').askLeft, 0);
});

test('kartu: soal tidak berulang dan sisa tumpukan berkurang', () => {
  const s = newGame(['a', 'b']);
  const drawn = [];
  for (let i = 0; i < 4; i++) {
    assert.equal(T.openCard(s).ok, true);
    drawn.push(T.snapshot(s).current.question);
    const ans = T.snapshot(s).current.answererId;
    assert.equal(T.submitAnswer(s, ans, 'jawab').ok, true);
    assert.equal(T.endTurn(s).ok, true);
  }
  assert.equal(new Set(drawn).size, 4);
  assert.equal(T.snapshot(s).deckLeft, BANK.length - 4);
});

test('PASS memakai jatah; timeout dianggap pass tanpa memakan jatah', () => {
  const s = newGame(['a', 'b']);
  // giliran 1: pass manual
  let ans = T.snapshot(s).current.answererId;
  assert.equal(T.openCard(s).ok, true);
  assert.equal(T.passTurn(s, ans).ok, true);
  assert.equal(s.history[0].passed, true);
  assert.equal(T.snapshot(s).players.find((p) => p.id === ans).passLeft, 0);
  // jalan terus sampai pemain yang sama kena lagi & mencoba pass lagi
  let guard = 0;
  while (s.phase !== 'finished' && guard++ < 20) {
    const cur = T.snapshot(s).current.answererId;
    assert.equal(T.openCard(s).ok, true);
    if (cur === ans) {
      assert.equal(T.passTurn(s, cur).ok, false); // jatah habis
      assert.equal(T.timeoutTurn(s).ok, true); // timeout tetap bisa
      assert.equal(T.snapshot(s).players.find((p) => p.id === cur).passLeft, 0);
    } else {
      assert.equal(T.submitAnswer(s, cur, 'jawab').ok, true);
      assert.equal(T.endTurn(s).ok, true);
    }
  }
  assert.equal(s.phase, 'finished');
});

test('reaksi: batas 2 per pemain, poin benar, kurang greget -5 sekali saja', () => {
  const s = newGame(['a', 'b', 'c']);
  const ans = T.snapshot(s).current.answererId;
  const [x, y] = others(s, ans);
  assert.equal(T.openCard(s).ok, true);
  assert.equal(T.react(s, x, 'lucu').ok, false); // belum fase reaksi
  assert.equal(T.submitAnswer(s, ans, 'cerita paling seru').ok, true);
  assert.equal(T.react(s, ans, 'lucu').ok, false); // tidak bisa ke sendiri
  assert.equal(T.react(s, x, 'ngakak').ok, false); // jenis tidak dikenal
  assert.equal(T.react(s, x, 'lucu').ok, true); // +10
  assert.equal(T.react(s, x, 'nangis').ok, true); // +15
  assert.equal(T.react(s, x, 'lovely').ok, false); // sudah 2x
  assert.equal(T.react(s, y, 'marah').ok, true); // +15
  assert.equal(T.kurangGreget(s, x).ok, true); // -5
  assert.equal(T.kurangGreget(s, x).ok, false); // hanya 1x
  assert.equal(T.kurangGreget(s, y).ok, true); // -5
  const pts = T.snapshot(s).players.find((p) => p.id === ans).points;
  assert.equal(pts, 30);
  assert.equal(T.endTurn(s).ok, true);
  const h = s.history[0];
  assert.equal(h.pointsEarned, 30);
  assert.deepEqual(h.counts, { lucu: 1, nangis: 1, lovely: 0, marah: 1 });
  assert.equal(h.kurangGreget, 2);
});

test('penghargaan akhir: top scorer + jawaban terbaik per kategori', () => {
  const s = newGame(['a', 'b', 'c']);
  const script = [
    (ans, o) => { T.react(s, o[0], 'lucu'); T.react(s, o[1], 'lucu'); },
    (ans, o) => { T.react(s, o[0], 'nangis'); T.react(s, o[1], 'nangis'); },
    (ans, o) => { T.react(s, o[0], 'lovely'); T.react(s, o[1], 'marah'); },
  ];
  const answerers = [];
  for (let i = 0; i < 3; i++) {
    const ans = T.snapshot(s).current.answererId;
    answerers.push(ans);
    assert.equal(T.openCard(s).ok, true);
    assert.equal(T.submitAnswer(s, ans, 'jawaban nomor ' + i).ok, true);
    script[i](ans, others(s, ans));
    assert.equal(T.endTurn(s).ok, true);
  }
  // sisa giliran (total 10) dimainkan polos tanpa reaksi: penghargaan
  // dari 3 jawaban pertama tidak berubah
  while (s.phase !== 'finished') playSimpleTurn(s);
  assert.equal(s.history.length, 10);
  assert.equal(s.phase, 'finished');
  assert.equal(s.awards.funniest.playerId, answerers[0]);
  assert.equal(s.awards.funniest.count, 2);
  assert.equal(s.awards.saddest.playerId, answerers[1]);
  assert.equal(s.awards.loveliest.playerId, answerers[2]);
  assert.equal(s.awards.mostEmotional.playerId, answerers[2]);
  assert.equal(s.awards.topScorer.playerId, answerers[1]); // 2x15 = 30
  assert.equal(s.awards.topScorer.points, 30);
});

test('Set Aturan: host memilih batas pertanyaan dari daftar resmi', () => {
  for (const c of [8, 10, 12, 16, 20, 24]) {
    const s = newGame(['a', 'b'], { totalQuestions: c });
    assert.equal(s.totalTurns, c);
    assert.equal(T.snapshot(s).explicitMode, false);
  }
  assert.equal(T.createGame({ playerIds: ['a', 'b'], questions: BANK,
    totalQuestions: 7 }).ok, false);
  assert.equal(T.createGame({ playerIds: ['a', 'b'], questions: BANK,
    totalQuestions: 15 }).ok, false);
});

test('Mode Eksplisit: ASK mati total, semua soal murni dari kartu eksplisit', () => {
  const s = newGame(['a', 'b', 'c'],
    { questions: Q.EXPLICIT, explicitMode: true });
  assert.equal(T.snapshot(s).explicitMode, true);
  const ans = T.snapshot(s).current.answererId;
  const other = others(s, ans)[0];
  const claim = T.claimAsk(s, other);
  assert.equal(claim.ok, false);
  assert.match(claim.error, /Eksplisit/);
  while (s.phase !== 'finished') playSimpleTurn(s);
  assert.equal(s.history.length, 10);
  const deck = new Set(Q.EXPLICIT);
  for (const h of s.history) {
    assert.equal(h.source, 'card');
    assert.ok(deck.has(h.question), 'soal harus dari bank eksplisit');
  }
});

test('ASK menggantung: penanya tidak kirim soal -> giliran hangus, PASS penjawab utuh', () => {
  const s = newGame(['a', 'b', 'c']);
  const ans = T.snapshot(s).current.answererId;
  const asker = others(s, ans)[0];
  assert.equal(T.expireAskWindow(s).ok, false); // belum ada klaim
  assert.equal(T.claimAsk(s, asker).ok, true);
  const r = T.expireAskWindow(s);
  assert.equal(r.ok, true);
  assert.equal(r.events[0].type, 'ask_expired');
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].passed, true);
  assert.equal(s.history[0].source, 'ask');
  assert.equal(s.history[0].askerId, asker);
  // jatah PASS penjawab tidak ikut terbakar; jatah ASK penanya tetap hangus
  assert.equal(T.snapshot(s).players.find((p) => p.id === ans).passLeft, 1);
  assert.equal(T.snapshot(s).players.find((p) => p.id === asker).askLeft, 1);
  assert.equal(s.phase, 'ask_window'); // giliran berikutnya sudah mulai
});

test('room truth: maksimal 8 pemain, tipe game dikenal RoomManager', () => {
  const { RoomManager } = require('../game/rooms.js');
  const rm = new RoomManager();
  const mk = (i) => ({ id: 'p' + i, nickname: 'P' + i, socket: null });
  const host = mk(0);
  const r = rm.create('truth', host);
  assert.equal(r.ok, true);
  assert.deepEqual(r.room.truthSettings, { totalQuestions: null, explicitMode: false });
  for (let i = 1; i < 8; i++) assert.equal(rm.addPlayer(r.room, mk(i)).ok, true);
  assert.equal(rm.addPlayer(r.room, mk(8)).ok, false); // kursi ke-9 ditolak
});

test('validator pesan WS truth: rute truth_* terdaftar dan ketat', () => {
  const vm = (type, data) => V.validateMessage(JSON.stringify({ type, data }));
  const rules = vm('truth_set_rules', { totalQuestions: 12, explicitMode: true });
  assert.equal(rules.ok, true);
  assert.deepEqual(rules.data, { totalQuestions: 12, explicitMode: true });
  assert.equal(vm('truth_set_rules', { totalQuestions: 13 }).ok, false);
  assert.equal(vm('truth_set_rules', { totalQuestions: null }).ok, true);
  assert.equal(vm('truth_ask_question', { question: 'pertanyaan sah?' }).ok, true);
  assert.equal(vm('truth_ask_question', { question: 'ab' }).ok, false);
  assert.equal(vm('truth_answer', { text: 'jawaban sah' }).ok, true);
  assert.equal(vm('truth_answer', { text: '   ' }).ok, false);
  assert.equal(vm('truth_react', { kind: 'lucu' }).ok, true);
  assert.equal(vm('truth_react', { kind: 'ngakak' }).ok, false);
  assert.equal(vm('truth_ask', {}).ok, true);
  assert.equal(vm('truth_pass', {}).ok, true);
  assert.equal(vm('truth_kurang_greget', {}).ok, true);
  assert.equal(vm('truth_next', {}).ok, true);
  const cr = vm('create_room', { game: 'truth' });
  assert.equal(cr.ok, true);
  const br = vm('create_truth_bot_room', { size: 4 });
  assert.equal(br.ok, true);
  assert.equal(br.data.size, 4);
  assert.equal(vm('create_truth_bot_room', { size: 1 }).ok, false);
  assert.equal(vm('create_truth_bot_room', { size: 9 }).ok, false);
});

test('bot Truth: kolam jawaban simulasi sehat', () => {
  const B = require('../game/bot.js');
  assert.ok(B.TRUTH_FAKE_ANSWERS.length >= 12);
  assert.equal(new Set(B.TRUTH_FAKE_ANSWERS).size, B.TRUTH_FAKE_ANSWERS.length);
  for (const a of B.TRUTH_FAKE_ANSWERS) {
    assert.ok(a.length >= 1 && a.length <= 1000);
  }
  assert.ok(B.TRUTH_FAKE_ANSWERS.includes(B.pickTruthAnswer(() => 0)));
});

test('validator truth: batas teks ASK, jawaban, dan jenis reaksi', () => {
  assert.equal(V.validAskQuestion('ab').ok, false);
  assert.equal(V.validAskQuestion('pertanyaan yang sah?').ok, true);
  assert.equal(V.validAskQuestion('x'.repeat(201)).ok, false);
  assert.equal(V.validAnswerText('').ok, false);
  assert.equal(V.validAnswerText(' jawaban sah ').ok, true);
  assert.equal(V.validAnswerText('x'.repeat(1001)).ok, false);
  assert.equal(V.validReactionKind('lucu').ok, true);
  assert.equal(V.validReactionKind('greget').ok, false);
});
