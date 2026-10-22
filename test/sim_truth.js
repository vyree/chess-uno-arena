'use strict';
/**
 * Integration simulation for Truth or Truth (Misi 3 Fase 2).
 * Real WebSocket clients play full games against a live server.
 * Start the server with fast truth timings first, e.g.:
 *   TRUTH_SPIN_MS=250 TRUTH_ASK_WINDOW_MS=900 TRUTH_ASK_SUBMIT_MS=900 \
 *   TRUTH_ANSWER_MS=2500 TRUTH_REACT_MS=700 PORT=3000 node server.js
 * Scenarios: A) normal 2-player game with Set Aturan, ASK claim, card
 * auto-open, PASS, answer timeout, reactions, MC narration, game over.
 * B) Explicit Mode: ASK rejected, notice event, cards only from the
 * explicit deck. C) Bot room: one human playtests solo — bots fill the
 * seats, simulate answers, react to the human, game completes.
 * Suggested fast timings for the full run:
 *   TRUTH_SPIN_MS=200 TRUTH_ASK_WINDOW_MS=600 TRUTH_ASK_SUBMIT_MS=900 \
 *   TRUTH_ANSWER_MS=6000 TRUTH_REACT_MS=3000
 * Server must not crash.
 */
const WebSocket = require('ws');
const Q = require('../game/questions.js');

const WSURL = 'ws://localhost:3000';
let failures = 0;

function check(name, cond, extra) {
  if (cond) console.log(`  PASS: ${name}`);
  else { console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); failures++; }
}

class Sim {
  constructor(nick) {
    this.nick = nick;
    this.queues = {};
    this.waiters = {};
    this.playerId = null;
    this.lobby = null;   // latest lobby_update
    this.state = null;   // latest game_state
    this.events = [];    // flattened truth_event events
    this.chats = [];
    this.over = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WSURL);
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ type: 'hello', data: { nickname: this.nick } }));
        resolve();
      });
      this.ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.type === 'welcome') this.playerId = m.playerId;
        if (m.type === 'lobby_update') this.lobby = m;
        if (m.type === 'game_state') this.state = m;
        if (m.type === 'truth_event') this.events.push(...m.events);
        if (m.type === 'chat') this.chats.push(m);
        if (m.type === 'game_over') this.over = m;
        const w = this.waiters[m.type];
        if (w && w.length) w.shift()(m);
        else (this.queues[m.type] || (this.queues[m.type] = [])).push(m);
      });
      this.ws.on('error', reject);
    });
  }
  send(type, data) { this.ws.send(JSON.stringify({ type, data: data || {} })); }
  next(type, timeoutMs) {
    const q = this.queues[type];
    if (q && q.length) return Promise.resolve(q.shift());
    return new Promise((resolve, reject) => {
      const done = (m) => { clearTimeout(timer); resolve(m); };
      const timer = setTimeout(() => {
        const w = this.waiters[type] || [];
        const i = w.indexOf(done);
        if (i >= 0) w.splice(i, 1);
        reject(new Error(`timeout menunggu ${type} [${this.nick}]`));
      }, timeoutMs || 20000);
      (this.waiters[type] || (this.waiters[type] = [])).push(done);
    });
  }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, label, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 20000)) {
    const v = fn();
    if (v) return v;
    await sleep(40);
  }
  throw new Error('timeout menunggu: ' + label);
}

function stage(sim) { return sim.state ? sim.state.truthStage : null; }
function snap(sim) { return sim.state ? sim.state.state : null; }
function answerer(sim) { const s = snap(sim); return s ? s.current.answererId : null; }
function otherOf(a, b) { return answerer(a) === a.playerId ? b : a; }
function selfOf(a, b) { return answerer(a) === a.playerId ? a : b; }

// Play one plain turn: wait for the card, answer it, skip the reaction
// wait via truth_next from the answerer.
async function plainTurn(a, b, label) {
  await until(() => stage(a) === 'answer', label + ': kartu terbuka');
  const ans = selfOf(a, b);
  ans.send('truth_answer', { text: 'jawaban jujur dari ' + ans.nick });
  await until(() => stage(a) === 'react', label + ': fase reaksi');
  ans.send('truth_next');
}

