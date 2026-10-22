'use strict';
/* Chess + UNO Arena — client. NO game rules here; only rendering + sending intents. */

const S = {
  ws: null, playerId: null, nickname: '', game: 'chess',
  roomCode: null, players: [], hostId: null,
  chess: null, uno: null, unoMeta: {}, truth: null,
  selected: null, legalMoves: [],
  saidUnoArmed: false, deadline: null, helloSent: false,
  welcomed: false, queue: [], // Misi 4B: outbound queue gated on 'welcome'
  authMode: false, // login PARKED (Sensei, 2026-10-21): nickname-only, local progress
  fbUser: null, profileNickname: null,
};

const PIECES = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};
const UNO_LABEL = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4', reverseBlack: '⇄', nullWhite: '✕' };

const $ = (id) => document.getElementById(id);

// ---------- utils ----------
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), ms || 2600);
}
// The MABAR.io shell (header + tab bar) frames the three tab screens;
// game-flow screens (menu, lobby, arenas) run chrome-less and full-bleed.
const TAB_SCREENS = { 'screen-landing': 'home', 'screen-profile': 'profile', 'screen-settings': 'settings' };
const TAB_TITLES = { home: 'Beranda', profile: 'Profile', settings: 'Settings' };

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
  $(id).classList.remove('hidden');
  window.scrollTo(0, 0);
  const tab = TAB_SCREENS[id];
  document.body.classList.toggle('on-tabs', !!tab);
  if (tab) {
    document.querySelectorAll('#tabbar .tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === tab));
    $('hdr-title').textContent = TAB_TITLES[tab];
    if (id === 'screen-profile') renderProfile();
    if (id === 'screen-settings') syncSettings();
  }
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
// Server switch: Fly.io is the PRIMARY server since 2026-10-22 (Sensei's
// call, after Railway's outage + env-var security incident). The default
// endpoint from firebase-config.js already points at Fly; ?server=railway
// explicitly picks the Railway standby instead.
function serverEndpoint(proto) {
  const pick = new URLSearchParams(location.search).get('server');
  if (pick === 'railway') return 'wss://chess-uno-arena-production.up.railway.app';
  if (pick === 'fly') return 'wss://ayo-nge.fly.dev';
  return window.CUA_WS_ENDPOINT || (proto + '://' + location.host);
}
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(serverEndpoint(proto));
  S.ws = ws;
  ws.onopen = async () => {
    // A fresh socket knows nobody yet: hello must be re-sent unless we
    // rejoin an existing room session (helloSent from a dead socket lies).
    S.helloSent = false; S.welcomed = false;
    const sess = loadSession();
    if (sess && sess.playerId && sess.code) {
      send('rejoin', { playerId: sess.playerId, code: sess.code });
    } else {
      if (sess && sess.nickname) S.nickname = sess.nickname;
      const nick = currentNick();
      if (nick) {
        send('hello', { nickname: nick });
        S.helloSent = true;
        S.nickname = nick;
      }
    }
  };
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    route(m);
  };
  ws.onclose = () => {
    S.welcomed = false; // queued messages wait for the next socket's welcome
    toast('Koneksi putus — mencoba ulang…');
    setTimeout(connect, 2500);
  };
}
function send(type, data) {
  // Misi 4B: identity first. Until this socket is welcomed, game messages
  // wait in a queue — no action can ever outrun the hello/rejoin, so the
  // server can never reject one with 'Kirim hello dulu ya'.
  if (type !== 'hello' && type !== 'rejoin' && !S.welcomed) {
    S.queue.push({ type, data: data || {} });
    return;
  }
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ type, data: data || {} }));
}
function flushQueue() {
  const pending = S.queue;
  S.queue = [];
  for (const m of pending) send(m.type, m.data);
}
// Misi 4B: localStorage, not sessionStorage — the session must survive a
// closed tab or a killed browser so reopening the app rejoins the game.
// A session whose room is gone self-heals via the 'error' route below.
function saveSession() {
  localStorage.setItem('cua', JSON.stringify({
    playerId: S.playerId, code: S.roomCode, nickname: S.nickname,
  }));
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem('cua')); } catch { return null; }
}
function clearSession() { localStorage.removeItem('cua'); }

// The nickname lives in localStorage (cua-nick) + S.nickname; the gate
// modal collects it once, Settings can change it later.
function currentNick() {
  if (S.nickname) return S.nickname;
  try { return (localStorage.getItem(NICK_KEY) || '').trim(); } catch { return ''; }
}
function ensureHello() {
  const nick = currentNick();
  if (!nick) { openNickModal(); return false; }
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
      S.playerId = m.playerId; S.nickname = m.nickname; saveSession(); saveLocalNick();
      S.welcomed = true; flushQueue();
      if (m.rejoined) toast('Kembali tersambung! 🎉');
      break;
    case 'pong': onPong(); break;
    case 'room_list': renderRoomList(m.rooms); break;
    case 'lobby_update': onLobby(m); break;
    case 'game_state': onGameState(m); break;
    case 'uno_events': handleUnoEvents(m.events); break;
    case 'truth_event': handleTruthEvents(m.events); break;
    case 'chess_legal': onChessLegal(m); break;
    case 'game_over': onGameOver(m); break;
    case 'chat': addChat(m.from, m.text); break;
    case 'left_room':
      hideModal();
      S.roomCode = null; clearSession();
      // Misi 4A: never trust that the server still knows us after a leave —
      // drop queued room intents and re-hello at once, so the next
      // create/join can never be rejected with 'Kirim hello dulu ya'.
      S.queue = [];
      S.helloSent = false;
      ensureHello();
      openGameMenu();
      break;
    case 'error':
      if (/Sesi tidak ditemukan/.test(m.message)) {
        // Misi 4A: the saved session is genuinely dead (room gone, server
        // restarted). Drop it, drop its queued intents, and take a fresh
        // identity — never retry a corpse on every refresh.
        clearSession();
        S.queue = [];
        S.helloSent = false;
        ensureHelloQuiet();
      }
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
  const nick = currentNick() || 'Tamu';
  if (!S.helloSent) { send('hello', { nickname: nick }); S.helloSent = true; S.nickname = nick; }
  return true;
}
// ---------- two-level menu: game menu + nickname gate + settings ----------
function enterGame(game) {
  S.game = game;
  if (!currentNick()) { openNickModal(); return; }
  openGameMenu();
}
const GAME_MENU = {
  chess: ['♟️ Catur', '2 pemain · klasik, timer per giliran'],
  uno: ['🃏 UNO', '2–8 pemain · tumpuk +2/+4, jangan lupa teriak UNO!'],
  truth: ['🎡 Truth or Truth', '2–8 pemain · roda acak, jawab jujur, kumpulkan reaksi!'],
};

