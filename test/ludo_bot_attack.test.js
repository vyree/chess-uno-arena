'use strict';
/**
 * Server integration test for the Oct 2026 bot-attack hang.
 * Spawns the real server (like session.test.js), creates Ludo bot
 * rooms, and auto-plays the human seat (roll, first legal move,
 * attack when a valid target exists, first defense when attacked).
 *
 * What it proves, end to end:
 * - a bot attack phase resolves in well under the 60s turn timeout
 *   (on the old code it hung exactly 60s: botChooseAttack's
 *   {player, token} / {abs} shape was passed raw to doLudoAttack,
 *   which reads targetPlayer/targetToken/targetAbs, so beginAttack
 *   failed and the caller ignored the failure without a sync/timer)
 * - a ludo_announce naming the attack card is broadcast
 * - a bot defense phase (human attacker vs bot defender — the case
 *   scheduleLudoBot used to miss because it keyed on the attacker's
 *   turn seat) also resolves in well under 60s, when one occurs
 *
 * The test is timing-sensitive by design (that IS the bug), so it
 * allows up to 3 rooms and a generous overall timeout; it still
 * fails on the old code because every bot attack there takes 60s.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3221;
const SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
const OFFSETS = [0, 13, 26, 39];
const BLOCKS = [5, 18, 31, 44];
const ATTACK_NAMES = {
  sniper: 'Sniper', bom: 'Bom Petak', seret: 'Rantai Seret', beku: 'Es Beku',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;

function startServer() {
  return spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), LUDO_BOT_THINK_MS: '0' },
    stdio: 'ignore',
  });
}
async function waitHealthy() {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > 10000) throw new Error('server tidak mau naik');
    await sleep(100);
  }
}
before(async () => { server = startServer(); await waitHealthy(); });
after(() => { if (server) server.kill('SIGKILL'); });

class Client {
  constructor() {
    this.queues = {};
    this.waiters = {};
    this.playerId = null;
    this.mySeat = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ type: 'hello', data: { nickname: 'Penguji' } }));
        resolve();
      });
      this.ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.type === 'welcome') this.playerId = m.playerId;
        if (m.type === 'game_state' && m.you === this.playerId) {
          const me = (m.players || []).find((p) => p.id === this.playerId);
          if (me) this.mySeat = me.seat;
        }
        const w = this.waiters[m.type];
        if (w && w.length) w.shift()(m);
        else (this.queues[m.type] || (this.queues[m.type] = [])).push(m);
      });
      this.ws.on('error', reject);
    });
  }
  send(type, data) { this.ws.send(JSON.stringify({ type, data: data || {} })); }
  // The server processes hello before later messages, but the room
  // create must not race it: wait for welcome first, otherwise the
  // create is rejected with "Kirim hello dulu ya" and no game ever
  // starts (this exact race made the first version of this test
  // observe no bot attack at all).
  waitWelcome(timeoutMs) {
    const q = this.queues.welcome;
    if (q && q.length) return Promise.resolve(q.shift());
    return new Promise((resolve, reject) => {
      const done = (m) => { clearTimeout(timer); resolve(m); };
      const timer = setTimeout(() => {
        const w = this.waiters.welcome || [];
        const i = w.indexOf(done);
        if (i >= 0) w.splice(i, 1);
        reject(new Error('timeout menunggu welcome'));
      }, timeoutMs || 10000);
      (this.waiters.welcome || (this.waiters.welcome = [])).push(done);
    });
  }
  // Drain every queued message of a type (used for announcements).
  drain(type) {
    const q = this.queues[type] || [];
    this.queues[type] = [];
    return q;
  }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

function absOf(seat, progress) {
  if (progress < 0 || progress > 50) return null;
  return (OFFSETS[seat] + progress) % 52;
}

// Play one bot room until a bot attack resolves (success) or the
// game ends. Returns { success, attackMs, announced, defenseMs }.
async function playRoom(client, deadline) {
  await client.waitWelcome();
  client.send('create_ludo_bot_room', {});
  let attack = null; // { kind, attacker, startedAt }
  const announceLog = [];
  let defense = null;
  let announced = false;
  let defenseMs = null;
  let attackMs = null;
  while (Date.now() < deadline) {
    // Announcements arrive as their own messages; check the queue.
    // Keep every announcement seen (with a timestamp) so an attack
    // announcement that arrives just after the resolving state is
    // still attributed to the attack instead of being discarded.
    for (const m of client.drain('ludo_announce')) {
      console.log(`  announce: ${m.text}`);
      announceLog.push({ at: Date.now(), text: m.text || '' });
    }
    if (attack) {
      const hit = announceLog.some((a) => a.at >= attack.startedAt - 1000
        && a.at <= Date.now() + 5000 && a.text.includes(ATTACK_NAMES[attack.kind]));
      if (hit) announced = true;
    }
    const q = client.queues.game_state || [];
    if (!q.length) { await sleep(20); continue; }
    const m = q.shift();
    if (m.game !== 'ludo' || !m.state || m.state.over) {
      if (m.state && m.state.over) return { success: false, attackMs, announced, defenseMs };
      continue;
    }
    const st = m.state;
    const mySeat = client.mySeat;
    // Track bot attack / bot defense phases and their durations.
    if (st.phase === 'attack' && st.turn !== mySeat && st.pendingAttack) {
      if (!attack) {
        attack = { kind: st.pendingAttack.kind, attacker: st.turn, startedAt: Date.now() };
        console.log(`  bot attack observed: ${attack.kind} by seat ${attack.attacker}`);
      }
    } else if (attack) {
      attackMs = Date.now() - attack.startedAt;
      console.log(`  bot attack resolved: ${attack.kind} in ${attackMs}ms, announced=${announced}`);
      const done = { success: attackMs < 20000 && announced, attackMs, announced, defenseMs };
      if (done.success) return done;
      // Resolved but without an announcement: keep playing, this
      // attack does not count as proven.
      attack = null;
    }
    if (st.phase === 'defense' && st.pendingDefense && st.pendingDefense.defender !== mySeat) {
      if (!defense) defense = { startedAt: Date.now() };
    } else if (defense) {
      defenseMs = Date.now() - defense.startedAt;
      defense = null;
    }
    if (st.turn !== mySeat) continue;
    // No deduplication guard here: a repeated human turn legitimately
    // has the same signature as the previous one (roll, no dice,
    // same deck), and suppressing it stalls the game at the human
    // seat until the 60s timeout. Duplicate sends are safe — the
    // server rejects a second action once the phase has moved on.
    if (st.phase === 'roll') client.send('ludo_roll', {});
    else if (st.phase === 'move') {
      const mv = (st.legalMoves || [])[0];
      if (mv) client.send('ludo_move', { token: mv.token });
    } else if (st.phase === 'attack' && st.pendingAttack) {
      const target = findHumanTarget(st, mySeat);
      if (target) client.send('ludo_attack', target);
      else client.send('ludo_pass_attack', {});
    } else if (st.phase === 'defense' && st.pendingDefense && st.pendingDefense.defender === mySeat) {
      const me = st.players[mySeat];
      const def = (me.hand || []).find((c) => c.group === 'defense');
      client.send('ludo_defense', { cardId: def ? def.id : null });
    } else if (st.phase === 'swap') client.send('ludo_swap', { oldCardId: null });
  }
  return { success: false, attackMs, announced, defenseMs };
}

function findHumanTarget(st, mySeat) {
  const kind = st.pendingAttack.kind;
  const mine = st.players[mySeat].tokens;
  if (kind === 'bom') {
    for (const abs of BLOCKS) {
      let enemy = false;
      st.players.forEach((pl, pi) => pl.tokens.forEach((t) => {
        if (pi !== mySeat && absOf(pi, t.progress) === abs) enemy = true;
      }));
      if (enemy) return { targetAbs: abs };
    }
    return null;
  }
  const onTrack = mine.some((t) => t.progress >= 0 && t.progress <= 50);
  if (kind === 'sniper' && !onTrack) return null;
  for (let pi = 0; pi < st.players.length; pi++) {
    if (pi === mySeat) continue;
    for (let ti = 0; ti < st.players[pi].tokens.length; ti++) {
      const abs = absOf(pi, st.players[pi].tokens[ti].progress);
      if (abs !== null && !SAFE.includes(abs)) return { targetPlayer: pi, targetToken: ti };
    }
  }
  return null;
}

test('bot attack via WS: fase attack bot selesai <20 detik + ada pengumuman', { timeout: 180000 }, async () => {
  let result = { success: false, attackMs: null, announced: false, defenseMs: null };
  for (let room = 0; room < 3 && !result.success; room++) {
    const client = new Client();
    await client.connect();
    result = await playRoom(client, Date.now() + 55000);
    client.close();
    if (!result.success) await sleep(200);
  }
  assert.equal(result.success, true,
    `tidak ada fase attack bot yang selesai + diumumkan (attackMs=${result.attackMs}, announced=${result.announced})`);
  assert.ok(result.attackMs < 20000, `fase attack bot ${result.attackMs}ms, harus <20000ms`);
  if (result.defenseMs !== null) {
    assert.ok(result.defenseMs < 20000, `fase defense bot ${result.defenseMs}ms, harus <20000ms`);
  }
});
