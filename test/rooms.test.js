'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager } = require('../game/rooms.js');

const mkPlayer = (id, nickname) => ({ id, nickname, socket: null, roomCode: null, seat: 0, connected: true });

test('create: kode 6 karakter unik, host jadi seat 0', () => {
  const rm = new RoomManager();
  const r1 = rm.create('chess', mkPlayer('p1', 'Andi'));
  const r2 = rm.create('chess', mkPlayer('p2', 'Budi'));
  assert.equal(r1.ok, true);
  assert.match(r1.room.code, /^[A-Z2-9]{6}$/);
  assert.notEqual(r1.room.code, r2.room.code);
  assert.equal(r1.room.players[0].seat, 0);
  assert.equal(r1.room.hostId, 'p1');
});

test('create menolak game tidak dikenal', () => {
  const rm = new RoomManager();
  assert.equal(rm.create('monopoli', mkPlayer('p1', 'A')).ok, false);
});

test('join: penuh ditolak, nickname ganda didedupe', () => {
  const rm = new RoomManager();
  const { room } = rm.create('chess', mkPlayer('p1', 'Andi'));
  const r2 = rm.addPlayer(room, mkPlayer('p2', 'Andi'));
  assert.equal(r2.ok, true);
  assert.equal(room.players[1].nickname, 'Andi 2');
  const r3 = rm.addPlayer(room, mkPlayer('p3', 'Cici'));
  assert.equal(r3.ok, false);
});

test('uno muat 6 pemain', () => {
  const rm = new RoomManager();
  const { room } = rm.create('uno', mkPlayer('p1', 'A'));
  for (let i = 2; i <= 6; i++) assert.equal(rm.addPlayer(room, mkPlayer('p' + i, 'P' + i)).ok, true);
  assert.equal(rm.addPlayer(room, mkPlayer('p7', 'P7')).ok, false);
});

test('removePlayer: seat dirapatkan, host pindah, room kosong terhapus', () => {
  const rm = new RoomManager();
  const { room } = rm.create('uno', mkPlayer('p1', 'A'));
  rm.addPlayer(room, mkPlayer('p2', 'B'));
  rm.addPlayer(room, mkPlayer('p3', 'C'));
  rm.removePlayer(room, 'p1');
  assert.equal(room.hostId, 'p2');
  assert.deepEqual(room.players.map((p) => p.seat), [0, 1]);
  rm.removePlayer(room, 'p2');
  rm.removePlayer(room, 'p3');
  assert.equal(rm.get(room.code), null, 'room kosong harus terhapus');
});

test('list: hanya room lobby yang belum penuh', () => {
  const rm = new RoomManager();
  const { room } = rm.create('chess', mkPlayer('p1', 'A'));
  assert.equal(rm.list().length, 1);
  rm.addPlayer(room, mkPlayer('p2', 'B'));
  assert.equal(rm.list().length, 0, 'room penuh tidak di-list');
});
