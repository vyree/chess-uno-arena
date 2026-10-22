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

test('join: kapasitas anggota room 8, nickname ganda didedupe', () => {
  const rm = new RoomManager();
  const { room } = rm.create('chess', mkPlayer('p1', 'Andi'));
  const r2 = rm.addPlayer(room, mkPlayer('p2', 'Andi'));
  assert.equal(r2.ok, true);
  assert.equal(room.players[1].nickname, 'Andi 2');
  // Misi 9: kapasitas room = 8 ANGGOTA untuk semua game (sesi catur tetap 2 orang)
  for (let i = 3; i <= 8; i++) assert.equal(rm.addPlayer(room, mkPlayer('p' + i, 'P' + i)).ok, true);
  assert.equal(rm.addPlayer(room, mkPlayer('p9', 'P9')).ok, false, 'anggota ke-9 ditolak');
});

test('join: masuk di tengah game menjadi penonton (Misi 9)', () => {
  const rm = new RoomManager();
  const { room } = rm.create('uno', mkPlayer('p1', 'A'));
  rm.addPlayer(room, mkPlayer('p2', 'B'));
  room.status = 'playing';
  const p3 = mkPlayer('p3', 'C');
  const r = rm.addPlayer(room, p3, true);
  assert.equal(r.ok, true);
  assert.equal(room.spectators.length, 1);
  assert.equal(p3.seat, -1);
  assert.equal(p3.inSession, false);
  assert.equal(rm.memberCount(room), 3, 'kapasitas menghitung pemain + penonton');
});

test('uno muat 8 pemain', () => {
  const rm = new RoomManager();
  const { room } = rm.create('uno', mkPlayer('p1', 'A'));
  for (let i = 2; i <= 8; i++) assert.equal(rm.addPlayer(room, mkPlayer('p' + i, 'P' + i)).ok, true);
  assert.equal(rm.addPlayer(room, mkPlayer('p9', 'P9')).ok, false);
});

test('shuffleSeats: permutasi valid, seat rapat, urutan berubah', () => {
  const rm = new RoomManager();
  const { room } = rm.create('uno', mkPlayer('p1', 'A'));
  for (let i = 2; i <= 6; i++) rm.addPlayer(room, mkPlayer('p' + i, 'P' + i));
  const before = room.players.map((p) => p.id).join(',');
  let changed = false;
  for (let t = 0; t < 30 && !changed; t++) {
    rm.shuffleSeats(room);
    assert.deepEqual(room.players.map((p) => p.seat), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual([...room.players.map((p) => p.id)].sort(), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    if (room.players.map((p) => p.id).join(',') !== before) changed = true;
  }
  assert.equal(changed, true, 'urutan tidak pernah berubah dalam 30x shuffle');
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

test('list: lobby & sedang main tampil (Misi 9), penuh/selesai tidak', () => {
  const rm = new RoomManager();
  const { room } = rm.create('chess', mkPlayer('p1', 'A'));
  assert.equal(rm.list().length, 1);
  assert.equal(rm.list()[0].status, 'lobby');
  room.status = 'playing';
  assert.equal(rm.list().length, 1, 'room yang sedang main tetap bisa dimasuki penonton');
  assert.equal(rm.list()[0].status, 'playing');
  room.status = 'over';
  assert.equal(rm.list().length, 0, 'room selesai tidak di-list');
  room.status = 'lobby';
  for (let i = 2; i <= 8; i++) rm.addPlayer(room, mkPlayer('p' + i, 'P' + i));
  assert.equal(rm.list().length, 0, 'room penuh tidak di-list');
});
