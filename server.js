'use strict';
/**
 * Chess + UNO Arena — server.
 * HTTP static + WebSocket. Otoritatif: semua aturan divalidasi di sini.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const chess = require('./game/chess');
const uno = require('./game/uno');
const bot = require('./game/bot');
const { createVerifier } = require('./game/auth');
const { RoomManager, MAX_PLAYERS } = require('./game/rooms');
const { validateMessage } = require('./game/validate');

const PORT = parseInt(process.env.PORT, 10) || 3000;
// Auth gate (Misi 2 Fase 4): active only when a Firebase project is set.
// Without it the server runs in open dev mode so local tests keep working.
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || null;
const tokenVerifier = FIREBASE_PROJECT_ID ? createVerifier(FIREBASE_PROJECT_ID) : null;
if (!tokenVerifier) {
  console.warn('[auth] FIREBASE_PROJECT_ID tidak terisi — gerbang login MATI (mode dev)');
}
const TURN_TIMEOUT_MS = 60 * 1000;
const BOT_DELAY_MS = 900; // bot "thinking" pause so humans can follow the game
const RECONNECT_GRACE_MS = 60 * 1000;
const MSG_PER_SEC = 20;

const rooms = new RoomManager();
const players = new Map(); // playerId -> {id, nickname, socket, roomCode, seat, connected, active}

// ---------------- helpers ----------------
function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function sendError(ws, message) { send(ws, { type: 'error', message }); }
function broadcast(room, obj, exceptId) {
  for (const p of room.players) {
    if (p.id === exceptId || !p.connected || !p.socket) continue;
    send(p.socket, obj);
  }
}
function getPlayerBySocket(ws) { return ws._playerId ? players.get(ws._playerId) : null; }

// ---------------- snapshots ----------------
const REASONS = {
  checkmate: 'Skakmat!', stalemate: 'Remis — stalemate', fifty: 'Remis — aturan 50 langkah',
  repetition: 'Remis — repetisi 3x', timeout: 'Waktu habis', resign: 'Menyerah',
  forfeit: 'Lawan keluar dari permainan', habis: 'Kartu habis!',
  semua_keluar: 'Semua lawan keluar',
};

function lobbySnapshot(room, forPlayer) {
  return {
    type: 'lobby_update', code: room.code, game: room.game, status: room.status,
    you: forPlayer ? forPlayer.id : null,
    hostId: room.hostId,
    maxPlayers: MAX_PLAYERS[room.game],
    players: room.players.map((p) => ({ id: p.id, nickname: p.nickname, seat: p.seat, isBot: !!p.isBot })),
  };
}

function chessColor(seat) { return seat === 0 ? 'w' : 'b'; }

function gameSnapshot(room, player) {
  const base = {
    type: 'game_state', code: room.code, game: room.game, status: room.status,
    you: player.id, hostId: room.hostId, deadline: room.deadline,
    players: room.players.map((p) => ({
      id: p.id, nickname: p.nickname, seat: p.seat, isBot: !!p.isBot,
      color: room.game === 'chess' ? chessColor(p.seat) : undefined,
      connected: p.connected,
    })),
  };
  if (room.game === 'chess') {
    base.state = chess.toClient(room.chess);
  } else if (room.uno) {
    const u = room.uno;
    base.state = uno.toClient(u.st, player.seat);
    base.round = u.round;
    base.scores = room.players
      .filter((p) => p.active !== false)
      .map((p) => ({ nickname: p.nickname, points: room.scoreBoard[p.id] || 0 }));
  }
  return base;
}

function sendLobby(room) {
  for (const p of room.players) {
    if (p.connected && p.socket) send(p.socket, lobbySnapshot(room, p));
  }
}
function sendGameState(room) {
  for (const p of room.players) {
    if (p.connected && p.socket && p.active !== false) send(p.socket, gameSnapshot(room, p));
  }
}

function gameOverPayload(room, result) {
  const payload = {
    type: 'game_over', game: room.game,
    result, reasonText: REASONS[result.reason] || result.reason,
  };
  if (room.game === 'chess' && result.winnerColor) {
    const w = room.players.find((p) => chessColor(p.seat) === result.winnerColor);
    payload.winnerNickname = w ? w.nickname : null;
  }
  if (room.game === 'uno') {
    payload.winnerSeat = result.winner;
    const w = room.players[result.winner];
    payload.winnerNickname = w ? w.nickname : null;
    payload.scores = room.players
      .filter((p) => p.active !== false)
      .map((p) => ({ nickname: p.nickname, points: room.scoreBoard[p.id] || 0 }));
  }
  return payload;
}

// ---------------- timers ----------------
function clearTurnTimer(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  room.deadline = null;
}
function startTurnTimer(room) {
  clearTurnTimer(room);
  room.deadline = Date.now() + TURN_TIMEOUT_MS;
  room.timer = setTimeout(() => onTurnTimeout(room), TURN_TIMEOUT_MS);
}

function onTurnTimeout(room) {
  if (room.status !== 'playing') return;
  if (room.game === 'chess') {
    const loserColor = room.chess.turn;
    const winnerColor = loserColor === 'w' ? 'b' : 'w';
    room.chess.over = { result: winnerColor === 'w' ? '1-0' : '0-1', reason: 'timeout' };
    room.status = 'over';
    clearTurnTimer(room);
    const payload = gameOverPayload(room, { ...room.chess.over, winnerColor });
    broadcast(room, payload);
  } else {
    const u = room.uno;
    if (!u || u.st.over) return;
    const seat = u.st.turn;
    if (!u.active[seat]) { unoFixTurn(room); startTurnTimer(room); sendGameState(room); scheduleBotIfNeeded(room); return; }
    if (u.st.pendingDraw > 0) {
      uno.drawCard(u.st, seat);
    } else {
      const d = uno.drawCard(u.st, seat);
      if (d.ok && !d.lostTurn && u.st.drewThisTurn) uno.passTurn(u.st, seat);
    }
    unoFixTurn(room);
    startTurnTimer(room);
    sendGameState(room);
    scheduleBotIfNeeded(room);
  }
}

function unoFixTurn(room) {
  const u = room.uno;
  if (!u) return;
  let guard = 0;
  const n = u.st.hands.length;
  while (!u.active[u.st.turn] && guard++ < n + 2) {
    u.st.turn = (((u.st.turn + u.st.dir) % n) + n) % n;
  }
}

// ---------------- forfeit / disconnect ----------------
function forfeitPlayer(room, playerId) {
  const player = room.players.find((p) => p.id === playerId);
  room.forfeitTimers.delete(playerId);
  if (room.status !== 'playing') {
    if (player) { rooms.removePlayer(room, playerId); players.delete(playerId); }
    if (rooms.get(room.code)) sendLobby(room);
    return;
  }
  if (room.game === 'chess') {
    const winnerColor = player && player.seat === 0 ? 'b' : 'w';
    room.chess.over = { result: winnerColor === 'w' ? '1-0' : '0-1', reason: 'forfeit' };
    room.status = 'over';
    clearTurnTimer(room);
    broadcast(room, gameOverPayload(room, { ...room.chess.over, winnerColor }));
  } else {
    const u = room.uno;
    if (player && u.active[player.seat]) {
      u.active[player.seat] = false;
      for (const c of u.st.hands[player.seat]) u.st.deck.push(c);
      u.st.hands[player.seat] = [];
      uno.shuffle(u.st.deck);
      player.active = false;
      unoFixTurn(room);
      const remaining = u.active.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
      if (remaining.length <= 1 && !u.st.over) {
        u.st.over = { winner: remaining[0] ?? -1, reason: 'semua_keluar' };
        room.status = 'over';
        clearTurnTimer(room);
        broadcast(room, gameOverPayload(room, u.st.over));
      } else {
        sendGameState(room);
      }
    }
  }
  players.delete(playerId);
}

function handleDisconnect(player) {
  player.connected = false;
  player.socket = null;
  const room = player.roomCode ? rooms.get(player.roomCode) : null;
  if (!room) { players.delete(player.id); return; }
  if (room.isBotRoom) {
    // bot room is a solo table: it ends together with its human
    teardownBotRoom(room);
    players.delete(player.id);
    return;
  }
  if (room.status === 'lobby') {
    rooms.removePlayer(room, player.id);
    players.delete(player.id);
    if (rooms.get(room.code)) sendLobby(room);
    return;
  }
  // playing/over: 60s grace to rejoin
  const t = setTimeout(() => forfeitPlayer(room, player.id), RECONNECT_GRACE_MS);
  room.forfeitTimers.set(player.id, t);
  sendGameState(room);
}

// ---------------- game actions ----------------
function handleStartGame(player, room, data) {
  if (room.hostId !== player.id) { sendError(player.socket, 'Hanya pembuat room yang bisa mulai'); return; }
  if (room.status !== 'lobby') { sendError(player.socket, 'Game sudah berjalan'); return; }
  if (room.game === 'chess') {
    if (room.players.length < 2) { sendError(player.socket, 'Tunggu lawan masuk dulu'); return; }
    room.chess = chess.newGame();
    room.status = 'playing';
  } else {
    if (room.players.length < 2) { sendError(player.socket, 'UNO butuh minimal 2 pemain'); return; }
    // UNO: seat order is shuffled at every game start (Sensei, Misi 2)
    rooms.shuffleSeats(room);
    room.unoExtreme = !!(data && data.extreme);
    const n = room.players.length;
    room.uno = { st: uno.newGame(n, { extreme: room.unoExtreme }), active: new Array(n).fill(true), round: 1 };
    room.scoreBoard = {};
    for (const p of room.players) room.scoreBoard[p.id] = 0;
    room.status = 'playing';
  }
  startTurnTimer(room);
  sendGameState(room);
}

function handleChessMove(player, room, data) {
  if (room.status !== 'playing' || !room.chess) { sendError(player.socket, 'Game belum berjalan'); return; }
  if (chessColor(player.seat) !== room.chess.turn) { sendError(player.socket, 'Bukan giliranmu'); return; }
  const r = chess.applyMove(room.chess, chess.parseSq(data.from), chess.parseSq(data.to), data.promotion);
  if (!r.ok) { sendError(player.socket, r.error === 'langkah tidak legal' ? 'Langkah tidak legal' : 'Langkah tidak valid'); return; }
  clearTurnTimer(room);
  if (r.status) {
    room.status = 'over';
    const winnerColor = r.status.result === '1-0' ? 'w' : r.status.result === '0-1' ? 'b' : null;
    sendGameState(room);
    broadcast(room, gameOverPayload(room, { ...r.status, winnerColor }));
  } else {
    startTurnTimer(room);
    sendGameState(room);
  }
}

// Shared tail of a successful UNO play (human or bot): scoring on a win,
// otherwise advance the turn and broadcast the new state + engine events.
function afterUnoPlay(room, player, r) {
  const u = room.uno;
  clearTurnTimer(room);
  let note = null;
  if (r.penalty) note = `${player.nickname} lupa bilang UNO! Penalti +${r.penalty}`;
  if (r.won) {
    // hitung poin: jumlah kartu tangan pemain lain
    let gained = 0;
    u.st.hands.forEach((hand, i) => {
      if (i !== u.st.over.winner) for (const c of hand) gained += uno.cardPoints(c);
    });
    const winner = room.players[u.st.over.winner];
    room.scoreBoard[winner.id] = (room.scoreBoard[winner.id] || 0) + gained;
    room.status = 'over';
    clearTurnTimer(room);
    const payload = gameOverPayload(room, u.st.over);
    payload.points = gained;
    if (note) payload.note = note;
    if (r.events && r.events.length) payload.events = r.events;
    broadcast(room, payload);
    return;
  }
  unoFixTurn(room);
  startTurnTimer(room);
  sendGameState(room);
  if (r.events && r.events.length) broadcast(room, { type: 'uno_events', events: r.events });
  if (note) broadcast(room, { type: 'chat', from: 'Sistem', text: note });
  scheduleBotIfNeeded(room);
}

function handleUnoPlay(player, room, data) {
  const u = room.uno;
  if (room.status !== 'playing' || !u) { sendError(player.socket, 'Game belum berjalan'); return; }
  if (u.st.turn !== player.seat) { sendError(player.socket, 'Bukan giliranmu'); return; }
  const isDrawn = u.st.drewThisTurn && u.st.drawnCard === data.cardId;
  const playFn = isDrawn ? uno.playDrawnCard : uno.playCard;
  const r = playFn(u.st, player.seat, data.cardId, { saidUno: data.saidUno, wildColor: data.wildColor });
  if (!r.ok) {
    const msgs = { 'bukan giliranmu': 'Bukan giliranmu', 'kartu tidak cocok': 'Kartu tidak cocok', 'pilih warna dulu': 'Pilih warna dulu untuk kartu wild', 'kartu tidak ada di tanganmu': 'Kartu tidak ada di tanganmu', 'hanya kartu sejenis yang bisa menumpuk': 'Hanya kartu sejenis yang bisa menumpuk tumpukan ini', 'mode ekstrim: +4 tidak bisa ditumpuk': 'Mode Ekstrim: +4 tidak bisa ditumpuk — ambil kartunya!' };
    sendError(player.socket, msgs[r.error] || 'Langkah tidak valid');
    return;
  }
  afterUnoPlay(room, player, r);
}

function handleUnoDraw(player, room) {
  const u = room.uno;
  if (room.status !== 'playing' || !u) { sendError(player.socket, 'Game belum berjalan'); return; }
  const r = uno.drawCard(u.st, player.seat);
  if (!r.ok) {
    const msgs = { 'bukan giliranmu': 'Bukan giliranmu', 'sudah ambil kartu giliran ini': 'Kamu sudah ambil kartu' };
    sendError(player.socket, msgs[r.error] || 'Tidak bisa ambil kartu');
    return;
  }
  clearTurnTimer(room);
  unoFixTurn(room);
  startTurnTimer(room);
  sendGameState(room);
  if (r.events) broadcast(room, { type: 'uno_events', events: r.events });
  scheduleBotIfNeeded(room);
}

function handleUnoPass(player, room) {
  const u = room.uno;
  if (room.status !== 'playing' || !u) { sendError(player.socket, 'Game belum berjalan'); return; }
  const r = uno.passTurn(u.st, player.seat);
  if (!r.ok) { sendError(player.socket, 'Ambil kartu dulu atau mainkan kartumu'); return; }
  clearTurnTimer(room);
  unoFixTurn(room);
  startTurnTimer(room);
  sendGameState(room);
  scheduleBotIfNeeded(room);
}

function handleUnoNewRound(player, room) {
  if (room.game !== 'uno' || room.status !== 'over' || !room.uno) {
    sendError(player.socket, 'Belum ada ronde yang selesai'); return;
  }
  // keluarkan pemain yang sudah tidak aktif, rapatkan seat
  for (const p of [...room.players]) {
    if (p.active === false) { rooms.removePlayer(room, p.id); players.delete(p.id); }
  }
  if (room.players.length < 2) { sendError(player.socket, 'Butuh minimal 2 pemain'); return; }
  // UNO: seats are re-shuffled every new round (Sensei, Misi 2)
  rooms.shuffleSeats(room);
  const n = room.players.length;
  room.uno = { st: uno.newGame(n, { extreme: room.unoExtreme }), active: new Array(n).fill(true), round: room.uno.round + 1 };
  room.status = 'playing';
  startTurnTimer(room);
  sendGameState(room);
  scheduleBotIfNeeded(room);
}

// ---------------- UNO bots ----------------
// If the current turn belongs to a bot, let it move after a short delay.
function scheduleBotIfNeeded(room) {
  if (room.game !== 'uno' || room.status !== 'playing' || !room.uno || room.uno.st.over) return;
  if (room.botTimer) return;
  const seat = room.uno.st.turn;
  if (!room.uno.active[seat]) return;
  const p = room.players[seat];
  if (!p || !p.isBot) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (!rooms.get(room.code)) return; // room was torn down meanwhile
    runBotTurn(room);
  }, BOT_DELAY_MS);
}

function runBotTurn(room) {
  if (room.status !== 'playing' || !room.uno || room.uno.st.over) return;
  const seat = room.uno.st.turn;
  const p = room.players[seat];
  if (!p || !p.isBot) return;
  const acts = bot.takeTurn(room.uno.st, seat);
  if (!acts.length) return;
  const events = acts.flatMap((a) => (a.r && a.r.events) || []);
  const playAct = [...acts].reverse().find((a) => a.action === 'play' || a.action === 'playDrawn');
  if (playAct) {
    afterUnoPlay(room, p, { ...playAct.r, events });
    return;
  }
  // draw-only turn (took the pile / drew a card, maybe passed)
  clearTurnTimer(room);
  unoFixTurn(room);
  startTurnTimer(room);
  sendGameState(room);
  if (events.length) broadcast(room, { type: 'uno_events', events });
  scheduleBotIfNeeded(room);
}

// A bot room exists only for its human: remove the bots and the room itself.
function teardownBotRoom(room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  for (const p of [...room.players]) {
    if (p.isBot) { rooms.removePlayer(room, p.id); players.delete(p.id); }
  }
  rooms.destroy(room.code);
}

// ---------------- message router ----------------
// Returns the verified Firebase uid for a token, or null (error already sent).
async function checkToken(ws, idToken) {
  if (!tokenVerifier) return 'dev-mode';
  if (!idToken) { sendError(ws, 'Silakan masuk dengan Google dulu ya'); return null; }
  try {
    const decoded = await tokenVerifier.verify(idToken);
    return decoded.uid;
  } catch {
    sendError(ws, 'Login tidak valid — silakan masuk dengan Google lagi ya');
    return null;
  }
}

async function route(ws, type, data) {
  const player = getPlayerBySocket(ws);

  if (type === 'hello') {
    let p = player;
    if (!p) {
      const uid = await checkToken(ws, data.idToken);
      if (uid === null) return;
      p = { id: crypto.randomUUID(), uid, nickname: data.nickname, socket: ws, roomCode: null, seat: 0, connected: true, active: true };
      players.set(p.id, p);
      ws._playerId = p.id;
    } else {
      p.nickname = data.nickname;
      p.socket = ws;
      p.connected = true;
    }
    send(ws, { type: 'welcome', playerId: p.id, nickname: p.nickname });
    return;
  }

  if (type === 'rejoin') {
    const p = players.get(data.playerId);
    const room = rooms.get(data.code);
    if (!p || !room || p.roomCode !== room.code) { sendError(ws, 'Sesi tidak ditemukan, masuk ulang ya'); return; }
    if (tokenVerifier) {
      // auth mode: a rejoin must prove the same Google account owns this seat
      const uid = await checkToken(ws, data.idToken);
      if (uid === null || uid !== p.uid) { sendError(ws, 'Sesi tidak ditemukan, masuk ulang ya'); return; }
    }
    const ft = room.forfeitTimers.get(p.id);
    if (ft) { clearTimeout(ft); room.forfeitTimers.delete(p.id); }
    p.socket = ws; p.connected = true; ws._playerId = p.id;
    send(ws, { type: 'welcome', playerId: p.id, nickname: p.nickname, rejoined: true });
    if (room.status === 'lobby') send(ws, lobbySnapshot(room, p));
    else send(ws, gameSnapshot(room, p));
    sendGameState(room);
    return;
  }

  if (!player) { sendError(ws, 'Kirim hello dulu ya'); return; }
  player.socket = ws;

  const needRoom = () => {
    const room = player.roomCode ? rooms.get(player.roomCode) : null;
    if (!room) { sendError(ws, 'Kamu tidak di room mana pun'); return null; }
    return room;
  };

  switch (type) {
    case 'create_room': {
      if (player.roomCode) { sendError(ws, 'Kamu sudah di sebuah room'); return; }
      const r = rooms.create(data.game, player);
      if (!r.ok) { sendError(ws, r.error); return; }
      sendLobby(r.room);
      return;
    }
    case 'create_bot_room': {
      // Solo UNO table: the human plus (size - 1) server-side bots, game starts at once.
      if (player.roomCode) { sendError(ws, 'Kamu sudah di sebuah room'); return; }
      const created = rooms.create('uno', player);
      if (!created.ok) { sendError(ws, created.error); return; }
      const room = created.room;
      room.isBotRoom = true;
      room.unoExtreme = !!data.extreme;
      for (let i = 0; i < data.size - 1; i++) {
        const bp = {
          id: 'bot-' + crypto.randomUUID(), nickname: bot.BOT_NAMES[i % bot.BOT_NAMES.length],
          isBot: true, socket: null, roomCode: room.code, seat: 0, connected: true, active: true,
        };
        players.set(bp.id, bp);
        rooms.addPlayer(room, bp);
      }
      rooms.shuffleSeats(room);
      const n = room.players.length;
      room.uno = { st: uno.newGame(n, { extreme: room.unoExtreme }), active: new Array(n).fill(true), round: 1 };
      room.scoreBoard = {};
      for (const p of room.players) room.scoreBoard[p.id] = 0;
      room.status = 'playing';
      startTurnTimer(room);
      sendGameState(room);
      scheduleBotIfNeeded(room);
      return;
    }
    case 'list_rooms': {
      send(ws, { type: 'room_list', rooms: rooms.list() });
      return;
    }
    case 'join_room': {
      if (player.roomCode) { sendError(ws, 'Keluar dari room sekarang dulu'); return; }
      const room = rooms.get(data.code);
      if (!room) { sendError(ws, 'Kode room tidak ditemukan'); return; }
      const r = rooms.addPlayer(room, player);
      if (!r.ok) { sendError(ws, r.error === 'room penuh' ? 'Room sudah penuh' : r.error); return; }
      sendLobby(room);
      return;
    }
    case 'leave_room': {
      const room = needRoom(); if (!room) return;
      if (room.isBotRoom) {
        teardownBotRoom(room);
        players.delete(player.id);
      } else if (room.status === 'playing') {
        // anggap forfeit langsung
        const t = room.forfeitTimers.get(player.id);
        if (t) { clearTimeout(t); room.forfeitTimers.delete(player.id); }
        forfeitPlayer(room, player.id);
      } else {
        rooms.removePlayer(room, player.id);
        players.delete(player.id);
        if (rooms.get(room.code)) sendLobby(room);
      }
      // EVERY path releases the leaver and confirms it, so the client can
      // always return to the main menu (bug fix 2026-10-21: the forfeit
      // path previously never sent left_room and the player got stuck).
      player.roomCode = null;
      ws._playerId = null;
      send(ws, { type: 'left_room' });
      return;
    }
    case 'start_game': {
      const room = needRoom(); if (!room) return;
      handleStartGame(player, room, data);
      return;
    }
    case 'chat': {
      const room = needRoom(); if (!room) return;
      const now = Date.now();
      if (ws._lastChat && now - ws._lastChat < 2000) { sendError(ws, 'Pelan-pelan chatnya ya 😄'); return; }
      ws._lastChat = now;
      broadcast(room, { type: 'chat', from: player.nickname, text: data.text });
      return;
    }
    case 'chess_moves_for': {
      const room = needRoom(); if (!room) return;
      if (room.game !== 'chess' || room.status !== 'playing') { sendError(ws, 'Game catur belum berjalan'); return; }
      const sq = chess.parseSq(data.square);
      const moves = chess.legalMoves(room.chess, sq).map((m) => ({
        from: chess.sqName(m.from), to: chess.sqName(m.to), promo: m.promo || null,
      }));
      send(ws, { type: 'chess_legal', square: data.square, moves });
      return;
    }
    case 'chess_move': {
      const room = needRoom(); if (!room) return;
      if (room.game !== 'chess') { sendError(ws, 'Ini bukan room catur'); return; }
      handleChessMove(player, room, data);
      return;
    }
    case 'chess_resign': {
      const room = needRoom(); if (!room) return;
      if (room.game !== 'chess' || room.status !== 'playing') { sendError(ws, 'Game belum berjalan'); return; }
      const winnerColor = chessColor(player.seat) === 'w' ? 'b' : 'w';
      room.chess.over = { result: winnerColor === 'w' ? '1-0' : '0-1', reason: 'resign' };
      room.status = 'over';
      clearTurnTimer(room);
      broadcast(room, gameOverPayload(room, { ...room.chess.over, winnerColor }));
      return;
    }
    case 'uno_play': {
      const room = needRoom(); if (!room) return;
      if (room.game !== 'uno') { sendError(ws, 'Ini bukan room UNO'); return; }
      handleUnoPlay(player, room, data);
      return;
    }
    case 'uno_draw': {
      const room = needRoom(); if (!room) return;
      if (room.game !== 'uno') { sendError(ws, 'Ini bukan room UNO'); return; }
      handleUnoDraw(player, room);
      return;
    }
    case 'uno_pass': {
      const room = needRoom(); if (!room) return;
      if (room.game !== 'uno') { sendError(ws, 'Ini bukan room UNO'); return; }
      handleUnoPass(player, room);
      return;
    }
    case 'uno_new_round': {
      const room = needRoom(); if (!room) return;
      handleUnoNewRound(player, room);
      return;
    }
    default:
      sendError(ws, 'Perintah tidak dikenal');
  }
}

// ---------------- HTTP static ----------------
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const httpServer = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') { res.writeHead(200); res.end('ok'); return; }
    let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('tidak ditemukan'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch {
    res.writeHead(500); res.end('error');
  }
});

// ---------------- WebSocket ----------------
const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  ws._times = [];
  ws.on('message', (raw) => {
    try {
      // rate limit: 20 msg/detik
      const now = Date.now();
      ws._times = ws._times.filter((t) => now - t < 1000);
      if (ws._times.length >= MSG_PER_SEC) {
        sendError(ws, 'Terlalu banyak pesan, santai dulu ya');
        ws.close();
        return;
      }
      ws._times.push(now);
      const v = validateMessage(raw.toString());
      if (!v.ok) { sendError(ws, v.error); return; }
      Promise.resolve(route(ws, v.type, v.data)).catch((e) => {
        console.error('route error:', e.message);
        sendError(ws, 'Terjadi kesalahan, coba lagi.');
      });
    } catch (e) {
      console.error('message handler error:', e.message);
      sendError(ws, 'Terjadi kesalahan, coba lagi.');
    }
  });
  ws.on('close', () => {
    try {
      const p = getPlayerBySocket(ws);
      if (p) handleDisconnect(p);
    } catch (e) { console.error('close handler error:', e.message); }
  });
  ws.on('error', () => {});
});

httpServer.listen(PORT, () => {
  console.log(`Chess + UNO Arena jalan di http://localhost:${PORT}`);
});