function openGameMenu() {
  const [title, sub] = GAME_MENU[S.game] || GAME_MENU.chess;
  $('gm-title').textContent = title;
  $('gm-sub').textContent = sub;
  $('bot-card').classList.toggle('hidden', S.game !== 'uno');
  $('ai-card').classList.toggle('hidden', S.game !== 'chess');
  $('gm-beta').classList.toggle('hidden', S.game !== 'truth');
  // Sensei's playtest door (2026-10-22): a quiet "( test bot )" entry in
  // the Truth menu footer — solo Truth against simulated bot answers.
  $('truth-testbot-row').classList.toggle('hidden', S.game !== 'truth');
  showScreen('screen-gamemenu');
  refreshRooms();
}

function openTestBot() {
  showModal('🤖 Test Bot — Truth or Truth',
    '<p class="muted">Main Truth sendirian: kursi lain diisi bot yang menjawab dengan simulasi, supaya Sensei bisa uji coba alur gamenya.</p>' +
    '<label for="testbot-size">Total pemain (termasuk kamu)</label>' +
    '<select id="testbot-size"><option value="2">2 pemain</option>' +
    '<option value="4" selected>4 pemain</option><option value="6">6 pemain</option>' +
    '<option value="8">8 pemain</option></select>',
    [
      {
        label: '▶️ Mulai', cls: 'primary',
        onClick: () => {
          if (ensureHello()) {
            send('create_truth_bot_room', { size: parseInt($('testbot-size').value, 10) });
          }
        },
      },
      { label: 'Batal', cls: 'ghost' },
    ]);
}
function openNickModal() {
  $('nick-input').value = currentNick();
  $('nick-modal-error').textContent = '';
  $('nick-modal').classList.remove('hidden');
  setTimeout(() => $('nick-input').focus(), 60);
}
function closeNickModal() { $('nick-modal').classList.add('hidden'); }
function saveNickFromModal() {
  const v = $('nick-input').value.trim();
  if (!v) { $('nick-modal-error').textContent = 'Isi nickname dulu ya'; return; }
  if (v.length > 16) { $('nick-modal-error').textContent = 'Maksimal 16 karakter'; return; }
  S.nickname = v;
  saveLocalNick();
  closeNickModal();
  openGameMenu();
}
// Single sound switch: the Settings tab toggle and the in-game button
// both call this; the nickname now lives in the Profile tab.
function setSound(on) {
  soundOn = on;
  try { localStorage.setItem('cua-sound', on ? 'on' : 'off'); } catch { /* private mode */ }
  if (!on && 'speechSynthesis' in window) speechSynthesis.cancel();
  const b = $('btn-sound'); if (b) b.textContent = on ? '🔊' : '🔇';
  const t = $('set-sound'); if (t) t.checked = on;
}
const GAME_LABEL = { chess: '♟️ Catur', uno: '🃏 UNO', truth: '🎡 Truth' };
const GAME_NAME = { chess: 'catur', uno: 'UNO', truth: 'Truth or Truth' };

