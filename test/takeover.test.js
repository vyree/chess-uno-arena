'use strict';
/**
 * Misi 4C integration tests: a bot takes over a disconnected player's
 * seat in a multiplayer room (name + "bot"), keeps playing it, and the
 * human can reclaim the seat even AFTER the reconnect grace expired
 * (regressions: "kartu jadi 0" destruction + "room sudah mulai main"
 * lockout). Runs a real server on a test port with fast env pins.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3217;
const WSURL = `ws://127.0.0.1:${PORT}`;
let server = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(nick) {
    this.nick = nick;
    this.msgs = [];       // every message, in arrival order
    this.playerId = null;
    this.errors = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WSURL);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.type === 'welcome') this.playerId = m.playerId;
        if (m.type === 'error') this.errors.push(m.message);
        this.msgs.push(m);
      });
    });
  }
  hello() { this.send('hello', { nickname: this.nick }); }
  send(type, data) { this.ws.send(JSON.stringify({ type, data: data || {} })); }
  close() { try { this.ws.terminate(); } catch { /* already gone */ } }
  // Poll the message log until pred(msg) matches; returns the message.
  async waitFor(pred, timeoutMs, label) {
    const start = Date.now();
    let idx = 0;
    for (;;) {
      while (idx < this.msgs.length) {
        const m = this.msgs[idx++];
        if (pred(m)) return m;
      }
      if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${label} [${this.nick}]`);
      await sleep(25);
    }
  }
  mark() { return this.msgs.length; }
  // Like waitFor but only over messages from index `from` onwards —
  // capture the mark BEFORE triggering the event, because the server's
  // response may land before the next await runs.
  async waitFrom(from, pred, timeoutMs, label) {
    const start = Date.now();
    let idx = from;
    for (;;) {
      while (idx < this.msgs.length) {
        const m = this.msgs[idx++];
        if (pred(m)) return m;
      }
      if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${label} [${this.nick}]`);
      await sleep(25);
    }
  }
  waitNext(pred, timeoutMs, label) { return this.waitFrom(this.msgs.length, pred, timeoutMs, label); }
  lastGameState() {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      if (this.msgs[i].type === 'game_state') return this.msgs[i];
    }
    return null;
  }
}

async function makeRoom(game, hostNick, guestNick) {
  const host = new Client(hostNick);
  await host.connect(); host.hello();
  await host.waitFor((m) => m.type === 'welcome', 4000, 'host welcome');
  host.send('create_room', { game });
  const lobby = await host.waitFor((m) => m.type === 'lobby_update', 4000, 'host lobby');
  const guest = new Client(guestNick);
  await guest.connect(); guest.hello();
  await guest.waitFor((m) => m.type === 'welcome', 4000, 'guest welcome');
  guest.send('join_room', { code: lobby.code });
  await guest.waitFor((m) => m.type === 'lobby_update' && m.players.length === 2, 4000, 'guest lobby');
  return { host, guest, code: lobby.code };
}

const seatOf = (state, playerId) => state.players.find((p) => p.id === playerId);

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      BOT_TAKEOVER_MS: '500',
      RECONNECT_GRACE_MS: '1500',
      UNO_BOT_THINK_MS: '50',
      CHESS_AI_THINK_MS: '50',
      TRUTH_SPIN_MS: '150',
      TRUTH_ASK_WINDOW_MS: '300',
      TRUTH_ASK_SUBMIT_MS: '300',
      TRUTH_ANSWER_MS: '8000',
      TRUTH_REACT_MS: '500',
    },
    stdio: 'ignore',
  });
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() - start > 8000) throw new Error('server tidak mau naik');
    await sleep(100);
  }
});

after(() => { if (server) server.kill('SIGKILL'); });

// Drive a human UNO seat with the dumbest legal strategy so the game
// keeps moving while the taken-over seat is observed.
function unoAutoplay(client, mySeat) {
  return setInterval(() => {
    const st = client.lastGameState();
    if (!st || st.status !== 'playing' || !st.state || st.state.over) return;
    if (st.state.turn !== mySeat()) return;
    const hand = st.state.hands[mySeat()];
    if (!Array.isArray(hand)) return;
    const playableIdx = st.state.playable.findIndex(Boolean);
    if (playableIdx >= 0 && !st.state.drewThisTurn) {
      const card = hand[playableIdx];
      client.send('uno_play', {
        cardId: card.id, saidUno: hand.length === 2,
        wildColor: 'red',
      });
    } else if (!st.state.drewThisTurn) {
      client.send('uno_draw');
    } else {
      client.send('uno_pass');
    }
  }, 250);
}

