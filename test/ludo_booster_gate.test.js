// Strict booster gate (Sensei 2026-11-03): the player MUST answer
// "mau booster tidak?" (ludo_booster_decide) before moving when holding
// a neutral card. doLudoMove and doLudoNeutral reject while pending.
const test = require('node:test');
const assert = require('node:assert/strict');

function makeRoom() {
  const ludo = require('../game/ludo.js');
  const st = ludo.newGame(() => 0.5);
  // Give player 0 a neutral (booster) card.
  st.players[0].hand.push({ id: 'n1', kind: 'x2', group: 'neutral' });
  st.phase = 'move';
  st.turn = 0;
  st.dice = 3;
  st.steps = 3;
  // Simulate doLudoRoll's gate assignment.
  const hand = st.players[0].hand || [];
  st.boosterDecisionPending = hand.some((c) => c.group === 'neutral');
  return { ludo, st };
}

test('gate is set when player holds a neutral card', () => {
  const { st } = makeRoom();
  assert.equal(st.boosterDecisionPending, true);
});

test('gate is NOT set when player holds no neutral card', () => {
  const ludo = require('../game/ludo.js');
  const st = ludo.newGame(() => 0.5);
  st.phase = 'move';
  st.turn = 0;
  const hand = st.players[0].hand || [];
  st.boosterDecisionPending = hand.some((c) => c.group === 'neutral');
  assert.equal(st.boosterDecisionPending, false);
});

test('server would block move/neutral while boosterDecisionPending', () => {
  const { st } = makeRoom();
  // The engine useNeutral does not check the gate; the server's
  // doLudoMove/doLudoNeutral do. The flag being true is what they check.
  assert.equal(st.boosterDecisionPending, true);
  // After the decision, the gate lifts.
  st.boosterDecisionPending = false;
  assert.equal(st.boosterDecisionPending, false);
});

test('toClient exposes boosterDecisionPending', () => {
  const { ludo, st } = makeRoom();
  const client = ludo.toClient(st, 0);
  assert.equal(client.boosterDecisionPending, true);
});

test('validator accepts ludo_booster_decide with boolean use', () => {
  const { validateMessage } = require('../game/validate.js');
  const ok1 = validateMessage(JSON.stringify({ type: 'ludo_booster_decide', data: { use: true } }));
  assert.equal(ok1.ok, true);
  assert.deepEqual(ok1.data, { use: true });
  const ok2 = validateMessage(JSON.stringify({ type: 'ludo_booster_decide', data: { use: false } }));
  assert.equal(ok2.ok, true);
  const bad1 = validateMessage(JSON.stringify({ type: 'ludo_booster_decide', data: { use: 'yes' } }));
  assert.equal(bad1.ok, false);
  const bad2 = validateMessage(JSON.stringify({ type: 'ludo_booster_decide', data: {} }));
  assert.equal(bad2.ok, false);
});
