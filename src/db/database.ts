// Database layer — SQLite for accounts, tokens, logs
import Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuid } from 'uuid';

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'ghsniper.db');

// Ensure data directory exists
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('wal_autocheckpoint = 0'); // 🔥 ALMIGHTY: Disable auto-checkpoint. We flush manually.
db.pragma('mmap_size = 2147483648'); // 🔥 ALMIGHTY: 2GB memory map
db.pragma('cache_size = -20000');    // 🔥 ALMIGHTY: 20MB page cache
db.pragma('synchronous = OFF');      // 🔥 ALMIGHTY: Zero disk I/O blocking
db.pragma('temp_store = MEMORY');    // 🔥 ALMIGHTY: Temp tables in RAM, not disk
db.pragma('busy_timeout = 5000');    // 🔥 ALMIGHTY: 5s retry on SQLITE_BUSY instead of instant fail
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at INTEGER DEFAULT 0,
    device_profile TEXT,
    captured_headers TEXT,
    status TEXT DEFAULT 'active',
    sniper_running INTEGER DEFAULT 0,
    sniper_interval_ms INTEGER DEFAULT 3000,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    email TEXT NOT NULL,
    action TEXT NOT NULL,
    block_id TEXT,
    status TEXT,
    message TEXT,
    http_code INTEGER,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS grabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    email TEXT NOT NULL,
    block_id TEXT NOT NULL,
    block_start TEXT,
    block_end TEXT,
    strategy TEXT,
    grabbed_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  -- 🔥 ALMIGHTY: Indexes for fast lookups on high-volume tables
  CREATE INDEX IF NOT EXISTS idx_logs_email ON logs(email);
  CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_grabs_email ON grabs(email);
  CREATE INDEX IF NOT EXISTS idx_grabs_grabbed ON grabs(grabbed_at);
  CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
