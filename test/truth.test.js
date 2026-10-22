'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../game/truth.js');
const V = require('../game/validate.js');

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
  assert.equal(s.totalTurns, 4); // 2 pemain x 2 putaran
  assert.equal(T.snapshot(s).deckLeft, BANK.length);
  assert.equal(s.phase, 'ask_window');
});

test('roda adil: tidak ada pengulangan dalam satu putaran, game selesai', () => {
  const s = newGame(['a', 'b', 'c', 'd']);
  const seenRound1 = [];
  for (let i = 0; i < 4; i++) {
    seenRound1.push(T.snapshot(s).current.answererId);
    playSimpleTurn(s);
  }
  assert.equal(new Set(seenRound1).size, 4);
  assert.equal(s.round, 2);
  for (let i = 0; i < 4; i++) playSimpleTurn(s);
  assert.equal(s.phase, 'finished');
  assert.ok(s.awards);
  assert.equal(s.history.length, 8);
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
  const s = newGame(['a', 'b', 'c'], { rounds: 3 });
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
  const s = newGame(['a', 'b'], { rounds: 2 });
  // giliran 1: pass manual
  let ans = T.snapshot(s).current.answererId;
  assert.equal(T.openCard(s).ok, true);
  assert.equal(T.passTurn(s, ans).ok, true);
  assert.equal(s.history[0].passed, true);
  assert.equal(T.snapshot(s).players.find((p) => p.id === ans).passLeft, 0);
  // jalan terus sampai pemain yang sama kena lagi & mencoba pass lagi
  let guard = 0;
  while (s.phase !== 'finished' && guard++ < 8) {
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
  const s = newGame(['a', 'b', 'c'], { rounds: 1 });
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
  assert.equal(s.phase, 'finished');
  assert.equal(s.awards.funniest.playerId, answerers[0]);
  assert.equal(s.awards.funniest.count, 2);
  assert.equal(s.awards.saddest.playerId, answerers[1]);
  assert.equal(s.awards.loveliest.playerId, answerers[2]);
  assert.equal(s.awards.mostEmotional.playerId, answerers[2]);
  assert.equal(s.awards.topScorer.playerId, answerers[1]); // 2x15 = 30
  assert.equal(s.awards.topScorer.points, 30);
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
