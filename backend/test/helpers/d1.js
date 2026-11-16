// A tiny Cloudflare D1 stand-in on top of node:sqlite, so the real migrations
// and the real batch/transaction semantics can be exercised in unit tests.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'migrations');

class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.db, this.sql, args.map((a) => (a === undefined ? null : a)));
  }
  _isSelect() {
    return /^\s*(select|with)/i.test(this.sql);
  }
  _exec() {
    const st = this.db.prepare(this.sql);
    if (this._isSelect()) return { success: true, results: st.all(...this.args), meta: {} };
    const r = st.run(...this.args);
    return { success: true, results: [], meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  }
  async run() { return this._exec(); }
  async all() { return this._exec(); }
  async first() {
    const st = this.db.prepare(this.sql);
    return st.get(...this.args) ?? null;
  }
}

export function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  }
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s._exec());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

export function createKV() {
  const m = new Map();
  return {
    async get(k, type) {
      const v = m.get(k);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
  };
}

export function createR2() {
  const m = new Map();
  return {
    async put(k, bytes, opts) { m.set(k, { bytes, opts }); },
    async get(k) {
      const o = m.get(k);
      return o ? { body: o.bytes, httpMetadata: o.opts?.httpMetadata } : null;
    },
  };
}