test('UNO: kursi diambil alih bot, bot main, manusia klaim balik LEWAT masa tenggang', { timeout: 40000 }, async () => {
  const { host: a, guest: b, code } = await makeRoom('uno', 'Alpha', 'Beta');
  a.send('start_game', { mode: 'normal' });
  const s0 = await a.waitFor((m) => m.type === 'game_state' && m.status === 'playing', 4000, 'game mulai');
  const aSeat = seatOf(s0, a.playerId).seat;
  const bSeat = seatOf(s0, b.playerId).seat;
  const bId = b.playerId;
  const auto = unoAutoplay(a, () => aSeat);
  try {
    const tDrop = Date.now();
    b.close(); // koneksi putus mendadak

    // 1) kursi tampil sebagai "Beta bot" dan ter-flag takenOver
    const sTaken = await a.waitNext((m) => m.type === 'game_state'
      && seatOf(m, bId) && seatOf(m, bId).takenOver === true, 6000, 'label Beta bot');
    assert.strictEqual(seatOf(sTaken, bId).nickname, 'Beta bot');

    // 2) bot benar-benar memainkan kursi itu (giliran mampir & lewat),
    //    dan kartu Beta TIDAK pernah jadi 0 selama game berjalan
    let sawBotTurn = false;
    let botTurnDone = false;
    let zeroSeen = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !botTurnDone) {
      const st = a.lastGameState();
      if (st && st.status === 'playing') {
        const cnt = st.state.hands[bSeat];
        if (typeof cnt === 'number' && cnt === 0) zeroSeen = true;
        if (st.state.turn === bSeat) sawBotTurn = true;
        else if (sawBotTurn) botTurnDone = true;
      }
      if (a.msgs.some((m) => m.type === 'game_over')) botTurnDone = true;
      await sleep(120);
    }
    assert.ok(botTurnDone, 'giliran kursi bot harus selesai dimainkan bot');
    assert.strictEqual(zeroSeen, false, 'kartu kursi yang diambil alih tidak boleh jadi 0');

    // 3) manusia kembali SETELAH grace (1500ms) habis: rejoin diterima
    const wait = tDrop + 2200 - Date.now();
    if (wait > 0) await sleep(wait);
    const b2 = new Client('Beta');
    await b2.connect();
    const markA = a.mark();
    b2.send('rejoin', { playerId: bId, code });
    const w = await b2.waitFor((m) => m.type === 'welcome' || m.type === 'error', 4000, 'rejoin diterima');
    assert.strictEqual(w.type, 'welcome', `rejoin harus diterima, dapat: ${JSON.stringify(w)}`);
    assert.strictEqual(w.rejoined, true);
    assert.ok(!b2.errors.some((e) => e.includes('Sesi tidak ditemukan')));

    // 4) nama kembali bersih di mata pemain lain
    const sBack = await a.waitFrom(markA, (m) => m.type === 'game_state'
      && seatOf(m, bId) && seatOf(m, bId).nickname === 'Beta' && !seatOf(m, bId).takenOver,
    5000, 'nama kembali Beta');
    assert.ok(sBack);
    b2.close();
  } finally {
    clearInterval(auto);
    a.close();
  }
});

test('UNO: rejoin CEPAT (sebelum takeover) tidak pernah dilabeli bot', { timeout: 20000 }, async () => {
  const { host: a, guest: b, code } = await makeRoom('uno', 'Alpha', 'Beta');
  a.send('start_game', { mode: 'normal' });
  await a.waitFor((m) => m.type === 'game_state' && m.status === 'playing', 4000, 'game mulai');
  const bId = b.playerId;
  b.close();
  await sleep(200); // takeover baru di 500ms — rejoin harus menang balapan
  const b2 = new Client('Beta');
  await b2.connect();
  b2.send('rejoin', { playerId: bId, code });
  const w = await b2.waitFor((m) => m.type === 'welcome' || m.type === 'error', 4000, 'rejoin cepat');
  assert.strictEqual(w.type, 'welcome');
  await sleep(900); // lewati titik takeover: tidak boleh ada label bot
  const bad = a.msgs.filter((m) => m.type === 'game_state'
    && seatOf(m, bId) && seatOf(m, bId).takenOver);
  assert.strictEqual(bad.length, 0, 'kursi yang cepat kembali tidak boleh diambil alih');
  b2.close();
  a.close();
});

