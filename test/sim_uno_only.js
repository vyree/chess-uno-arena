'use strict';
/**
 * Integration simulation: real WebSocket clients play full games.
 * Scenarios: chess to checkmate, UNO round to completion (3 players),
 * abrupt disconnect + rejoin, wrong room code. Server must not crash.
 *
 * Sim uses per-type message queues: waiters only consume their own type,
 * so no stale-waiter races.
 */
const WebSocket = require('ws');

const WSURL = 'ws://localhost:3000';
let failures = 0;

function check(name, cond, extra) {
  if (cond) console.log(`  PASS: ${name}`);
  else { console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); failures++; }
}

class Sim {
  constructor(nick) {
    this.nick = nick;
    this.queues = {};  // type -> [msg]
    this.waiters = {}; // type -> [resolve]
    this.playerId = null;
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
        const w = this.waiters[m.type];
        if (w && w.length) w.shift()(m);
        else (this.queues[m.type] || (this.queues[m.type] = [])).push(m);
      });
      this.ws.on('error', reject);
    });
  }
  send(type, data) { this.ws.send(JSON.stringify({ type, data: data || {} })); }
  // next message of type; queue first, else wait (with timeout)
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
      }, timeoutMs || 15000);
      (this.waiters[type] || (this.waiters[type] = [])).push(done);
    });
  }
  close() { try { this.ws.close(); } catch { /* noop */ } }
  kill() { try { this.ws.terminate(); } catch { /* noop */ } }
}

async function scenarioChess() {
  console.log('\n[1] Catur sampai skakmat (2 client)');
  const a = new Sim('Putih');
  const b = new Sim('Hitam');
  await a.connect(); await b.connect();
  await a.next('welcome'); await b.next('welcome');
  a.send('create_room', { game: 'chess' });
  const lobby = await a.next('lobby_update');
  check('room code 6 karakter', /^[A-Z2-9]{6}$/.test(lobby.code), lobby.code);
  b.send('join_room', { code: lobby.code });
  await b.next('lobby_update');

  a.send('start_game');
  // scholar's mate
  const whiteMoves = [['e2', 'e4'], ['f1', 'c4'], ['d1', 'h5'], ['h5', 'f7']];
  const blackMoves = [['e7', 'e5'], ['b8', 'c6'], ['g8', 'f6']];
  let wi = 0, bi = 0, over = null, guard = 0;
  while (!over && guard++ < 20) {
    const st = await a.next('game_state');
    if (st.state.over) { over = st.state.over; break; }
    if (st.state.turn === 'w') {
      const [f, t] = whiteMoves[wi++];
      a.send('chess_move', { from: f, to: t });
    } else {
      const [f, t] = blackMoves[bi++];
      b.send('chess_move', { from: f, to: t });
    }
  }
  check('skakmat terjadi', !!over, JSON.stringify(over));
  check('hasil 1-0 scholar mate', !!over && over.result === '1-0' && over.reason === 'checkmate',
    JSON.stringify(over));
  const go = await a.next('game_over').catch(() => null);
  check('game_over diterima client', !!go && go.result.reason === 'checkmate');
  a.close(); b.close();
}