function renderRoomList(rooms) {
  const box = $('room-list');
  box.innerHTML = '';
  const mine = rooms.filter((r) => r.game === S.game);
  if (!mine.length) {
    box.innerHTML = `<p class="muted">Belum ada room ${GAME_NAME[S.game] || ''} yang menunggu. Buat satu yuk!</p>`;
    return;
  }
  for (const r of mine) {
    const div = document.createElement('div');
    div.className = 'room-item';
    const label = GAME_LABEL[r.game] || r.game;
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
  // UNO only: host's mode picker for the upcoming game (Misi 5)
  $('lobby-extreme-row').classList.toggle('hidden', m.game !== 'uno');
  if (m.game === 'uno') {
    $('lobby-mode').disabled = !isHost;
    $('lobby-extreme-note').classList.toggle('hidden', isHost);
  }
  // Truth only: the host's Set Aturan panel (Sensei's spec, 2026-10-22)
  $('truth-rules-row').classList.toggle('hidden', m.game !== 'truth');
  if (m.game === 'truth' && m.truthSettings) {
    $('truth-total').value = m.truthSettings.totalQuestions == null
      ? '' : String(m.truthSettings.totalQuestions);
    $('truth-explicit').checked = !!m.truthSettings.explicitMode;
    $('truth-total').disabled = !isHost;
    $('truth-explicit').disabled = !isHost;
    $('truth-rules-note').classList.toggle('hidden', isHost);
  }
}

// ---------- chess ----------
function onGameState(m) {
  S.roomCode = m.code; S.players = m.players; S.hostId = m.hostId;
  S.deadline = m.deadline; saveSession();
  if (m.game === 'chess') {
    S.chess = m.state; S.game = 'chess';
    showScreen('screen-chess');
    renderChess(m);
  } else if (m.game === 'truth') {
    S.truth = m.state; S.game = 'truth';
    showScreen('screen-truth');
    renderTruth(m);
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
  else if (opp && opp.isBot) { badge.textContent = opp.nickname + ' is thinking'; badge.className = 'turn-badge thinking'; }
  else { badge.textContent = 'Giliran lawan'; badge.className = 'turn-badge'; }

  $('chess-status').textContent = st.inCheck && !st.over
    ? (isMyTurn ? 'Rajamu sedang diskak!' : 'Raja lawan diskak!') : '';

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
  if (c.kind === 'reverseBlack') return 'blackrev';
  if (c.kind === 'nullWhite') return 'nullwhite';
  return c.color || '';
}

// Classic card face (Sensei's reference, 2026-10-21): white tilted oval in
// the middle with the big value, small values in the top-left and the
// bottom-right (flipped) corners; wilds carry the 4-color motif instead.
function cardHTML(c) {
  const label = cardLabel(c);
  if (c.kind === 'wild' || c.kind === 'wild4') {
    const corner = c.kind === 'wild4' ? '+4' : '<span class="mini-motif"></span>';
    return `<i class="cnr tl">${corner}</i>`
      + '<span class="oval"><span class="motif"></span></span>'
      + `<i class="cnr br">${corner}</i>`;
  }
  return `<i class="cnr tl">${label}</i>`
    + `<span class="oval"><span class="val">${label}</span></span>`
    + `<i class="cnr br">${label}</i>`;
}

function renderUno(m) {
  const st = m.state;
  const me = m.players.find((p) => p.id === m.you);
  const mySeat = me ? me.seat : 0;
  const isMyTurn = st.turn === mySeat && !st.over;

  // seat ring: every player in seat order, you at the bottom
  renderUnoRing(m, mySeat);

  let status = '';
  if (st.over) status = 'Ronde selesai!';
  else if (st.pendingDraw > 0 && isMyTurn) status = `Kamu kena +${st.pendingDraw}! Ambil kartunya`;
  else if (isMyTurn) status = st.drewThisTurn ? 'Kartu diambil — mainkan atau lewati' : 'Giliranmu!';
  else status = `Menunggu ${m.players[st.turn] ? m.players[st.turn].nickname : ''}…`;
  $('uno-status').textContent = status;
  // red pill only while YOU face a pending +N penalty (Sensei, 2026-10-22)
  $('uno-status').classList.toggle('penalty', !st.over && st.pendingDraw > 0 && isMyTurn);

  // table
  const disc = $('uno-discard');
  disc.className = 'uno-card ' + cardClass(st.top);
  disc.innerHTML = cardHTML(st.top);
  $('deck-count').textContent = st.deckCount + ' kartu';
  $('uno-color-badge').style.background = colorHex(st.currentColor);
  const dirEl = $('uno-dir');
  dirEl.classList.toggle('ccw', st.dir === -1);
  dirEl.title = st.dir === -1 ? 'Arah: berlawanan jarum jam' : 'Arah: searah jarum jam';
  const modeBadge = $('uno-mode-badge');
  modeBadge.classList.toggle('hidden', !st.mode || st.mode === 'normal');
  modeBadge.textContent = st.mode === 'hell' ? '🔥 HELL' : 'HARD';

  // hand
  const hand = $('uno-hand');
  hand.innerHTML = '';
  const myHand = st.hands[mySeat] || [];
  $('hand-count').textContent = myHand.length;
  myHand.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'uno-card ' + cardClass(c) + (st.playable && st.playable[i] ? ' playable' : '');
    el.innerHTML = cardHTML(c);
    el.onclick = () => onUnoCardClick(c);
    hand.appendChild(el);
  });

  // uno button auto-arm at 2 cards
  if (myHand.length === 2) S.saidUnoArmed = true;
  $('btn-uno-say').classList.toggle('armed', S.saidUnoArmed);
  $('btn-uno-pass').classList.toggle('hidden', !(isMyTurn && st.drewThisTurn));
}

function colorHex(c) {
  return { red: '#d92323', yellow: '#e69c00', green: '#159947', blue: '#2266b8' }[c] || '#999';
}

function onUnoCardClick(card) {
  const doPlay = (wildColor) => {
    send('uno_play', { cardId: card.id, saidUno: S.saidUnoArmed, wildColor });
    S.saidUnoArmed = false;
  };
  if (card.kind === 'wild' || card.kind === 'wild4' || card.kind === 'nullWhite') {
    showModal('Pilih warna…', '<div class="color-pick">' +
      ['red', 'yellow', 'green', 'blue'].map((c) =>
        `<button data-c="${c}" style="background:${colorHex(c)}" title="${c}"></button>`).join('') +
      '</div>', [{ label: 'Batal', cls: 'ghost' }]);
    document.querySelectorAll('.color-pick button').forEach((b) => {
      b.onclick = () => { hideModal(); doPlay(b.dataset.c); };
    });
  } else doPlay(undefined);
}

// Seat ring around the table. Seats ascend clockwise; your seat sits at the
// bottom, so the moving turn highlight reads as the actual play order.
function renderUnoRing(m, mySeat) {
  const st = m.state;
  const ring = $('uno-ring');
  ring.innerHTML = '';
  const n = m.players.length;
  for (let k = 0; k < n; k++) {
    const seat = (mySeat + k) % n;
    const p = m.players[seat];
    const ang = (90 + (k * 360) / n) * Math.PI / 180;
    const chip = document.createElement('div');
    chip.className = 'seat-chip'
      + (seat === mySeat ? ' me' : '')
      + (st.turn === seat && !st.over ? ' turn' : '')
      + (p.connected === false ? ' offline' : '');
    chip.dataset.seat = seat;
    chip.style.left = (50 + 40 * Math.cos(ang)).toFixed(1) + '%';
    chip.style.top = (50 + 42 * Math.sin(ang)).toFixed(1) + '%';
    const raw = st.hands[seat];
    const count = typeof raw === 'number' ? raw : (Array.isArray(raw) ? raw.length : '?');
    const nick = document.createElement('span');
    nick.className = 'nick';
    nick.textContent = (p.connected === false ? '💤 ' : '') + p.nickname + (p.isBot ? ' 🤖' : '');
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = `🃏 ${count}`;
    chip.appendChild(nick);
    chip.appendChild(cnt);
    if (count === 1 && !st.over) {
      const b = document.createElement('span');
      b.className = 'uno-badge';
      b.textContent = 'UNO!';
      chip.appendChild(b);
    }
    ring.appendChild(chip);
  }
}