`);

// Prepared statements (pre-compiled for zero-overhead execution)
const stmts = {
  addAccount: db.prepare(`INSERT INTO accounts (id, email, access_token, refresh_token, token_expires_at, device_profile, captured_headers, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  updateAccountFields: db.prepare(`UPDATE accounts SET access_token = ?, refresh_token = ?, token_expires_at = ?, device_profile = ?, captured_headers = ?, updated_at = ? WHERE email = ?`),
  getAccount: db.prepare(`SELECT * FROM accounts WHERE email = ?`),
  getAccountById: db.prepare(`SELECT * FROM accounts WHERE id = ?`),
  getAllAccounts: db.prepare(`SELECT * FROM accounts ORDER BY created_at DESC`),
  updateTokens: db.prepare(`UPDATE accounts SET access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = ? WHERE email = ?`),
  updateStatus: db.prepare(`UPDATE accounts SET status = ?, updated_at = ? WHERE email = ?`),
  updateSniper: db.prepare(`UPDATE accounts SET sniper_running = ?, updated_at = ? WHERE email = ?`),
  updateSniperInterval: db.prepare(`UPDATE accounts SET sniper_interval_ms = ?, updated_at = ? WHERE email = ?`),
  deleteAccount: db.prepare(`DELETE FROM accounts WHERE email = ?`),
  deleteLogs: db.prepare(`DELETE FROM logs WHERE account_id = ?`),
  deleteGrabs: db.prepare(`DELETE FROM grabs WHERE account_id = ?`),
  addLog: db.prepare(`INSERT INTO logs (account_id, email, action, block_id, status, message, http_code) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  getLogs: db.prepare(`SELECT * FROM logs WHERE email = ? ORDER BY created_at DESC LIMIT ?`),
  getAllLogs: db.prepare(`SELECT * FROM logs ORDER BY created_at DESC LIMIT ?`),
  addGrab: db.prepare(`INSERT INTO grabs (account_id, email, block_id, block_start, block_end, strategy) VALUES (?, ?, ?, ?, ?, ?)`),
  getGrabs: db.prepare(`SELECT * FROM grabs WHERE email = ? ORDER BY grabbed_at DESC LIMIT ?`),
  getAllGrabs: db.prepare(`SELECT * FROM grabs ORDER BY grabbed_at DESC LIMIT ?`),
  getGrabCount: db.prepare(`SELECT COUNT(*) as count FROM grabs WHERE email = ?`),
  getTotalGrabCount: db.prepare(`SELECT COUNT(*) as count FROM grabs`),
  cleanupOldLogs: db.prepare(`DELETE FROM logs WHERE created_at < ?`),
  cleanupOldGrabs: db.prepare(`DELETE FROM grabs WHERE grabbed_at < ?`),
  resetSniperFlags: db.prepare(`UPDATE accounts SET sniper_running = 0`),
};

// 🔥 ALMIGHTY: Batch write transaction for addLog — wraps single insert in implicit transaction
// better-sqlite3 auto-wraps single statements in transactions, but explicit is faster for bursts
const addLogBatch = db.transaction((entries: Array<{accountId: string; email: string; action: string; blockId: string | null; status: string | null; message: string | null; httpCode: number | null}>) => {
  for (const e of entries) {
    stmts.addLog.run(e.accountId, e.email, e.action, e.blockId, e.status, e.message, e.httpCode);
  }
});

export interface AccountRow {
  id: string;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number;
  device_profile: string | null;
  captured_headers: string | null;
  status: string;
  sniper_running: number;
  sniper_interval_ms: number;
  created_at: number;
  updated_at: number;
}

// L1 Memory Cache for Zero-Latency Reads (bypasses SQLite I/O)
const accountCache = new Map<string, AccountRow>();

export const DB = {
  addAccount(email: string, accessToken: string, refreshToken: string, expiresAt: number, deviceProfile?: object, capturedHeaders?: object): AccountRow {
    const now = Date.now();
    const existing = stmts.getAccount.get(email) as AccountRow | undefined;
    
    if (existing) {
      stmts.updateAccountFields.run(accessToken, refreshToken, expiresAt, deviceProfile ? JSON.stringify(deviceProfile) : null, capturedHeaders ? JSON.stringify(capturedHeaders) : null, now, email);
    } else {
      const id = uuid();
      stmts.addAccount.run(id, email, accessToken, refreshToken, expiresAt, deviceProfile ? JSON.stringify(deviceProfile) : null, capturedHeaders ? JSON.stringify(capturedHeaders) : null, now);
    }
    const acc = stmts.getAccount.get(email) as AccountRow;
    accountCache.set(email, acc);
    return acc;
  },

  getAccount(email: string): AccountRow | undefined {
    if (accountCache.has(email)) return accountCache.get(email);
    const acc = stmts.getAccount.get(email) as AccountRow | undefined;
    if (acc) accountCache.set(email, acc);
    return acc;
  },

  getAccountById(id: string): AccountRow | undefined {
    return stmts.getAccountById.get(id) as AccountRow | undefined;
  },

  getAllAccounts(): AccountRow[] {
    const accounts = stmts.getAllAccounts.all() as AccountRow[];
    for (const acc of accounts) accountCache.set(acc.email, acc);
    return accounts;
  },

  updateTokens(email: string, accessToken: string, refreshToken: string, expiresAt: number) {
    stmts.updateTokens.run(accessToken, refreshToken, expiresAt, Date.now(), email);
    accountCache.delete(email); // Invalidate cache
  },

  updateStatus(email: string, status: string) {
    stmts.updateStatus.run(status, Date.now(), email);
    accountCache.delete(email);
  },

  setSniperRunning(email: string, running: boolean) {
    stmts.updateSniper.run(running ? 1 : 0, Date.now(), email);
    accountCache.delete(email);
  },

  setSniperInterval(email: string, intervalMs: number) {
    stmts.updateSniperInterval.run(intervalMs, Date.now(), email);
    accountCache.delete(email);
  },

  deleteAccount(email: string) {
    const acc = stmts.getAccount.get(email) as AccountRow | undefined;
    if (acc) {
      stmts.deleteLogs.run(acc.id);
      stmts.deleteGrabs.run(acc.id);
      stmts.deleteAccount.run(email);
      accountCache.delete(email);
    }
  },

  addLog(email: string, action: string, blockId?: string, status?: string, message?: string, httpCode?: number) {
    const acc = accountCache.get(email) || stmts.getAccount.get(email) as AccountRow | undefined;
    stmts.addLog.run(acc?.id || '', email, action, blockId || null, status || null, message || null, httpCode || null);
  },

  // 🔥 ALMIGHTY: Batch insert logs in a single transaction (50x faster for bursts)
  addLogsBatch(entries: Array<{email: string; action: string; blockId?: string; status?: string; message?: string; httpCode?: number}>) {
    const mapped = entries.map(e => {
      const acc = accountCache.get(e.email) || stmts.getAccount.get(e.email) as AccountRow | undefined;
      return { accountId: acc?.id || '', email: e.email, action: e.action, blockId: e.blockId || null, status: e.status || null, message: e.message || null, httpCode: e.httpCode || null };
    });
    addLogBatch(mapped);
  },

  getLogs(email: string, limit = 100) {
    return stmts.getLogs.all(email, limit);
  },

  getAllLogs(limit = 200) {
    return stmts.getAllLogs.all(limit);
  },

  addGrab(email: string, blockId: string, blockStart: string, blockEnd: string, strategy: string) {
    const acc = accountCache.get(email) || stmts.getAccount.get(email) as AccountRow | undefined;
    stmts.addGrab.run(acc?.id || '', email, blockId, blockStart, blockEnd, strategy);
  },

  getGrabs(email: string, limit = 50) {
    return stmts.getGrabs.all(email, limit);
  },

  getAllGrabs(limit = 100) {
    return stmts.getAllGrabs.all(limit);
  },

  getGrabCount(email: string): number {
    return (stmts.getGrabCount.get(email) as any)?.count || 0;
  },

  getTotalGrabCount(): number {
    return (stmts.getTotalGrabCount.get() as any)?.count || 0;
  },

  performMaintenance() {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    stmts.cleanupOldLogs.run(sevenDaysAgo);
    stmts.cleanupOldGrabs.run(sevenDaysAgo);
    // WAL checkpoint — flush write-ahead log to main database file
    db.pragma('wal_checkpoint(TRUNCATE)');
    // Clear account cache to pick up any stale data
    accountCache.clear();
    console.log('[DB] Maintenance complete: old logs purged, WAL checkpointed');
  },

  // 🔥 ALMIGHTY: Reset all sniper_running flags on boot (clean slate after crash)
  resetAllSniperFlags() {
    stmts.resetSniperFlags.run();
    accountCache.clear();
  },

  // Get raw DB stats for dashboard
  getStats() {
    const accounts = (db.prepare('SELECT COUNT(*) as count FROM accounts').get() as any)?.count || 0;
    const logs = (db.prepare('SELECT COUNT(*) as count FROM logs').get() as any)?.count || 0;
    const grabs = (db.prepare('SELECT COUNT(*) as count FROM grabs').get() as any)?.count || 0;
    const walSize = (() => { try { return fs.statSync(DB_PATH + '-wal').size; } catch { return 0; } })();
    const dbSize = (() => { try { return fs.statSync(DB_PATH).size; } catch { return 0; } })();
    return { accounts, logs, grabs, dbSizeBytes: dbSize, walSizeBytes: walSize };
  },
};

export default DB;
