'use strict';
/**
 * Firebase ID token verification with zero dependencies.
 *
 * A Firebase ID token is an RS256 JWT signed by Google. Verification:
 * fetch Google's x509 certs (cached), check the signature with the cert
 * matching the token's kid, then validate iss/aud/exp/sub claims.
 * The cert source is injectable so unit tests can use a local keypair.
 */
const crypto = require('crypto');

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CLOCK_SKEW_S = 60;

async function defaultFetchCerts() {
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('gagal mengambil sertifikat Google');
  const certs = await res.json();
  let maxAge = 3600;
  const cc = res.headers.get('cache-control');
  if (cc) {
    const m = /max-age=(\d+)/.exec(cc);
    if (m) maxAge = parseInt(m[1], 10);
  }
  return { certs, maxAge };
}

function b64urlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function publicKeyFromPem(pem) {
  try {
    return new crypto.X509Certificate(pem).publicKey;
  } catch {
    return crypto.createPublicKey(pem); // raw SPKI public key (used by tests)
  }
}

function createVerifier(projectId, opts) {
  const fetchCerts = (opts && opts.fetchCerts) || defaultFetchCerts;
  let cache = null; // { certs, expiresAt }

  async function getCerts() {
    if (cache && cache.expiresAt > Date.now()) return cache.certs;
    const { certs, maxAge } = await fetchCerts();
    cache = { certs, expiresAt: Date.now() + (maxAge || 3600) * 1000 };
    return certs;
  }

  // Resolves to { uid } for a genuine token; rejects with a coded Error.
  async function verify(idToken) {
    const fail = (msg) => { throw new Error(msg); };
    if (typeof idToken !== 'string' || idToken.length > 8192) fail('token tidak valid');
    const parts = idToken.split('.');
    if (parts.length !== 3) fail('token tidak valid');
    let header;
    let payload;
    try {
      header = b64urlJson(parts[0]);
      payload = b64urlJson(parts[1]);
    } catch { fail('token tidak valid'); }
    if (header.alg !== 'RS256' || !header.kid) fail('token tidak valid');

    const certs = await getCerts();
    const pem = certs[header.kid];
    if (!pem) fail('token tidak valid');

    const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], 'base64url');
    let ok = false;
    try {
      ok = crypto.verify('RSA-SHA256', signed, publicKeyFromPem(pem), signature);
    } catch { ok = false; }
    if (!ok) fail('tanda tangan token tidak valid');

    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) fail('issuer token salah');
    if (payload.aud !== projectId) fail('audiens token salah');
    if (!payload.exp || payload.exp < now - CLOCK_SKEW_S) fail('token kedaluwarsa');
    if (!payload.sub || typeof payload.sub !== 'string') fail('token tidak valid');
    return { uid: payload.sub };
  }

  return { verify };
}

module.exports = { createVerifier };