async function scenarioA() {
  console.log('Skenario A: game normal 2 pemain + Set Aturan + MC');
  const a = new Sim('Andini');
  const b = new Sim('Bagas');
  await a.connect(); await b.connect();
  a.send('create_room', { game: 'truth' });
  const lobby = await a.next('lobby_update');
  const code = lobby.code;
  check('room truth terbuat', !!code);
  check('Set Aturan default di lobby', lobby.truthSettings
    && lobby.truthSettings.totalQuestions === null
    && lobby.truthSettings.explicitMode === false);
  b.send('join_room', { code });
  await b.next('lobby_update');

  b.send('truth_set_rules', { totalQuestions: 12 });
  const err = await b.next('error');
  check('non-host tidak bisa set aturan', /Hanya pembuat room/.test(err.message), err.message);
  a.send('truth_set_rules', { totalQuestions: 8 });
  const lobby2 = await until(
    () => a.lobby && a.lobby.truthSettings.totalQuestions === 8 && a.lobby,
    'lobby_update aturan baru');
  check('host set batas 8 pertanyaan', lobby2.truthSettings.totalQuestions === 8);

  a.send('start_game');
  await until(() => a.state && a.state.game === 'truth', 'game_state truth');
  check('totalTurns = 8 dari Set Aturan', snap(a).totalTurns === 8);
  check('mode eksplisit mati', snap(a).explicitMode === false);
  check('tahap awal = spin', stage(a) === 'spin');
  await until(() => a.chats.some((c) => c.from === 'MC'), 'MC menyapa');
  check('MC aktif untuk room 2 pemain', true);

  // --- Giliran 1: klaim ASK ---
  await until(() => stage(a) === 'ask', 'jendela ASK giliran 1');
  await until(() => a.events.some((e) => e.type === 'ask_window_open'), 'event ask_window_open');
  check('event ask_window_open terkirim', true);
  const asker = otherOf(a, b);
  const ans1 = selfOf(a, b);
  asker.send('truth_ask');
  await until(() => snap(a).current.askerId === asker.playerId, 'klaim ASK tercatat');
  check('event ask_claimed terkirim', a.events.some((e) => e.type === 'ask_claimed'));
  asker.send('truth_ask_question', { question: 'Kapan terakhir kamu berbohong?' });
  await until(() => stage(a) === 'answer', 'tahap jawab setelah ASK');
  check('soal dari ASK tampil', snap(a).current.question === 'Kapan terakhir kamu berbohong?');
  check('sumber soal = ask', snap(a).current.source === 'ask');
  ans1.send('truth_answer', { text: 'Kemarin, soal hal kecil saja.' });
  await until(() => stage(a) === 'react', 'fase reaksi giliran 1');
  asker.send('truth_react', { kind: 'lucu' });
  asker.send('truth_kurang_greget');
  await until(() => {
    const p = snap(a).players.find((x) => x.id === ans1.playerId);
    return p && p.points === 5;
  }, 'poin penjawab = 10 - 5');
  check('poin reaksi + kurang greget benar (+10-5=5)', true);
  ans1.send('truth_next');

  // --- Giliran 2: kartu otomatis ---
  await until(() => stage(a) === 'answer' && snap(a).current.source === 'card',
    'kartu terbuka otomatis');
  check('kartu dari bank normal', Q.ALL.includes(snap(a).current.question));
  check('sisa tumpukan berkurang 1', snap(a).deckLeft === Q.ALL.length - 1);
  const ans2 = selfOf(a, b);
  ans2.send('truth_answer', { text: 'Jawaban giliran dua.' });
  await until(() => stage(a) === 'react', 'reaksi giliran 2');
  // jangan kirim truth_next: biarkan timer reaksi yang menutup giliran

  // --- Giliran 3: PASS ---
  await until(() => stage(a) === 'answer' && snap(a).turnNumber === 3, 'giliran 3 menjawab');
  const ans3 = selfOf(a, b);
  ans3.send('truth_pass');
  await until(() => a.events.some((e) => e.type === 'passed'
    && e.playerId === ans3.playerId), 'event passed');
  check('PASS tercatat sebagai event', true);

  // --- Giliran 4: timeout jawaban ---
  await until(() => stage(a) === 'answer' && snap(a).turnNumber === 4, 'giliran 4 menjawab');
  await until(() => a.events.some((e) => e.type === 'answer_timeout'), 'event timeout', 12000);
  check('timeout jawaban menutup giliran', true);

  // --- Giliran 5-8: polos sampai selesai ---
  for (let t = 5; t <= 8; t++) {
    await plainTurn(a, b, 'giliran ' + t);
  }
  const over = await a.next('game_over', 20000);
  check('game_over diterima', over.game === 'truth');
  check('awards ada di game_over', !!(over.awards && over.awards.topScorer));
  check('skor akhir 2 pemain', Array.isArray(over.scores) && over.scores.length === 2);
  check('status room over', a.state.status === 'over');
  check('MC mengumumkan putaran', a.chats.some((c) => c.from === 'MC' && /Putaran ke-/.test(c.text)));
  a.close(); b.close();
}

