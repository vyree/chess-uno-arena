'use strict';
/**
 * validate.js — single choke point for all inbound WebSocket messages.
 * Every message must pass through validateMessage() before routing.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function validNickname(n) {
  if (typeof n !== 'string') return { ok: false, error: 'nickname harus teks' };
  const t = n.trim();
  if (t.length < 1) return { ok: false, error: 'isi nickname dulu ya' };
  if (t.length > 16) return { ok: false, error: 'nickname maksimal 16 karakter' };
  return { ok: true, value: escapeHtml(t) };
}

// Firebase ID token: optional at this layer (the server enforces its
// presence when auth is enabled). Format check only; crypto is game/auth.js.
function validIdToken(t) {
  if (t === undefined || t === null) return { ok: true, value: null };
  if (typeof t !== 'string' || t.length < 10 || t.length > 8192) {
    return { ok: false, error: 'token login tidak valid' };
  }
  return { ok: true, value: t };
}

function validCode(c) {
  if (typeof c !== 'string') return { ok: false, error: 'kode room harus teks' };
  const t = c.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(t)) return { ok: false, error: 'kode room harus 6 karakter' };
  return { ok: true, value: t };
}

function validSquare(s) {
  if (typeof s !== 'string' || !/^[a-h][1-8]$/.test(s)) {
    return { ok: false, error: 'format petak salah (contoh: e2)' };
  }
  return { ok: true, value: s };
}

function validPromo(p) {
  if (p === undefined || p === null) return { ok: true, value: undefined };
  if (typeof p !== 'string' || !['q', 'r', 'b', 'n'].includes(p.toLowerCase())) {
    return { ok: false, error: 'promosi harus q/r/b/n' };
  }
  return { ok: true, value: p.toLowerCase() };
}

function validCardId(id) {
  if (typeof id !== 'string' || !/^c\d+$/.test(id) || id.length > 12) {
    return { ok: false, error: 'id kartu tidak valid' };
  }
  return { ok: true, value: id };
}

function validColor(c) {
  if (c === undefined || c === null) return { ok: true, value: undefined };
  if (!['red', 'yellow', 'green', 'blue'].includes(c)) {
    return { ok: false, error: 'warna tidak valid' };
  }
  return { ok: true, value: c };
}

// Truth or Truth payloads (Misi 3). The truth_* message validators
// below were registered in Fase 2, when the server started routing them.
const { TOTAL_QUESTION_CHOICES } = require('./truth');
const TRUTH_REACTIONS = ['lucu', 'nangis', 'lovely', 'marah'];
function validAskQuestion(q) {
  if (typeof q !== 'string') return { ok: false, error: 'pertanyaan harus teks' };
  const t = q.trim();
  if (t.length < 3 || t.length > 200) {
    return { ok: false, error: 'pertanyaan harus 3-200 karakter' };
  }
  return { ok: true, value: escapeHtml(t) };
}
function validAnswerText(a) {
  if (typeof a !== 'string') return { ok: false, error: 'jawaban harus teks' };
  const t = a.trim();
  if (t.length < 1 || t.length > 1000) {
    return { ok: false, error: 'jawaban harus 1-1000 karakter' };
  }
  return { ok: true, value: escapeHtml(t) };
}
function validReactionKind(k) {
  if (!TRUTH_REACTIONS.includes(k)) {
    return { ok: false, error: 'reaksi harus lucu/nangis/lovely/marah' };
  }
  return { ok: true, value: k };
}

// Validators per message type. Each returns {ok, data} or {ok:false, error}.
const VALIDATORS = {
  hello(d) {
    const n = validNickname(d.nickname);
    if (!n.ok) return n;
    const t = validIdToken(d.idToken);
    if (!t.ok) return t;
    return { ok: true, data: { nickname: n.value, idToken: t.value } };
  },
  create_room(d) {
    if (!['chess', 'uno', 'truth'].includes(d.game)) {
      return { ok: false, error: 'game harus chess, uno, atau truth' };
    }
    return { ok: true, data: { game: d.game } };
  },
  list_rooms() { return { ok: true, data: {} }; },
  join_room(d) {
    const c = validCode(d.code);
    if (!c.ok) return c;
    return { ok: true, data: { code: c.value } };
  },
  leave_room() { return { ok: true, data: {} }; },
  rejoin(d) {
    if (typeof d.playerId !== 'string' || d.playerId.length > 64) {
      return { ok: false, error: 'playerId tidak valid' };
    }
    const c = validCode(d.code);
    if (!c.ok) return c;
    const t = validIdToken(d.idToken);
    if (!t.ok) return t;
    return { ok: true, data: { playerId: d.playerId, code: c.value, idToken: t.value } };
  },
  start_game(d) {
    // extreme = UNO Mode Ekstrim toggle set by the host (Misi 2)
    return { ok: true, data: { extreme: d.extreme === true } };
  },
  create_bot_room(d) {
    if (![2, 4, 6, 8].includes(d.size)) {
      return { ok: false, error: 'ukuran meja bot harus 2, 4, 6, atau 8 pemain' };
    }
    return { ok: true, data: { size: d.size, extreme: d.extreme === true } };
  },
  chat(d) {
    if (typeof d.text !== 'string') return { ok: false, error: 'chat harus teks' };
    const t = d.text.trim();
    if (t.length < 1) return { ok: false, error: 'chat kosong' };
    if (t.length > 200) return { ok: false, error: 'chat maksimal 200 karakter' };
    return { ok: true, data: { text: escapeHtml(t) } };
  },
  chess_moves_for(d) {
    const s = validSquare(d.square);
    if (!s.ok) return s;
    return { ok: true, data: { square: s.value } };
  },
  chess_move(d) {
    const f = validSquare(d.from);
    if (!f.ok) return f;
    const t = validSquare(d.to);
    if (!t.ok) return t;
    const p = validPromo(d.promotion);
    if (!p.ok) return p;
    return { ok: true, data: { from: f.value, to: t.value, promotion: p.value } };
  },
  chess_resign() { return { ok: true, data: {} }; },
  uno_play(d) {
    const c = validCardId(d.cardId);
    if (!c.ok) return c;
    const w = validColor(d.wildColor);
    if (!w.ok) return w;
    return {
      ok: true,
      data: { cardId: c.value, saidUno: d.saidUno === true, wildColor: w.value },
    };
  },
  uno_draw() { return { ok: true, data: {} }; },
  uno_pass() { return { ok: true, data: {} }; },
  uno_new_round() { return { ok: true, data: {} }; },
  // ---- Truth or Truth (Misi 3 Fase 2) ----
  truth_set_rules(d) {
    const data = {};
    if (d.totalQuestions !== undefined) {
      if (d.totalQuestions !== null && !TOTAL_QUESTION_CHOICES.includes(d.totalQuestions)) {
        return { ok: false, error: 'batas pertanyaan harus 8/10/12/16/20/24' };
      }
      data.totalQuestions = d.totalQuestions;
    }
    if (d.explicitMode !== undefined) data.explicitMode = d.explicitMode === true;
    return { ok: true, data };
  },
  truth_ask() { return { ok: true, data: {} }; },
  truth_ask_question(d) {
    const q = validAskQuestion(d.question);
    if (!q.ok) return q;
    return { ok: true, data: { question: q.value } };
  },
  truth_answer(d) {
    const a = validAnswerText(d.text);
    if (!a.ok) return a;
    return { ok: true, data: { text: a.value } };
  },
  truth_pass() { return { ok: true, data: {} }; },
  truth_react(d) {
    const k = validReactionKind(d.kind);
    if (!k.ok) return k;
    return { ok: true, data: { kind: k.value } };
  },
  truth_kurang_greget() { return { ok: true, data: {} }; },
  truth_next() { return { ok: true, data: {} }; },
};

function validateMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'pesan bukan JSON valid' };
  }
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    return { ok: false, error: 'format pesan salah' };
  }
  const v = VALIDATORS[msg.type];
  if (!v) return { ok: false, error: `perintah tidak dikenal: ${msg.type}` };
  const r = v(msg.data || {});
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, type: msg.type, data: r.data };
}

module.exports = { validateMessage, escapeHtml, validNickname,
  validAskQuestion, validAnswerText, validReactionKind, TRUTH_REACTIONS };
