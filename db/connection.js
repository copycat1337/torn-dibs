import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

dotenv.config();

const DB_DIR = process.env.DB_DIR || "./data";
const DB_FILE = process.env.DB_FILE || "cat.db";

export function resolveDbPath() {
  return path.resolve(DB_DIR, DB_FILE);
}

export function openDatabase() {
  const file = resolveDbPath();

  if (!fs.existsSync(file)) {
    const err = new Error(
      `Database not found at ${file}. Run: npm run db:init`
    );
    err.code = "DB_NOT_FOUND";
    throw err;
  }

  const db = new Database(file);
  // WAL lets readers run while a write is in flight.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export { DB_DIR, DB_FILE };