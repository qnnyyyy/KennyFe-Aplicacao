// Autenticação: senha com scrypt (nativo) + sessão em cookie httpOnly.
const crypto = require('node:crypto');
const { db } = require('./db');

const COOKIE = 'kf_session';
const SESSION_DAYS = 60;
const COLORS = ['#ff5fa2', '#a66bff', '#4cc9f0', '#ffb84c', '#5ce1a0', '#ff6b6b', '#7c8cff', '#f72585'];

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const FRAMES = ['none', 'neon', 'fire', 'ice', 'gold', 'rainbow', 'toxic', 'galaxy', 'pixel', 'glitch'];

function parseJson(s, fallback) {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

function publicUser(u) {
  if (!u) return null;
  const showActivity = u.show_activity === undefined ? true : Boolean(u.show_activity);
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    color: u.color,
    avatarUrl: u.avatar_url,
    statusText: u.status_text,
    bio: u.bio || '',
    bannerColor: u.banner_color || '#2f7bff',
    bannerUrl: u.banner_url || null,
    frame: FRAMES.includes(u.frame) ? u.frame : 'none',
    favoriteGames: parseJson(u.favorite_games, []),
    showActivity,
    // o "jogando agora" só sai se a pessoa permitir
    activity: showActivity ? parseJson(u.activity, null) : null,
    tetrisXp: u.tetris_xp || 0,
    tetrisSkin: u.tetris_skin || 'classic',
  };
}

// o próprio usuário recebe também o e-mail e se é o dono do site (isso nunca vai para os outros)
function selfUser(u) {
  if (!u) return null;
  return { ...publicUser(u), email: u.email || null, isAdmin: require('./stats').isAdmin(u) };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return token;
}

function userFromToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > unixepoch()`
    )
    .get(token);
  return row || null;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function tokenFromReq(req) {
  return parseCookies(req.headers.cookie)[COOKIE];
}

function setSessionCookie(req, res, token) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireAuth(req, res, next) {
  const user = userFromToken(tokenFromReq(req));
  if (!user) return res.status(401).json({ error: 'Faça login para continuar.' });
  req.user = user;
  next();
}

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

module.exports = {
  hashPassword,
  verifyPassword,
  publicUser,
  selfUser,
  FRAMES,
  createSession,
  userFromToken,
  tokenFromReq,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  randomColor,
  COOKIE,
};
