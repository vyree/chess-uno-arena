'use strict';
/**
 * Ludo confirm stopper tests (2026-11-03, Sensei):
 * 1. ludo_confirm validator accepts the message.
 * 2. toClient exposes pendingConfirm (with noMove flag) for the popup.
 * 3. toClient exposes pendingConfirm=null when no confirm is pending.
 */
const test = require('node:test');
const assert = require('node:assert');
const validate = require('../game/validate');
const ludo = require('../game/ludo');

function fresh() { return ludo.newGame(() => 0.5); }

test('validator: ludo_confirm diterima', () => {
  const r = validate.validateMessage(JSON.stringify({ type: 'ludo_confirm', data: {} }));
  assert.equal(r.ok, true);
  assert.equal(r.type, 'ludo_confirm');
});

test('toClient: pendingConfirm terekspos dengan flag noMove', () => {
  const st = fresh();
  st.phase = 'confirm';
  st.turn = 2;
  st.pendingConfirm = { noMove: true };
  const c = ludo.toClient(st, 2);
  assert.deepEqual(c.pendingConfirm, { noMove: true });
  assert.equal(c.phase, 'confirm');
  assert.equal(c.turn, 2);
});

test('toClient: pendingConfirm=null bila tidak ada konfirmasi', () => {
  const st = fresh();
  st.phase = 'roll';
  st.pendingConfirm = null;
  const c = ludo.toClient(st, 0);
  assert.equal(c.pendingConfirm, null);
});

test('toClient: myPhase turn holder saat confirm adalah confirm', () => {
  const st = fresh();
  st.phase = 'confirm';
  st.turn = 1;
  st.pendingConfirm = { noMove: false };
  const holder = ludo.toClient(st, 1);
  const other = ludo.toClient(st, 0);
  assert.equal(holder.myPhase, 'confirm');
  assert.equal(other.myPhase, 'waiting');
});