// ---------- uno fx: synthesized sound + card flights from server events ----------
let audioCtx = null;
let soundOn = true;
try { soundOn = localStorage.getItem('cua-sound') !== 'off'; } catch { /* keep default */ }

function ac() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, dur, type, vol, delay, slideTo) {
  const ctx = ac(); if (!ctx) return;
  const t0 = ctx.currentTime + (delay || 0);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noiseSweep(dur, from, to) {
  const ctx = ac(); if (!ctx) return;
  const len = Math.max(1, (ctx.sampleRate * dur) | 0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1;
  const t0 = ctx.currentTime;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t0); src.stop(t0 + dur);
}

function speakUno() {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance('Uno!');
    u.rate = 1.05; u.pitch = 1.25; u.volume = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* speech is a bonus; the tones still play */ }
}

function sfx(name) {
  if (!soundOn) return;
  try {
    if (name === 'play') noiseSweep(0.18, 1900, 320);
    else if (name === 'draw') noiseSweep(0.1, 480, 1250);
    else if (name === 'penalty') { tone(210, 0.15, 'square', 0.07); tone(150, 0.24, 'square', 0.07, 0.12); }
    else if (name === 'stack') { tone(520, 0.09, 'square', 0.08); tone(784, 0.13, 'square', 0.08, 0.09); }
    else if (name === 'uno') { speakUno(); tone(880, 0.1, 'triangle', 0.1); tone(1318, 0.16, 'triangle', 0.1, 0.09); }
    else if (name === 'win') [523, 659, 784, 1047].forEach((fr, i) => tone(fr, 0.17, 'triangle', 0.11, i * 0.11));
  } catch { /* audio must never break the game */ }
}

const reducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

function seatAnchor(seat) {
  const me = (S.players || []).find((p) => p.id === S.playerId);
  if (me && me.seat === seat) return $('uno-hand');
  return document.querySelector(`.seat-chip[data-seat="${seat}"]`);
}

// Animate a ghost card flying between two elements (Web Animations API).
function flyCard(fromEl, toEl, card, back) {
  if (reducedMotion || document.body.classList.contains('low-gfx') || !fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'uno-card fly ' + (back ? 'deck' : cardClass(card || {}));
  ghost.innerHTML = back ? '<span class="oval"><span class="val">🎴</span></span>' : (card ? cardHTML(card) : '?');
  ghost.style.left = (a.left + a.width / 2 - 24) + 'px';
  ghost.style.top = (a.top + a.height / 2 - 34) + 'px';
  document.body.appendChild(ghost);
  const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
  const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
  const anim = ghost.animate([
    { transform: 'translate(0, 0) rotate(0deg) scale(.65)', opacity: 0.95 },
    { transform: `translate(${dx}px, ${dy}px) rotate(${(Math.random() * 18 - 9).toFixed(0)}deg) scale(1)`, opacity: 1 },
  ], { duration: 380, easing: 'cubic-bezier(.2,.7,.3,1)' });
  anim.onfinish = () => ghost.remove();
}

function unoFlash(text) {
  const f = $('uno-flash');
  if (!f) return;
  f.textContent = text;
  f.classList.remove('hidden', 'pop');
  void f.offsetWidth; // restart the CSS animation
  f.classList.add('pop');
  clearTimeout(f._t);
  f._t = setTimeout(() => f.classList.add('hidden'), 1200);
}

// Server events (play/draw/drawPenalty/stack/uno) drive all FX, so every
// client sees and hears the same action at the same moment.
function handleUnoEvents(events) {
  if (!events || !events.length || S.game !== 'uno') return;
  for (const ev of events) {
    const anchor = seatAnchor(ev.player);
    if (ev.type === 'play') {
      flyCard(anchor, $('uno-discard'), S.uno ? S.uno.top : null, false);
      sfx('play');
    } else if (ev.type === 'draw') {
      flyCard($('uno-deck'), anchor, null, true);
      sfx('draw');
    } else if (ev.type === 'drawPenalty') {
      const times = Math.min(ev.n || 1, 6);
      for (let i = 0; i < times; i++) {
        setTimeout(() => flyCard($('uno-deck'), anchor, null, true), i * 95);
      }
      sfx('penalty');
      unoFlash(`+${ev.n}`);
    } else if (ev.type === 'stack') {
      sfx('stack');
      unoFlash(`STACK +${ev.total}!`);
    } else if (ev.type === 'bounce') {
      sfx('stack');
      unoFlash('↩ PANTUL!');
    } else if (ev.type === 'nullify') {
      sfx('penalty');
      unoFlash('✕ NULL! Semua +2');
      for (const p of ev.affected || []) {
        const target = seatAnchor(p);
        for (let i = 0; i < 2; i++) {
          setTimeout(() => flyCard($('uno-deck'), target, null, true), i * 95);
        }
      }
    } else if (ev.type === 'uno') {
      sfx('uno');
    }
  }
}

// ---------- game over ----------
const REASONS_ID = {
  checkmate: 'Skakmat!', stalemate: 'Remis — stalemate', fifty: 'Remis — aturan 50 langkah',
  repetition: 'Remis — repetisi 3x', timeout: 'Waktu habis ⏱️', resign: 'Menyerah 🏳️',
  forfeit: 'Lawan keluar dari permainan', habis: 'Kartu habis! 🎉', semua_keluar: 'Semua lawan keluar',
};

function onGameOver(m) {
  if (m.game === 'truth') { onTruthGameOver(m); return; }
  S.deadline = null;
  recordStats(m);
  if (m.game === 'uno') { handleUnoEvents(m.events); sfx('win'); }
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
  if (m.game === 'chess' && S.players.some((p) => p.isBot)) {
    actions.push({ label: '🔄 Main Lagi', cls: 'primary', onClick: () => send('chess_new_round') });
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
  for (const id of ['chat-box', 'chat-box-chess', 'chat-box-uno', 'chat-box-truth']) {
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
  for (const id of ['chess-timer', 'uno-timer', 'truth-timer']) {
    const el = $(id);
    if (!el) continue;
    if (!S.deadline) { el.textContent = '⏱️ --'; el.classList.remove('low'); continue; }
    const left = Math.max(0, Math.ceil((S.deadline - Date.now()) / 1000));
    el.textContent = '⏱️ ' + left;
    el.classList.toggle('low', left <= 15 && left > 0);
  }
}, 500);

// ---------- local progress (login parked, Sensei 2026-10-21) ----------
// No accounts: the nickname is collected once by the gate modal (or via
// Settings) and the player's
// progress (games played / won / points) lives in this device's
// localStorage only. The Firebase login code was removed on Sensei's
// order; the server-side verifier stays parked behind REQUIRE_AUTH.
const STATS_KEY = 'cua-stats';
const NICK_KEY = 'cua-nick';

function loadLocalStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY));
    if (s && typeof s.played === 'number') return s;
  } catch { /* corrupted storage falls through to a fresh record */ }
  return { played: 0, won: 0, points: 0 };
}

