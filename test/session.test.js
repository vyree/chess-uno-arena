'use strict';
/**
 * Misi 9 integration tests: the room/session model.
 * - a room can be joined mid-game: the newcomer spectates (read-only)
 * - after the game, the DECISION PHASE opens: the next session starts
 *   only when every session player has decided
 * - voting out = leaving the game, NOT the room (they watch; the room
 *   falls back to its lobby when too few continue)
 * - a spectator can opt in and joins the next session
 * - the 60s decision timer (shrunk via DECISION_MS) counts silence as
 *   "not continuing"
 * Chess carries the flow tests (scholar's mate ends a game fast and
 * deterministically); one UNO smoke test covers the round flow.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3219;
const TIMER_PORT = 3220;
let server = null;
let timerServer = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(port, extraEnv) {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: 'ignore',
  });
  return proc;
}

async function waitHealthy(port) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > 8000) throw new Error('server tidak mau naik');
    await sleep(100);
  }
}

before(async () => {
  server = startServer(PORT, { DECISION_MS: '30000' });
  timerServer = startServer(TIMER_PORT, { DECISION_MS: '1200' });
  await waitHealthy(PORT);
  await waitHealthy(TIMER_PORT);
});

after(() => {
  if (server) server.kill('SIGKILL');
  if (timerServer) timerServer.kill('SIGKILL');
});

let seq = 0;
class TClient {
  constructor(port, nickname) {
    this.port = port;
    this.nickname = nickname + (++seq);
    this.inbox = [];
    this.waiters = [];
    this.playerId = null;
    this.code = null;
  }
  async connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'welcome') this.playerId = m.playerId;
      if (m.type === 'lobby_update') this.code = m.code;
      this.inbox.push(m);
      this.waiters = this.waiters.filter((w) => !w(m));
    });
    await new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.send('hello', { nickname: this.nickname });
    await this.waitFor((m) => m.type === 'welcome');
    return this;
  }
  send(type, data = {}) { this.ws.send(JSON.stringify({ type, data })); }
  waitFor(fn, timeout = 8000) {
    const hit = this.inbox.find(fn);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout menunggu pesan')), timeout);
      this.waiters.push((m) => {
        if (fn(m)) { clearTimeout(timer); resolve(m); return true; }
        return false;
      });
    });
  }
  latest(type) {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      if (this.inbox[i].type === type) return this.inbox[i];
    }
    return null;
  }
  async createRoom(game) {
    this.send('create_room', { game });
    const l = await this.waitFor((m) => m.type === 'lobby_update');
    this.code = l.code;
    return l.code;
  }
  async joinRoom(code) {
    this.code = code;
    this.send('join_room', { code });
  }
  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

// Scholar's mate: host (white) mates the guest in 7 half-moves.
const MATE = [
  [0, 'e2', 'e4'], [1, 'e7', 'e5'], [0, 'f1', 'c4'], [1, 'b8', 'c6'],
  [0, 'd1', 'h5'], [1, 'g8', 'f6'], [0, 'h5', 'f7'],
];
async function playMate(a, b) {
  const players = [a, b];
  for (const [who, from, to] of MATE) {
    const c = players[who];
    const other = players[1 - who];
    // wait until it is really this side's turn on the mover's screen
    await c.waitFor((m) => m.type === 'game_state' && m.state
      && m.state.turn === (who === 0 ? 'w' : 'b') && !m.state.over);
    c.send('chess_move', { from, to });
    if (!(from === 'h5' && to === 'f7')) {
      await other.waitFor((m) => m.type === 'game_state' && m.state && m.state.lastMove && m.state.lastMove.to === to);
    }
  }
}

test('SESI: gabung tengah game = penonton, keputusan bersama, penonton ikut sesi baru', { timeout: 40000 }, async () => {
  const a = await new TClient(PORT, 'HostSesi').connect();
  const b = await new TClient(PORT, 'TamuSesi').connect();
  const c = await new TClient(PORT, 'Nyusul').connect();
  const code = await a.createRoom('chess');
  await b.joinRoom(code);
  await b.waitFor((m) => m.type === 'lobby_update');
  a.send('start_game');
  await a.waitFor((m) => m.type === 'game_state' && m.status === 'playing');

  // C joins mid-game: spectator snapshot, read-only
  await c.joinRoom(code);
  const specSnap = await c.waitFor((m) => m.type === 'game_state');
  assert.equal(specSnap.spectating, true, 'penyusul harus berstatus penonton');
  assert.equal(specSnap.status, 'playing');
  c.send('chess_move', { from: 'e2', to: 'e4' });
  const err = await c.waitFor((m) => m.type === 'error');
  assert.match(err.message, /menonton/);

  await playMate(a, b);
  const over = await a.waitFor((m) => m.type === 'game_over');
  assert.equal(over.decision, true, 'room multiplayer harus masuk fase keputusan');
  const dec = await c.waitFor((m) => m.type === 'decision_update');
  assert.equal(dec.roster.length, 2, 'roster = 2 pemain sesi');
  assert.ok(dec.spectators.some((s) => s.id === c.playerId), 'penonton tampil di panel');

  // A says yes — the session must NOT start while B is undecided
  a.inbox.length = 0; b.inbox.length = 0;
  a.send('decide', { play: true });
  await a.waitFor((m) => m.type === 'decision_update'
    && m.roster.some((r) => r.id === a.playerId && r.state === 'in'));
  await sleep(400);
  assert.ok(!a.inbox.some((m) => m.type === 'game_state' && m.status === 'playing'),
    'game TIDAK boleh mulai sebelum semua memutuskan');

  // C opts in, B opts out -> new session is A + C; B watches
  c.send('decide', { play: true });
  b.send('decide', { play: false });
  const newState = await a.waitFor((m) => m.type === 'game_state' && m.status === 'playing');
  const ids = newState.players.map((p) => p.id).sort();
  assert.deepEqual(ids, [a.playerId, c.playerId].sort(), 'sesi baru = yang lanjut + penonton yang ikut');
  const bSnap = await b.waitFor((m) => m.type === 'game_state' && m.spectating === true);
  assert.ok(bSnap, 'yang tidak lanjut menonton sesi baru dari dalam room');
  a.close(); b.close(); c.close();
});

test('KEPUTUSAN: yang keluar tetap anggota room; sesi kurang orang -> balik lobby', { timeout: 40000 }, async () => {
  const a = await new TClient(PORT, 'HostDua').connect();
  const b = await new TClient(PORT, 'TamuDua').connect();
  const code = await a.createRoom('chess');
  await b.joinRoom(code);
  await b.waitFor((m) => m.type === 'lobby_update');
  a.send('start_game');
  await a.waitFor((m) => m.type === 'game_state' && m.status === 'playing');
  await playMate(a, b);
  await a.waitFor((m) => m.type === 'game_over');
  await a.waitFor((m) => m.type === 'decision_update');

  a.inbox.length = 0; b.inbox.length = 0; // ignore pre-game lobby snapshots
  a.send('decide', { play: true });
  b.send('leave_game'); // out of the GAME, still in the room
  const lobby = await a.waitFor((m) => m.type === 'lobby_update');
  assert.ok(lobby.players.some((p) => p.id === b.playerId),
    'pemain yang keluar game tetap anggota room di lobby');
  assert.equal(lobby.status, 'lobby');

  // and the member can play the next lobby-started session again
  b.inbox.length = 0;
  a.send('start_game');
  const st = await b.waitFor((m) => m.type === 'game_state' && m.status === 'playing');
  assert.ok(st.players.some((p) => p.id === b.playerId), 'anggota lobby ikut sesi berikutnya');
  assert.notEqual(st.spectating, true);
  a.close(); b.close();
});

test('TIMER: diam 60 detik (versi tes 1,2 detik) = tidak lanjut', { timeout: 30000 }, async () => {
  const a = await new TClient(TIMER_PORT, 'HostTimer').connect();
  const b = await new TClient(TIMER_PORT, 'TamuTimer').connect();
  const code = await a.createRoom('chess');
  await b.joinRoom(code);
  await b.waitFor((m) => m.type === 'lobby_update');
  a.send('start_game');
  await a.waitFor((m) => m.type === 'game_state' && m.status === 'playing');
  await playMate(a, b);
  await a.waitFor((m) => m.type === 'decision_update');
  a.inbox.length = 0; // ignore pre-game lobby snapshots
  a.send('decide', { play: true });
  // B stays silent: the timer must resolve without B, and with only
  // one "yes" the room falls back to its lobby.
  const lobby = await a.waitFor((m) => m.type === 'lobby_update', 6000);
  assert.equal(lobby.status, 'lobby');
  assert.ok(lobby.players.some((p) => p.id === b.playerId), 'yang diam tetap anggota room');
  a.close(); b.close();
});

test('UNO: ronde selesai -> panel keputusan -> ronde baru untuk yang lanjut', { timeout: 90000 }, async () => {
  const a = await new TClient(PORT, 'UnoSatu').connect();
  const b = await new TClient(PORT, 'UnoDua').connect();
  const code = await a.createRoom('uno');
  await b.joinRoom(code);
  await b.waitFor((m) => m.type === 'lobby_update');
  a.send('start_game', { mode: 'normal' });
  // dumb autoplay on both sides until the round ends
  const auto = (client) => {
    client.ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type !== 'game_state' || m.game !== 'uno' || !m.state || m.state.over) return;
      const st = m.state;
      const me = m.players.find((p) => p.id === m.you);
      if (!me || st.turn !== me.seat) return;
      const hand = st.hands[me.seat] || [];
      const idx = st.playable ? st.playable.findIndex(Boolean) : -1;
      // small delay: instant spam trips the server's rate limiter,
      // which silently drops the move and stalls the round
      const act = () => {
        if (idx >= 0) {
          const card = hand[idx];
          client.send('uno_play', {
            cardId: card.id, saidUno: hand.length === 2,
            wildColor: (card.kind === 'wild' || card.kind === 'wild4') ? 'red' : undefined,
          });
        } else if (st.drewThisTurn) client.send('uno_pass');
        else client.send('uno_draw');
      };
      setTimeout(act, 150);
    });
  };
  auto(a); auto(b);
  const over = await a.waitFor((m) => m.type === 'game_over' && m.game === 'uno', 60000);
  assert.equal(over.decision, true);
  await a.waitFor((m) => m.type === 'decision_update');
  a.send('decide', { play: true });
  b.send('decide', { play: true });
  const round2 = await a.waitFor((m) => m.type === 'game_state' && m.game === 'uno'
    && m.status === 'playing' && m.round === 2, 10000);
  assert.equal(round2.round, 2, 'ronde kedua harus berjalan untuk yang lanjut');
  a.close(); b.close();
});
