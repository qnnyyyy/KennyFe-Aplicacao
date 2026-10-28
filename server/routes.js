// API REST: contas, grupos, mensagens, uploads e biblioteca de figurinhas.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { db, UPLOAD_DIR } = require('./db');
const auth = require('./auth');
const stats = require('./stats');
const guild = require('./guild');

// e-mail: minúsculo, formato simples, sem repetir conta
function checkEmail(raw, username, exceptUserId = 0) {
  const email = String(raw || '').trim().toLowerCase();
  if (!email) return { error: 'Coloque seu e-mail.' };
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'E-mail inválido.' };
  if (stats.emailReserved(email, username) || db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id != ?').get(email, exceptUserId))
    return { error: 'Esse e-mail já está em uso por outra conta.' };
  return { email };
}

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

// viewerId: quem vai receber (os canais e permissões dependem da pessoa)
function groupPayload(g, viewerId) {
  const gp = guild.guildPayload(g, viewerId);
  const canInvite = gp.myPerms.includes('invite') || gp.myPerms.includes('manage_group');
  return {
    id: g.id,
    name: g.name,
    icon: g.icon,
    ownerId: g.owner_id,
    inviteCode: canInvite ? g.invite_code : null,
    isDm: Boolean(g.is_dm),
    members: groupMembers(g.id),
    lastMessageId: Math.max(0, ...gp.channels.map((c) => c.lastMessageId)),
    ...gp,
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
    channelId: m.channel_id,
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

// sem canal = vai para o primeiro canal de texto do grupo
function createMessage({ groupId, channelId = null, userId, type = 'text', content = '', mediaUrl = null, replyTo = null }) {
  if (!channelId) channelId = guild.defaultText(groupId)?.id || null;
  const info = db
    .prepare('INSERT INTO messages (group_id, channel_id, user_id, type, content, media_url, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(groupId, channelId, userId, type, content, mediaUrl, replyTo);
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
    const em = checkEmail(req.body.email, username);
    if (em.error) return res.status(400).json({ error: em.error });
    const info = db
      .prepare('INSERT INTO users (username, display_name, password_hash, color, email) VALUES (?, ?, ?, ?, ?)')
      .run(username, displayName, auth.hashPassword(password), auth.randomColor(), em.email);
    const token = auth.createSession(info.lastInsertRowid);
    auth.setSessionCookie(req, res, token);
    res.json({ user: auth.selfUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
  });

  r.post('/auth/login', rateLimit(10, 5 * 60e3), (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash))
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    auth.setSessionCookie(req, res, auth.createSession(user.id));
    stats.track(user.id, 'login');
    res.json({ user: auth.selfUser(user) });
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

  r.get('/me', (req, res) => res.json({ user: auth.selfUser(req.user) }));

  // painel do dono do site
  r.get('/admin/stats', (req, res) => {
    if (!stats.isAdmin(req.user)) return res.status(404).json({ error: 'Não encontrado.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(stats.adminStats(hub.online));
  });

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
    const { TETRIS_SKINS } = require('./tetris-skins');
    const skin = TETRIS_SKINS.find((k) => k.id === req.body.tetrisSkin && (u.tetris_xp || 0) >= k.xp);
    if (skin) db.prepare('UPDATE users SET tetris_skin = ? WHERE id = ?').run(skin.id, u.id);
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
    if (req.body.email !== undefined && String(req.body.email || '').trim().toLowerCase() !== (u.email || '')) {
      const em = checkEmail(req.body.email, u.username, u.id);
      if (em.error) return res.status(400).json({ error: em.error });
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(em.email, u.id);
    }
    stats.track(u.id, 'profile_edit');
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    // Avisa todo mundo que compartilha grupo com o usuário
    const groupIds = db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(u.id);
    groupIds.forEach(({ group_id }) => notifyGroup(group_id));
    res.json({ user: auth.selfUser(fresh) });
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

  // ---------- Amigos ----------
  const friendRow = (a, b) => db.prepare('SELECT * FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').get(a, b, b, a);

  r.get('/friends', (req, res) => {
    const me = req.user.id;
    const rows = db.prepare('SELECT * FROM friendships WHERE user_id = ? OR friend_id = ?').all(me, me);
    const friends = rows.map((f) => {
      const otherId = f.user_id === me ? f.friend_id : f.user_id;
      const status = f.status === 'accepted' ? 'accepted' : f.user_id === me ? 'outgoing' : 'incoming';
      return { user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(otherId)), status, since: f.created_at };
    }).filter((f) => f.user);
    res.json({ friends });
  });

  r.post('/friends', (req, res) => {
    const username = String(req.body.username || '').trim().replace(/^@/, '').toLowerCase();
    const other = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!other) return res.status(404).json({ error: 'Não achei ninguém com esse usuário. Confira o @ (sem espaços).' });
    if (other.id === req.user.id) return res.status(400).json({ error: 'Esse é você 😄' });
    const f = friendRow(req.user.id, other.id);
    if (f?.status === 'accepted') return res.status(409).json({ error: 'Vocês já são amigos!' });
    if (f && f.user_id === req.user.id) return res.status(409).json({ error: 'Pedido já enviado — esperando a pessoa aceitar.' });
    if (f) {
      // a outra pessoa já tinha pedido: aceita direto
      db.prepare("UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ?").run(other.id, req.user.id);
      hub.friendsChanged([req.user.id, other.id], { type: 'accepted', by: req.user.id });
      return res.json({ ok: true, accepted: true });
    }
    db.prepare('INSERT INTO friendships (user_id, friend_id) VALUES (?, ?)').run(req.user.id, other.id);
    stats.track(req.user.id, 'friend_add');
    hub.friendsChanged([req.user.id, other.id], { type: 'request', by: req.user.id });
    res.json({ ok: true });
  });

  r.post('/friends/:id/accept', (req, res) => {
    const id = Number(req.params.id);
    const info = db.prepare("UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ? AND status = 'pending'").run(id, req.user.id);
    if (!info.changes) return res.status(404).json({ error: 'Pedido não encontrado.' });
    hub.friendsChanged([req.user.id, id], { type: 'accepted', by: req.user.id });
    res.json({ ok: true });
  });

  r.delete('/friends/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(req.user.id, id, id, req.user.id);
    hub.friendsChanged([req.user.id, id], { type: 'removed', by: req.user.id });
    res.json({ ok: true });
  });

  // Conversa direta (DM): reaproveita se já existir
  r.post('/dm/:userId', (req, res) => {
    const other = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.userId));
    if (!other || other.id === req.user.id) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const shareGroup = db.prepare('SELECT 1 FROM group_members a JOIN group_members b ON a.group_id = b.group_id WHERE a.user_id = ? AND b.user_id = ?').get(req.user.id, other.id);
    if (friendRow(req.user.id, other.id)?.status !== 'accepted' && !shareGroup) return res.status(403).json({ error: 'Adicione como amigo primeiro.' });
    let g = db.prepare(
      `SELECT g.* FROM groups g WHERE g.is_dm = 1
         AND EXISTS (SELECT 1 FROM group_members WHERE group_id = g.id AND user_id = ?)
         AND EXISTS (SELECT 1 FROM group_members WHERE group_id = g.id AND user_id = ?)`
    ).get(req.user.id, other.id);
    if (!g) {
      const info = db.prepare("INSERT INTO groups (name, icon, owner_id, invite_code, is_dm) VALUES ('', '💬', ?, ?, 1)").run(req.user.id, inviteCode());
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?), (?, ?)').run(info.lastInsertRowid, req.user.id, info.lastInsertRowid, other.id);
      g = db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid);
      guild.ensureChannels(g.id);
    }
    stats.track(req.user.id, 'dm_open');
    notifyGroup(g.id);
    res.json({ group: groupPayload(g, req.user.id) });
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
    stats.track(req.user.id, 'group_create');
    guild.ensureChannels(info.lastInsertRowid);
    notifyGroup(info.lastInsertRowid);
    res.json({ group: groupPayload(db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid), req.user.id) });
  });

  r.post('/groups/join', (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    const g = db.prepare('SELECT * FROM groups WHERE invite_code = ?').get(code);
    if (!g || g.is_dm) return res.status(404).json({ error: 'Convite inválido.' });
    if (!isMember(g.id, req.user.id)) {
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(g.id, req.user.id);
      hub.broadcastMessage(createMessage({ groupId: g.id, userId: req.user.id, type: 'system', content: 'entrou no grupo 🎉' }));
      stats.track(req.user.id, 'group_join');
    }
    notifyGroup(g.id);
    res.json({ group: groupPayload(g, req.user.id) });
  });

  const loadGroup = (req, res, next) => {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
    if (!g || !isMember(g.id, req.user.id)) return res.status(404).json({ error: 'Grupo não encontrado.' });
    req.group = g;
    next();
  };

  const need = (perm) => (req, res, next) => (guild.can(req.group.id, req.user.id, perm) ? next() : res.status(403).json({ error: 'Sua classe não tem permissão para isso.' }));

  r.patch('/groups/:id', loadGroup, need('manage_group'), (req, res) => {
    const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 40) || req.group.name : req.group.name;
    const icon = req.body.icon !== undefined ? String(req.body.icon).slice(0, 8) || req.group.icon : req.group.icon;
    db.prepare('UPDATE groups SET name = ?, icon = ? WHERE id = ?').run(name, icon, req.group.id);
    notifyGroup(req.group.id);
    res.json({ ok: true });
  });

  r.post('/groups/:id/members', loadGroup, need('invite'), (req, res) => {
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

  r.post('/groups/:id/invite/reset', loadGroup, need('manage_group'), (req, res) => {
    db.prepare('UPDATE groups SET invite_code = ? WHERE id = ?').run(inviteCode(), req.group.id);
    notifyGroup(req.group.id);
    res.json({ ok: true });
  });

  r.get('/groups/:id/messages', loadGroup, (req, res) => {
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const ch = req.query.channel ? guild.getChannel(req.query.channel) : guild.defaultText(req.group.id);
    if (!ch || ch.group_id !== req.group.id || !guild.access(ch, req.user.id).see) return res.status(404).json({ error: 'Canal não encontrado.' });
    const rows = db
      .prepare('SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT 60')
      .all(ch.id, before);
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
      stats.track(req.user.id, `${purpose}_create`);
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

  guildRoutes(r, { hub, loadGroup, need, notifyGroup });
  return r;
}

// ---------- Canais, classes e moderação ----------
function guildRoutes(r, { hub, loadGroup, need, notifyGroup }) {
  const EMOJI_MAX = 8;
  const chFields = (b, old = {}) => {
    const name = b.name !== undefined ? String(b.name).trim().slice(0, 32) : old.name;
    return {
      name: (old.kind || b.kind) === 'text' ? String(name || '').toLowerCase().replace(/\s+/g, '-') || 'canal' : name || 'Canal',
      emoji: b.emoji !== undefined ? String(b.emoji).slice(0, EMOJI_MAX) : old.emoji || '',
      topic: b.topic !== undefined ? String(b.topic).slice(0, 160) : old.topic || '',
      locked: b.locked !== undefined ? (b.locked ? 1 : 0) : old.locked || 0,
      hidden: b.hidden !== undefined ? (b.hidden ? 1 : 0) : old.hidden || 0,
      userLimit: b.userLimit !== undefined ? Math.max(0, Math.min(99, Number(b.userLimit) || 0)) : old.user_limit || 0,
      allowRoles: Array.isArray(b.allowRoles) ? b.allowRoles.map(Number).filter((id) => guild.getRole(id)?.group_id === (old.group_id || b.groupId)) : guild.parse(old.allow_roles, []),
    };
  };
  const loadChannel = (req, res, next) => {
    const ch = guild.getChannel(req.params.cid);
    if (!ch || !isMember(ch.group_id, req.user.id) || !guild.access(ch, req.user.id).see) return res.status(404).json({ error: 'Canal não encontrado.' });
    if (!guild.can(ch.group_id, req.user.id, 'manage_channels')) return res.status(403).json({ error: 'Sua classe não pode mexer nos canais.' });
    req.channel = ch;
    next();
  };

  r.post('/groups/:id/channels', loadGroup, need('manage_channels'), (req, res) => {
    const kind = req.body.kind === 'voice' ? 'voice' : 'text';
    if (guild.channelsOf(req.group.id).length >= 60) return res.status(400).json({ error: 'Limite de 60 canais.' });
    const f = chFields({ ...req.body, kind, groupId: req.group.id });
    const ch = guild.createChannel(req.group.id, { kind, ...f });
    notifyGroup(req.group.id);
    res.json({ channel: guild.channelPayload(ch, req.user.id) });
  });

  r.patch('/channels/:cid', loadChannel, (req, res) => {
    const f = chFields(req.body, req.channel);
    db.prepare('UPDATE channels SET name = ?, emoji = ?, topic = ?, locked = ?, hidden = ?, user_limit = ?, allow_roles = ? WHERE id = ?')
      .run(f.name, f.emoji, f.topic, f.locked, f.hidden, f.userLimit, JSON.stringify(f.allowRoles), req.channel.id);
    notifyGroup(req.channel.group_id);
    hub.recheckChannel?.(req.channel.id);
    res.json({ ok: true });
  });

  r.post('/channels/:cid/move', loadChannel, (req, res) => {
    const ch = req.channel;
    const list = guild.channelsOf(ch.group_id).filter((c) => c.kind === ch.kind);
    const i = list.findIndex((c) => c.id === ch.id);
    const j = i + (Number(req.body.dir) < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return res.json({ ok: true });
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((c, k) => db.prepare('UPDATE channels SET position = ? WHERE id = ?').run(k, c.id));
    notifyGroup(ch.group_id);
    res.json({ ok: true });
  });

  r.delete('/channels/:cid', loadChannel, (req, res) => {
    const ch = req.channel;
    if (guild.channelsOf(ch.group_id).filter((c) => c.kind === ch.kind).length <= 1)
      return res.status(400).json({ error: `O grupo precisa de pelo menos um canal de ${ch.kind === 'voice' ? 'voz' : 'texto'}.` });
    hub.closeChannel?.(ch.id);
    db.prepare('DELETE FROM messages WHERE channel_id = ?').run(ch.id);
    db.prepare('DELETE FROM channels WHERE id = ?').run(ch.id);
    notifyGroup(ch.group_id);
    res.json({ ok: true });
  });

  // ----- classes -----
  const roleFields = (b, old = {}) => ({
    name: b.name !== undefined ? String(b.name).trim().slice(0, 32) || 'classe' : old.name,
    color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : old.color || '#9aa4c3',
    perms: b.perms !== undefined ? guild.cleanPerms(b.perms) : guild.parse(old.perms, []),
    hoist: b.hoist !== undefined ? (b.hoist ? 1 : 0) : old.hoist ?? 1,
    icon: b.icon !== undefined ? String(b.icon).slice(0, 8) : old.icon || '',
  });
  // só mexe em classes abaixo da sua (o dono mexe em todas) e não dá poderes que não tem
  const checkRole = (req, res, role, perms) => {
    const gid = req.group?.id || role.group_id;
    if (role && role.position >= guild.topPosition(gid, req.user.id)) return res.status(403).json({ error: 'Essa classe está acima (ou no nível) da sua.' }), false;
    const mine = guild.permsOf(gid, req.user.id);
    if (perms && perms.some((p) => !mine.has(p))) return res.status(403).json({ error: 'Você não pode dar uma permissão que não tem.' }), false;
    return true;
  };
  const loadRole = (req, res, next) => {
    const role = guild.getRole(req.params.rid);
    if (!role || !isMember(role.group_id, req.user.id)) return res.status(404).json({ error: 'Classe não encontrada.' });
    if (!guild.can(role.group_id, req.user.id, 'manage_roles')) return res.status(403).json({ error: 'Sua classe não pode gerenciar classes.' });
    req.role = role;
    req.group = db.prepare('SELECT * FROM groups WHERE id = ?').get(role.group_id);
    next();
  };

  r.post('/groups/:id/roles', loadGroup, need('manage_roles'), (req, res) => {
    if (req.group.is_dm) return res.status(400).json({ error: 'Conversa direta não tem classes.' });
    const f = roleFields(req.body);
    if (!checkRole(req, res, null, f.perms)) return;
    if (guild.rolesOf(req.group.id).length >= 40) return res.status(400).json({ error: 'Limite de 40 classes.' });
    // nasce logo abaixo da classe mais alta de quem criou
    const top = guild.topPosition(req.group.id, req.user.id);
    const pos = Number.isFinite(top) ? Math.max(0, top) : (db.prepare('SELECT MAX(position) p FROM roles WHERE group_id = ?').get(req.group.id)?.p ?? -1) + 1;
    if (Number.isFinite(top)) db.prepare('UPDATE roles SET position = position + 1 WHERE group_id = ? AND position >= ?').run(req.group.id, pos);
    const info = db.prepare('INSERT INTO roles (group_id, name, color, position, perms, hoist, icon) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(req.group.id, f.name, f.color, pos, JSON.stringify(f.perms), f.hoist, f.icon);
    notifyGroup(req.group.id);
    res.json({ role: guild.rolePayload(guild.getRole(info.lastInsertRowid)) });
  });

  r.patch('/roles/:rid', loadRole, (req, res) => {
    const f = roleFields(req.body, req.role);
    const newPerms = f.perms.filter((p) => !guild.parse(req.role.perms, []).includes(p));
    if (!checkRole(req, res, req.role, newPerms)) return;
    db.prepare('UPDATE roles SET name = ?, color = ?, perms = ?, hoist = ?, icon = ? WHERE id = ?').run(f.name, f.color, JSON.stringify(f.perms), f.hoist, f.icon, req.role.id);
    notifyGroup(req.role.group_id);
    hub.recheckGroup?.(req.role.group_id);
    res.json({ ok: true });
  });

  r.post('/roles/:rid/move', loadRole, (req, res) => {
    const list = guild.rolesOf(req.role.group_id); // do mais alto para o mais baixo
    const i = list.findIndex((x) => x.id === req.role.id);
    const j = i + (Number(req.body.dir) < 0 ? -1 : 1); // -1 = subir
    if (j < 0 || j >= list.length) return res.json({ ok: true });
    if (!checkRole(req, res, req.role) || !checkRole(req, res, list[j])) return;
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((x, k) => db.prepare('UPDATE roles SET position = ? WHERE id = ?').run(list.length - 1 - k, x.id));
    notifyGroup(req.role.group_id);
    res.json({ ok: true });
  });

  r.delete('/roles/:rid', loadRole, (req, res) => {
    if (!checkRole(req, res, req.role)) return;
    db.prepare('DELETE FROM roles WHERE id = ?').run(req.role.id);
    notifyGroup(req.role.group_id);
    hub.recheckGroup?.(req.role.group_id);
    res.json({ ok: true });
  });

  r.patch('/groups/:id/everyone', loadGroup, need('manage_roles'), (req, res) => {
    const perms = guild.cleanPerms(req.body.perms).filter((p) => p !== 'admin');
    db.prepare('UPDATE groups SET everyone_perms = ? WHERE id = ?').run(JSON.stringify(perms), req.group.id);
    notifyGroup(req.group.id);
    hub.recheckGroup?.(req.group.id);
    res.json({ ok: true });
  });

  // dar/tirar classes de alguém
  r.put('/groups/:id/members/:uid/roles', loadGroup, need('manage_roles'), (req, res) => {
    const uid = Number(req.params.uid);
    if (!isMember(req.group.id, uid)) return res.status(404).json({ error: 'Pessoa não está no grupo.' });
    const top = guild.topPosition(req.group.id, req.user.id);
    if (uid !== req.user.id && guild.topPosition(req.group.id, uid) >= top) return res.status(403).json({ error: 'Essa pessoa está no seu nível ou acima.' });
    const want = new Set((req.body.roleIds || []).map(Number));
    const current = new Set(guild.memberRoleIds(req.group.id, uid));
    for (const role of guild.rolesOf(req.group.id)) {
      const has = current.has(role.id), wants = want.has(role.id);
      if (has === wants) continue;
      if (role.position >= top) return res.status(403).json({ error: `A classe "${role.name}" está acima da sua.` });
      if (wants) db.prepare('INSERT OR IGNORE INTO member_roles (group_id, user_id, role_id) VALUES (?, ?, ?)').run(req.group.id, uid, role.id);
      else db.prepare('DELETE FROM member_roles WHERE user_id = ? AND role_id = ?').run(uid, role.id);
    }
    notifyGroup(req.group.id);
    hub.recheckGroup?.(req.group.id);
    res.json({ ok: true });
  });

  r.delete('/groups/:id/members/:uid', loadGroup, need('kick'), (req, res) => {
    const uid = Number(req.params.uid);
    if (uid === req.group.owner_id || uid === req.user.id) return res.status(400).json({ error: 'Não dá para expulsar essa pessoa.' });
    if (guild.topPosition(req.group.id, uid) >= guild.topPosition(req.group.id, req.user.id)) return res.status(403).json({ error: 'Essa pessoa está no seu nível ou acima.' });
    const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(uid);
    db.prepare('DELETE FROM member_roles WHERE group_id = ? AND user_id = ?').run(req.group.id, uid);
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.group.id, uid);
    hub.broadcastMessage(createMessage({ groupId: req.group.id, userId: req.user.id, type: 'system', content: `expulsou ${u?.display_name || 'alguém'} do grupo` }));
    hub.leaveGroupRoom(uid, req.group.id);
    notifyGroup(req.group.id, [uid]);
    res.json({ ok: true });
  });

  r.get('/perms', (_req, res) => res.json({ perms: guild.PERMS.map(([id, name, desc]) => ({ id, name, desc })), everyoneDefault: guild.DEFAULT_EVERYONE }));
}

module.exports = { buildRouter, isMember, createMessage, messagePayload, groupPayload, groupMembers, UPLOAD_DIR: path.resolve(UPLOAD_DIR) };