async function scenarioB() {
  console.log('Skenario B: Mode Eksplisit');
  const a = new Sim('Citra');
  const b = new Sim('Dimas');
  await a.connect(); await b.connect();
  a.send('create_room', { game: 'truth' });
  const lobby = await a.next('lobby_update');
  b.send('join_room', { code: lobby.code });
  await b.next('lobby_update');
  a.send('truth_set_rules', { explicitMode: true, totalQuestions: 8 });
  const lobby2 = await until(
    () => a.lobby && a.lobby.truthSettings.explicitMode === true && a.lobby,
    'lobby_update eksplisit');
  check('toggle eksplisit tersimpan', lobby2.truthSettings.explicitMode === true);

  a.send('start_game');
  await until(() => a.state && a.state.game === 'truth', 'game_state truth B');
  check('snapshot explicitMode = true', snap(a).explicitMode === true);
  check('totalTurns = 8', snap(a).totalTurns === 8);

  await until(() => stage(a) === 'ask', 'jeda eksplisit');
  await until(() => a.events.some((e) => e.type === 'explicit_question_incoming'),
    'event explicit_question_incoming');
  check('event explicit_question_incoming terkirim', true);
  const asker = otherOf(a, b);
  asker.send('truth_ask');
  const err = await asker.next('error');
  check('ASK ditolak di Mode Eksplisit', /Eksplisit/.test(err.message), err.message);

  const deck = new Set(Q.EXPLICIT);
  for (let t = 1; t <= 8; t++) {
    await until(() => stage(a) === 'answer', 'kartu eksplisit giliran ' + t);
    check(`soal giliran ${t} dari bank eksplisit`, deck.has(snap(a).current.question),
      snap(a).current.question);
    const ans = selfOf(a, b);
    ans.send('truth_answer', { text: 'dijawab sejujurnya' });
    await until(() => stage(a) === 'react', 'reaksi giliran ' + t);
    ans.send('truth_next');
  }
  const over = await a.next('game_over', 20000);
  check('game eksplisit selesai dengan awards', !!(over.awards && over.awards.topScorer));
  a.close(); b.close();
}

async function scenarioC() {
  console.log('Skenario C: room bot Truth (uji coba solo)');
  const B = require('../game/bot.js');
  const h = new Sim('Sensei');
  await h.connect();
  h.send('create_truth_bot_room', { size: 4 });
  await until(() => h.state && h.state.game === 'truth', 'game_state bot room');
  check('bot room: 4 pemain', h.state.players.length === 4);
  check('bot room: 3 bot mengisi kursi', h.state.players.filter((p) => p.isBot).length === 3);
  check('bot room: total 10 pertanyaan', snap(h).totalTurns === 10);
  const botIds = new Set(h.state.players.filter((p) => p.isBot).map((p) => p.id));
  const fakeSet = new Set(B.TRUTH_FAKE_ANSWERS);
  let botAnswered = false;
  let humanAnswered = false;
  const deadline = Date.now() + 150000;
  while (!h.over && Date.now() < deadline) {
    const s = snap(h);
    const stg = stage(h);
    if (s && stg === 'answer' && s.current.answererId === h.playerId) {
      humanAnswered = true;
      h.send('truth_answer', { text: 'Jawaban asli dari Sensei.' });
      await sleep(300);
    } else if (s && stg === 'react') {
      if (s.current.answer && botIds.has(s.current.answererId)
          && fakeSet.has(s.current.answer)) botAnswered = true;
      if (s.current.answererId === h.playerId) {
        await sleep(1200); // beri waktu bot bereaksi dulu
        if (stage(h) === 'react') h.send('truth_next');
      }
    }
    await sleep(120);
  }
  check('game bot selesai (game_over)', !!h.over);
  check('bot terbukti menjawab (simulasi)', botAnswered);
  check('manusia ikut menjawab di gilirannya', humanAnswered);
  const me = h.over ? h.over.scores.find((x) => x.playerId === h.playerId) : null;
  check('poin manusia > 0 dari reaksi bot', !!me && me.points > 0, me && String(me.points));
  check('skor akhir 4 pemain', !!h.over && h.over.scores.length === 4);
  check('MC menemani room bot', h.chats.some((c) => c.from === 'MC'));
  h.close();
}

(async () => {
  try {
    await scenarioA();
    await scenarioB();
    await scenarioC();
  } catch (e) {
    console.log('  FAIL: pengecualian — ' + e.message);
    failures++;
  }
  console.log(failures === 0 ? 'SIM TRUTH: SEMUA LOLOS' : `SIM TRUTH: ${failures} GAGAL`);
  process.exit(failures === 0 ? 0 : 1);
})();
