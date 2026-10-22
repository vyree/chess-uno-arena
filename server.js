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
const truth = require('./game/truth');
const questions = require('./game/questions');
const bot = require('./game/bot');
const chessbot = require('./game/chessbot');
const personachat = require('./game/personachat');
const { createVerifier } = require('./game/auth');
const { RoomManager, MAX_PLAYERS } = require('./game/rooms');
const { validateMessage } = require('./game/validate');

const PORT = parseInt(process.env.PORT, 10) || 3000;
// Auth gate (Misi 2 Fase 4) — PARKED by Sensei (2026-10-21). The gate
// only activates with FIREBASE_PROJECT_ID *and* REQUIRE_AUTH=1; otherwise
// the server runs open (nickname-only) and progress lives on the client.
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || null;
// Login gate PARKED (Sensei, 2026-10-21): token verification stays off
// unless explicitly re-enabled with REQUIRE_AUTH=1.
const tokenVerifier = (FIREBASE_PROJECT_ID && process.env.REQUIRE_AUTH === '1')
  ? createVerifier(FIREBASE_PROJECT_ID)
  : null;
if (!tokenVerifier) {
  console.warn('[auth] gerbang login MATI — login diparkir (mode nickname terbuka)');
}
const TURN_TIMEOUT_MS = 60 * 1000;
// Truth timing follows the engine contract (game/truth.js). The env
// overrides exist only so the WS simulation can run fast; production
// always uses the spec defaults.
const TRUTH_TIMING = {
  spin: parseInt(process.env.TRUTH_SPIN_MS, 10) || truth.SPIN_MS,
  askWindow: parseInt(process.env.TRUTH_ASK_WINDOW_MS, 10) || truth.ASK_WINDOW_MS,
  askSubmit: parseInt(process.env.TRUTH_ASK_SUBMIT_MS, 10) || truth.ASK_SUBMIT_MS,
  answer: parseInt(process.env.TRUTH_ANSWER_MS, 10) || truth.ANSWER_MS,
  react: parseInt(process.env.TRUTH_REACT_MS, 10) || truth.REACT_MS,
};
// UNO bot "thinking" pause (Misi 8, Sensei): a human-like random
// 5-10 s so bot turns feel natural instead of instant; the client
// labels the wait "is thinking". UNO_BOT_THINK_MS (env) pins the
// pause for tests/simulations.
function unoBotThinkMs() {
  const fixed = parseInt(process.env.UNO_BOT_THINK_MS || '', 10);
  if (Number.isFinite(fixed) && fixed >= 0) return fixed;
  return 5000 + Math.round(Math.random() * 5000);
}
const RECONNECT_GRACE_MS = parseInt(process.env.RECONNECT_GRACE_MS, 10) || 60 * 1000;
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
    truthSettings: room.game === 'truth' ? room.truthSettings : undefined,
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
  } else if (room.game === 'truth' && room.truth) {
    base.state = truth.snapshot(room.truth.st);
    base.truthStage = room.truthStage;
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
  if (room.game === 'truth') {
    payload.awards = result.awards;
    payload.scores = (room.truth ? room.truth.st.players : []).map((p) => {
      const rp = room.players.find((x) => x.id === p.id);
      return { playerId: p.id, nickname: rp ? rp.nickname : p.id, points: p.points };
    });
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
function forfeitPlayer(room, playerId, keepIdentity = false) {
  const player = room.players.find((p) => p.id === playerId);
  room.forfeitTimers.delete(playerId);
  if (room.status !== 'playing') {
    if (player) { rooms.removePlayer(room, playerId); if (!keepIdentity) players.delete(playerId); }
    if (rooms.get(room.code)) sendLobby(room);
    return;
  }
  if (room.game === 'chess') {
    const winnerColor = player && player.seat === 0 ? 'b' : 'w';
    room.chess.over = { result: winnerColor === 'w' ? '1-0' : '0-1', reason: 'forfeit' };
    room.status = 'over';
    clearTurnTimer(room);
    broadcast(room, gameOverPayload(room, { ...room.chess.over, winnerColor }));
  } else if (room.game === 'truth') {
    // Truth survives a departure: the engine keeps the seat and the
    // turn timers auto-pass a ghost answerer, so the game plays out
    // for everyone who stayed.
    rooms.removePlayer(room, playerId);
    if (rooms.get(room.code)) sendGameState(room);
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
  if (!keepIdentity) players.delete(playerId);
}

function handleDisconnect(player) {
  player.connected = false;
  player.socket = null;
  const room = player.roomCode ? rooms.get(player.roomCode) : null;
  if (!room) { players.delete(player.id); return; }
  // Misi 4A: EVERY room type gets the same reconnect grace — a refresh or
  // a dropped connection must never destroy a seat instantly. Room types
  // differ only in what expireGrace() does when the player never returns.
  // (Rejoin cancels this timer: route('rejoin') clears forfeitTimers.)
  const t = setTimeout(() => expireGrace(room, player.id), RECONNECT_GRACE_MS);
  room.forfeitTimers.set(player.id, t);
  if (room.status === 'lobby') sendLobby(room); else sendGameState(room);
}

function expireGrace(room, playerId) {
  room.forfeitTimers.delete(playerId);
  const player = players.get(playerId);
  if (!player || player.connected) return;
  if (room.isBotRoom) {
    // bot room is a solo table: it ends together with its human
    teardownBotRoom(room);
    players.delete(playerId);
    return;
  }
  // lobby: forfeitPlayer's non-playing branch releases the seat;
  // playing/over: it forfeits the game. Both delete the identity.
  forfeitPlayer(room, playerId);
}

// ---------------- game actions ----------------
function handleStartGame(player, room, data) {
  if (room.hostId !== player.id) { sendError(player.socket, 'Hanya pembuat room yang bisa mulai'); return; }
  if (room.status !== 'lobby') { sendError(player.socket, 'Game sudah berjalan'); return; }
  if (room.game === 'chess') {
    if (room.players.length < 2) { sendError(player.socket, 'Tunggu lawan masuk dulu'); return; }
    room.chess = chess.newGame();
    room.status = 'playing';
  } else if (room.game === 'truth') {
    if (room.players.length < 2) { sendError(player.socket, 'Truth butuh minimal 2 pemain'); return; }
    const started = startTruthGame(room);
    if (!started.ok) sendError(player.socket, started.error);
    return;
  } else {
    if (room.players.length < 2) { sendError(player.socket, 'UNO butuh minimal 2 pemain'); return; }
    // UNO: seat order is shuffled at every game start (Sensei, Misi 2)
    rooms.shuffleSeats(room);
    room.unoMode = (data && data.mode) || 'normal';
    const n = room.players.length;
    room.uno = { st: uno.newGame(n, { mode: room.unoMode }), active: new Array(n).fill(true), round: 1 };
    room.scoreBoard = {};
    for (const p of room.players) room.scoreBoard[p.id] = 0;
    room.status = 'playing';
  }
  startTurnTimer(room);
  sendGameState(room);
}

function countPieces(board) {
  let n = 0;
  for (const p of board) if (p) n++;
  return n;
}

// What a chess move did, captured BEFORE it is applied (Misi 8: the
// persona skill chat triggers need the moved/captured piece types).
function chessMoveMeta(room, from, to, moverIsBot) {
  const moved = room.chess.board[from];
  const victim = room.chess.board[to];
  return {
    moverIsBot,
    movedType: moved ? moved.t : null,
    capturedType: victim ? victim.t : null,
    movedTo: to,
  };
}

function handleChessMove(player, room, data) {
  if (room.status !== 'playing' || !room.chess) { sendError(player.socket, 'Game belum berjalan'); return; }
  if (chessColor(player.seat) !== room.chess.turn) { sendError(player.socket, 'Bukan giliranmu'); return; }
  const from = chess.parseSq(data.from);
  const to = chess.parseSq(data.to);
  const meta = chessMoveMeta(room, from, to, !!player.isBot);
  const before = countPieces(room.chess.board);
  const r = chess.applyMove(room.chess, from, to, data.promotion);
  if (!r.ok) { sendError(player.socket, r.error === 'langkah tidak legal' ? 'Langkah tidak legal' : 'Langkah tidak valid'); return; }
  afterChessMove(room, r, { ...meta, captured: countPieces(room.chess.board) < before });
}

// Shared tail of a successful chess move (human or the VS AI persona):
// game over, or next turn + let the AI answer when it is its move.
// In VS AI rooms the persona also reacts in chat (Misi 7): captures,
// checks, and the final result get the occasional in-character line.
function afterChessMove(room, r, meta) {
  clearTurnTimer(room);
  if (r.status) {
    room.status = 'over';
    const winnerColor = r.status.result === '1-0' ? 'w' : r.status.result === '0-1' ? 'b' : null;
    sendGameState(room);
    broadcast(room, gameOverPayload(room, { ...r.status, winnerColor }));
    personaResultLine(room, winnerColor);
  } else {
    startTurnTimer(room);
    sendGameState(room);
    personaMoveLine(room, meta);
    scheduleChessAiIfNeeded(room);
  }
}

// ----- VS AI persona chat (Misi 7) -----
function personaName(room) {
  const botPlayer = room.players.find((p) => p.isBot);
  return botPlayer ? botPlayer.nickname : 'AI';
}

function broadcastPersonaChat(room, text) {
  broadcast(room, { type: 'chat', from: personaName(room), text });
}

function schedulePersonaLine(room, line) {
  if (!line) return;
  setTimeout(() => {
    if (!rooms.get(room.code)) return;
    broadcastPersonaChat(room, line.text);
  }, line.delayMs);
}

// The board truth a persona may quote in chat: player name, who is
// ahead on material (bot's perspective; the bot is always Black),
// capture tallies, move number, and who is in check right now.
function chessFacts(room) {
  const st = room.chess;
  const human = room.players.find((p) => !p.isBot);
  const evalCp = chessbot.evaluate(st); // white perspective
  const inCheckNow = chess.inCheck(st.board, st.turn);
  return {
    name: human ? human.nickname : 'kamu',
    material: evalCp < -60 ? 'ahead' : evalCp > 60 ? 'behind' : 'even',
    capturesByBot: room.aiCaptures ? room.aiCaptures.bot : 0,
    capturesByHuman: room.aiCaptures ? room.aiCaptures.human : 0,
    moveNumber: st.full,
    checkSide: inCheckNow ? (st.turn === 'b' ? 'bot' : 'human') : null,
  };
}

function personaResultLine(room, winnerColor) {
  if (!room.isBotRoom || !room.aiChat) return;
  const category = winnerColor === 'b' ? 'win' : winnerColor === 'w' ? 'lose' : 'draw';
  const line = personachat.eventLine(room.aiChat, room.aiPersona, category, chessFacts(room), Math.random, Date.now());
  schedulePersonaLine(room, line);
}

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900 };

// Gemini's parade moment (Misi 8): both his knights still alive and
// the one that just moved has crossed into the human's half.
function botKnightsAdvanced(room, meta) {
  let knights = 0;
  for (const p of room.chess.board) if (p && p.t === 'n' && p.c === 'b') knights++;
  return knights >= 2 && Math.floor(meta.movedTo / 8) <= 3;
}

// Meta's bait (Misi 8): after his move the human CAN capture one of
// his pieces worth a knight or more — poisoned or not, he taunts.
function metaOffersBait(room) {
  for (const m of chess.allLegalMoves(room.chess, 'w')) {
    const victim = room.chess.board[m.to];
    if (victim && victim.c === 'b' && (PIECE_VALUES[victim.t] || 0) >= 300) return true;
  }
  return false;
}

function personaMoveLine(room, meta) {
  if (!room.isBotRoom || !room.aiChat || !meta) return;
  if (meta.captured) {
    if (meta.moverIsBot) room.aiCaptures.bot += 1;
    else room.aiCaptures.human += 1;
  }
  let category = null;
  if (room.aiPersona === 'gemini' && !meta.moverIsBot && meta.capturedType === 'n') category = 'knightLost';
  else if (room.aiPersona === 'gemini' && meta.moverIsBot && meta.movedType === 'n'
    && (room.aiParadeCount || 0) < 2 && botKnightsAdvanced(room, meta)) category = 'parade';
  else if (room.aiPersona === 'meta' && meta.moverIsBot && metaOffersBait(room)) category = 'bait';
  else if (room.aiPersona === 'claude' && meta.moverIsBot && meta.capturedType === 'q') category = 'grind';
  else if (meta.captured) category = meta.moverIsBot ? 'botCaptured' : 'humanCaptured';
  else if (chess.inCheck(room.chess.board, room.chess.turn)) {
    category = meta.moverIsBot ? 'botGaveCheck' : 'botInCheck';
  }
  if (!category) return;
  const line = personachat.eventLine(room.aiChat, room.aiPersona, category, chessFacts(room), Math.random, Date.now());
  if (line && category === 'parade') room.aiParadeCount = (room.aiParadeCount || 0) + 1;
  schedulePersonaLine(room, line);
}

// A long think deserves an occasional mid-wait remark ("Sebentar,
// posisi ini menarik…"), fired partway into the scheduled pause and
// re-checked against the persona's chance/gap rules when it lands.
function scheduleThinkLine(room, thinkMs) {
  if (!room.aiChat || thinkMs < 20000) return;
  room.aiThinkTimer = setTimeout(() => {
    room.aiThinkTimer = null;
    if (!rooms.get(room.code) || room.status !== 'playing') return;
    const line = personachat.eventLine(room.aiChat, room.aiPersona, 'longThink', chessFacts(room), Math.random, Date.now());
    if (line) broadcastPersonaChat(room, line.text);
  }, Math.round(thinkMs * 0.4));
}

// Position facts the thinking-time model needs (Misi 7): which phase
// of the game we are in, whether the persona is in check, how many
// legal moves exist, and whether an obvious recapture is available.
function chessThinkContext(room) {
  const st = room.chess;
  const legal = chess.allLegalMoves(st, st.turn);
  let canRecapture = false;
  if (st.lastMove) {
    const target = chess.parseSq(st.lastMove.to);
    const victim = st.board[target];
    if (victim && victim.c !== st.turn) {
      canRecapture = legal.some((m) => m.to === target);
    }
  }
  return {
    moveNumber: st.full,
    inCheck: chess.inCheck(st.board, st.turn),
    legalCount: legal.length,
    canRecapture,
  };
}

// VS AI chess (Misi 6): when the side to move belongs to the persona,
// schedule its answer after a dramatic "thinking" pause. pickThinkMs
// caps the pause inside the turn limit, so the AI never times out.
// CHESS_AI_THINK_MS (env) pins the pause for tests/simulations.
function scheduleChessAiIfNeeded(room) {
  if (room.game !== 'chess' || !room.isBotRoom || room.status !== 'playing' || !room.chess || room.chess.over) return;
  if (room.botTimer) return;
  const seat = room.chess.turn === 'w' ? 0 : 1;
  const p = room.players[seat];
  if (!p || !p.isBot) return;
  const fixed = parseInt(process.env.CHESS_AI_THINK_MS || '', 10);
  const thinkMs = Number.isFinite(fixed) && fixed >= 0
    ? fixed
    : chessbot.pickThinkMs(Math.random, TURN_TIMEOUT_MS, chessThinkContext(room));
  scheduleThinkLine(room, thinkMs);
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (!rooms.get(room.code) || room.status !== 'playing') return;
    runChessAiTurn(room);
  }, thinkMs);
}

