process.env.UV_THREADPOOL_SIZE = '128';
// GHSniper Web Server v4 — Express + API routes + Web dashboard
// 🔥 v4: Added auth, trust proxy, schedule release status, proxy status
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import DB from './db/database';
import { getBlocks, pickupBlock, refreshToken, instantBypass, SniperResult, getProxyStatus } from './api/grubhubApi';
import { startSniper, stopSniper, getSniperStatus, getAllSniperStatuses } from './engine/sniperEngine';
import { setTelegramConfig, getTelegramConfig, sendTelegram, setScheduleReleaseConfig, getScheduleReleaseConfigs, startConnectionWarming, getNextPeakDrop, getRateLimitStatus, NYC_INTELLIGENCE, getScheduleReleaseState, getNextScheduleRelease } from './engine/nycIntelligence';

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || ''; // Set via Railway env var

// 🔥 v4: Trust Railway's reverse proxy for correct req.ip
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Hard timeout on all API requests
app.use((req, res, next) => {
  req.setTimeout(30000);
  res.setTimeout(30000);
  next();
});

// 🔥 v4: Auth middleware — skip for static files and health check
app.use('/api', (req, res, next) => {
  // Health check is public
  if (req.path === '/health') return next();
  // If AUTH_TOKEN is not set, skip auth (backward compat)
  if (!AUTH_TOKEN) return next();
  
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token as string || '';
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized. Set AUTH_TOKEN env var and pass it as Bearer token.' });
  }
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// ══ ACCOUNT ROUTES ══

app.post('/api/accounts', (req, res) => {
  const { email, accessToken, refreshToken: rt, capturedHeaders } = req.body;
  if (!email || !accessToken) return res.status(400).json({ error: 'email and accessToken required' });
  const expiresAt = Date.now() + 3600 * 1000;
  const account = DB.addAccount(email, accessToken, rt || '', expiresAt, undefined, capturedHeaders);
  DB.addLog(email, 'ACCOUNT_ADDED', undefined, 'ok', 'Token pasted');
  res.json({ ok: true, account });
});

app.get('/api/accounts', (_req, res) => {
  const accounts = DB.getAllAccounts();
  const statuses = getAllSniperStatuses();
  const enriched = accounts.map(a => ({
    ...a,
    access_token: a.access_token ? '***' + a.access_token.slice(-8) : null,
    refresh_token: a.refresh_token ? '***' + a.refresh_token.slice(-8) : null,
    sniper: statuses.find(s => s.email === a.email) || null,
  }));
  res.json(enriched);
});

app.delete('/api/accounts/:email', (req, res) => {
  stopSniper(req.params.email);
  DB.deleteAccount(req.params.email);
  res.json({ ok: true });
});

app.post('/api/accounts/:email/refresh', async (req, res) => {
  const ok = await refreshToken(req.params.email);
  res.json({ ok, message: ok ? 'Token refreshed' : 'Refresh failed' });
});

// ══ BLOCKS ROUTES ══

app.get('/api/blocks/:email', async (req, res) => {
  try {
    const blocks = await getBlocks(req.params.email);
    const now = new Date();
    res.json({
      total: blocks.length,
      open: blocks.filter(b => b.type !== 'DELETED' && b.type !== 'ASSIGNED' && b.couriers_needed > 0 && new Date(b.start) > now).length,
      assigned: blocks.filter(b => b.type === 'ASSIGNED').length,
      future: blocks.filter(b => new Date(b.start) > now).length,
      blocks,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/blocks/:email/pickup/:blockId', async (req, res) => {
  try {
    const result = await pickupBlock(req.params.email, req.params.blockId);
    if (result.success) {
      DB.addLog(req.params.email, 'MANUAL_GRAB', req.params.blockId, 'grabbed', 'HTTP ' + result.status);
    }
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ══ SNIPER ROUTES ══

app.post('/api/sniper/:email/start', async (req, res) => {
  const interval = req.body.intervalMs || 3000;
  const result = await startSniper(req.params.email, interval);
  res.json(result);
});

app.post('/api/sniper/:email/stop', (req, res) => {
  const result = stopSniper(req.params.email);
  res.json(result);
});

app.get('/api/sniper/:email/status', (req, res) => {
  const status = getSniperStatus(req.params.email);
  if (!status) return res.json({ running: false, email: req.params.email });
  res.json({
    email: status.email,
    running: status.running,
    cycles: status.cycles,
    lastLog: status.lastLog,
    logs: status.logs.slice(-50),
    startedAt: status.startedAt,
    uptimeSeconds: Math.round((Date.now() - status.startedAt) / 1000),
    result: status.result,
  });
});

app.get('/api/snipers', (_req, res) => {
  const all = getAllSniperStatuses();
  res.json(all.map(s => ({
    email: s.email,
    running: s.running,
    cycles: s.cycles,
    lastLog: s.lastLog,
    uptimeSeconds: Math.round((Date.now() - s.startedAt) / 1000),
  })));
});

app.post('/api/instant/:email', async (req, res) => {
  const logs: string[] = [];
  try {
    const results = await instantBypass(req.params.email, (msg) => logs.push(msg));
    res.json({ results, logs });
  } catch (e: any) {
    res.status(500).json({ error: e.message, logs });
  }
});

// ══ LOGS & GRABS ══

app.get('/api/logs/:email', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(DB.getLogs(req.params.email, limit));
});

app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 200;
  res.json(DB.getAllLogs(limit));
});

app.get('/api/grabs/:email', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(DB.getGrabs(req.params.email, limit));
});

app.get('/api/grabs', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  res.json(DB.getAllGrabs(limit));
});

// ══ TELEGRAM ══
app.post('/api/telegram', (req, res) => {
  const { botToken, chatId } = req.body;
  if (!botToken || !chatId) return res.status(400).json({ error: 'botToken and chatId required' });
  setTelegramConfig(botToken, chatId);
  sendTelegram('✅ GHSniper Web v4 connected! Notifications active.');
  res.json({ ok: true });
});

app.get('/api/telegram', (_req, res) => {
  res.json(getTelegramConfig());
});

app.post('/api/telegram/test', async (_req, res) => {
  await sendTelegram('🧪 Test notification from GHSniper Web v4 ALMIGHTY');
  res.json({ ok: true });
});

// ══ SCHEDULE RELEASE ══
app.post('/api/schedule-release', (req, res) => {
  const { email, driverLevel } = req.body;
  if (!email || !driverLevel) return res.status(400).json({ error: 'email and driverLevel required' });
  setScheduleReleaseConfig(email, driverLevel);
  res.json({ ok: true, message: 'Schedule release configured for ' + email + ' (' + driverLevel + ')' });
});

app.get('/api/schedule-release', (_req, res) => {
  res.json({
    configs: getScheduleReleaseConfigs(),
    state: getScheduleReleaseState(),
    nextRelease: getNextScheduleRelease(),
  });
});

// ══ NYC INTELLIGENCE ══
app.get('/api/nyc', (_req, res) => {
  res.json({
    nextPeakDrop: getNextPeakDrop(),
    rateLimits: getRateLimitStatus(),
    intelligence: NYC_INTELLIGENCE,
    proxyStatus: getProxyStatus(),
    nextScheduleRelease: getNextScheduleRelease(),
  });
});

// ══ HEALTH CHECK (public — no auth) ══
app.get('/api/health', (_req, res) => {
  const accounts = DB.getAllAccounts();
  const snipers = getAllSniperStatuses();
  res.json({
    status: 'ok',
    version: '4.0.0',
    uptime: Math.round(process.uptime()) + 's',
    accounts: accounts.length,
    activeSnipers: snipers.filter(s => s.running).length,
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    dbStats: DB.getStats(),
    proxyStatus: getProxyStatus(),
    scheduleRelease: getScheduleReleaseState(),
    authEnabled: !!AUTH_TOKEN,
    timestamp: new Date().toISOString(),
  });
});

// ══ AUTH STATUS (for frontend) ══
app.get('/api/auth-status', (_req, res) => {
  res.json({ authRequired: !!AUTH_TOKEN });
});

// ══ DASHBOARD ══
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Database maintenance (every 6 hours)
setInterval(() => {
  console.log('[Maintenance] Running SQLite Log Rotation & WAL Checkpoint...');
  DB.performMaintenance();
}, 6 * 60 * 60 * 1000);

// V8 Memory Optimization (safe GC during non-critical windows)
setInterval(() => {
  if (global.gc) {
    const min = new Date().getMinutes();
    if (![13, 14, 15, 16, 43, 44, 45, 46].includes(min)) {
      global.gc();
    }
  }
}, 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║   GHSniper Web v4.0 — ALMIGHTY Edition           ║');
  console.log('  ║   http://localhost:' + PORT + '                          ║');
  console.log('  ║   Guaranteed Schedule + Telegram + Rate Evasion   ║');
  console.log('  ║   Auth: ' + (AUTH_TOKEN ? 'ENABLED' : 'DISABLED (set AUTH_TOKEN)') + '                        ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');

  // Read which snipers were running BEFORE clearing flags
  const accountsToRestart = DB.getAllAccounts().filter(a => a.sniper_running && a.access_token);

  DB.resetAllSniperFlags();
  console.log('[Boot] Reset stale sniper flags');

  // Pre-warm DNS
  const dns = require('dns');
  const ghHosts = [
    'api-managed-delivery-gtm.grubhub.com',
    'api-managed-delivery-us-east-1.grubhub.com',
    'api-managed-delivery-us-west-2.grubhub.com',
    'api-md-gtm.grubhub.com',
    'api-gtm.grubhub.com',
  ];
  ghHosts.forEach(host => {
    dns.resolve4(host, (err: any, addresses: string[]) => {
      if (!err && addresses.length > 0) {
        console.log(`[DNS Warmup] ${host} → ${addresses[0]}`);
      }
    });
  });

  // Start connection warming + schedule release watchdog
  startConnectionWarming();

  // Restart snipers that were running before crash/restart
  if (accountsToRestart.length > 0) {
    console.log(`[AutoRestart] Restarting ${accountsToRestart.length} snipers that were active before restart`);
    for (const acc of accountsToRestart) {
      console.log('[AutoRestart] Restarting sniper for ' + acc.email);
      startSniper(acc.email, acc.sniper_interval_ms || 3000);
    }
  } else {
    console.log('[Boot] No snipers were running before restart');
  }
});

// ══ GRACEFUL SHUTDOWN ══
const gracefulShutdown = (signal: string) => {
  console.log(`\n[Shutdown] ${signal} received. Flushing state...`);
  try {
    DB.performMaintenance();
    console.log('[Shutdown] SQLite WAL checkpointed. Clean exit.');
  } catch (e: any) {
    console.error('[Shutdown] Flush error:', e.message);
  }
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason: any) => {
  console.error('[CRITICAL] Unhandled Rejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err.message);
  const transient = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'EAI_AGAIN', 'SOCKET_TIMEOUT', 'ERR_SOCKET_CONNECTION_TIMEOUT'];
  if (transient.some(code => err.message.includes(code))) {
    return;
  }
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

export default app;
