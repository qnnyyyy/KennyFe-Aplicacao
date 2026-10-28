// Banco de dados SQLite (nativo do Node 22, sem dependências nativas).
// O arquivo fica em data/kennyfe.db e é criado/migrado automaticamente.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'kennyfe.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    color         TEXT NOT NULL DEFAULT '#ff5fa2',
    avatar_url    TEXT,
    status_text   TEXT,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    icon        TEXT NOT NULL DEFAULT '🎮',
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_code TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL DEFAULT 'text',   -- text | sticker | gif | image | file | system
    content    TEXT NOT NULL DEFAULT '',
    media_url  TEXT,
    reply_to   INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    edited_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, id);

  CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  );

  -- Biblioteca pessoal de figurinhas/GIFs de cada usuário (separada por conta)
  CREATE TABLE IF NOT EXISTS stickers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,                   -- sticker | gif
    url        TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (owner_id, url)
  );
`);

// Migrações: colunas novas do perfil (adicionadas sem perder dados)
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
const addUserCol = (name, def) => !userCols.includes(name) && db.exec(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
addUserCol('bio', "TEXT NOT NULL DEFAULT ''");
addUserCol('banner_color', "TEXT NOT NULL DEFAULT '#2f7bff'");
addUserCol('banner_url', 'TEXT');
addUserCol('frame', "TEXT NOT NULL DEFAULT 'none'");
addUserCol('favorite_games', "TEXT NOT NULL DEFAULT '[]'");
addUserCol('show_activity', 'INTEGER NOT NULL DEFAULT 1');
addUserCol('activity', 'TEXT'); // JSON { name, since, source }
addUserCol('tetris_xp', 'INTEGER NOT NULL DEFAULT 0');
addUserCol('tetris_skin', "TEXT NOT NULL DEFAULT 'classic'");

// Limpa sessões expiradas a cada inicialização
db.prepare('DELETE FROM sessions WHERE expires_at < unixepoch()').run();

module.exports = { db, DB_PATH, DATA_DIR, UPLOAD_DIR };