function runChessAiTurn(room) {
  if (room.aiThinkTimer) { clearTimeout(room.aiThinkTimer); room.aiThinkTimer = null; }
  if (room.status !== 'playing' || !room.chess || room.chess.over) return;
  const seat = room.chess.turn === 'w' ? 0 : 1;
  const p = room.players[seat];
  if (!p || !p.isBot) return;
  const mv = chessbot.chooseMove(room.chess, room.aiPersona);
  if (!mv) return;
  const meta = chessMoveMeta(room, mv.from, mv.to, true);
  const before = countPieces(room.chess.board);
  const r = chess.applyMove(room.chess, mv.from, mv.to, mv.promo);
  if (!r.ok) return; // cannot happen: chooseMove returns legal moves only
  afterChessMove(room, r, { ...meta, captured: countPieces(room.chess.board) < before });
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
    const msgs = { 'bukan giliranmu': 'Bukan giliranmu', 'kartu tidak cocok': 'Kartu tidak cocok', 'pilih warna dulu': 'Pilih warna dulu untuk kartu wild', 'kartu tidak ada di tanganmu': 'Kartu tidak ada di tanganmu', 'hanya kartu sejenis yang bisa menumpuk': 'Hanya kartu sejenis yang bisa menumpuk tumpukan ini', '+4 tidak bisa ditumpuk di mode normal': 'Mode Normal: +4 tidak bisa ditumpuk — ambil kartunya!', 'tumpukan +4 hanya bisa dijawab +4': 'Tumpukan +4 hanya bisa dijawab +4', 'kartu spesial hanya bisa dipakai melawan tumpukan': 'Kartu spesial hanya bisa dipakai melawan tumpukan' };
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
    if (p.active === false) {
      rooms.removePlayer(room, p.id);
      // Reap the identity only while it is still bound to this room; a
      // leaver who kept theirs (Misi 4B) may already be playing elsewhere.
      if (p.roomCode === room.code) players.delete(p.id);
    }
  }
  if (room.players.length < 2) { sendError(player.socket, 'Butuh minimal 2 pemain'); return; }
  // UNO: seats are re-shuffled every new round (Sensei, Misi 2)
  rooms.shuffleSeats(room);
  const n = room.players.length;
  room.uno = { st: uno.newGame(n, { mode: room.unoMode || 'normal' }), active: new Array(n).fill(true), round: room.uno.round + 1 };
  room.status = 'playing';
  startTurnTimer(room);
  sendGameState(room);
  scheduleBotIfNeeded(room);
}

