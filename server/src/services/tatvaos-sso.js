/**
 * "Sign in with TatvaOS" — OpenID Connect authorization-code flow with PKCE
 * (S256), per https://core.tatvaos.com/docs/sso-integration-guide.html
 *
 * Server-side only. The client secret and the PKCE verifier never reach the
 * browser: the verifier + state + nonce travel in a short-lived signed,
 * httpOnly cookie between /start and /callback.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sign, verify } = require('../middleware/auth');

const ISSUER = 'https://core.tatvaos.com';
const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
const TOKEN_URL = `${ISSUER}/api/oauth/token`;
const JWKS_URL = `${ISSUER}/api/oauth/jwks`;
const USERINFO_URL = `${ISSUER}/api/oauth/userinfo`;
const COOKIE = 'tvos_sso';
const SCOPE = 'openid profile email';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Build the authorize URL + the cookie value that must accompany the callback. */
function beginLogin({ clientId, redirectUri, role, next }) {
  const codeVerifier = b64url(crypto.randomBytes(48));                 // 64 chars, within 43–128
  const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const url = AUTHORIZE_URL + '?' + new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  // signed by our JWT secret, 10-minute life — tamper-proof and self-expiring
  const cookie = jwt.sign({ t: 1, state, nonce, cv: codeVerifier, role, next }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '10m' });
  return { url, cookie };
}

function readCookie(req) {
  const raw = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  if (!raw) return null;
  try { return verify(decodeURIComponent(raw.slice(COOKIE.length + 1))); } catch { return null; }
}

let jwksCache = { keys: [], at: 0 };
async function getKey(kid) {
  if (!jwksCache.keys.find((k) => k.kid === kid) || Date.now() - jwksCache.at > 3600e3) {
    const r = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`could not load TatvaOS signing keys (HTTP ${r.status})`);
    jwksCache = { keys: (await r.json()).keys || [], at: Date.now() };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error('ID token signed with an unknown key');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
}

/**
 * Finish the login: validate state/iss, exchange the code (with PKCE verifier
 * + client secret), verify the ID token (RS256 via JWKS, iss, aud, nonce, exp)
 * and return the identity { sub, tid, email, emailVerified, name }.
 */
async function completeLogin(req, { clientId, clientSecret, redirectUri, tenantId }) {
  const saved = readCookie(req);
  if (!saved || !saved.t) throw new Error('Sign-in session expired — please try again');
  if (req.query.error) throw new Error(`TatvaOS sign-in was ${req.query.error === 'access_denied' ? 'cancelled or not permitted for your account' : 'refused (' + req.query.error + ')'}`);
  if (String(req.query.state || '') !== saved.state) throw new Error('Sign-in state mismatch — please try again');
  const iss = String(req.query.iss || ISSUER + '/');
  if (iss.replace(/\/$/, '') !== ISSUER) throw new Error('Unexpected issuer');

  const tr = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(req.query.code || ''),
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: saved.cv,
    }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const tokens = await tr.json().catch(() => ({}));
  if (!tr.ok || !tokens.id_token) {
    console.error('[tatvaos-sso] token exchange failed:', tr.status, tokens.error, tokens.error_description);
    const why = tokens.error === 'invalid_grant' ? 'the sign-in code expired — please try again'
      : tokens.error === 'invalid_client' ? 'client secret rejected — check Settings → Login Options'
      : tr.status === 429 ? 'TatvaOS is rate-limiting sign-ins — wait a minute'
      : (tokens.error_description || tokens.error || `HTTP ${tr.status}`);
    throw new Error('TatvaOS verification failed: ' + why);
  }

  const header = JSON.parse(Buffer.from(String(tokens.id_token).split('.')[0], 'base64url').toString());
  const pem = await getKey(header.kid);
  let claims;
  try {
    claims = jwt.verify(tokens.id_token, pem, { algorithms: ['RS256'], audience: clientId, issuer: [ISSUER, ISSUER + '/'] });
  } catch (e) { throw new Error('ID token rejected: ' + e.message); }
  if (claims.nonce !== saved.nonce) throw new Error('ID token nonce mismatch');
  if (tenantId && String(claims.tid || '') !== String(tenantId)) throw new Error('Your TatvaOS organisation is not allowed to sign in here');

  // profile/email may be omitted from the ID token — userinfo is authoritative
  let info = {};
  try {
    const ur = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10000) });
    if (ur.ok) info = await ur.json();
  } catch {}
  return {
    sub: claims.sub, tid: claims.tid || info.tid || '',
    email: (info.email || claims.email || '').trim().toLowerCase(),
    emailVerified: info.email_verified ?? claims.email_verified ?? false,
    name: info.name || claims.name || '',
    role: saved.role, next: saved.next,
  };
}

const cookieOptions = (secure) => `${COOKIE}=; Path=/api/public/auth/tatvaos; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
function setCookieHeader(value, secure) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/api/public/auth/tatvaos; Max-Age=600; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

module.exports = { beginLogin, completeLogin, setCookieHeader, clearCookieHeader: cookieOptions, ISSUER };
