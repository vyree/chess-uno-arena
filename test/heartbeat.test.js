'use strict';
/**
 * Bug 1 fix B tests: the server's protocol heartbeat must terminate a
 * socket that never answers pings (a silently dead mobile connection),
 * while a healthy client that auto-pongs stays connected indefinitely.
 * The dead client is a raw TCP socket that completes the WS handshake
 * by hand and then never speaks again.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const WebSocket = require('ws');

const PORT = 3218;
let server = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), WS_HEARTBEAT_MS: '1000' },
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

test('heartbeat server: klien sehat (auto-pong) TIDAK diputus', { timeout: 15000 }, async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const msgs = [];
  ws.on('message', (raw) => msgs.push(JSON.parse(raw.toString())));
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(JSON.stringify({ type: 'hello', data: { nickname: 'Sehat' } }));
  await sleep(3500); // > 3 heartbeat sweeps
  assert.strictEqual(ws.readyState, 1, 'klien sehat harus tetap terhubung');
  ws.send(JSON.stringify({ type: 'list_rooms', data: {} }));
  await sleep(400);
  assert.ok(msgs.some((m) => m.type === 'room_list'), 'server harus tetap melayani klien sehat');
  ws.close();
});

test('heartbeat server: soket mati diam-diam diterminasi server', { timeout: 15000 }, async () => {
  const closedAt = await new Promise((resolve, reject) => {
    const sock = net.connect(PORT, '127.0.0.1');
    const guard = setTimeout(() => { sock.destroy(); reject(new Error('server tidak menerminasi soket mati dalam 8 detik')); }, 8000);
    let handshaken = false;
    let buf = Buffer.alloc(0);
    sock.on('connect', () => {
      sock.write(
        'GET / HTTP/1.1\r\n'
        + `Host: 127.0.0.1:${PORT}\r\n`
        + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
        + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
        + 'Sec-WebSocket-Version: 13\r\n\r\n',
      );
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshaken && buf.includes('\r\n\r\n')) handshaken = true;
      // after the handshake: stay perfectly silent — never pong
    });
    sock.on('close', () => { clearTimeout(guard); resolve(Date.now()); });
    sock.on('error', () => { /* reset by terminate is fine */ });
  });
  assert.ok(closedAt > 0, 'soket mati harus ditutup server');
});