// ---------------- Truth or Truth (Misi 3 Fase 2) ----------------
// The engine is a pure state machine; this driver owns the clock:
// spin -> ASK window -> answering -> reacting -> next spin. Every engine
// event is broadcast as `truth_event` (the mandatory on-screen popups)
// and mirrored by the MC bot when the room has only 2 humans.
function nickOf(room, playerId) {
  const p = room.players.find((x) => x.id === playerId);
  return p ? p.nickname : 'Pemain';
}

function truthSetTimer(room, ms, fn) {
  clearTurnTimer(room);
  room.deadline = Date.now() + ms;
  room.timer = setTimeout(() => { room.timer = null; fn(); }, ms);
}

function mcSay(room, text) { broadcast(room, { type: 'chat', from: 'MC', text }); }

function mcSpeak(room, events) {
  if (!room.truth || !room.truth.mc) return;
  for (const e of events) {
    if (e.type === 'turn_started') {
      mcSay(room, `🎡 Putaran ke-${e.turnNumber} dari ${e.totalTurns}! Rodanya berhenti di ${nickOf(room, e.playerId)}!`);
    } else if (e.type === 'ask_claimed') {
      mcSay(room, `🙋 ${nickOf(room, e.playerId)} mau bertanya!`);
    } else if (e.type === 'question_ready') {
      mcSay(room, `❓ ${nickOf(room, e.playerId)} bertanya: ${room.truth.st.current.question}`);
    } else if (e.type === 'card_opened') {
      mcSay(room, `📖 Soalnya: ${e.question}`);
    } else if (e.type === 'passed') {
      mcSay(room, `⏭️ ${nickOf(room, e.playerId)} skip!!`);
    } else if (e.type === 'answer_timeout') {
      mcSay(room, `⌛ Waktu habis! ${nickOf(room, e.playerId)} tidak menjawab.`);
    } else if (e.type === 'ask_expired') {
      mcSay(room, `🤔 ${nickOf(room, e.playerId)} kelamaan menyusun pertanyaan — giliran hangus!`);
    } else if (e.type === 'game_over' && e.awards && e.awards.topScorer) {
      mcSay(room, `🏆 Selesai! Poin tertinggi: ${nickOf(room, e.awards.topScorer.playerId)} dengan ${e.awards.topScorer.points} poin!`);
    }
  }
}

