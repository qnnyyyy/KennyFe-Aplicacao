// Estatísticas do site (só o dono vê): tempo de uso, funções mais usadas, cadastros.
const { db } = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_daily (
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day            TEXT NOT NULL, -- AAAA-MM-DD (horário de Brasília)
    online_seconds INTEGER NOT NULL DEFAULT 0,
    call_seconds   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );
  CREATE TABLE IF NOT EXISTS feature_usage (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    last_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, feature)
  );
  CREATE TABLE IF NOT EXISTS feature_daily (
    day     TEXT NOT NULL,
    feature TEXT NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, feature)
  );
`);

const FEATURES = {
  login: 'Entrou no site (login)',
  message: 'Mensagens de texto',
  dm_message: 'Mensagens no privado',
  sticker: 'Figurinhas enviadas',
  gif: 'GIFs enviados',
  media: 'Fotos / vídeos / arquivos',
  reaction: 'Reações em mensagens',
  call: 'Entrou em call',
  screen_share: 'Compartilhou a tela',
  camera: 'Ligou a câmera',
  coop_host: 'Modo Coop (hospedou)',
  coop_guest: 'Modo Coop (pediu controle)',
  soundboard: 'Tocou som do soundboard',
  clip: 'Gravou clipe da call',
  cinema: 'Modo cinema',
  sticker_create: 'Criou figurinha',
  gif_create: 'Criou GIF',
  sound_create: 'Adicionou som',
  game_tetris: 'Abriu Tetris Royale',
  game_tictactoe: 'Abriu Jogo da velha',
  game_connect4: 'Abriu Lig 4',
  game_draw: 'Abriu Desenha & Adivinha',
  game_reaction: 'Abriu Reflexo',
  game_join: 'Entrou numa partida',
  tetris_round: 'Rodadas de Tetris',
  friend_add: 'Pedidos de amizade',
  dm_open: 'Abriu conversa privada',
  group_create: 'Criou grupo',
  group_join: 'Entrou em grupo por convite',
  profile_edit: 'Editou o perfil',
  coop_download: 'Baixou o Kenfeh Coop',
  command: 'Usou comandos com /',
  music_play: 'Pediu música (KenBeat)',
  music_skip: 'Pulou música',
  poll_create: 'Criou enquete',
  poll_vote: 'Votou em enquete',
};
// o que o navegador pode registrar sozinho (o resto o servidor já conta)
const CLIENT_FEATURES = new Set(['soundboard', 'clip', 'cinema', 'coop_guest']);

// dia no horário de Brasília (o servidor pode estar em outro fuso)
const dayOf = (ms = Date.now()) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 10);

const stmtFeature = db.prepare(
  `INSERT INTO feature_usage (user_id, feature, count, last_at) VALUES (?, ?, ?, unixepoch())
   ON CONFLICT (user_id, feature) DO UPDATE SET count = count + excluded.count, last_at = excluded.last_at`
);
const stmtFeatureDay = db.prepare(
  `INSERT INTO feature_daily (day, feature, count) VALUES (?, ?, ?)
   ON CONFLICT (day, feature) DO UPDATE SET count = count + excluded.count`
);
function track(userId, feature, n = 1) {
  if (!userId || !FEATURES[feature]) return;
  try {
    stmtFeature.run(userId, feature, n);
    stmtFeatureDay.run(dayOf(), feature, n);
  } catch {}
}

const stmtUsage = db.prepare(
  `INSERT INTO usage_daily (user_id, day, online_seconds, call_seconds) VALUES (?, ?, ?, ?)
   ON CONFLICT (user_id, day) DO UPDATE SET online_seconds = online_seconds + excluded.online_seconds, call_seconds = call_seconds + excluded.call_seconds`
);
const stmtSeen = db.prepare('UPDATE users SET last_seen = unixepoch() WHERE id = ?');

// Tempo de uso: conta enquanto o site estiver aberto (socket conectado) e, à parte, o tempo em call.
function attachUsage(hub) {
  const since = new Map(); // userId -> ms da última contagem
  const inCall = (userId) => [...(hub.online.get(userId) || [])].some((s) => s.data.callGroup);
  const flush = (userId) => {
    const t = since.get(userId);
    if (!t) return;
    const now = Date.now();
    const secs = Math.min(120, Math.round((now - t) / 1000));
    since.set(userId, now);
    if (secs <= 0) return;
    try {
      stmtUsage.run(userId, dayOf(now), secs, inCall(userId) ? secs : 0);
      stmtSeen.run(userId);
    } catch {}
  };
  setInterval(() => {
    for (const userId of hub.online.keys()) flush(userId);
  }, 30e3).unref();
  return {
    connected(userId) {
      if (!since.has(userId)) since.set(userId, Date.now());
      stmtSeen.run(userId);
    },
    // chamado antes de entrar/sair de call para o tempo cair no lugar certo
    flush,
    disconnected(userId) {
      flush(userId);
      since.delete(userId);
    },
  };
}

// ---------------- dono do site ----------------
const list = (v, def) => String(v || def).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ADMIN_USERNAMES = list(process.env.ADMIN_USERNAMES, 'kenny_maciel');
const ADMIN_EMAILS = list(process.env.ADMIN_EMAILS, 'kennymaciel6@gmail.com');
const isAdmin = (u) => Boolean(u && ADMIN_USERNAMES.includes(String(u.username).toLowerCase()));
// o e-mail do dono não pode ser usado por outra conta
const emailReserved = (email, username) => ADMIN_EMAILS.includes(email) && !ADMIN_USERNAMES.includes(String(username).toLowerCase());

// a conta do dono já existente recebe o e-mail dela
try {
  for (const name of ADMIN_USERNAMES) {
    const email = ADMIN_EMAILS[ADMIN_USERNAMES.indexOf(name)] || ADMIN_EMAILS[0];
    if (email) db.prepare("UPDATE users SET email = ? WHERE username = ? AND (email IS NULL OR email = '') AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?)").run(email, name, email);
  }
} catch {}

function adminStats(online) {
  const now = Math.floor(Date.now() / 1000);
  const today = dayOf();
  const days = [];
  for (let i = 29; i >= 0; i--) days.push(dayOf(Date.now() - i * 86400e3));
  const first = days[0];

  const users = db.prepare('SELECT id, username, display_name, email, color, avatar_url, created_at, last_seen, tetris_xp FROM users ORDER BY created_at DESC').all();
  const usage = new Map(db.prepare('SELECT user_id, SUM(online_seconds) o, SUM(call_seconds) c, COUNT(*) d FROM usage_daily GROUP BY user_id').all().map((r) => [r.user_id, r]));
  const usage7 = new Map(db.prepare('SELECT user_id, SUM(online_seconds) o FROM usage_daily WHERE day >= ? GROUP BY user_id').all(days[23]).map((r) => [r.user_id, r.o]));
  const msgs = new Map(db.prepare("SELECT user_id, COUNT(*) n FROM messages WHERE type != 'system' GROUP BY user_id").all().map((r) => [r.user_id, r.n]));
  const groupsOf = new Map(db.prepare('SELECT gm.user_id, COUNT(*) n FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE g.is_dm = 0 GROUP BY gm.user_id').all().map((r) => [r.user_id, r.n]));
  const friendsOf = new Map();
  for (const r of db.prepare("SELECT user_id, friend_id FROM friendships WHERE status = 'accepted'").all()) {
    friendsOf.set(r.user_id, (friendsOf.get(r.user_id) || 0) + 1);
    friendsOf.set(r.friend_id, (friendsOf.get(r.friend_id) || 0) + 1);
  }
  const feats = new Map();
  for (const r of db.prepare('SELECT user_id, feature, count FROM feature_usage WHERE feature != ? ORDER BY count DESC').all('login')) {
    if (!feats.has(r.user_id)) feats.set(r.user_id, []);
    feats.get(r.user_id).push({ feature: r.feature, label: FEATURES[r.feature] || r.feature, count: r.count });
  }

  const daily = new Map(days.map((d) => [d, { day: d, active: 0, signups: 0, onlineSeconds: 0, callSeconds: 0 }]));
  for (const r of db.prepare('SELECT day, COUNT(*) a, SUM(online_seconds) o, SUM(call_seconds) c FROM usage_daily WHERE day >= ? GROUP BY day').all(first)) {
    const d = daily.get(r.day);
    if (d) Object.assign(d, { active: r.a, onlineSeconds: r.o, callSeconds: r.c });
  }
  for (const u of users) {
    const d = daily.get(dayOf(u.created_at * 1000));
    if (d) d.signups++;
  }

  const features = db
    .prepare('SELECT feature, SUM(count) count, COUNT(*) users FROM feature_usage WHERE feature != ? GROUP BY feature ORDER BY count DESC')
    .all('login')
    .map((r) => ({ ...r, label: FEATURES[r.feature] || r.feature }));

  const count = (sql, ...a) => db.prepare(sql).get(...a)?.n || 0;
  const totalOnline = db.prepare('SELECT SUM(online_seconds) o, SUM(call_seconds) c FROM usage_daily').get();
  const activeSince = (d) => count('SELECT COUNT(DISTINCT user_id) n FROM usage_daily WHERE day >= ?', d);

  return {
    generatedAt: now,
    totals: {
      users: users.length,
      onlineNow: online.size,
      activeToday: activeSince(today),
      active7d: activeSince(days[23]),
      active30d: activeSince(first),
      new7d: users.filter((u) => u.created_at >= now - 7 * 86400).length,
      onlineSeconds: totalOnline?.o || 0,
      callSeconds: totalOnline?.c || 0,
      messages: count("SELECT COUNT(*) n FROM messages WHERE type != 'system'"),
      groups: count('SELECT COUNT(*) n FROM groups WHERE is_dm = 0'),
      dms: count('SELECT COUNT(*) n FROM groups WHERE is_dm = 1'),
      friendships: count("SELECT COUNT(*) n FROM friendships WHERE status = 'accepted'"),
      stickers: count('SELECT COUNT(*) n FROM stickers'),
      withEmail: users.filter((u) => u.email).length,
    },
    daily: [...daily.values()],
    features,
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      email: u.email || null,
      color: u.color,
      avatarUrl: u.avatar_url,
      createdAt: u.created_at,
      lastSeen: online.has(u.id) ? now : u.last_seen || null,
      online: online.has(u.id),
      onlineSeconds: usage.get(u.id)?.o || 0,
      onlineSeconds7d: usage7.get(u.id) || 0,
      callSeconds: usage.get(u.id)?.c || 0,
      daysActive: usage.get(u.id)?.d || 0,
      messages: msgs.get(u.id) || 0,
      groups: groupsOf.get(u.id) || 0,
      friends: friendsOf.get(u.id) || 0,
      tetrisXp: u.tetris_xp || 0,
      features: feats.get(u.id) || [],
    })),
  };
}

module.exports = { track, attachUsage, isAdmin, emailReserved, adminStats, CLIENT_FEATURES, FEATURES };
