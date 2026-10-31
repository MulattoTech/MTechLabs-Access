import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Real SQLite execution behind the D1 prepare/bind/first/all/run/batch contract.
// No SQL-result stubs: authorization/coordination tests exercise the actual schema.
function plain(row) { return row ? { ...row } : null; }

class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  execute(mode) {
    const statement = this.db.sqlite.prepare(this.sql);
    if (mode === 'first') return plain(statement.get(...this.values));
    if (mode === 'all') return { success: true, results: statement.all(...this.values).map(plain), meta: { changes: 0 } };
    if (statement.columns().length) {
      const results = statement.all(...this.values).map(plain);
      return { success: true, results, meta: { changes: Number(this.db.sqlite.prepare('SELECT changes() AS n').get().n) } };
    }
    const info = statement.run(...this.values);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
  async first(column) { const row = this.execute('first'); return column ? row?.[column] ?? null : row; }
  async all() { return this.execute('all'); }
  async run() { return this.execute('run'); }
}

export function createDB() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0001.sql', import.meta.url), 'utf8'));
  return {
    sqlite,
    prepare(sql) { return new Statement(this, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.execute('run'));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    async exec(sql) { sqlite.exec(sql); return { count: 1 }; },
    close() { sqlite.close(); },
  };
}

export async function seedAuth(db, now = Math.floor(Date.now() / 1000)) {
  const users = [
    ['owner', 'owner@example.com', 'approved', 1],
    ['alice', 'alice@example.com', 'approved', 0],
    ['bob', 'bob@example.com', 'approved', 0],
    ['pending', 'pending@example.com', 'pending', 0],
    ['suspended', 'suspended@example.com', 'suspended', 0],
  ];
  const apps = [
    ['hub', 'Owner Hub', 'm-techlabs.com', 'owner_only', 1, 'hub-audience'],
    ['codes', 'Code Bot', 'codes.m-techlabs.com', 'native', 1, 'codes-audience'],
    ['tracker', 'Tracker', 'tracker.m-techlabs.com', 'gate', 1, 'tracker-audience'],
    ['fleet', 'Fleet', 'fleet.m-techlabs.com', 'owner_only', 1, 'fleet-audience'],
    ['external', 'External', 'external.m-techlabs.com', 'external', 0, 'external-audience'],
  ];
  await db.batch([
    ...users.map(([id, email, status, isOwner]) => db.prepare('INSERT INTO users(id,email,status,is_owner,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, email, status, isOwner, now, now)),
    ...apps.map(([id, name, hostname, mode, managed, audience]) => db.prepare('INSERT INTO apps(id,name,hostname,access_mode,managed,audience,created_at) VALUES(?,?,?,?,?,?,?)').bind(id, name, hostname, mode, managed, audience, now)),
  ]);
}