test('CATUR: kursi yang ditinggal diisi bot pengisi, lalu diklaim balik', { timeout: 40000 }, async () => {
  const { host: a, guest: b, code } = await makeRoom('chess', 'Alpha', 'Beta');
  a.send('start_game', {});
  await a.waitFor((m) => m.type === 'game_state' && m.status === 'playing', 4000, 'game mulai');
  // Alpha = host = Putih: e2-e4, lalu Beta (Hitam) pergi
  a.send('chess_move', { from: 'e2', to: 'e4' });
  await a.waitNext((m) => m.type === 'game_state' && m.state.turn === 'b', 4000, 'giliran hitam');
  const bId = b.playerId;
  const tDrop = Date.now();
  b.close();

  const sTaken = await a.waitNext((m) => m.type === 'game_state'
    && seatOf(m, bId) && seatOf(m, bId).takenOver === true, 6000, 'label Beta bot');
  assert.strictEqual(seatOf(sTaken, bId).nickname, 'Beta bot');

  // bot pengisi menjawab langkah Hitam -> giliran kembali ke Putih
  await a.waitNext((m) => m.type === 'game_state' && m.state.turn === 'w'
    && m.state.lastMove && m.state.lastMove.from !== 'e2', 12000, 'bot pengisi melangkah');

  const wait = tDrop + 2200 - Date.now();
  if (wait > 0) await sleep(wait);
  const b2 = new Client('Beta');
  await b2.connect();
  const markA = a.mark();
  b2.send('rejoin', { playerId: bId, code });
  const w = await b2.waitFor((m) => m.type === 'welcome' || m.type === 'error', 4000, 'rejoin diterima');
  assert.strictEqual(w.type, 'welcome', `rejoin harus diterima, dapat: ${JSON.stringify(w)}`);
  await a.waitFrom(markA, (m) => m.type === 'game_state'
    && seatOf(m, bId) && seatOf(m, bId).nickname === 'Beta' && !seatOf(m, bId).takenOver,
  5000, 'nama kembali Beta');
  b2.close();
  a.close();
});

test('TRUTH: penjawab yang putus dijawabkan bot, bukan timeout 8 detik', { timeout: 60000 }, async () => {
  const { host: a, guest: b } = await makeRoom('truth', 'Alpha', 'Beta');
  a.send('start_game', {});
  await a.waitFor((m) => m.type === 'game_state' && m.status === 'playing', 4000, 'game mulai');
  const aId = a.playerId;
  const bId = b.playerId;
  b.close(); // Beta pergi sejak awal; bot harus menutup giliran jawabnya

  // Alpha menjawab gilirannya sendiri secepatnya supaya roda cepat
  // sampai ke giliran Beta.
  let answeredTurn = -1;
  const auto = setInterval(() => {
    const st = a.lastGameState();
    if (!st || !st.state || st.status !== 'playing') return;
    if (st.truthStage === 'answer' && st.state.current.answererId === aId
      && st.state.turnNumber !== answeredTurn) {
      answeredTurn = st.state.turnNumber;
      a.send('truth_answer', { text: 'Jawaban Alpha, jujur kok.' });
    }
  }, 200);
  try {
    // tunggu giliran jawab Beta MULAI
    const sB = await a.waitNext((m) => m.type === 'game_state'
      && m.truthStage === 'answer' && m.state.current.answererId === bId,
    25000, 'giliran jawab Beta');
    const turnNo = sB.state.turnNumber;
    const t0 = Date.now();
    // giliran Beta harus DITUTUP bot (answer_submitted / giliran baru),
    // jauh sebelum jendela jawab 8000ms habis
    await a.waitNext((m) => (m.type === 'truth_event'
      && m.events.some((e) => e.type === 'answer_submitted' && e.playerId === bId))
      || (m.type === 'truth_event' && m.events.some((e) => e.type === 'turn_started' && e.turnNumber > turnNo))
      || m.type === 'game_over', 7000, 'giliran Beta ditutup bot');
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 7000, `giliran Beta harus ditutup bot < 7s, aktual ${elapsed}ms`);
    const timedOut = a.msgs.some((m) => m.type === 'truth_event'
      && m.events.some((e) => e.type === 'answer_timeout' && e.playerId === bId));
    assert.strictEqual(timedOut, false, 'tidak boleh ada answer_timeout untuk Beta');
  } finally {
    clearInterval(auto);
    a.close();
  }
});
