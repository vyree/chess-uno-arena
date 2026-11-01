'use strict';
/**
 * UNO mid-game leave tests (2026-11-01, Sensei):
 * 1. A player who leaves mid-game is replaced by a bot IN PLACE (same
 *    seat, same hand) while organics remain — the game continues.
 * 2. Host ownership passes to a random remaining organic.
 * 3. When no organics remain, the game ends with no winner and the
 *    session is destroyed (no stuck room).
 * Runs a real server on a test port with slow bots so nothing finishes
 * on its own mid-test.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3218;
const WSURL = `ws://127.0.0.1:${PORT}`;
let server = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(nick) {
    this.nick = nick;
    this.msgs = [];
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
  lastGameState() {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      if (this.msgs[i].type === 'game_state') return this.msgs[i];
    }
    return null;
  }
}

async function makeRoom(game, hostNick, ...guestNicks) {
  const host = new Client(hostNick);
  await host.connect(); host.hello();
  await host.waitFor((m) => m.type === 'welcome', 4000, 'host welcome');
  host.send('create_room', { game });
  const lobby = await host.waitFor((m) => m.type === 'lobby_update', 4000, 'host lobby');
  const guests = [];
  for (const nick of guestNicks) {
    const g = new Client(nick);
    await g.connect(); g.hello();
    await g.waitFor((m) => m.type === 'welcome', 4000, 'guest welcome');
    g.send('join_room', { code: lobby.code });
    await g.waitFor((m) => m.type === 'lobby_update', 4000, 'guest lobby');
    guests.push(g);
  }
  return { host, guests, code: lobby.code };
}

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      UNO_BOT_THINK_MS: '5000', // slow bots: nothing finishes on its own
      CHESS_AI_THINK_MS: '50',
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

test('leaver diganti bot, game lanjut, host pindah ke organik acak', async () => {
  const { host, guests, code } = await makeRoom('uno', 'TuanHost', 'TamuA', 'TamuB');
  const [a, b] = guests;
  try {
    host.send('start_game', { mode: 'normal' });
    await host.waitFor((m) => m.type === 'game_state' && m.status === 'playing', 4000, 'game mulai');
    const hostId = host.playerId;

    host.send('leave_room');
    await host.waitFor((m) => m.type === 'left_room', 4000, 'host left_room');

    // The game continues with the leaver's seat driven by a bot.
    const gs = await a.waitFor(
      (m) => m.type === 'game_state' && m.status === 'playing'
        && m.players.some((p) => p.id === hostId && p.isBot),
      4000, 'game_state pasca-leave');
    const replaced = gs.players.find((p) => p.id === hostId);
    assert.ok(/^Bot /.test(replaced.nickname), 'kursi leaver jadi bot: ' + replaced.nickname);
    assert.notEqual(gs.hostId, hostId, 'host pindah dari leaver');
    assert.ok([a.playerId, b.playerId].includes(gs.hostId), 'host baru = organik tersisa');
    // System announcement reaches the table.
    await a.waitFor(
      (m) => m.type === 'chat' && /digantikan/.test(m.text || ''),
      4000, 'pengumuman pergantian bot');
    void code;
  } finally {
    host.close(); a.close(); b.close();
  }
});

test('organik terakhir keluar: game selesai tanpa pemenang, session destroy', async () => {
  const { host, guests, code } = await makeRoom('uno', 'SoloHost', 'SoloTamu');
  const [a] = guests;
  try {
    host.send('start_game', { mode: 'normal' });
    await host.waitFor((m) => m.type === 'game_state' && m.status === 'playing', 4000, 'game mulai');

    a.send('leave_room');
    await a.waitFor((m) => m.type === 'left_room', 4000, 'tamu left_room');
    await host.waitFor(
      (m) => m.type === 'game_state' && m.players.some((p) => p.id === a.playerId && p.isBot),
      4000, 'tamu jadi bot');

    host.send('leave_room');
    const over = await host.waitFor(
      (m) => m.type === 'game_over' && m.result && m.result.reason === 'semua_keluar',
      4000, 'game_over tanpa pemenang');
    assert.ok(!over.winnerNickname, 'tidak ada pemenang');
    await host.waitFor((m) => m.type === 'left_room', 4000, 'host left_room');

    // The session is gone: joining the code must fail.
    const c = new Client('Pengintip');
    await c.connect(); c.hello();
    await c.waitFor((m) => m.type === 'welcome', 4000, 'pengintip welcome');
    c.send('join_room', { code });
    await c.waitFor((m) => m.type === 'error', 4000, 'join room mati ditolak');
    c.close();
  } finally {
    host.close(); a.close();
  }
});
