// Canais (texto e voz), classes (cargos com cor e permissões) e quem pode o quê em cada grupo.
const { db } = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'text', -- text | voice
    name        TEXT NOT NULL,
    emoji       TEXT NOT NULL DEFAULT '',
    topic       TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    locked      INTEGER NOT NULL DEFAULT 0, -- voz: trancada | texto: só leitura
    hidden      INTEGER NOT NULL DEFAULT 0, -- invisível para quem não tem acesso
    user_limit  INTEGER NOT NULL DEFAULT 0,
    allow_roles TEXT NOT NULL DEFAULT '[]', -- classes que sempre entram/veem
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(group_id, position);
  CREATE TABLE IF NOT EXISTS roles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#9aa4c3',
    position   INTEGER NOT NULL DEFAULT 0, -- maior = mais importante
    perms      TEXT NOT NULL DEFAULT '[]',
    hoist      INTEGER NOT NULL DEFAULT 1, -- aparece separado na lista de membros
    icon       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS member_roles (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id  INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  );
`);
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!cols('messages').includes('channel_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id)');
if (!cols('groups').includes('everyone_perms')) db.exec("ALTER TABLE groups ADD COLUMN everyone_perms TEXT");

// ---------------- permissões ----------------
const PERMS = [
  ['admin', 'Administrador', 'Pode tudo (cuidado!)'],
  ['manage_group', 'Editar o grupo', 'Nome, ícone e código de convite'],
  ['manage_channels', 'Gerenciar canais', 'Criar, editar, trancar, esconder e apagar canais'],
  ['manage_roles', 'Gerenciar classes', 'Criar classes e dar/tirar classes das pessoas (só abaixo da própria)'],
  ['kick', 'Expulsar membros', 'Tirar pessoas do grupo'],
  ['manage_messages', 'Apagar mensagens', 'Apagar mensagens dos outros e usar /limpar'],
  ['join_locked', 'Entrar em calls trancadas', 'Entra em canal de voz trancado ou lotado'],
  ['see_hidden', 'Ver canais invisíveis', 'Enxerga canais escondidos'],
  ['move_members', 'Mover e desconectar', 'Puxar pessoas para outro canal de voz ou tirar da call'],
  ['mute_members', 'Mutar na call', 'Silenciar o microfone de alguém na call'],
  ['music', 'Usar o bot de música', 'Tocar, pular e parar músicas'],
  ['start_games', 'Abrir jogos', 'Começar partidas na aba Jogos e com /jogar'],
  ['invite', 'Convidar pessoas', 'Ver o código de convite e adicionar pelo @'],
];
const PERM_IDS = PERMS.map((p) => p[0]);
const DEFAULT_EVERYONE = ['music', 'start_games', 'invite'];

const parse = (s, d) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};
const cleanPerms = (list) => [...new Set((Array.isArray(list) ? list : []).filter((p) => PERM_IDS.includes(p)))];

const getGroup = (id) => db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
const getChannel = (id) => db.prepare('SELECT * FROM channels WHERE id = ?').get(Number(id));
const getRole = (id) => db.prepare('SELECT * FROM roles WHERE id = ?').get(Number(id));
const rolesOf = (groupId) => db.prepare('SELECT * FROM roles WHERE group_id = ? ORDER BY position DESC, id').all(groupId);
const memberRoleIds = (groupId, userId) => db.prepare('SELECT role_id FROM member_roles WHERE group_id = ? AND user_id = ?').all(groupId, userId).map((r) => r.role_id);
const everyonePerms = (g) => cleanPerms(parse(g?.everyone_perms, DEFAULT_EVERYONE));

function permsOf(groupId, userId) {
  const g = getGroup(groupId);
  if (!g) return new Set();
  if (g.owner_id === userId || g.is_dm) return new Set(PERM_IDS);
  const set = new Set(everyonePerms(g));
  const mine = new Set(memberRoleIds(groupId, userId));
  for (const r of rolesOf(groupId)) if (mine.has(r.id)) parse(r.perms, []).forEach((p) => set.add(p));
  if (set.has('admin')) return new Set(PERM_IDS);
  return set;
}
const can = (groupId, userId, perm) => permsOf(groupId, userId).has(perm);

// posição da classe mais alta da pessoa (o dono fica acima de todas)
function topPosition(groupId, userId) {
  const g = getGroup(groupId);
  if (g?.owner_id === userId) return Infinity;
  const mine = new Set(memberRoleIds(groupId, userId));
  return Math.max(-1, ...rolesOf(groupId).filter((r) => mine.has(r.id)).map((r) => r.position));
}

// "bater na porta": quem está dentro deixa alguém entrar numa call trancada (vale 10 min)
const grants = new Map(); // channelId -> Map(userId -> expira em)
function grant(channelId, userId) {
  if (!grants.has(channelId)) grants.set(channelId, new Map());
  grants.get(channelId).set(userId, Date.now() + 10 * 60e3);
}
const granted = (channelId, userId) => (grants.get(channelId)?.get(userId) || 0) > Date.now();

function access(ch, userId, perms = permsOf(ch.group_id, userId)) {
  const allowed = parse(ch.allow_roles, []);
  const mine = memberRoleIds(ch.group_id, userId);
  const byRole = allowed.some((r) => mine.includes(r));
  const all = perms.has('admin') || perms.size === PERM_IDS.length;
  const see = all || !ch.hidden || perms.has('see_hidden') || byRole || granted(ch.id, userId);
  const enter = see && (all || !ch.locked || byRole || granted(ch.id, userId) || (ch.kind === 'voice' ? perms.has('join_locked') : perms.has('manage_channels')));
  return { see, enter, bypassLimit: all || perms.has('join_locked') || perms.has('move_members') };
}

function channelsOf(groupId) {
  return db.prepare('SELECT * FROM channels WHERE group_id = ? ORDER BY position, id').all(groupId);
}

function createChannel(groupId, { kind = 'text', name, emoji = '', topic = '', locked = 0, hidden = 0, userLimit = 0, allowRoles = [] }) {
  const pos = (db.prepare('SELECT MAX(position) p FROM channels WHERE group_id = ? AND kind = ?').get(groupId, kind)?.p ?? -1) + 1;
  const info = db
    .prepare('INSERT INTO channels (group_id, kind, name, emoji, topic, position, locked, hidden, user_limit, allow_roles) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(groupId, kind, name, emoji, topic, pos, locked ? 1 : 0, hidden ? 1 : 0, userLimit, JSON.stringify(allowRoles));
  return getChannel(info.lastInsertRowid);
}

// todo grupo tem pelo menos um canal de texto e um de voz
function ensureChannels(groupId) {
  const g = getGroup(groupId);
  if (!g) return;
  const list = channelsOf(groupId);
  if (!list.some((c) => c.kind === 'text')) createChannel(groupId, { kind: 'text', name: g.is_dm ? 'conversa' : 'geral', emoji: '💬' });
  if (!list.some((c) => c.kind === 'voice')) createChannel(groupId, { kind: 'voice', name: g.is_dm ? 'Call' : 'Resenha', emoji: '🔊' });
  const text = defaultText(groupId);
  db.prepare('UPDATE messages SET channel_id = ? WHERE group_id = ? AND channel_id IS NULL').run(text.id, groupId);
}
const defaultText = (groupId) => db.prepare("SELECT * FROM channels WHERE group_id = ? AND kind = 'text' ORDER BY position, id LIMIT 1").get(groupId);
const defaultVoice = (groupId) => db.prepare("SELECT * FROM channels WHERE group_id = ? AND kind = 'voice' ORDER BY position, id LIMIT 1").get(groupId);

for (const { id } of db.prepare('SELECT id FROM groups').all()) ensureChannels(id);

function channelPayload(ch, userId, perms) {
  const a = access(ch, userId, perms);
  if (!a.see) return null;
  const last = ch.kind === 'text' || ch.kind === 'voice' ? db.prepare('SELECT MAX(id) id FROM messages WHERE channel_id = ?').get(ch.id)?.id || 0 : 0;
  return {
    id: ch.id,
    groupId: ch.group_id,
    kind: ch.kind,
    name: ch.name,
    emoji: ch.emoji,
    topic: ch.topic,
    position: ch.position,
    locked: Boolean(ch.locked),
    hidden: Boolean(ch.hidden),
    userLimit: ch.user_limit,
    allowRoles: parse(ch.allow_roles, []),
    canEnter: a.enter,
    lastMessageId: last,
  };
}

const rolePayload = (r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, perms: cleanPerms(parse(r.perms, [])), hoist: Boolean(r.hoist), icon: r.icon });

// o que vai junto do grupo para cada pessoa (canais filtrados pelo que ela pode ver)
function guildPayload(g, userId) {
  const perms = permsOf(g.id, userId);
  const roleRows = db.prepare('SELECT user_id, role_id FROM member_roles WHERE group_id = ?').all(g.id);
  const memberRoles = {};
  for (const r of roleRows) (memberRoles[r.user_id] ||= []).push(r.role_id);
  return {
    channels: channelsOf(g.id).map((c) => channelPayload(c, userId, perms)).filter(Boolean),
    roles: rolesOf(g.id).map(rolePayload),
    memberRoles,
    everyonePerms: everyonePerms(g),
    myPerms: [...perms],
  };
}

// quem pode ver um canal (para mandar mensagens só para essas pessoas)
function viewers(ch) {
  return db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
    .all(ch.group_id)
    .map((r) => r.user_id)
    .filter((uid) => access(ch, uid).see);
}

module.exports = {
  PERMS,
  PERM_IDS,
  DEFAULT_EVERYONE,
  cleanPerms,
  parse,
  getChannel,
  getRole,
  rolesOf,
  memberRoleIds,
  permsOf,
  can,
  topPosition,
  access,
  grant,
  channelsOf,
  createChannel,
  ensureChannels,
  defaultText,
  defaultVoice,
  channelPayload,
  rolePayload,
  guildPayload,
  viewers,
};