function renderLocalStats() {
  const el = $('local-stats');
  if (!el) return;
  const s = loadLocalStats();
  el.textContent = s.played
    ? `🏆 Progres lokal: ${s.played} main · ${s.won} menang · ${s.points} poin`
    : '🏆 Progresmu tersimpan lokal di perangkat ini';
}

// Record one finished game into the local stats (best-effort only).
function recordStats(m) {
  const s = loadLocalStats();
  const won = !!m.winnerNickname && m.winnerNickname === S.nickname;
  s.played += 1;
  if (won) { s.won += 1; s.points += m.points || 0; }
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  renderLocalStats();
}

function saveLocalNick() {
  try { localStorage.setItem(NICK_KEY, S.nickname || ''); } catch { /* ignore */ }
}
function prefillLocalNick() {
  try {
    const nick = localStorage.getItem(NICK_KEY);
    if (nick) S.nickname = nick;
  } catch { /* ignore */ }
}

// ---------- settings tab: ping + graphics ----------
let pingWaiter = null;
function onPong() {
  if (pingWaiter) { const f = pingWaiter; pingWaiter = null; f(performance.now()); }
}

// Three samples over the live game socket; the average is what a player
// would actually feel in a match.
async function runPing() {
  const out = $('ping-result');
  if (!S.ws || S.ws.readyState !== 1) {
    out.textContent = 'Belum terhubung ke server — tunggu sebentar, lalu coba lagi.';
    return;
  }
  ensureHelloQuiet();
  out.textContent = 'Mengukur…';
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const done = new Promise((res) => {
      pingWaiter = res;
      setTimeout(() => { if (pingWaiter) { pingWaiter = null; res(null); } }, 3000);
    });
    send('ping');
    const t1 = await done;
    if (t1 === null) { out.textContent = 'Ping gagal — server tidak membalas. Coba lagi ya.'; return; }
    samples.push(Math.round(t1 - t0));
    await new Promise((r) => setTimeout(r, 250));
  }
  const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  const quality = avg < 80 ? 'Sangat lancar 🚀' : avg < 150 ? 'Lancar ✅'
    : avg < 300 ? 'Cukup 👍' : 'Berat 🐌 — cek koneksimu';
  out.textContent = `🏓 ${avg} ms (sampel: ${samples.join(' · ')} ms) — ${quality}`;
}

