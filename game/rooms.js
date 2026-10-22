'use strict';
/**
 * RoomManager: pure room membership & codes.
 * Game orchestration lives in server.js.
 */
const crypto = require('crypto');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
// Misi 9: this is ROOM MEMBER capacity (Sensei: max 8 per room for
// every game, joinable any time). Session sizes are smaller per game
// (a chess session is always 2) and are enforced by the server.
const MAX_PLAYERS = { chess: 8, uno: 8, truth: 8 };

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
      status: 'lobby', // lobby | playing | decision | over (over: solo bot rooms)
      players: [],      // {id, nickname, socket, connected, seat} — session players, seat order
      spectators: [],   // Misi 9: room members watching the session (seat -1)
      decision: null,   // Misi 9: { endsAt, roster: Map<id, state>, optIns: Set<id> }
      decisionTimer: null,
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

  memberCount(room) { return room.players.length + room.spectators.length; }

  findMember(room, playerId) {
    return room.players.find((p) => p.id === playerId)
      || room.spectators.find((p) => p.id === playerId) || null;
  }

  // Misi 9: a room can be entered at ANY time (Sensei). Joining while
  // a session runs (or is being decided) makes you a spectator;
  // joining a lobby makes you a regular member (seat at session start).
  addPlayer(room, player, asSpectator = false) {
    if (this.memberCount(room) >= MAX_PLAYERS[room.game]) return { ok: false, error: 'room penuh' };
    if (this.findMember(room, player.id)) return { ok: false, error: 'sudah di room ini' };
    // dedupe nickname across both lists
    let nick = player.nickname;
    let n = 2;
    const taken = (x) => room.players.some((p) => p.nickname === x)
      || room.spectators.some((p) => p.nickname === x);
    while (taken(nick)) nick = `${player.nickname} ${n++}`;
    player.nickname = nick;
    player.roomCode = room.code;
    player.connected = true;
    if (asSpectator) {
      player.seat = -1;
      player.inSession = false;
      room.spectators.push(player);
    } else {
      player.seat = room.players.length;
      room.players.push(player);
    }
    return { ok: true, room };
  }

  removePlayer(room, playerId) {
    const i = room.players.findIndex((p) => p.id === playerId);
    if (i >= 0) {
      room.players.splice(i, 1);
      room.players.forEach((p, idx) => { p.seat = idx; });
    } else {
      const j = room.spectators.findIndex((p) => p.id === playerId);
      if (j < 0) return false;
      room.spectators.splice(j, 1);
    }
    if (room.hostId === playerId) {
      const next = room.players[0] || room.spectators[0];
      if (next) room.hostId = next.id;
    }
    const ft = room.forfeitTimers.get(playerId);
    if (ft) { clearTimeout(ft); room.forfeitTimers.delete(playerId); }
    const tt = room.takeoverTimers.get(playerId);
    if (tt) { clearTimeout(tt); room.takeoverTimers.delete(playerId); }
    if (this.memberCount(room) === 0) {
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
    if (room.decisionTimer) clearTimeout(room.decisionTimer);
    for (const t of room.forfeitTimers.values()) clearTimeout(t);
    for (const t of room.takeoverTimers.values()) clearTimeout(t);
    this.rooms.delete(code);
  }

  list() {
    const out = [];
    for (const room of this.rooms.values()) {
      // Misi 9: rooms are enterable at any time — list playing and
      // deciding rooms too (marked with their status), not just lobbies.
      if (room.status === 'over') continue;
      if (this.memberCount(room) >= MAX_PLAYERS[room.game]) continue;
      out.push({
        code: room.code,
        game: room.game,
        status: room.status,
        players: [...room.players, ...room.spectators].map((p) => p.nickname),
        maxPlayers: MAX_PLAYERS[room.game],
      });
    }
    return out;
  }
}

module.exports = { RoomManager, MAX_PLAYERS, genCode };
