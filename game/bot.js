'use strict';
/**
 * UNO bot: server-side AI for one seat. The bot only calls the same engine
 * functions a human turn would, deciding from its own hand + public state —
 * it cannot cheat or peek at other hands.
 */
const uno = require('./uno');

const BOT_NAMES = [
  'Bot Sakura', 'Bot Melati', 'Bot Anggrek', 'Bot Cempaka',
  'Bot Dahlia', 'Bot Kamboja', 'Bot Flamboyan',
];

// Color the bot wants when playing a wild: its most-held color.
function chooseWildColor(st, idx) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of st.hands[idx]) if (c.color) counts[c.color]++;
  let best = 'red';
  for (const col of uno.COLORS) if (counts[col] > counts[best]) best = col;
  return best;
}

function nextSeat(st, idx) {
  const n = st.hands.length;
  return (((idx + st.dir) % n) + n) % n;
}

// Pick which playable card to shed. Heuristics:
// - attack (draw2 / wild4 / skip) when the next player is close to winning
// - otherwise shed the highest-point non-wild card; wilds are kept for last
// While a draw pile is pending, `playable` already contains stack cards only.
function chooseCard(st, idx, playable) {
  if (playable.length === 1) return playable[0];
  const isWild = (c) => c.kind === 'wild' || c.kind === 'wild4';
  const nonWild = playable.filter((c) => !isWild(c));
  if (st.hands[nextSeat(st, idx)].length <= 2) {
    const atk = nonWild.find((c) => c.kind === 'draw2')
      || playable.find((c) => c.kind === 'wild4')
      || nonWild.find((c) => c.kind === 'skip')
      || nonWild.find((c) => c.kind === 'reverse');
    if (atk) return atk;
  }
  const pool = nonWild.length ? nonWild : playable;
  return pool.reduce((a, b) => (uno.cardPoints(b) > uno.cardPoints(a) ? b : a));
}

// Play one full turn for seat idx. Returns a log of engine actions taken:
// [{ action: 'play' | 'playDrawn' | 'draw' | 'pass', r }] (r = engine result).
function takeTurn(st, idx) {
  const log = [];
  if (st.over || st.turn !== idx) return log;
  const hand = st.hands[idx];
  const playable = hand.filter((c) => uno.canPlay(st, idx, c));
  if (playable.length) {
    const card = chooseCard(st, idx, playable);
    const r = uno.playCard(st, idx, card.id, {
      saidUno: hand.length === 2,
      wildColor: chooseWildColor(st, idx),
    });
    log.push({ action: 'play', r });
    return log;
  }
  const dr = uno.drawCard(st, idx);
  log.push({ action: 'draw', r: dr });
  if (!dr.ok || dr.lostTurn || st.over) return log;
  if (dr.playable) {
    const r2 = uno.playDrawnCard(st, idx, dr.card.id, {
      saidUno: st.hands[idx].length === 2,
      wildColor: chooseWildColor(st, idx),
    });
    log.push({ action: 'playDrawn', r: r2 });
  } else {
    log.push({ action: 'pass', r: uno.passTurn(st, idx) });
  }
  return log;
}

// Truth or Truth bot rooms (Misi 3, playtest scheme — Sensei): bots
// cannot really answer, so the server simulates plausible answers
// from this pool. Deliberately generic so they fit almost any card.
const TRUTH_FAKE_ANSWERS = [
  'Pernah sih, tapi ceritanya panjang... intinya aku kapok.',
  'Sering! Hampir tiap minggu malah, hehe.',
  'Hmm, terakhir waktu itu... ya begitulah, jangan ditiru ya.',
  'Jujur ya, aku malu cerita ini. Tapi pernah, sekali saja.',
  'Enggak pernah! Aku anaknya baik-baik kok.',
  'Itu rahasia... tapi kalau dipaksa jawab: iya, pernah.',
  'Waktu SMP sih pernah, sekarang sudah tobat.',
  'Sebenarnya sering kepikiran, tapi belum pernah kesampaian.',
  'Pernah, dan sampai sekarang masih suka kebayang.',
  'Kalau yang itu sih keahlian aku, jangan diragukan lagi.',
  'Baru kemarin kejadian, masih anget ceritanya.',
  'Aku jawab jujur ya: tidak, dan aku bangga soal itu.',
  'Pernah sekali, gara-gara penasaran doang sih.',
  'Hampir tiap hari! Sudah jadi kebiasaan burukku.',
  'Dulu sering, sekarang sudah jauh berkurang kok.',
  'Cerita ini cuma aku kasih tahu di sini ya: pernah, dua kali.',
  'Malu-maluin banget pokoknya, tapi ya terjadi juga akhirnya.',
  'Enggak akan aku lupakan sih, itu pengalaman paling nekatku.',
];

function pickTruthAnswer(rand) {
  const r = typeof rand === 'function' ? rand : Math.random;
  return TRUTH_FAKE_ANSWERS[Math.floor(r() * TRUTH_FAKE_ANSWERS.length)];
}

module.exports = { BOT_NAMES, takeTurn, chooseCard, chooseWildColor,
  TRUTH_FAKE_ANSWERS, pickTruthAnswer };