const GFX_KEY = 'cua-gfx';
function gfxMode() {
  try { return localStorage.getItem(GFX_KEY) === 'low' ? 'low' : 'high'; } catch { return 'high'; }
}
// "Graphic" for this web arena = visual effects & animation quality.
// Low freezes CSS animation/shadows and card flights — kind to old phones.
function applyGfx() {
  const low = gfxMode() === 'low';
  document.body.classList.toggle('low-gfx', low);
  document.querySelectorAll('#set-gfx .seg-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.gfx === (low ? 'low' : 'high')));
}
function setGfx(mode) {
  try { localStorage.setItem(GFX_KEY, mode); } catch { /* private mode */ }
  applyGfx();
}
function syncSettings() {
  const t = $('set-sound'); if (t) t.checked = soundOn;
  applyGfx();
  try {
    $('server-info').textContent = 'Server: ' + new URL(serverEndpoint('wss')).host;
  } catch { /* endpoint label is decorative */ }
}

// ---------- profile tab ----------
// Preset avatars (Sensei's call, 2026-10-22): built-in picks keep the
// profile light — no uploads, nothing extra stored on any server.
const AVATARS = [
  ['🦊', 'linear-gradient(135deg,#ffd29d,#ff8f6b)'],
  ['🐱', 'linear-gradient(135deg,#fbc2eb,#a6c1ee)'],
  ['🐼', 'linear-gradient(135deg,#e0eafc,#cfdef3)'],
  ['🦁', 'linear-gradient(135deg,#f6d365,#fda085)'],
  ['🐸', 'linear-gradient(135deg,#c1dfc4,#9fd3a8)'],
  ['🐯', 'linear-gradient(135deg,#fddb92,#f6a35c)'],
  ['🐰', 'linear-gradient(135deg,#fbc2eb,#fdcbf1)'],
  ['🦉', 'linear-gradient(135deg,#a18cd1,#fbc2eb)'],
];
const AVATAR_KEY = 'cua-avatar';
const BIO_KEY = 'cua-bio';

function avatarIdx() {
  let n = 0;
  try { n = parseInt(localStorage.getItem(AVATAR_KEY) || '0', 10); } catch { /* default */ }
  return AVATARS[n] ? n : 0;
}
// Level grows from XP: points carry most weight, wins and games add up.
function levelOf(s) {
  const xp = s.points + s.won * 20 + s.played * 5;
  const level = 1 + Math.floor(Math.sqrt(xp / 60));
  const cur = 60 * (level - 1) * (level - 1);
  const next = 60 * level * level;
  return { xp, level, pct: Math.min(100, Math.round(((xp - cur) / (next - cur)) * 100)) };
}
function renderProfile() {
  const s = loadLocalStats();
  const [emoji, grad] = AVATARS[avatarIdx()];
  const av = $('profile-avatar');
  av.textContent = emoji; av.style.background = grad;
  $('profile-name').textContent = currentNick() || 'Tamu';
  const lv = levelOf(s);
  $('profile-level').textContent = lv.level;
  $('profile-score').textContent = s.points;
  $('xp-bar').style.width = lv.pct + '%';
  $('profile-substats').textContent =
    `${s.played} main · ${s.won} menang · ${lv.xp} XP menuju level ${lv.level + 1}`;
  $('profile-nick-input').value = currentNick();
  const bio = $('profile-bio');
  if (document.activeElement !== bio) {
    try { bio.value = localStorage.getItem(BIO_KEY) || ''; } catch { bio.value = ''; }
  }
}
function renderAvatarPicker() {
  const box = $('avatar-picker');
  box.innerHTML = '';
  AVATARS.forEach(([emoji, grad], i) => {
    const b = document.createElement('button');
    b.className = 'avatar-pick' + (i === avatarIdx() ? ' active' : '');
    b.textContent = emoji; b.style.background = grad;
    b.onclick = () => {
      try { localStorage.setItem(AVATAR_KEY, String(i)); } catch { /* private mode */ }
      renderProfile(); renderAvatarPicker();
    };
    box.appendChild(b);
  });
}
function saveNickFromProfile() {
  const v = $('profile-nick-input').value.trim();
  const msg = $('profile-nick-msg');
  if (!v) { msg.className = 'field-error'; msg.textContent = 'Nickname tidak boleh kosong'; return; }
  if (v.length > 16) { msg.className = 'field-error'; msg.textContent = 'Maksimal 16 karakter'; return; }
  S.nickname = v;
  saveLocalNick();
  if (S.helloSent) send('hello', { nickname: v }); // server renames us for future rooms
  msg.className = 'field-ok'; msg.textContent = 'Tersimpan ✓';
  renderProfile();
}

// ---------- truth or truth arena ----------
const REACT_DEFS = [
  ['lucu', '😆', 'Lucu', 10], ['nangis', '😭', 'Nangis', 15],
  ['lovely', '🥰', 'Lovely', 10], ['marah', '😤', 'Marah', 15],
];
const WHEEL_COLORS = ['#ff8f6b', '#ffd29d', '#a6c1ee', '#9fd3a8', '#fbc2eb', '#fddb92', '#b3a1e0', '#ff9fb2'];
let truthUi = { turn: -1, myReacts: 0, greget: false };

function truthNick(id) {
  const p = S.players.find((x) => x.id === id);
  return p ? p.nickname : '?';
}

function renderTruth(m) {
  const st = m.state;
  S.truth = st;
  S.truthStage = m.truthStage;
  if (truthUi.turn !== st.turnNumber) truthUi = { turn: st.turnNumber, myReacts: 0, greget: false };
  $('truth-round').textContent = `PUTARAN ${st.round}/${st.totalTurns}`;
  $('truth-banner').textContent = {
    spin: '🎡 Rodanya berputar… siapa yang kena?',
    ask: st.explicitMode ? '🔞 Mode Eksplisit — pertanyaan keluar acak' : '✋ Jendela ASK terbuka!',
    answer: '💬 Saatnya menjawab!',
    react: '🎭 Beri reaksi!',
  }[S.truthStage] || '🎡 Truth or Truth';
  renderTruthWheel(m, st);
  renderTruthPanel(m, st);
}

// Player chips sit around a segmented disc (Sensei's sketch: an adaptive
// 2–8 player circle with a needle on top); the disc spins during 'spin'.
function renderTruthWheel(m, st) {
  const n = m.players.length;
  const seg = 360 / n;
  const stops = m.players.map((p, i) =>
    `${WHEEL_COLORS[p.seat % WHEEL_COLORS.length]} ${(i * seg).toFixed(1)}deg ${((i + 1) * seg).toFixed(1)}deg`).join(', ');
  const disc = $('truth-disc');
  disc.style.background = `conic-gradient(${stops})`;
  disc.classList.toggle('spinning', S.truthStage === 'spin');
  const ring = $('truth-ring');
  ring.innerHTML = '';
  const me = m.players.find((p) => p.id === m.you);
  const mySeat = me ? me.seat : 0;
  const pointsOf = (id) => {
    const sp = st.players.find((x) => x.id === id);
    return sp ? sp.points : 0;
  };
  for (let k = 0; k < n; k++) {
    const seat = (mySeat + k) % n;
    const p = m.players[seat];
    const ang = (90 + (k * 360) / n) * Math.PI / 180;
    const chip = document.createElement('div');
    chip.className = 'seat-chip'
      + (p.id === m.you ? ' me' : '')
      + (st.current.answererId === p.id ? ' turn' : '')
      + (p.connected === false ? ' offline' : '');
    chip.style.left = (50 + 44 * Math.cos(ang)).toFixed(1) + '%';
    chip.style.top = (50 + 44 * Math.sin(ang)).toFixed(1) + '%';
    const nick = document.createElement('span');
    nick.className = 'nick';
    nick.textContent = (p.connected === false ? '💤 ' : '') + p.nickname + (p.isBot ? ' 🤖' : '');
    const pts = document.createElement('span');
    pts.className = 'cnt';
    pts.textContent = `⭐ ${pointsOf(p.id)}`;
    chip.appendChild(nick);
    chip.appendChild(pts);
    ring.appendChild(chip);
  }
}

function renderTruthPanel(m, st) {
  const panel = $('truth-panel');
  const cur = st.current;
  const me = st.players.find((p) => p.id === m.you);
  const iAmAnswerer = cur.answererId === m.you;
  const answererNick = truthNick(cur.answererId);
  const deckLine = `<p class="muted">🃏 Sisa kartu: ${st.deckLeft} · yang menjawab: <strong>${answererNick}</strong></p>`;

  if (S.truthStage === 'spin' || !cur.answererId) {
    panel.innerHTML = `<p class="truth-big">🎡 Rodanya berputar…</p>${deckLine}`;
    return;
  }
  if (S.truthStage === 'ask') {
    if (st.explicitMode) {
      panel.innerHTML = `<p class="truth-big">🔞 Pertanyaan eksplisit akan keluar secara acak…</p>${deckLine}`;
      return;
    }
    if (cur.askerId === m.you) {
      panel.innerHTML = `<p class="truth-big">✋ Kamu yang bertanya!</p>
        <input id="ask-q-input" maxlength="200" placeholder="Tulis pertanyaanmu…" autocomplete="off">
        <button id="btn-ask-send" class="btn primary big">Kirim Pertanyaan</button>
        <p class="muted">Cepat ya — kalau kelamaan, pertanyaanmu hangus!</p>`;
      $('btn-ask-send').onclick = () => {
        const q = $('ask-q-input').value.trim();
        if (q) send('truth_ask_question', { question: q });
      };
      $('ask-q-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-ask-send').click(); });
      $('ask-q-input').focus();
      return;
    }
    if (cur.askerId) {
      panel.innerHTML = `<p class="truth-big">✋ ${truthNick(cur.askerId)} sedang menyiapkan pertanyaan…</p>${deckLine}`;
      return;
    }
    let html = `<p class="truth-big">✋ Siapa mau bertanya ke ${answererNick}?</p>`;
    if (!iAmAnswerer && me && me.askLeft > 0) {
      html += `<button id="btn-ask" class="btn primary big">✋ ASK! (sisa ${me.askLeft}x)</button>`;
    } else if (iAmAnswerer) {
      html += '<p class="muted">Kamu yang menjawab putaran ini — bersiap ya!</p>';
    } else {
      html += '<p class="muted">Jatah ASK kamu habis — kartu akan terbuka otomatis.</p>';
    }
    panel.innerHTML = html + deckLine;
    const b = $('btn-ask');
    if (b) b.onclick = () => send('truth_ask');
    return;
  }
  if (S.truthStage === 'answer') {
    const srcLabel = cur.source === 'ask'
      ? `❓ Pertanyaan dari ${truthNick(cur.askerId)}` : '🃏 Kartu pertanyaan';
    let html = `<p class="muted">${srcLabel}</p><p class="truth-question">${cur.question || ''}</p>`;
    if (iAmAnswerer) {
      html += `<textarea id="ans-input" maxlength="500" rows="3" placeholder="Tulis jawaban jujurmu…"></textarea>
        <div class="row"><button id="btn-ans-send" class="btn primary big">Kirim Jawaban</button>
        ${me && me.passLeft > 0 ? `<button id="btn-pass" class="btn warning">⏭️ PASS (sisa ${me.passLeft}x)</button>` : ''}</div>`;
    } else {
      html += `<p class="muted">⏳ Menunggu ${answererNick} menjawab…</p>`;
    }
    panel.innerHTML = html;
    const sendBtn = $('btn-ans-send');
    if (sendBtn) sendBtn.onclick = () => {
      const t = $('ans-input').value.trim();
      if (t) send('truth_answer', { text: t });
    };
    const passBtn = $('btn-pass');
    if (passBtn) passBtn.onclick = () => {
      if (confirm('Pakai jatah PASS untuk pertanyaan ini?')) send('truth_pass');
    };
    return;
  }
  if (S.truthStage === 'react') {
    let html = `<p class="muted">🃏 ${cur.question || ''}</p>`;
    if (cur.passed) html += `<p class="truth-big">⏭️ ${answererNick} skip pertanyaan ini!</p>`;
    else html += `<p class="truth-answer">💬 “${cur.answer || ''}”</p>`;
    html += '<div class="react-row">' + REACT_DEFS.map(([kind, emoji, label, pts]) =>
      `<button class="react-btn" data-kind="${kind}" ${iAmAnswerer || cur.passed ? 'disabled' : ''}>` +
      `<span class="react-emoji">${emoji}</span><span>${label}</span>` +
      `<strong>${cur.reactionCounts[kind]}</strong><small>+${pts}</small></button>`).join('') + '</div>';
    if (cur.kurangGreget > 0) {
      html += `<p class="truth-greget">😤 Kurang Greget! ×${cur.kurangGreget} (−${cur.kurangGreget * 5} poin untuk ${answererNick})</p>`;
    }
    if (!iAmAnswerer && !cur.passed && !truthUi.greget) {
      html += '<div class="row"><button id="btn-greget" class="btn danger small">😤 Kurang Greget! −5</button></div>';
    }
    if (truthUi.myReacts > 0 && !iAmAnswerer) {
      html += `<p class="muted">Reaksimu terkirim: ${truthUi.myReacts}/2</p>`;
    }
    if (iAmAnswerer) html += '<button id="btn-next" class="btn primary big">⏭️ Lanjut Putaran</button>';
    panel.innerHTML = html;
    panel.querySelectorAll('.react-btn').forEach((b) => {
      b.onclick = () => {
        if (truthUi.myReacts >= 2) { toast('Maksimal 2 reaksi per jawaban'); return; }
        truthUi.myReacts += 1;
        send('truth_react', { kind: b.dataset.kind });
        if (truthUi.myReacts >= 2) {
          panel.querySelectorAll('.react-btn').forEach((x) => { x.disabled = true; });
        }
      };
    });
    const g = $('btn-greget');
    if (g) g.onclick = () => { truthUi.greget = true; send('truth_kurang_greget'); };
    const nx = $('btn-next');
    if (nx) nx.onclick = () => send('truth_next');
    return;
  }
  panel.innerHTML = '<p class="truth-big">🎉 Permainan selesai!</p>';
}

