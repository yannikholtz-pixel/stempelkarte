import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

let backend;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS karten (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stempel INTEGER NOT NULL DEFAULT 0,
    erstellt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stempel (
    id TEXT PRIMARY KEY,
    karte_id TEXT NOT NULL,
    erstellt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rabatte (
    id TEXT PRIMARY KEY,
    karte_id TEXT NOT NULL,
    art TEXT NOT NULL,
    erstellt TEXT NOT NULL,
    eingeloest TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sitzungen (
    token TEXT PRIMARY KEY,
    erstellt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS umsaetze (
    id TEXT PRIMARY KEY,
    karte_id TEXT,
    behandlung TEXT,
    betrag_cent INTEGER NOT NULL,
    erstellt TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_umsaetze_erstellt ON umsaetze (erstellt)`,
  `CREATE INDEX IF NOT EXISTS idx_stempel_karte ON stempel (karte_id, erstellt)`,
  `CREATE INDEX IF NOT EXISTS idx_rabatte_karte ON rabatte (karte_id)`
];

export async function initDb() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3
    });
    backend = {
      async query(sql, params = []) {
        let i = 0;
        const text = sql.replace(/\?/g, () => `$${++i}`);
        const res = await pool.query(text, params);
        return res.rows;
      }
    };
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
    fs.mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, 'stempelkarte.db'));
    db.exec('PRAGMA journal_mode = WAL');
    backend = {
      async query(sql, params = []) {
        const stmt = db.prepare(sql);
        if (/^\s*select/i.test(sql)) return stmt.all(...params);
        stmt.run(...params);
        return [];
      }
    };
  }
  for (const stmt of SCHEMA) await backend.query(stmt);
}

export function query(sql, params) {
  return backend.query(sql, params);
}
