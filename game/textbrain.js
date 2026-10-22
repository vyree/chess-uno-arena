'use strict';
/**
 * textbrain (Misi 7): a tiny, game-agnostic Indonesian chat reader.
 * It turns messy player text ("sprt ny ak akn klh") into an intent the
 * caller can act on, in four layers: normalize -> slang dictionary ->
 * consonant-skeleton guessing ("sprt" and "seperti" share the frame
 * SPRT) -> intent patterns scored over the expanded token set. It
 * also flags abuse and gibberish. Pure functions, zero I/O, shared by
 * any game that wants a talking opponent (chess first).
 */
const { SLANG, WORDS, PROFANITY } = require('./slang');

const VOCAB = new Set(WORDS);
for (const value of Object.values(SLANG)) {
  for (const w of value.split(' ')) VOCAB.add(w);
}
const PROFANITY_SET = new Set(PROFANITY);

// Consonant skeleton: Indonesian slang drops vowels, so words that
// share a skeleton are candidates for each other ("klh" -> "kalah").
function skeleton(word) {
  return word.replace(/[aiueo]/g, '');
}
const SKELETONS = new Map();
for (const word of VOCAB) {
  const sk = skeleton(word);
  if (sk.length < 2) continue;
  if (!SKELETONS.has(sk)) SKELETONS.set(sk, []);
  SKELETONS.get(sk).push(word);
}
const PROFANITY_SKELETONS = new Set(PROFANITY.map(skeleton));

// Lowercase, drop punctuation (remembering '?'), fold 3+ repeated
// letters down to one ("kalahhh" -> "kalah", "anjiiing" -> "anjing").
function normalize(text) {
  const raw = String(text || '');
  const question = raw.includes('?');
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return { tokens: cleaned ? cleaned.split(' ') : [], question };
}

// Every canonical word a token might mean: itself, its dictionary
// expansion, and its consonant-skeleton siblings.
function expandToken(token) {
  const out = new Set([token]);
  if (SLANG[token]) {
    for (const w of SLANG[token].split(' ')) out.add(w);
    return out;
  }
  if (token.length >= 3) {
    const candidates = SKELETONS.get(skeleton(token));
    if (candidates) for (const w of candidates) out.add(w);
  }
  return out;
}

function expandTokens(tokens) {
  const out = new Set();
  for (const t of tokens) for (const w of expandToken(t)) out.add(w);
  return out;
}

function isAbusive(tokens, expanded) {
  for (const t of tokens) {
    if (PROFANITY_SET.has(t)) return true;
    if (t.length >= 3 && PROFANITY_SKELETONS.has(skeleton(t))) return true;
  }
  for (const w of expanded) if (PROFANITY_SET.has(w)) return true;
  return false;
}

function isRecognized(token) {
  if (VOCAB.has(token) || SLANG[token]) return true;
  return token.length >= 3 && SKELETONS.has(skeleton(token));
}

// Intent defs come from the caller: [{ id, patterns: [[tok, ...]] }]
// — a pattern matches when ALL its tokens are in the expanded set;
// the longest matching pattern wins, earliest intent breaks ties.
function analyze(text, intents) {
  const { tokens, question } = normalize(text);
  const expanded = expandTokens(tokens);
  let best = null;
  let bestScore = 0;
  for (const intent of intents || []) {
    for (const pattern of intent.patterns) {
      if (pattern.length > bestScore && pattern.every((t) => expanded.has(t))) {
        best = intent.id;
        bestScore = pattern.length;
      }
    }
  }
  const recognized = tokens.filter(isRecognized).length;
  const coverage = tokens.length ? recognized / tokens.length : 0;
  return {
    intent: best,
    abuse: isAbusive(tokens, expanded),
    gibberish: tokens.length > 0 && !best && coverage < 0.34,
    emojiOnly: tokens.length === 0 && String(text || '').trim().length > 0,
    question,
    tokens,
    expanded,
  };
}

module.exports = { analyze, normalize, expandTokens, expandToken, skeleton };