// Mandatory on-screen popups for game events (Sensei's spec).
const TRUTH_POPUPS = {
  ask_claimed: (e) => `✋ ${truthNick(e.playerId)} bertanya!`,
  question_ready: (e) => `❓ Pertanyaan dari ${truthNick(e.playerId)} sudah siap!`,
  card_opened: () => '🃏 Kartu pertanyaan terbuka!',
  answer_submitted: (e) => `💬 ${truthNick(e.playerId)} sudah menjawab!`,
  passed: (e) => `⏭️ ${truthNick(e.playerId)} skip!!`,
  ask_expired: (e) => `⌛ ${truthNick(e.playerId)} kelamaan — pertanyaannya hangus!`,
  answer_timeout: (e) => `⌛ Waktu habis — ${truthNick(e.playerId)} dianggap skip`,
  kurang_greget: (e) => `😤 ${truthNick(e.playerId)}: “Kurang Greget!”`,
};
let popupTimer = null;
function truthPopup(text) {
  const el = $('truth-popup');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden', 'pop');
  void el.offsetWidth; // restart the animation
  el.classList.add('pop');
  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => el.classList.add('hidden'), 2100);
}
function handleTruthEvents(events) {
  if (!events) return;
  for (const e of events) {
    if (e.type === 'turn_started') {
      truthPopup(`🎡 Putaran ke ${e.round} — giliran ${truthNick(e.playerId)} menjawab!`);
    } else if (TRUTH_POPUPS[e.type]) {
      truthPopup(TRUTH_POPUPS[e.type](e));
    }
  }
}

