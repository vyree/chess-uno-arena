'use strict';
/**
 * RoomManager: pure room membership & codes.
 * Game orchestration lives in server.js.
 */
const crypto = require('crypto');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const MAX_PLAYERS = { chess: 2, uno: 8, truth: 8 };

function genCode(existing) {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
  } while (existing.has(code));
  return code;
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> room
  }

  create(game, host) {
    if (!MAX_PLAYERS[game]) return { ok: false, error: 'game tidak dikenal' };
    const code = genCode(this.rooms);
    const room = {
      code,
      game,
      status: 'lobby', // lobby | playing | over
      players: [],      // {id, nickname, socket, connected, seat}
      hostId: host.id,
      chess: null,
      uno: null,        // { st, scores, active, round }
      truth: null,      // { st } — Truth or Truth engine state (Misi 3)
      truthStage: null, // spin | ask | answer | react (server driver)
      // "Set Aturan" panel choices (host, lobby): null total = auto by size
      truthSettings: { totalQuestions: null, explicitMode: false },
      timer: null,
      deadline: null,
      forfeitTimers: new Map(), // playerId -> timeout
      takeoverTimers: new Map(), // playerId -> timeout (Misi 4C bot takeover)
      createdAt: Date.now(),
    };
    this.rooms.set(code, room);
    const added = this.addPlayer(room, host);
    if (!added.ok) { this.rooms.delete(code); return added; }
    return { ok: true, room };
  }

  get(code) {
    if (!code) return null;
    return this.rooms.get(String(code).toUpperCase()) || null;
  }

  addPlayer(room, player) {
    if (room.status !== 'lobby') return { ok: false, error: 'room sudah mulai main' };
    if (room.players.length >= MAX_PLAYERS[room.game]) return { ok: false, error: 'room penuh' };
    if (room.players.some((p) => p.id === player.id)) return { ok: false, error: 'sudah di room ini' };
    // dedupe nickname
    let nick = player.nickname;
    let n = 2;
    while (room.players.some((p) => p.nickname === nick)) nick = `${player.nickname} ${n++}`;
    player.nickname = nick;
    player.seat = room.players.length;
    player.roomCode = room.code;
    player.connected = true;
    room.players.push(player);
    return { ok: true, room };
  }

  removePlayer(room, playerId) {
    const i = room.players.findIndex((p) => p.id === playerId);
    if (i < 0) return false;
    room.players.splice(i, 1);
    room.players.forEach((p, idx) => { p.seat = idx; });
    if (room.hostId === playerId && room.players.length > 0) {
      room.hostId = room.players[0].id;
    }
    const ft = room.forfeitTimers.get(playerId);
    if (ft) { clearTimeout(ft); room.forfeitTimers.delete(playerId); }
    const tt = room.takeoverTimers.get(playerId);
    if (tt) { clearTimeout(tt); room.takeoverTimers.delete(playerId); }
    if (room.players.length === 0) {
      this.destroy(room.code);
      return true;
    }
    return true;
  }

  // Shuffle seat order (UNO: at game start and again every new round).
  // rand is injectable for tests; seat indexes are reassigned to match.
  shuffleSeats(room, rand) {
    const r = rand || Math.random;
    const a = room.players;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    a.forEach((p, idx) => { p.seat = idx; });
    return room;
  }

  destroy(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.timer) clearTimeout(room.timer);
    for (const t of room.forfeitTimers.values()) clearTimeout(t);
    for (const t of room.takeoverTimers.values()) clearTimeout(t);
    this.rooms.delete(code);
  }

  list() {
    const out = [];
    for (const room of this.rooms.values()) {
      if (room.status !== 'lobby') continue;
      if (room.players.length >= MAX_PLAYERS[room.game]) continue;
      out.push({
        code: room.code,
        game: room.game,
        players: room.players.map((p) => p.nickname),
        maxPlayers: MAX_PLAYERS[room.game],
      });
    }
    return out;
  }
}

module.exports = { RoomManager, MAX_PLAYERS, genCode };