function emitTruthEvents(room, events) {
  if (!events || !events.length) return;
  broadcast(room, { type: 'truth_event', events });
  mcSpeak(room, events);
}

function startTruthGame(room) {
  const s = room.truthSettings || { totalQuestions: null, explicitMode: false };
  const r = truth.createGame({
    playerIds: room.players.map((p) => p.id),
    questions: s.explicitMode ? questions.EXPLICIT : questions.ALL,
    explicitMode: s.explicitMode,
    totalQuestions: s.totalQuestions === null ? undefined : s.totalQuestions,
  });
  if (!r.ok) return r;
  room.truth = { st: r.state, mc: room.players.filter((p) => !p.isBot).length < 3 };
  room.status = 'playing';
  room.truthStage = 'spin';
  if (room.truth.mc) {
    mcSay(room, '🎤 Karena pemainnya pas-pasan, MC ikut menemani — aku yang putar rodanya yaa!');
  }
  sendGameState(room);
  emitTruthEvents(room, [{
    type: 'turn_started', playerId: r.state.current.answererId,
    turnNumber: 1, totalTurns: r.state.totalTurns, round: 1,
  }]);
  truthSetTimer(room, TRUTH_TIMING.spin, () => truthOpenAsk(room));
  return { ok: true };
}

function truthOpenAsk(room) {
  if (!room.truth || room.status !== 'playing') return;
  room.truthStage = 'ask';
  sendGameState(room);
  // The pause notice differs per mode (Sensei): explicit rooms announce
  // a random explicit question instead of inviting an ASK.
  broadcast(room, { type: 'truth_event', events: [{
    type: room.truth.st.explicitMode ? 'explicit_question_incoming' : 'ask_window_open',
  }] });
  truthSetTimer(room, TRUTH_TIMING.askWindow, () => {
    if (!room.truth || room.status !== 'playing') return;
    const r = truth.openCard(room.truth.st);
    if (!r.ok) return; // an ASK claim holds the turn; its own timer rules
    truthAfterQuestion(room, r.events);
  });
}