function onTruthGameOver(m) {
  S.deadline = null;
  const s = loadLocalStats();
  const myScore = (m.scores || []).find((x) => x.playerId === S.playerId);
  const top = m.awards && m.awards.topScorer;
  s.played += 1;
  if (top && top.playerId === S.playerId) s.won += 1;
  if (myScore) s.points += myScore.points;
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  renderLocalStats();
  let body = '';
  if (top) body += `<p style="font-size:18px">🏆 Juara Poin: <strong>${truthNick(top.playerId)}</strong> (${top.points} poin)</p>`;
  const awardLines = [
    ['funniest', '😆 Paling Lucu'], ['saddest', '😭 Paling Sedih'],
    ['loveliest', '🥰 Paling Lovely'], ['mostEmotional', '😤 Paling Emosional'],
  ];
  for (const [key, label] of awardLines) {
    const a = m.awards && m.awards[key];
    if (a) body += `<p>${label}: <strong>${truthNick(a.playerId)}</strong> (${a.count} reaksi)<br><span class="muted">“${a.answer}”</span></p>`;
  }
  if (m.scores && m.scores.length) {
    const sorted = [...m.scores].sort((a, b) => b.points - a.points);
    body += '<table class="score-table">' + sorted
      .map((x) => `<tr><td>${x.nickname}</td><td><strong>${x.points}</strong></td></tr>`).join('') + '</table>';
  }
  showModal('🎡 Truth or Truth Selesai!', body,
    [{ label: '🚪 Keluar Room', cls: 'primary', onClick: () => send('leave_room') }]);
}

// ---------- wire up ----------
document.addEventListener('DOMContentLoaded', () => {
  for (const b of document.querySelectorAll('.game-card')) {
    b.onclick = () => enterGame(b.dataset.game);
  }
  $('btn-back-menu').onclick = () => showScreen('screen-landing');
  $('btn-nick-save').onclick = saveNickFromModal;
  $('btn-nick-cancel').onclick = closeNickModal;
  $('nick-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNickFromModal(); });
  // MABAR.io tab bar
  document.querySelectorAll('#tabbar .tab').forEach((b) => {
    b.onclick = () => showScreen(
      { home: 'screen-landing', profile: 'screen-profile', settings: 'screen-settings' }[b.dataset.tab]);
  });
  $('set-sound').onchange = (e) => setSound(e.target.checked);
  document.querySelectorAll('#set-gfx .seg-btn').forEach((b) => {
    b.onclick = () => setGfx(b.dataset.gfx);
  });
  $('btn-ping').onclick = runPing;
  $('btn-testbot').onclick = openTestBot;
  document.querySelectorAll('.ai-btn').forEach((b) => {
    b.onclick = () => send('create_chess_ai_room', { persona: b.dataset.persona });
  });
  // profile tab
  $('profile-avatar').onclick = () => {
    $('avatar-picker').classList.toggle('hidden');
    renderAvatarPicker();
  };
  $('btn-profile-save-nick').onclick = saveNickFromProfile;
  $('btn-bio-edit').onclick = () => {
    $('profile-bio').disabled = false;
    $('bio-actions').classList.remove('hidden');
    $('profile-bio').focus();
  };
  $('btn-bio-save').onclick = () => {
    try { localStorage.setItem(BIO_KEY, $('profile-bio').value.trim()); } catch { /* private mode */ }
    $('profile-bio').disabled = true;
    $('bio-actions').classList.add('hidden');
    toast('Bio tersimpan ✓');
  };
  $('btn-leave-truth').onclick = () => { if (confirm('Keluar dari room?')) send('leave_room'); };
  $('btn-create').onclick = () => {
    if (!ensureHello()) return;
    send('create_room', { game: S.game });
  };
  $('btn-bot').onclick = () => {
    if (!ensureHello()) return;
    send('create_bot_room', {
      size: parseInt($('bot-size').value, 10),
      mode: $('bot-mode').value,
    });
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
  $('btn-start').onclick = () => send('start_game', {
    mode: S.game === 'uno' ? $('lobby-mode').value : 'normal',
  });
  const btnSound = $('btn-sound');
  btnSound.textContent = soundOn ? '🔊' : '🔇';
  btnSound.onclick = () => {
    setSound(!soundOn);
    if (soundOn) sfx('draw');
  };
  // browsers unlock audio only after a user gesture; warm the context up early
  document.addEventListener('pointerdown', () => { if (soundOn) ac(); });
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
  wireChat('chat-input-truth', 'btn-chat-truth', 'chat-box-truth');
  const sendTruthRules = () => {
    if (S.playerId !== S.hostId) return;
    send('truth_set_rules', {
      totalQuestions: $('truth-total').value === '' ? null : Number($('truth-total').value),
      explicitMode: $('truth-explicit').checked,
    });
  };
  $('truth-total').onchange = sendTruthRules;
  $('truth-explicit').onchange = sendTruthRules;
  prefillLocalNick();
  renderLocalStats();
  applyGfx();
  showScreen('screen-landing');
  connect();
});
