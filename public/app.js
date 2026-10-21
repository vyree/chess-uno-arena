'use strict';
/* Chess + UNO Arena — client. NO game rules here; only rendering + sending intents. */

const S = {
  ws: null, playerId: null, nickname: '', game: 'chess',
  roomCode: null, players: [], hostId: null,
  chess: null, uno: null, unoMeta: {},
  selected: null, legalMoves: [],
  saidUnoArmed: false, deadline: null, helloSent: false,
  authMode: !!window.CUA_FIREBASE, fbUser: null, profileNickname: null,
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
  const ws = new WebSocket(window.CUA_WS_ENDPOINT || (proto + '://' + location.host));
  S.ws = ws;
  ws.onopen = async () => {
    const sess = loadSession();
    if (sess && sess.playerId && sess.code) {
      if (S.authMode) {
        // rejoin must carry a fresh ID token proving the same Google account
        const user = await waitForFbUser();
        if (user) {
          send('rejoin', { playerId: sess.playerId, code: sess.code, idToken: await user.getIdToken() });
          return;
        }
        clearSession();
      } else {
        send('rejoin', { playerId: sess.playerId, code: sess.code });
      }
    } else if (sess && sess.nickname && !S.authMode) {
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
  if (S.authMode) return !!S.profileNickname; // hello is sent by the auth flow
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
    case 'uno_events': handleUnoEvents(m.events); break;
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
  if (S.authMode && !S.profileNickname) return; // gate: no profile, no room list
  if (!ensureHelloQuiet()) return;
  send('list_rooms');
}
function ensureHelloQuiet() {
  if (S.authMode) return true; // the auth flow owns hello in Firebase mode
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
  // UNO only: host's Extreme Mode toggle for the upcoming game
  $('lobby-extreme-row').classList.toggle('hidden', m.game !== 'uno');
  if (m.game === 'uno') {
    $('lobby-extreme').disabled = !isHost;
    $('lobby-extreme-note').classList.toggle('hidden', isHost);
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

  // seat ring: every player in seat order, you at the bottom
  renderUnoRing(m, mySeat);

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
  const dirEl = $('uno-dir');
  dirEl.classList.toggle('ccw', st.dir === -1);
  dirEl.title = st.dir === -1 ? 'Arah: berlawanan jarum jam' : 'Arah: searah jarum jam';
  $('uno-extreme-badge').classList.toggle('hidden', !st.extreme);

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
  if (reducedMotion || !fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'uno-card fly ' + (back ? 'deck' : cardClass(card || {}));
  ghost.innerHTML = `<span>${back ? '🎴' : (card ? cardLabel(card) : '?')}</span>`;
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

// ---------- firebase auth + profile (Fase 4) ----------
// The Google identity (name/email/photo) is NEVER rendered anywhere; the
// in-game identity is only the self-chosen nickname stored per account.
// The SDK is loaded as ES modules via dynamic import (pinned version) so a
// CDN failure only closes the login gate instead of killing the whole app.
// Profiles/stats live in Realtime Database (Sensei's decision, 2026-10-21):
// this project's (default) database is Datastore Mode and creating a
// Firestore database is billing-locked, while RTDB is free on Spark.
let fb = null;
let fbAuth = null;
let fbDb = null;
const FB_VERSION = '10.12.2';

async function loadFirebase() {
  if (fb) return fb;
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
  const [appM, authM, dbM] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-database.js`),
  ]);
  fb = { ...appM, ...authM, ...dbM };
  return fb;
}

function authShow(which) {
  for (const id of ['auth-login', 'auth-create', 'auth-profile']) {
    $(id).classList.toggle('hidden', id !== which);
  }
}
function setControlsLocked(locked) {
  $('landing-controls').classList.toggle('locked', locked);
}
function renderProfileStats(stats) {
  const el = $('profile-stats');
  if (!stats) { el.textContent = ''; return; }
  el.textContent = `🏆 Statistik: ${stats.played || 0} main · ${stats.won || 0} menang · ${stats.points || 0} poin`;
}
function profileRef(uid) { return fb.ref(fbDb, 'users/' + uid); }

async function sendAuthHello() {
  if (!fbAuth || !fbAuth.currentUser || !S.profileNickname) return;
  const idToken = await fbAuth.currentUser.getIdToken();
  send('hello', { nickname: S.profileNickname, idToken });
  S.helloSent = true;
  S.nickname = S.profileNickname;
}

async function onFbUser(user) {
  S.fbUser = user;
  if (!user) {
    S.profileNickname = null;
    authShow('auth-login');
    setControlsLocked(true);
    return;
  }
  try {
    const snap = await fb.get(profileRef(user.uid));
    if (!snap.exists()) {
      authShow('auth-create');
      setControlsLocked(true);
      return;
    }
    const data = snap.val();
    S.profileNickname = data.nickname;
    $('profile-nick').textContent = data.nickname;
    renderProfileStats(data.stats);
    authShow('auth-profile');
    setControlsLocked(false);
    sendAuthHello();
  } catch (e) {
    $('auth-error').textContent = 'Gagal memuat profil — periksa koneksi lalu muat ulang ya';
  }
}

function waitForFbUser() {
  return new Promise((resolve) => {
    if (!fbAuth) { resolve(null); return; }
    const un = fb.onAuthStateChanged(fbAuth, (u) => { un(); resolve(u); });
    setTimeout(() => resolve(fbAuth.currentUser), 4000);
  });
}

async function initAuth() {
  if (!S.authMode) return; // dev mode: the auth box stays hidden
  $('auth-box').classList.remove('hidden');
  $('nick-block').classList.add('hidden');
  setControlsLocked(true);
  try {
    await loadFirebase();
  } catch (e) {
    // SDK failed to load: fail closed, the gate stays up
    $('auth-error').textContent = 'Komponen login gagal dimuat — periksa koneksi internet kamu';
    return;
  }
  const app = fb.initializeApp(window.CUA_FIREBASE);
  fbAuth = fb.getAuth(app);
  fbDb = fb.getDatabase(app);
  fb.onAuthStateChanged(fbAuth, onFbUser);
  $('btn-google').onclick = async () => {
    $('auth-error').textContent = '';
    try {
      await fb.signInWithPopup(fbAuth, new fb.GoogleAuthProvider());
    } catch (e) {
      $('auth-error').textContent = 'Login dibatalkan atau gagal — coba lagi ya';
    }
  };
  $('btn-create-nick').onclick = async () => {
    const nick = $('new-nickname').value.trim();
    $('create-error').textContent = '';
    if (!nick) { $('create-error').textContent = 'Isi nickname dulu ya'; return; }
    if (nick.length > 16) { $('create-error').textContent = 'Maksimal 16 karakter'; return; }
    try {
      await fb.set(profileRef(fbAuth.currentUser.uid), {
        nickname: nick,
        stats: { played: 0, won: 0, points: 0 },
        createdAt: fb.serverTimestamp(),
      });
      onFbUser(fbAuth.currentUser);
    } catch (e) {
      $('create-error').textContent = 'Gagal menyimpan nickname, coba lagi ya';
    }
  };
  $('btn-edit-nick').onclick = () => {
    $('edit-nickname').value = S.profileNickname || '';
    $('edit-nick-row').classList.toggle('hidden');
  };
  $('btn-save-nick').onclick = async () => {
    const nick = $('edit-nickname').value.trim();
    if (!nick || nick.length > 16) { toast('Nickname 1–16 karakter ya'); return; }
    try {
      await fb.update(profileRef(fbAuth.currentUser.uid), { nickname: nick });
      S.profileNickname = nick;
      S.nickname = nick;
      $('profile-nick').textContent = nick;
      $('edit-nick-row').classList.add('hidden');
      sendAuthHello(); // refresh the server-side nickname binding
      toast('Nickname diperbarui! ✏️');
    } catch (e) { toast('Gagal memperbarui nickname'); }
  };
  $('btn-signout').onclick = async () => {
    await fb.signOut(fbAuth);
    location.reload();
  };
}

// Record one finished game into the player's own Realtime Database stats.
function recordStats(m) {
  if (!S.authMode || !fb || !fbDb || !fbAuth || !fbAuth.currentUser) return;
  const won = !!m.winnerNickname && m.winnerNickname === S.nickname;
  fb.update(profileRef(fbAuth.currentUser.uid), {
    'stats/played': fb.increment(1),
    'stats/won': fb.increment(won ? 1 : 0),
    'stats/points': fb.increment(won && m.points ? m.points : 0),
    lastPlayedAt: fb.serverTimestamp(),
  }).catch(() => { /* stats are best-effort; never break the game-over UI */ });
}

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
  $('btn-bot').onclick = () => {
    if (!ensureHello()) return;
    send('create_bot_room', {
      size: parseInt($('bot-size').value, 10),
      extreme: $('bot-extreme').checked,
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
    extreme: S.game === 'uno' && $('lobby-extreme').checked,
  });
  const btnSound = $('btn-sound');
  const syncSoundIcon = () => { btnSound.textContent = soundOn ? '🔊' : '🔇'; };
  syncSoundIcon();
  btnSound.onclick = () => {
    soundOn = !soundOn;
    try { localStorage.setItem('cua-sound', soundOn ? 'on' : 'off'); } catch { /* private mode */ }
    if (!soundOn && 'speechSynthesis' in window) speechSynthesis.cancel();
    syncSoundIcon();
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
  initAuth();
  connect();
});