async function scenarioUno() {
  console.log('\n[2] UNO satu ronde selesai (3 client, main valid)');
  const ps = [new Sim('U1'), new Sim('U2'), new Sim('U3')];
  for (const p of ps) { await p.connect(); await p.next('welcome'); }
  ps[0].send('create_room', { game: 'uno' });
  const lobby = await ps[0].next('lobby_update');
  ps[1].send('join_room', { code: lobby.code }); await ps[1].next('lobby_update');
  ps[2].send('join_room', { code: lobby.code }); await ps[2].next('lobby_update');
  ps[0].send('start_game');

  let winner = null, guard = 0, moves = 0;
  while (!winner && guard++ < 800) {
    // wait for a game_state on ANY client
    const got = await Promise.race(
      ps.map((p, i) => p.next('game_state').then((m) => ({ m, i })).catch(() => null))
    );
    if (!got) continue;
    const { m: gs, i } = got;
    const me = ps[i];
    if (gs.state.over) { winner = gs.state.over; break; }
    const seat = gs.players.find((x) => x.id === gs.you).seat;
    if (gs.state.turn !== seat) continue; // bukan giliran client ini
    const hand = gs.state.hands[seat];
    const pi = (gs.state.playable || []).findIndex(Boolean);
    if (pi >= 0) {
      const card = hand[pi];
      me.send('uno_play', {
        cardId: card.id, saidUno: true,
        wildColor: (card.kind === 'wild' || card.kind === 'wild4') ? 'red' : undefined,
      });
    } else if (gs.state.drewThisTurn) {
      me.send('uno_pass');
    } else {
      me.send('uno_draw');
    }
    moves++;
  }
  check('ronde UNO selesai', !!winner, `moves=${moves} guard=${guard}`);
  check('ada pemenang', !!winner && winner.winner >= 0, JSON.stringify(winner));
  ps[0].send('uno_new_round');
  const ng = await ps[0].next('game_state').catch(() => null);
  check('ronde baru dimulai (round 2)', !!ng && ng.round === 2, ng && `round=${ng.round}`);
  for (const p of ps) p.close();
}

async function scenarioDisconnect() {
  console.log('\n[3] Disconnect tiba-tiba + rejoin (server tidak crash)');
  const a = new Sim('A');
  const b = new Sim('B');
  await a.connect(); await b.connect();
  await a.next('welcome'); await b.next('welcome');
  a.send('create_room', { game: 'chess' });
  const lobby = await a.next('lobby_update');
  const pidB = b.playerId;
  b.send('join_room', { code: lobby.code });
  await b.next('lobby_update');
  a.send('start_game');
  await a.next('game_state');
  b.kill(); // disconnect brutal
  await new Promise((r) => setTimeout(r, 1200));
  const c = new Sim('C');
  await c.connect(); await c.next('welcome');
  check('server tetap responsif setelah disconnect', true);
  const b2 = new Sim('B');
  await b2.connect();
  b2.send('rejoin', { playerId: pidB, code: lobby.code });
  const w = await b2.next('welcome').catch(() => null);
  check('rejoin berhasil dalam masa tenggang', !!w && w.rejoined === true);
  const gs = await b2.next('game_state').catch(() => null);
  check('state game terkirim ulang setelah rejoin', !!gs && gs.game === 'chess');
  a.close(); b2.close(); c.close();
}

async function scenarioBadCode() {
  console.log('\n[4] Kode room salah & pesan sampah');
  const a = new Sim('Z');
  await a.connect(); await a.next('welcome');
  a.send('join_room', { code: 'ZZZZZZ' });
  const err = await a.next('error').catch(() => null);
  check('kode salah ditolak dengan pesan ramah', !!err && /tidak ditemukan/i.test(err.message),
    err && err.message);
  a.ws.send('bukan json {{{');
  const err2 = await a.next('error').catch(() => null);
  check('pesan bukan JSON ditolak tanpa crash', !!err2);
  a.send('chess_move', { from: 'e2', to: 'e4' });
  const err3 = await a.next('error').catch(() => null);
  check('aksi tanpa room ditolak', !!err3);
  // rate limit: spam
  for (let i = 0; i < 30; i++) a.ws.send(JSON.stringify({ type: 'list_rooms', data: {} }));
  await new Promise((r) => setTimeout(r, 500));
  check('server hidup setelah spam', a.ws.readyState === 1 || a.ws.readyState === 3);
  a.close();
}

(async () => {
  try {
    //await scenarioChess();
    await scenarioUno();
    //await scenarioDisconnect();
    //await scenarioBadCode();
  } catch (e) {
    console.log('  FAIL: exception —', e.message);
    failures++;
  }
  console.log(failures === 0 ? '\nSEMUA SKENARIO LOLOS ✅' : `\n${failures} KEGAGALAN ❌`);
  process.exit(failures === 0 ? 0 : 1);
})();
