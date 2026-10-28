// API REST: contas, grupos, mensagens, uploads e biblioteca de figurinhas.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { db, UPLOAD_DIR } = require('./db');
const auth = require('./auth');

const ALLOWED_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/webm': '.weba',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'text/plain': '.txt',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + (ALLOWED_MIME[file.mimetype] || '.bin')),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(ALLOWED_MIME[file.mimetype])),
});

// Limite simples de tentativas (login/cadastro) por IP — o site fica aberto na internet
const attempts = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip = req.headers['cf-connecting-ip'] || req.ip;
    const now = Date.now();
    const key = req.path + '|' + ip;
    const a = attempts.get(key);
    if (!a || now - a.start > windowMs) attempts.set(key, { start: now, n: 1 });
    else if (++a.n > max) return res.status(429).json({ error: 'Muitas tentativas. Espere um minutinho e tente de novo.' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (now - a.start > 15 * 60e3) attempts.delete(k);
}, 60e3).unref();

// TURN da Cloudflare (gratuito até 1 TB/mês): credenciais temporárias geradas pelo servidor
let cfTurn = { at: 0, servers: null };
async function cloudflareTurn() {
  const keyId = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_API_TOKEN;
  if (!keyId || !token) return [];
  if (cfTurn.servers && Date.now() - cfTurn.at < 6 * 3600e3) return cfTurn.servers;
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const list = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
    // navegadores não aceitam a porta 53, então removemos essas URLs
    cfTurn = {
      at: Date.now(),
      servers: list
        .map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
        .filter((s) => s.urls.length),
    };
    return cfTurn.servers;
  } catch (err) {
    console.warn('[turn] Cloudflare TURN indisponível:', err.message);
    return cfTurn.servers || [];
  }
}

function inviteCode() {
  return crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8).toUpperCase();
}

function isMember(groupId, userId) {
  return Boolean(db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId));
}

function groupMembers(groupId) {
  return db
    .prepare(
      `SELECT u.*, gm.role FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ? ORDER BY gm.joined_at`
    )
    .all(groupId)
    .map((u) => ({ ...auth.publicUser(u), role: u.role }));
}

function groupPayload(g) {
  const last = db.prepare('SELECT id, created_at FROM messages WHERE group_id = ? ORDER BY id DESC LIMIT 1').get(g.id);
  return {
    id: g.id,
    name: g.name,
    icon: g.icon,
    ownerId: g.owner_id,
    inviteCode: g.invite_code,
    members: groupMembers(g.id),
    lastMessageId: last ? last.id : 0,
  };
}

function messagePayload(m) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(m.user_id);
  const reactions = db.prepare('SELECT emoji, user_id FROM reactions WHERE message_id = ?').all(m.id);
  let reply = null;
  if (m.reply_to) {
    const r = db.prepare('SELECT m.id, m.type, m.content, u.display_name FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(m.reply_to);
    if (r) reply = { id: r.id, type: r.type, content: r.content, author: r.display_name };
  }
  return {
    id: m.id,
    groupId: m.group_id,
    author: auth.publicUser(user),
    type: m.type,
    content: m.content,
    mediaUrl: m.media_url,
    reply,
    reactions: reactions.map((r) => ({ emoji: r.emoji, userId: r.user_id })),
    createdAt: m.created_at,
    editedAt: m.edited_at,
  };
}

function createMessage({ groupId, userId, type = 'text', content = '', mediaUrl = null, replyTo = null }) {
  const info = db
    .prepare('INSERT INTO messages (group_id, user_id, type, content, media_url, reply_to) VALUES (?, ?, ?, ?, ?, ?)')
    .run(groupId, userId, type, content, mediaUrl, replyTo);
  return messagePayload(db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid));
}