function truthAfterQuestion(room, events) {
  room.truthStage = 'answer';
  sendGameState(room);
  emitTruthEvents(room, events);
  truthSetTimer(room, TRUTH_TIMING.answer, () => {
    if (!room.truth || room.status !== 'playing') return;
    const r = truth.timeoutTurn(room.truth.st);
    if (r.ok) truthOnTurnClosed(room, r.events);
  });
  scheduleTruthBots(room);
}

function truthOnTurnClosed(room, events) {
  const finished = room.truth.st.phase === 'finished';
  if (finished) {
    room.status = 'over';
    room.truthStage = null;
    clearTurnTimer(room);
    clearTruthBotTimers(room);
  } else {
    room.truthStage = 'spin';
  }
  sendGameState(room);
  emitTruthEvents(room, events);
  if (finished) {
    broadcast(room, gameOverPayload(room, { awards: room.truth.st.awards }));
    return;
  }
  truthSetTimer(room, TRUTH_TIMING.spin, () => truthOpenAsk(room));
}

function truthGuard(player, room) {
  if (room.game !== 'truth' || room.status !== 'playing' || !room.truth) {
    sendError(player.socket, 'Game Truth belum berjalan');
    return false;
  }
  return true;
}

function handleTruthSetRules(player, room, data) {
  if (room.game !== 'truth') { sendError(player.socket, 'Ini bukan room Truth'); return; }
  if (room.hostId !== player.id) { sendError(player.socket, 'Hanya pembuat room yang bisa set aturan'); return; }
  if (room.status !== 'lobby') { sendError(player.socket, 'Aturan hanya bisa diubah di lobby'); return; }
  if (data.totalQuestions !== undefined) room.truthSettings.totalQuestions = data.totalQuestions;
  if (data.explicitMode !== undefined) room.truthSettings.explicitMode = data.explicitMode;
  sendLobby(room);
}

