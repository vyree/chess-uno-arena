'use strict';
// Misi 2 Fase 4: Firebase ID token verifier (zero-dep RS256 + claims).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createVerifier } = require('../game/auth.js');

const PROJECT = 'arena-test-project';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

let fetchCount = 0;
const fetchCerts = async () => {
  fetchCount++;
  return { certs: { kid1: pubPem }, maxAge: 3600 };
};

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function makeToken(payloadOverrides, headerOverrides, key) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: 'kid1', typ: 'JWT', ...(headerOverrides || {}) };
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'uid-abc-123',
    iat: now,
    exp: now + 3600,
    ...(payloadOverrides || {}),
  };
  const body = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(body), key || privateKey).toString('base64url');
  return `${body}.${sig}`;
}

test('token valid diterima, uid terbaca, sertifikat di-cache', async () => {
  fetchCount = 0;
  const v = createVerifier(PROJECT, { fetchCerts });
  const out = await v.verify(makeToken());
  assert.equal(out.uid, 'uid-abc-123');
  await v.verify(makeToken());
  assert.equal(fetchCount, 1); // second verify hits the cert cache
});

test('token kedaluwarsa ditolak', async () => {
  const v = createVerifier(PROJECT, { fetchCerts });
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(() => v.verify(makeToken({ exp: now - 3600 })), /kedaluwarsa/);
});

test('aud / iss yang salah ditolak', async () => {
  const v = createVerifier(PROJECT, { fetchCerts });
  await assert.rejects(() => v.verify(makeToken({ aud: 'project-lain' })), /audiens/);
  await assert.rejects(() => v.verify(makeToken({ iss: 'https://securetoken.google.com/project-lain' })), /issuer/);
});

test('tanda tangan rusak / kunci lain ditolak', async () => {
  const v = createVerifier(PROJECT, { fetchCerts });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(() => v.verify(makeToken({}, {}, other)), /tanda tangan/);
  const good = makeToken();
  const tampered = good.slice(0, -4) + 'AAAA';
  await assert.rejects(() => v.verify(tampered), /tanda tangan/);
});

test('format token rusak ditolak', async () => {
  const v = createVerifier(PROJECT, { fetchCerts });
  await assert.rejects(() => v.verify('bukan-jwt'), /tidak valid/);
  await assert.rejects(() => v.verify(null), /tidak valid/);
  await assert.rejects(() => v.verify(makeToken({}, { kid: 'tidak-ada' })), /tidak valid/);
});
