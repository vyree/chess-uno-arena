'use strict';
/* Chess + UNO Arena — client. NO game rules here; only rendering + sending intents. */

const S = {
  ws: null, playerId: null, nickname: '', game: 'chess',
  roomCode: null, players: [], hostId: null,
  chess: null, uno: null, unoMeta: {},
  selected: null, legalMoves: [],
  saidUnoArmed: false, deadline: null, helloSent: false,
};

const PIECES = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};
const UNO_LABEL = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4' };

const $ = (id) => document.getElementById(id);

// ---------- utils ----------
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), ms || 2600);
}
function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
  $(id).classList.remove('hidden');
  window.scrollTo(0, 0);
}
function showModal(title, bodyHTML, actions) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = bodyHTML;
  const box = $('modal-actions');
  box.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.cls || 'secondary');
    b.textContent = a.label;
    b.onclick = () => { $('modal').classList.add('hidden'); a.onClick && a.onClick(); };
    box.appendChild(b);
  }
  $('modal').classList.remove('hidden');
}
function hideModal() { $('modal').classList.add('hidden'); }

// ---------- websocket ----------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(proto + '://' + location.host);
  S.ws = ws;
  ws.onopen = () => {
    const sess = loadSession();
    if (sess && sess.playerId && sess.code) {
      send('rejoin', { playerId: sess.playerId, code: sess.code });
    } else if (sess && sess.nickname) {
      $('nickname').value = sess.nickname;
    }
  };
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    route(m);
  };
  ws.onclose = () => {
    toast('Koneksi putus — mencoba ulang…');
    setTimeout(connect, 2500);
  };
}
function send(type, data) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ type, data: data || {} }));
}
function saveSession() {
  sessionStorage.setItem('cua', JSON.stringify({
    playerId: S.playerId, code: S.roomCode, nickname: S.nickname,
  }));
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem('cua')); } catch { return null; }
}
function clearSession() { sessionStorage.removeItem('cua'); }

function ensureHello() {
  const nick = $('nickname').value.trim();
  if (!nick) { $('nick-error').textContent = 'Isi nickname dulu ya'; return false; }
  if (nick.length > 16) { $('nick-error').textContent = 'Maksimal 16 karakter'; return false; }
  $('nick-error').textContent = '';
  if (!S.helloSent) {
    send('hello', { nickname: nick });
    S.helloSent = true;
  }
  S.nickname = nick;
  return true;
}

// ---------- router ----------
function route(m) {
  switch (m.type) {
    case 'welcome':
      S.playerId = m.playerId; S.nickname = m.nickname; saveSession();
      if (m.rejoined) toast('Kembali tersambung! 🎉');
      break;
    case 'room_list': renderRoomList(m.rooms); break;
    case 'lobby_update': onLobby(m); break;
    case 'game_state': onGameState(m); break;
    case 'chess_legal': onChessLegal(m); break;
    case 'game_over': onGameOver(m); break;
    case 'chat': addChat(m.from, m.text); break;
    case 'left_room':
      S.roomCode = null; clearSession(); showScreen('screen-landing'); refreshRooms();
      break;
    case 'error':
      if (/room|kode/i.test(m.message)) $('join-error').textContent = m.message;
      else toast(m.message);
      break;
  }
}

// ---------- landing ----------
function refreshRooms() {
  if (!ensureHelloQuiet()) return;
  send('list_rooms');
}
function ensureHelloQuiet() {
  const nick = $('nickname').value.trim() || 'Tamu';
  if (!S.helloSent) { send('hello', { nickname: nick }); S.helloSent = true; S.nickname = nick; }
  return true;
}
function renderRoomList(rooms) {
  const box = $('room-list');
  box.innerHTML = '';
  if (!rooms.length) { box.innerHTML = '<p class="muted">Belum ada room. Buat satu yuk!</p>'; return; }
  for (const r of rooms) {
    const div = document.createElement('div');
    div.className = 'room-item';
    const label = r.game === 'chess' ? '♟️ Catur' : '🃏 UNO';
    div.innerHTML = `<span><span class="code">${r.code}</span> · ${label} · ${r.players.length}/${r.maxPlayers}</span>`;
    const b = document.createElement('button');
    b.className = 'btn secondary small'; b.textContent = 'Gabung';
    b.onclick = () => { if (ensureHello()) send('join_room', { code: r.code }); };
    div.appendChild(b);
    box.appendChild(div);
  }
}