function handleTruthAsk(player, room) {
  if (!truthGuard(player, room)) return;
  if (room.truthStage !== 'ask') { sendError(player.socket, 'Jendela ASK belum terbuka'); return; }
  const r = truth.claimAsk(room.truth.st, player.id);
  if (!r.ok) { sendError(player.socket, r.error); return; }
  sendGameState(room);
  emitTruthEvents(room, r.events);
  // the asker now has ASK_SUBMIT_MS to actually send the question
  truthSetTimer(room, TRUTH_TIMING.askSubmit, () => {
    if (!room.truth || room.status !== 'playing') return;
    const ex = truth.expireAskWindow(room.truth.st);
    if (ex.ok) truthOnTurnClosed(room, ex.events);
  });
}

function handleTruthAskQuestion(player, room, data) {
  if (!truthGuard(player, room)) return;
  const r = truth.submitAskQuestion(room.truth.st, player.id, data.question);
  if (!r.ok) { sendError(player.socket, r.error); return; }
  truthAfterQuestion(room, r.events);
}

function enterTruthReact(room, events) {
  room.truthStage = 'react';
  sendGameState(room);
  emitTruthEvents(room, events);
  truthSetTimer(room, TRUTH_TIMING.react, () => {
    if (!room.truth || room.status !== 'playing') return;
    const e = truth.endTurn(room.truth.st);
    if (e.ok) truthOnTurnClosed(room, e.events);
  });
  scheduleTruthBots(room);
}

function handleTruthAnswer(player, room, data) {
  if (!truthGuard(player, room)) return;
  const r = truth.submitAnswer(room.truth.st, player.id, data.text);
  if (!r.ok) { sendError(player.socket, r.error); return; }
  enterTruthReact(room, r.events);
}

function handleTruthPass(player, room) {
  if (!truthGuard(player, room)) return;
  const r = truth.passTurn(room.truth.st, player.id);
  if (!r.ok) { sendError(player.socket, r.error); return; }
  truthOnTurnClosed(room, r.events);
}

function handleTruthReact(player, room, data) {
  if (!truthGuard(player, room)) return;
  const r = truth.react(room.truth.st, player.id, data.kind);
  if (!r.ok) { sendError(player.socket, r.error); return; }
  sendGameState(room);
  emitTruthEvents(room, r.events);
}

function handleTruthKurangGreget(player, room) {
  if (!truthGuard(player, room)) return;
  const r = truth.kurangGreget(room.truth.st, player.id);
  if (!r.ok) { sendError(player.socket, r.error); return; }
  sendGameState(room);
  emitTruthEvents(room, r.events);
}

function handleTruthNext(player, room) {
  if (!truthGuard(player, room)) return;
  if (room.truth.st.current.answererId !== player.id) {
    sendError(player.socket, 'Hanya penjawab yang bisa lanjut');
    return;
  }
  const r = truth.endTurn(room.truth.st);
  if (!r.ok) { sendError(player.socket, r.error); return; }
  truthOnTurnClosed(room, r.events);
}

// ---------------- Truth bots (playtest rooms) ----------------
// Bots cannot really answer (Sensei): this driver simulates answers
// from game/bot.js, lets bots react to answers, and shortens a bot's
// own reaction window so a solo test game keeps moving.
function truthBotLater(room, ms, fn) {
  if (!room.truthBotTimers) room.truthBotTimers = new Set();
  const t = setTimeout(() => {
    room.truthBotTimers.delete(t);
    if (!rooms.get(room.code) || !room.truth || room.status !== 'playing') return;
    fn();
  }, ms);
  room.truthBotTimers.add(t);
  return t;
}

