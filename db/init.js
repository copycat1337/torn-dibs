import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { DB_DIR, DB_FILE, resolveDbPath } from "./connection.js";

dotenv.config();

const RESET = process.argv.includes("--reset");
const file = resolveDbPath();
const dir = path.resolve(DB_DIR);

function log(msg) {
  console.log(`[db:init] ${msg}`);
}

function fail(msg, code = 1) {
  console.error(`[db:init] ERROR: ${msg}`);
  process.exit(code);
}

try {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log(`created directory ${dir}`);
  } else {
    log(`directory exists: ${dir}`);
  }
} catch (e) {
  fail(`cannot create directory ${dir}: ${e.message}`);
}

const exists = fs.existsSync(file);
if (exists && !RESET) {
  log(`database already exists: ${file}`);
  log("applying schema (idempotent)");
}
if (exists && RESET) {
  log(`--reset: removing ${file} and WAL sidecars`);
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = file + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

let db;
try {
  db = new Database(file);
} catch (e) {
  fail(`cannot open database at ${file}: ${e.message}`);
}

log(`opened ${file}`);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  token         TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL,
  player_name   TEXT,
  faction_id    TEXT NOT NULL,
  torn_api_key  TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_faction ON users(faction_id);

CREATE TABLE IF NOT EXISTS calls (
  id           TEXT PRIMARY KEY,
  faction_id   TEXT NOT NULL,
  member_id    TEXT NOT NULL,
  member_name  TEXT,
  caller_id    TEXT NOT NULL,
  caller_name  TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_member  ON calls(faction_id, member_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_caller  ON calls(faction_id, caller_id);

CREATE TABLE IF NOT EXISTS statuses (
  faction_id     TEXT NOT NULL,
  member_id      TEXT NOT NULL,
  status         TEXT,
  until          INTEGER,
  previous_area  INTEGER,
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (faction_id, member_id)
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

try {
  db.exec(SCHEMA);
  log("schema applied (tables: users, calls, statuses, schema_meta)");
} catch (e) {
  fail(`schema creation failed: ${e.message}`);
}

const SCHEMA_VERSION = "2";
try {
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SCHEMA_VERSION);
  log(`schema_version = ${SCHEMA_VERSION}`);
} catch (e) {
  fail(`cannot write schema_meta: ${e.message}`);
}

const counts = {};
for (const t of ["users", "calls", "statuses"]) {
  counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
}
log(
  `done. rows: users=${counts.users} calls=${counts.calls} statuses=${counts.statuses}`
);
db.close();