function buildRouter(io, hub) {
  const r = express.Router();
  r.use(express.json({ limit: '1mb' }));

  // Atualiza os grupos de todos os membros online
  const notifyGroup = (groupId, extraUserIds = []) => {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    const ids = new Set(extraUserIds);
    if (g) groupMembers(groupId).forEach((m) => ids.add(m.id));
    for (const id of ids) hub.refreshUserGroups(id);
  };

  // ---------- Conta ----------
  r.post('/auth/register', rateLimit(10, 60 * 60e3), (req, res) => {
    const required = process.env.REGISTER_CODE;
    if (required && String(req.body.accessCode || '').trim() !== required)
      return res.status(403).json({ error: 'Código de acesso inválido. Peça pra quem administra o site.' });
    const username = String(req.body.username || '').trim().toLowerCase();
    const displayName = String(req.body.displayName || '').trim() || username;
    const password = String(req.body.password || '');
    if (!/^[a-z0-9_.]{3,24}$/.test(username))
      return res.status(400).json({ error: 'Usuário deve ter 3–24 caracteres (letras, números, _ ou .).' });
    if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
    if (displayName.length > 32) return res.status(400).json({ error: 'Nome muito longo (máx. 32).' });
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username))
      return res.status(409).json({ error: 'Esse usuário já existe.' });
    const info = db
      .prepare('INSERT INTO users (username, display_name, password_hash, color) VALUES (?, ?, ?, ?)')
      .run(username, displayName, auth.hashPassword(password), auth.randomColor());
    const token = auth.createSession(info.lastInsertRowid);
    auth.setSessionCookie(req, res, token);
    res.json({ user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
  });

  r.post('/auth/login', rateLimit(10, 5 * 60e3), (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash))
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    auth.setSessionCookie(req, res, auth.createSession(user.id));
    res.json({ user: auth.publicUser(user) });
  });

  r.post('/auth/logout', (req, res) => {
    const token = auth.tokenFromReq(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  r.get('/public-config', (_req, res) => res.json({ registerCodeRequired: Boolean(process.env.REGISTER_CODE) }));

  r.get('/config', async (_req, res) => {
    const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, ...(await cloudflareTurn())];
    if (process.env.TURN_URL) {
      iceServers.push({
        urls: process.env.TURN_URL.split(',').map((s) => s.trim()),
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_PASSWORD,
      });
    }
    res.json({ iceServers });
  });

  r.use(auth.requireAuth);

  r.get('/me', (req, res) => res.json({ user: auth.publicUser(req.user) }));

  r.patch('/me', (req, res) => {
    const u = req.user;
    const displayName = req.body.displayName !== undefined ? String(req.body.displayName).trim().slice(0, 32) || u.display_name : u.display_name;
    const color = /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : u.color;
    const statusText = req.body.statusText !== undefined ? String(req.body.statusText).slice(0, 80) : u.status_text;
    const avatarUrl = req.body.avatarUrl !== undefined ? (String(req.body.avatarUrl).startsWith('/uploads/') ? req.body.avatarUrl : null) : u.avatar_url;
    const bio = req.body.bio !== undefined ? String(req.body.bio).slice(0, 300) : u.bio;
    const bannerColor = /^#[0-9a-f]{6}$/i.test(req.body.bannerColor || '') ? req.body.bannerColor : u.banner_color;
    const bannerUrl = req.body.bannerUrl !== undefined ? (String(req.body.bannerUrl || '').startsWith('/uploads/') ? req.body.bannerUrl : null) : u.banner_url;
    const frame = auth.FRAMES.includes(req.body.frame) ? req.body.frame : u.frame;
    const favoriteGames = Array.isArray(req.body.favoriteGames)
      ? JSON.stringify([...new Set(req.body.favoriteGames.map((g) => String(g).trim().slice(0, 40)).filter(Boolean))].slice(0, 12))
      : u.favorite_games;
    const showActivity = req.body.showActivity !== undefined ? (req.body.showActivity ? 1 : 0) : u.show_activity;
    db.prepare(
      `UPDATE users SET display_name = ?, color = ?, status_text = ?, avatar_url = ?, bio = ?, banner_color = ?, banner_url = ?,
       frame = ?, favorite_games = ?, show_activity = ? WHERE id = ?`
    ).run(displayName, color, statusText, avatarUrl, bio, bannerColor, bannerUrl, frame, favoriteGames, showActivity, u.id);
    if (req.body.newPassword) {
      if (!auth.verifyPassword(String(req.body.currentPassword || ''), u.password_hash))
        return res.status(400).json({ error: 'Senha atual incorreta.' });
      if (String(req.body.newPassword).length < 6) return res.status(400).json({ error: 'Nova senha muito curta.' });
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(String(req.body.newPassword)), u.id);
    }
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    // Avisa todo mundo que compartilha grupo com o usuário
    const groupIds = db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(u.id);
    groupIds.forEach(({ group_id }) => notifyGroup(group_id));
    res.json({ user: auth.publicUser(fresh) });
  });

  // "Jogando agora": definido à mão, pelo agente do PC ou ao transmitir um jogo
  r.post('/me/activity', (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 60);
    const source = ['manual', 'agent', 'stream'].includes(req.body.source) ? req.body.source : 'manual';
    const current = (() => {
      try {
        return JSON.parse(req.user.activity || 'null');
      } catch {
        return null;
      }
    })();
    // o agente não apaga um status escrito à mão
    if (!name && source === 'agent' && current?.source === 'manual') return res.json({ ok: true });
    const activity = name ? JSON.stringify({ name, since: current?.name === name ? current.since : Math.floor(Date.now() / 1000), source }) : null;
    db.prepare('UPDATE users SET activity = ? WHERE id = ?').run(activity, req.user.id);
    hub.broadcastUser(req.user.id);
    res.json({ ok: true });
  });

  // ---------- Grupos ----------
  r.get('/groups', (req, res) => {
    const groups = db
      .prepare('SELECT g.* FROM groups g JOIN group_members gm ON gm.group_id = g.id WHERE gm.user_id = ? ORDER BY g.created_at')
      .all(req.user.id);
    res.json({ groups: groups.map(groupPayload) });
  });

  r.post('/groups', (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 40);
    const icon = String(req.body.icon || '🎮').slice(0, 8);
    if (!name) return res.status(400).json({ error: 'Dê um nome ao grupo.' });
    const info = db.prepare('INSERT INTO groups (name, icon, owner_id, invite_code) VALUES (?, ?, ?, ?)').run(name, icon, req.user.id, inviteCode());
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')").run(info.lastInsertRowid, req.user.id);
    notifyGroup(info.lastInsertRowid);
    res.json({ group: groupPayload(db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid)) });
  });

  r.post('/groups/join', (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    const g = db.prepare('SELECT * FROM groups WHERE invite_code = ?').get(code);
    if (!g) return res.status(404).json({ error: 'Convite inválido.' });
    if (!isMember(g.id, req.user.id)) {
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(g.id, req.user.id);
      hub.broadcastMessage(createMessage({ groupId: g.id, userId: req.user.id, type: 'system', content: 'entrou no grupo 🎉' }));
    }
    notifyGroup(g.id);
    res.json({ group: groupPayload(g) });
  });

  const loadGroup = (req, res, next) => {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
    if (!g || !isMember(g.id, req.user.id)) return res.status(404).json({ error: 'Grupo não encontrado.' });
    req.group = g;
    next();
  };

  r.patch('/groups/:id', loadGroup, (req, res) => {
    const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 40) || req.group.name : req.group.name;
    const icon = req.body.icon !== undefined ? String(req.body.icon).slice(0, 8) || req.group.icon : req.group.icon;
    db.prepare('UPDATE groups SET name = ?, icon = ? WHERE id = ?').run(name, icon, req.group.id);
    notifyGroup(req.group.id);
    res.json({ ok: true });
  });

  r.post('/groups/:id/members', loadGroup, (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!isMember(req.group.id, u.id)) {
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(req.group.id, u.id);
      hub.broadcastMessage(createMessage({ groupId: req.group.id, userId: u.id, type: 'system', content: `foi adicionado(a) por ${req.user.display_name}` }));
    }
    notifyGroup(req.group.id);
    res.json({ ok: true });
  });

  r.delete('/groups/:id/members/me', loadGroup, (req, res) => {
    const g = req.group;
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(g.id, req.user.id);
    const remaining = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at').all(g.id);
    if (!remaining.length) {
      db.prepare('DELETE FROM groups WHERE id = ?').run(g.id);
    } else {
      if (g.owner_id === req.user.id) {
        db.prepare('UPDATE groups SET owner_id = ? WHERE id = ?').run(remaining[0].user_id, g.id);
        db.prepare("UPDATE group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?").run(g.id, remaining[0].user_id);
      }
      hub.broadcastMessage(createMessage({ groupId: g.id, userId: req.user.id, type: 'system', content: 'saiu do grupo 👋' }));
    }
    hub.leaveGroupRoom(req.user.id, g.id);
    notifyGroup(g.id, [req.user.id]);
    res.json({ ok: true });
  });

  r.post('/groups/:id/invite/reset', loadGroup, (req, res) => {
    db.prepare('UPDATE groups SET invite_code = ? WHERE id = ?').run(inviteCode(), req.group.id);
    notifyGroup(req.group.id);
    res.json({ ok: true });
  });

  r.get('/groups/:id/messages', loadGroup, (req, res) => {
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = db
      .prepare('SELECT * FROM messages WHERE group_id = ? AND id < ? ORDER BY id DESC LIMIT 60')
      .all(req.group.id, before);
    res.json({ messages: rows.reverse().map(messagePayload), hasMore: rows.length === 60 });
  });

  // ---------- Uploads ----------
  r.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Arquivo inválido ou formato não suportado.' });
    const url = '/uploads/' + req.file.filename;
    const purpose = String(req.body.purpose || 'file');
    let sticker = null;
    if (purpose === 'sticker' || purpose === 'gif' || purpose === 'sound') {
      const info = db
        .prepare('INSERT INTO stickers (owner_id, kind, url, name) VALUES (?, ?, ?, ?)')
        .run(req.user.id, purpose, url, String(req.body.name || '').slice(0, 40));
      sticker = { id: Number(info.lastInsertRowid), kind: purpose, url, name: String(req.body.name || '') };
    }
    res.json({ url, name: req.file.originalname, size: req.file.size, mime: req.file.mimetype, sticker });
  });

  // ---------- Figurinhas / GIFs (biblioteca pessoal) ----------
  r.get('/stickers', (req, res) => {
    const rows = db.prepare('SELECT id, kind, url, name FROM stickers WHERE owner_id = ? ORDER BY id DESC').all(req.user.id);
    res.json({ stickers: rows });
  });

  r.post('/stickers', (req, res) => {
    const url = String(req.body.url || '');
    const kind = req.body.kind === 'gif' ? 'gif' : 'sticker';
    if (!url.startsWith('/uploads/')) return res.status(400).json({ error: 'URL inválida.' });
    db.prepare('INSERT OR IGNORE INTO stickers (owner_id, kind, url, name) VALUES (?, ?, ?, ?)').run(req.user.id, kind, url, String(req.body.name || ''));
    res.json({ ok: true });
  });

  r.delete('/stickers/:id', (req, res) => {
    db.prepare('DELETE FROM stickers WHERE id = ? AND owner_id = ?').run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  return r;
}

module.exports = { buildRouter, isMember, createMessage, messagePayload, groupPayload, groupMembers, UPLOAD_DIR: path.resolve(UPLOAD_DIR) };