// ---------- lobby ----------
function onLobby(m) {
  S.roomCode = m.code; S.players = m.players; S.hostId = m.hostId; S.game = m.game;
  saveSession();
  showScreen('screen-lobby');
  $('lobby-code').textContent = m.code;
  $('lobby-count').textContent = m.players.length;
  const ul = $('lobby-players');
  ul.innerHTML = '';
  for (const p of m.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p.nickname}</span>` +
      (p.id === m.hostId ? '<span class="host-badge">👑 Host</span>' : '') +
      (p.id === m.you ? '<span class="muted"> (kamu)</span>' : '');
    ul.appendChild(li);
  }
  const isHost = m.you === m.hostId;
  $('btn-start').disabled = !isHost;
  $('btn-start').textContent = isHost ? '▶️ Mulai Main' : '⏳ Menunggu host…';
}

// ---------- chess ----------
function onGameState(m) {
  S.roomCode = m.code; S.players = m.players; S.hostId = m.hostId;
  S.deadline = m.deadline; saveSession();
  if (m.game === 'chess') {
    S.chess = m.state; S.game = 'chess';
    showScreen('screen-chess');
    renderChess(m);
  } else {
    S.uno = m.state; S.unoMeta = m; S.game = 'uno';
    showScreen('screen-uno');
    renderUno(m);
  }
}

function myColor(m) {
  const me = m.players.find((p) => p.id === m.you);
  return me && me.seat === 1 ? 'b' : 'w';
}

function renderChess(m) {
  const st = m.state;
  const color = myColor(m);
  const isMyTurn = st.turn === color && !st.over;
  const opp = m.players.find((p) => p.id !== m.you);
  $('chess-opponent').textContent = '♟️ vs ' + (opp ? opp.nickname : '?');
  const badge = $('chess-turn');
  if (st.over) { badge.textContent = 'Selesai'; badge.className = 'turn-badge'; }
  else if (isMyTurn) { badge.textContent = 'Giliranmu!'; badge.className = 'turn-badge mine'; }
  else { badge.textContent = 'Giliran lawan'; badge.className = 'turn-badge'; }

  $('chess-status').textContent = st.inCheck && !st.over
    ? (isMyTurn ? '⚠️ Rajamu sedang diskak!' : '⚠️ Raja lawan diskak!') : '';

  const board = $('board');
  board.innerHTML = '';
  const last = st.lastMove || {};
  const legalTo = new Set(S.legalMoves.map((x) => x.to));
  const legalFrom = S.selected;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rr = color === 'w' ? 7 - r : r;
      const ff = color === 'w' ? f : 7 - f;
      const idx = rr * 8 + ff;
      const sq = $('board').appendChild(document.createElement('div'));
      const name = 'abcdefgh'[ff] + (rr + 1);
      sq.className = 'square ' + ((rr + ff) % 2 === 0 ? 'dark' : 'light');
      sq.dataset.sq = name;
      const piece = st.board[idx];
      if (piece) {
        const span = document.createElement('span');
        span.className = piece[0] === 'w' ? 'piece-w' : 'piece-b';
        span.textContent = PIECES[piece];
        sq.appendChild(span);
      }
      if (last.from === name) sq.classList.add('last-from');
      if (last.to === name) sq.classList.add('last-to');
      if (legalFrom === name) sq.classList.add('selected');
      if (legalTo.has(name)) sq.classList.add(piece ? 'capture' : 'legal');
      sq.onclick = () => onChessClick(name, piece, color, isMyTurn);
    }
  }
}

function onChessClick(name, piece, color, isMyTurn) {
  if (!isMyTurn || S.chess.over) return;
  // if clicked a legal target -> move
  const mv = S.legalMoves.find((x) => x.to === name);
  if (mv && S.selected) {
    const from = S.selected;
    const doSend = (promo) => {
      send('chess_move', { from, to: name, promotion: promo });
      S.selected = null; S.legalMoves = [];
    };
    if (mv.promo) {
      showModal('Promosi pion jadi…', '<div class="promo-pick">' +
        ['q', 'r', 'b', 'n'].map((p) =>
          `<button data-p="${p}">${PIECES[color + p]}</button>`).join('') + '</div>',
        []);
      document.querySelectorAll('.promo-pick button').forEach((b) => {
        b.onclick = () => { hideModal(); doSend(b.dataset.p); };
      });
    } else doSend(undefined);
    return;
  }
  // select own piece
  if (piece && piece[0] === color) {
    S.selected = name;
    send('chess_moves_for', { square: name });
  } else {
    S.selected = null; S.legalMoves = [];
    renderChess({ players: S.players, you: S.playerId, state: S.chess });
  }
}

function onChessLegal(m) {
  S.legalMoves = m.moves;
  renderChess({ players: S.players, you: S.playerId, state: S.chess });
}

// ---------- uno ----------
const UNO_COLORS = { red: 'Merah 🔴', yellow: 'Kuning 🟡', green: 'Hijau 🟢', blue: 'Biru 🔵' };

function cardLabel(c) {
  if (c.kind === 'number') return String(c.value);
  return UNO_LABEL[c.kind] || '?';
}
function cardClass(c) {
  if (c.kind === 'wild' || c.kind === 'wild4') return 'wild';
  return c.color || '';
}

function renderUno(m) {
  const st = m.state;
  const me = m.players.find((p) => p.id === m.you);
  const mySeat = me ? me.seat : 0;
  const isMyTurn = st.turn === mySeat && !st.over;

  // opponents
  const box = $('uno-opponents');
  box.innerHTML = '';
  m.players.forEach((p, i) => {
    if (p.id === m.you) return;
    const count = typeof st.hands[i] === 'number' ? st.hands[i] : '?';
    const d = document.createElement('span');
    d.className = 'opp' + (st.turn === i ? ' turn' : '');
    d.textContent = `${p.connected === false ? '💤 ' : ''}${p.nickname} 🃏${count}`;
    box.appendChild(d);
  });

  let status = '';
  if (st.over) status = 'Ronde selesai!';
  else if (st.pendingDraw > 0 && isMyTurn) status = `Kamu kena +${st.pendingDraw}! Ambil kartunya 🃏`;
  else if (isMyTurn) status = st.drewThisTurn ? 'Kartu diambil — mainkan atau lewati' : 'Giliranmu! 🎯';
  else status = `Menunggu ${m.players[st.turn] ? m.players[st.turn].nickname : ''}…`;
  $('uno-status').textContent = status;

  // table
  const disc = $('uno-discard');
  disc.className = 'uno-card ' + cardClass(st.top);
  disc.innerHTML = `<span>${cardLabel(st.top)}</span><small>${UNO_COLORS[st.currentColor] || ''}</small>`;
  $('deck-count').textContent = st.deckCount + ' kartu';
  $('uno-color-badge').style.background = colorHex(st.currentColor);

  // hand
  const hand = $('uno-hand');
  hand.innerHTML = '';
  const myHand = st.hands[mySeat] || [];
  $('hand-count').textContent = myHand.length;
  myHand.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'uno-card ' + cardClass(c) + (st.playable && st.playable[i] ? ' playable' : '');
    el.innerHTML = `<span>${cardLabel(c)}</span>`;
    el.onclick = () => onUnoCardClick(c);
    hand.appendChild(el);
  });

  // uno button auto-arm at 2 cards
  if (myHand.length === 2) S.saidUnoArmed = true;
  $('btn-uno-say').classList.toggle('armed', S.saidUnoArmed);
  $('btn-uno-pass').classList.toggle('hidden', !(isMyTurn && st.drewThisTurn));
}

function colorHex(c) {
  return { red: '#e05c5c', yellow: '#f2c14e', green: '#3fae6a', blue: '#5b8def' }[c] || '#999';
}

function onUnoCardClick(card) {
  const doPlay = (wildColor) => {
    send('uno_play', { cardId: card.id, saidUno: S.saidUnoArmed, wildColor });
    S.saidUnoArmed = false;
  };
  if (card.kind === 'wild' || card.kind === 'wild4') {
    showModal('Pilih warna…', '<div class="color-pick">' +
      ['red', 'yellow', 'green', 'blue'].map((c) =>
        `<button data-c="${c}" style="background:${colorHex(c)}" title="${c}"></button>`).join('') +
      '</div>', [{ label: 'Batal', cls: 'ghost' }]);
    document.querySelectorAll('.color-pick button').forEach((b) => {
      b.onclick = () => { hideModal(); doPlay(b.dataset.c); };
    });
  } else doPlay(undefined);
}

// ---------- game over ----------
const REASONS_ID = {
  checkmate: 'Skakmat!', stalemate: 'Remis — stalemate', fifty: 'Remis — aturan 50 langkah',
  repetition: 'Remis — repetisi 3x', timeout: 'Waktu habis ⏱️', resign: 'Menyerah 🏳️',
  forfeit: 'Lawan keluar dari permainan', habis: 'Kartu habis! 🎉', semua_keluar: 'Semua lawan keluar',
};

function onGameOver(m) {
  S.deadline = null;
  const reason = REASONS_ID[m.result.reason] || m.reasonText || m.result.reason;
  let body = `<p style="font-size:18px">${reason}</p>`;
  if (m.winnerNickname) body += `<p>🏆 Pemenang: <strong>${m.winnerNickname}</strong></p>`;
  else body += '<p>🤝 Seri!</p>';
  if (m.points) body += `<p>+${m.points} poin!</p>`;
  if (m.note) body += `<p class="muted">${m.note}</p>`;
  if (m.scores && m.scores.length) {
    body += '<table class="score-table">' + m.scores
      .map((s) => `<tr><td>${s.nickname}</td><td><strong>${s.points}</strong></td></tr>`).join('') + '</table>';
  }
  const actions = [];
  if (m.game === 'uno') {
    actions.push({ label: '🔄 Main Lagi', cls: 'primary', onClick: () => send('uno_new_round') });
  }
  actions.push({ label: '🚪 Keluar Room', cls: 'ghost', onClick: () => send('leave_room') });
  showModal('Permainan Selesai', body, actions);
}

// ---------- chat ----------
function wireChat(inputId, btnId, boxId) {
  const sendChat = () => {
    const inp = $(inputId);
    if (!inp.value.trim()) return;
    send('chat', { text: inp.value });
    inp.value = '';
  };
  $(btnId).onclick = sendChat;
  $(inputId).onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
}
function addChat(from, text) {
  for (const id of ['chat-box', 'chat-box-chess', 'chat-box-uno']) {
    const box = $(id);
    if (!box) continue;
    const div = document.createElement('div');
    if (from === 'Sistem') { div.className = 'sys'; div.textContent = text; }
    else { div.innerHTML = `<strong>${from}:</strong> `; div.appendChild(document.createTextNode(text)); }
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }
}

// ---------- timer ----------
setInterval(() => {
  for (const id of ['chess-timer', 'uno-timer']) {
    const el = $(id);
    if (!el) continue;
    if (!S.deadline) { el.textContent = '⏱️ --'; el.classList.remove('low'); continue; }
    const left = Math.max(0, Math.ceil((S.deadline - Date.now()) / 1000));
    el.textContent = '⏱️ ' + left;
    el.classList.toggle('low', left <= 15 && left > 0);
  }
}, 500);

// ---------- wire up ----------
document.addEventListener('DOMContentLoaded', () => {
  for (const b of document.querySelectorAll('.game-card')) {
    b.onclick = () => {
      document.querySelectorAll('.game-card').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      S.game = b.dataset.game;
    };
  }
  $('btn-create').onclick = () => {
    if (!ensureHello()) return;
    send('create_room', { game: S.game });
  };
  $('btn-join').onclick = () => {
    if (!ensureHello()) return;
    const code = $('room-code').value.trim().toUpperCase();
    $('join-error').textContent = '';
    send('join_room', { code });
  };
  $('btn-refresh').onclick = refreshRooms;
  $('btn-copy').onclick = () => {
    navigator.clipboard && navigator.clipboard.writeText($('lobby-code').textContent);
    toast('Kode disalin! 📋');
  };
  $('btn-start').onclick = () => send('start_game');
  $('btn-leave-lobby').onclick = () => { if (confirm('Keluar dari room?')) send('leave_room'); };
  $('btn-leave-chess').onclick = () => { if (confirm('Keluar? Kamu dianggap menyerah.')) send('leave_room'); };
  $('btn-leave-uno').onclick = () => { if (confirm('Keluar dari room?')) send('leave_room'); };
  $('btn-resign').onclick = () => { if (confirm('Menyerah?')) send('chess_resign'); };
  $('uno-deck').onclick = () => send('uno_draw');
  $('btn-uno-pass').onclick = () => send('uno_pass');
  $('btn-uno-say').onclick = () => {
    S.saidUnoArmed = !S.saidUnoArmed;
    $('btn-uno-say').classList.toggle('armed', S.saidUnoArmed);
    toast(S.saidUnoArmed ? '📢 UNO disiapkan!' : 'UNO dibatalkan');
  };
  wireChat('chat-input', 'btn-chat', 'chat-box');
  wireChat('chat-input-chess', 'btn-chat-chess', 'chat-box-chess');
  wireChat('chat-input-uno', 'btn-chat-uno', 'chat-box-uno');
  connect();
});
