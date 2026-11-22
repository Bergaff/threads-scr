-- Threads Digest — D1 (SQLite) схема, раздел 13 ТЗ + служебные таблицы.
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('ru','en')),
  cookies_enc TEXT NOT NULL,
  proxy TEXT,
  user_agent TEXT,
  locale TEXT,
  timezone TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ok', -- ok | paused | dead
  pause_until TEXT,
  backoff_level INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_ok_at TEXT,
  pages_today INTEGER NOT NULL DEFAULT 0,
  pages_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS authors (
  username TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  followers INTEGER NOT NULL DEFAULT 0,
  is_verified INTEGER NOT NULL DEFAULT 0,
  lang TEXT,
  median_eng REAL,
  in_seed INTEGER NOT NULL DEFAULT 0,
  in_stoplist INTEGER NOT NULL DEFAULT 0,
  is_hot INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  code TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  author_username TEXT NOT NULL REFERENCES authors(username),
  text TEXT NOT NULL DEFAULT '',
  lang TEXT,
  media_type TEXT, -- photo | video | carousel | none
  media_urls TEXT, -- JSON array
  taken_at TEXT NOT NULL,
  is_reply INTEGER NOT NULL DEFAULT 0,
  is_quote INTEGER NOT NULL DEFAULT 0,
  parent_code TEXT,
  parent_text TEXT,
  source TEXT NOT NULL, -- feed | authors | search | trending | api
  account_id TEXT REFERENCES accounts(id),
  collected_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_paid_partnership INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  filter_reasons TEXT -- JSON array
);

CREATE TABLE IF NOT EXISTS post_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_code TEXT NOT NULL REFERENCES posts(code),
  measured_at TEXT NOT NULL DEFAULT (datetime('now')),
  likes INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  quotes INTEGER NOT NULL DEFAULT 0,
  views INTEGER
);
CREATE INDEX IF NOT EXISTS idx_snapshots_post_time ON post_snapshots(post_code, measured_at);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_code TEXT NOT NULL REFERENCES posts(code),
  author_username TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  likes INTEGER NOT NULL DEFAULT 0,
  media_urls TEXT,
  is_author_reply INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_replies_post ON replies(post_code);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_code TEXT NOT NULL REFERENCES posts(code),
  lang TEXT NOT NULL,
  score REAL NOT NULL,
  score_parts TEXT, -- JSON: hot, lift, discuss, velocity, k_content
  status TEXT NOT NULL DEFAULT 'new', -- new | in_work | approved | rejected | used
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_candidates_lang_score ON candidates(lang, score DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  post_code TEXT NOT NULL REFERENCES posts(code),
  channel TEXT NOT NULL, -- tg_ru | tg_en | yt_ru | yt_en
  kind TEXT NOT NULL, -- tg_post | shorts
  caption TEXT,
  script TEXT, -- JSON segments для Shorts
  title TEXT,
  description TEXT,
  hashtags TEXT,
  card_path TEXT,
  video_path TEXT,
  preview_path TEXT,
  prompt_version TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | approved | queued | published | rejected
  approved_by INTEGER,
  anonymized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id TEXT NOT NULL REFERENCES content_items(id),
  channel TEXT NOT NULL,
  external_id TEXT, -- message_id | video_id
  status TEXT NOT NULL DEFAULT 'pending', -- pending | published | failed | taken_down
  error TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_idempotent
  ON publications(content_id, channel);

CREATE TABLE IF NOT EXISTS pub_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id INTEGER NOT NULL REFERENCES publications(id),
  views INTEGER,
  forwards INTEGER,
  clicks INTEGER,
  measured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bot_states (
  chat_id INTEGER PRIMARY KEY,
  state TEXT,
  data TEXT, -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