function clearTruthBotTimers(room) {
  if (!room.truthBotTimers) return;
  for (const t of room.truthBotTimers) clearTimeout(t);
  room.truthBotTimers.clear();
}

function scheduleTruthBots(room) {
  if (!room.truth || room.status !== 'playing') return;
  const st = room.truth.st;
  if (room.truthStage === 'answer' && st.phase === 'answering') {
    const ans = room.players.find((p) => p.id === st.current.answererId);
    if (ans && ans.isBot) {
      const delay = Math.min(2000 + Math.random() * 2000, TRUTH_TIMING.answer * 0.4);
      truthBotLater(room, delay, () => {
        const r = truth.submitAnswer(st, ans.id, bot.pickTruthAnswer());
        if (r.ok) enterTruthReact(room, r.events);
      });
    }
    return;
  }
  if (room.truthStage === 'react' && st.phase === 'reacting') {
    for (const p of room.players) {
      if (!p.isBot || p.id === st.current.answererId) continue;
      if (Math.random() < 0.25) continue; // some bots stay quiet
      truthBotLater(room, 500 + Math.random() * TRUTH_TIMING.react * 0.5, () => {
        const kind = truth.REACTIONS[Math.floor(Math.random() * truth.REACTIONS.length)];
        const r = truth.react(st, p.id, kind);
        if (!r.ok) return;
        sendGameState(room);
        emitTruthEvents(room, r.events);
        if (Math.random() < 0.3) { // sometimes a second reaction
          const kind2 = truth.REACTIONS[Math.floor(Math.random() * truth.REACTIONS.length)];
          const r2 = truth.react(st, p.id, kind2);
          if (r2.ok) { sendGameState(room); emitTruthEvents(room, r2.events); }
        }
      });
    }
    const ans = room.players.find((p) => p.id === st.current.answererId);
    if (ans && ans.isBot) {
      // do not make the human wait out a bot's full reaction window
      truthBotLater(room, TRUTH_TIMING.react * 0.75, () => {
        const e = truth.endTurn(st);
        if (e.ok) truthOnTurnClosed(room, e.events);
      });
    }
  }
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
  }, unoBotThinkMs());
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
  clearTruthBotTimers(room);
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
    // Refresh the room's view of the rejoined player, phase-correctly:
    // sendGameState on a lobby room crashes (no game state exists yet).
    if (room.status === 'lobby') { send(ws, lobbySnapshot(room, p)); sendLobby(room); }
    else { send(ws, gameSnapshot(room, p)); sendGameState(room); }
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
      room.unoMode = data.mode || 'normal';
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
      room.uno = { st: uno.newGame(n, { mode: room.unoMode }), active: new Array(n).fill(true), round: 1 };
      room.scoreBoard = {};
      for (const p of room.players) room.scoreBoard[p.id] = 0;
      room.status = 'playing';
      startTurnTimer(room);
      sendGameState(room);
      scheduleBotIfNeeded(room);
      return;
    }
    case 'create_truth_bot_room': {
      // Solo Truth playtest table (Sensei): the human plus bots that
      // simulate answers; the game starts at once with default rules.
      if (player.roomCode) { sendError(ws, 'Kamu sudah di sebuah room'); return; }
      const created = rooms.create('truth', player);
      if (!created.ok) { sendError(ws, created.error); return; }
      const room = created.room;
      room.isBotRoom = true;
      for (let i = 0; i < data.size - 1; i++) {
        const bp = {
          id: 'bot-' + crypto.randomUUID(), nickname: bot.BOT_NAMES[i % bot.BOT_NAMES.length],
          isBot: true, socket: null, roomCode: room.code, seat: 0, connected: true, active: true,
        };
        players.set(bp.id, bp);
        rooms.addPlayer(room, bp);
      }
      const started = startTruthGame(room);
      if (!started.ok) { teardownBotRoom(room); sendError(ws, started.error); }
      return;
    }
    case 'ping': {
      send(ws, { type: 'pong', t: Date.now() });
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
      } else if (room.status === 'playing') {
        // anggap forfeit langsung
        const t = room.forfeitTimers.get(player.id);
        if (t) { clearTimeout(t); room.forfeitTimers.delete(player.id); }
        forfeitPlayer(room, player.id, true);
      } else {
        rooms.removePlayer(room, player.id);
        if (rooms.get(room.code)) sendLobby(room);
      }
      // EVERY path releases the leaver and confirms it, so the client can
      // always return to the main menu (bug fix 2026-10-21: the forfeit
      // path previously never sent left_room and the player got stuck).
      // Misi 4B: identity is persistent — leaving detaches the player from
      // the room only; the record and this socket's binding survive, so
      // the next create/join never needs a fresh hello first.
      player.roomCode = null;
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
      // VS AI rooms: the persona may answer (Misi 7) — scripted brain,
      // typing delay, cooldown and abuse ladder live in personachat.
      if (room.isBotRoom && room.game === 'chess' && room.aiChat && !player.isBot) {
        const reply = personachat.respond(room.aiChat, room.aiPersona, data.text, chessFacts(room), Math.random, now);
        schedulePersonaLine(room, reply);
      }
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
    case 'create_chess_ai_room': {
      // VS AI chess (Misi 6): the human (White) plus one persona seat;
      // the game starts at once. Internally a bot room — the UI only
      // ever presents the persona as an AI opponent.
      if (player.roomCode) { sendError(ws, 'Kamu sudah di sebuah room'); return; }
      const created = rooms.create('chess', player);
      if (!created.ok) { sendError(ws, created.error); return; }
      const room = created.room;
      room.isBotRoom = true;
      room.aiPersona = data.persona;
      const bp = {
        id: 'bot-' + crypto.randomUUID(), nickname: chessbot.PERSONAS[data.persona].name,
        isBot: true, socket: null, roomCode: room.code, seat: 0, connected: true, active: true,
      };
      players.set(bp.id, bp);
      rooms.addPlayer(room, bp);
      room.chess = chess.newGame();
      room.status = 'playing';
      room.aiChat = personachat.createState();
      room.aiCaptures = { bot: 0, human: 0 };
      room.aiParadeCount = 0;
      startTurnTimer(room);
      sendGameState(room);
      schedulePersonaLine(room, personachat.eventLine(
        room.aiChat, room.aiPersona, 'start', chessFacts(room), Math.random, Date.now()));
      return;
    }
    case 'chess_new_round': {
      const room = needRoom(); if (!room) return;
      if (room.game !== 'chess' || !room.isBotRoom || room.status !== 'over') {
        sendError(ws, 'Ronde baru hanya untuk VS AI yang sudah selesai');
        return;
      }
      room.chess = chess.newGame();
      room.status = 'playing';
      room.aiCaptures = { bot: 0, human: 0 };
      room.aiParadeCount = 0;
      startTurnTimer(room);
      sendGameState(room);
      if (room.aiChat) {
        schedulePersonaLine(room, personachat.eventLine(
          room.aiChat, room.aiPersona, 'start', chessFacts(room), Math.random, Date.now()));
      }
      return;
    }
    case 'truth_set_rules': {
      const room = needRoom(); if (!room) return;
      handleTruthSetRules(player, room, data);
      return;
    }
    case 'truth_ask': {
      const room = needRoom(); if (!room) return;
      handleTruthAsk(player, room);
      return;
    }
    case 'truth_ask_question': {
      const room = needRoom(); if (!room) return;
      handleTruthAskQuestion(player, room, data);
      return;
    }
    case 'truth_answer': {
      const room = needRoom(); if (!room) return;
      handleTruthAnswer(player, room, data);
      return;
    }
    case 'truth_pass': {
      const room = needRoom(); if (!room) return;
      handleTruthPass(player, room);
      return;
    }
    case 'truth_react': {
      const room = needRoom(); if (!room) return;
      handleTruthReact(player, room, data);
      return;
    }
    case 'truth_kurang_greget': {
      const room = needRoom(); if (!room) return;
      handleTruthKurangGreget(player, room);
      return;
    }
    case 'truth_next': {
      const room = needRoom(); if (!room) return;
      handleTruthNext(player, room);
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
      // Misi 4B: route strictly in arrival order per socket. route() is
      // async (hello awaits token verification); without this chain, two
      // frames sharing one packet interleave and an action can outrun its
      // own hello — the intermittent 'Kirim hello dulu ya'. The catch is
      // inside the chain so one bad message never poisons the queue.
      ws._chain = (ws._chain || Promise.resolve()).then(() =>
        route(ws, v.type, v.data).catch((e) => {
          console.error('route error:', e.message);
          sendError(ws, 'Terjadi kesalahan, coba lagi.');
        })
      );
    } catch (e) {
      console.error('message handler error:', e.message);
      sendError(ws, 'Terjadi kesalahan, coba lagi.');
    }
  });
  ws.on('close', () => {
    try {
      const p = getPlayerBySocket(ws);
      // Misi 4A: only the socket that currently owns the player may run
      // disconnect handling — a stale close arriving after a rejoin on a
      // newer socket must not touch the live session.
      if (p && p.socket === ws) handleDisconnect(p);
    } catch (e) { console.error('close handler error:', e.message); }
  });
  ws.on('error', () => {});
});

httpServer.listen(PORT, () => {
  console.log(`Chess + UNO Arena jalan di http://localhost:${PORT}`);
});
