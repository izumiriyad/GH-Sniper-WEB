"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
process.env.UV_THREADPOOL_SIZE = '128';
// GHSniper Web Server — Express + API routes + Web dashboard
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const path_1 = __importDefault(require("path"));
const database_1 = __importDefault(require("./db/database"));
const grubhubApi_1 = require("./api/grubhubApi");
const sniperEngine_1 = require("./engine/sniperEngine");
const nycIntelligence_1 = require("./engine/nycIntelligence");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// 🔥 ALMIGHTY: Hard timeout on all API requests to prevent zombie connections
app.use((req, res, next) => {
    req.setTimeout(30000);
    res.setTimeout(30000);
    next();
});
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'public')));
// ══ ACCOUNT ROUTES ══
// Add account (paste token)
app.post('/api/accounts', (req, res) => {
    const { email, accessToken, refreshToken: rt, capturedHeaders } = req.body;
    if (!email || !accessToken)
        return res.status(400).json({ error: 'email and accessToken required' });
    const expiresAt = Date.now() + 3600 * 1000;
    const account = database_1.default.addAccount(email, accessToken, rt || '', expiresAt, undefined, capturedHeaders);
    database_1.default.addLog(email, 'ACCOUNT_ADDED', undefined, 'ok', 'Token pasted');
    res.json({ ok: true, account });
});
// List all accounts
app.get('/api/accounts', (_req, res) => {
    const accounts = database_1.default.getAllAccounts();
    const statuses = (0, sniperEngine_1.getAllSniperStatuses)();
    const enriched = accounts.map(a => ({
        ...a,
        access_token: a.access_token ? '***' + a.access_token.slice(-8) : null,
        refresh_token: a.refresh_token ? '***' + a.refresh_token.slice(-8) : null,
        sniper: statuses.find(s => s.email === a.email) || null,
    }));
    res.json(enriched);
});
// Delete account
app.delete('/api/accounts/:email', (req, res) => {
    (0, sniperEngine_1.stopSniper)(req.params.email);
    database_1.default.deleteAccount(req.params.email);
    res.json({ ok: true });
});
// Refresh token
app.post('/api/accounts/:email/refresh', async (req, res) => {
    const ok = await (0, grubhubApi_1.refreshToken)(req.params.email);
    res.json({ ok, message: ok ? 'Token refreshed' : 'Refresh failed' });
});
// ══ BLOCKS ROUTES ══
// Get blocks for account
app.get('/api/blocks/:email', async (req, res) => {
    try {
        const blocks = await (0, grubhubApi_1.getBlocks)(req.params.email);
        const now = new Date();
        res.json({
            total: blocks.length,
            open: blocks.filter(b => b.type !== 'DELETED' && b.type !== 'ASSIGNED' && b.couriers_needed > 0 && new Date(b.start) > now).length,
            assigned: blocks.filter(b => b.type === 'ASSIGNED').length,
            future: blocks.filter(b => new Date(b.start) > now).length,
            blocks,
        });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Pickup a specific block
app.post('/api/blocks/:email/pickup/:blockId', async (req, res) => {
    try {
        const result = await (0, grubhubApi_1.pickupBlock)(req.params.email, req.params.blockId);
        if (result.success) {
            database_1.default.addLog(req.params.email, 'MANUAL_GRAB', req.params.blockId, 'grabbed', 'HTTP ' + result.status);
        }
        res.json(result);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// ══ SNIPER ROUTES ══
// Start continuous sniper (JOB:PICKUP)
app.post('/api/sniper/:email/start', async (req, res) => {
    const interval = req.body.intervalMs || 3000;
    const result = await (0, sniperEngine_1.startSniper)(req.params.email, interval);
    res.json(result);
});
// Stop sniper
app.post('/api/sniper/:email/stop', (req, res) => {
    const result = (0, sniperEngine_1.stopSniper)(req.params.email);
    res.json(result);
});
// Get sniper status
app.get('/api/sniper/:email/status', (req, res) => {
    const status = (0, sniperEngine_1.getSniperStatus)(req.params.email);
    if (!status)
        return res.json({ running: false, email: req.params.email });
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
// Get all sniper statuses
app.get('/api/snipers', (_req, res) => {
    const all = (0, sniperEngine_1.getAllSniperStatuses)();
    res.json(all.map(s => ({
        email: s.email,
        running: s.running,
        cycles: s.cycles,
        lastLog: s.lastLog,
        uptimeSeconds: Math.round((Date.now() - s.startedAt) / 1000),
    })));
});
// Run instant bypass (4 strategies)
app.post('/api/instant/:email', async (req, res) => {
    const logs = [];
    try {
        const results = await (0, grubhubApi_1.instantBypass)(req.params.email, (msg) => logs.push(msg));
        res.json({ results, logs });
    }
    catch (e) {
        res.status(500).json({ error: e.message, logs });
    }
});
// ══ LOGS & GRABS ══
app.get('/api/logs/:email', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json(database_1.default.getLogs(req.params.email, limit));
});
app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 200;
    res.json(database_1.default.getAllLogs(limit));
});
app.get('/api/grabs/:email', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(database_1.default.getGrabs(req.params.email, limit));
});
app.get('/api/grabs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json(database_1.default.getAllGrabs(limit));
});
// ══ TELEGRAM ══
app.post('/api/telegram', (req, res) => {
    const { botToken, chatId } = req.body;
    if (!botToken || !chatId)
        return res.status(400).json({ error: 'botToken and chatId required' });
    (0, nycIntelligence_1.setTelegramConfig)(botToken, chatId);
    (0, nycIntelligence_1.sendTelegram)('✅ GHSniper Web connected! Notifications active.');
    res.json({ ok: true });
});
app.get('/api/telegram', (_req, res) => {
    res.json((0, nycIntelligence_1.getTelegramConfig)());
});
app.post('/api/telegram/test', async (_req, res) => {
    await (0, nycIntelligence_1.sendTelegram)('🧪 Test notification from GHSniper Web v3');
    res.json({ ok: true });
});
// ══ SCHEDULE RELEASE ══
app.post('/api/schedule-release', (req, res) => {
    const { email, driverLevel } = req.body;
    if (!email || !driverLevel)
        return res.status(400).json({ error: 'email and driverLevel required' });
    (0, nycIntelligence_1.setScheduleReleaseConfig)(email, driverLevel);
    res.json({ ok: true, message: 'Schedule release configured for ' + email + ' (' + driverLevel + ')' });
});
app.get('/api/schedule-release', (_req, res) => {
    res.json((0, nycIntelligence_1.getScheduleReleaseConfigs)());
});
// ══ NYC INTELLIGENCE ══
app.get('/api/nyc', (_req, res) => {
    res.json({
        nextPeakDrop: (0, nycIntelligence_1.getNextPeakDrop)(),
        rateLimits: (0, nycIntelligence_1.getRateLimitStatus)(),
        intelligence: nycIntelligence_1.NYC_INTELLIGENCE,
    });
});
// ══ HEALTH CHECK ══
app.get('/api/health', (_req, res) => {
    const accounts = database_1.default.getAllAccounts();
    const snipers = (0, sniperEngine_1.getAllSniperStatuses)();
    res.json({
        status: 'ok',
        uptime: Math.round(process.uptime()) + 's',
        accounts: accounts.length,
        activeSnipers: snipers.filter(s => s.running).length,
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        dbStats: database_1.default.getStats(),
        timestamp: new Date().toISOString(),
    });
});
// ══ DASHBOARD ══
app.get('/', (_req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'public', 'index.html'));
});
// Database maintenance (Runs every 6 hours)
setInterval(() => {
    console.log('[Maintenance] Running SQLite Log Rotation & WAL Checkpoint...');
    database_1.default.performMaintenance();
}, 6 * 60 * 60 * 1000);
// Advanced V8 Memory Optimization (Requires running with --expose-gc)
// Forces garbage collection during "safe" idle windows to prevent Stop-The-World latency spikes during drops
setInterval(() => {
    if (global.gc) {
        const min = new Date().getMinutes();
        // Only run GC when we are NOT in the critical drop windows (13-16, 43-46)
        if (![13, 14, 15, 16, 43, 44, 45, 46].includes(min)) {
            global.gc();
        }
    }
}, 60 * 1000); // Check every minute
// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║   GHSniper Web v3.0 — NYC Edition                ║');
    console.log('  ║   http://localhost:' + PORT + '                          ║');
    console.log('  ║   Schedule Release + Telegram + Rate Evasion     ║');
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log('');
    // 🔥 ALMIGHTY: Read which snipers were running BEFORE clearing flags
    const accountsToRestart = database_1.default.getAllAccounts().filter(a => a.sniper_running && a.access_token);
    // Clean stale flags (in case of crash, all flags are now clean)
    database_1.default.resetAllSniperFlags();
    console.log('[Boot] Reset stale sniper flags');
    // 🔥 ALMIGHTY: Pre-warm DNS cache for all GH hostnames on boot
    const dns = require('dns');
    const ghHosts = [
        'api-managed-delivery-gtm.grubhub.com',
        'api-managed-delivery-us-east-1.grubhub.com',
        'api-managed-delivery-us-west-2.grubhub.com',
        'api-md-gtm.grubhub.com',
        'api-gtm.grubhub.com',
    ];
    ghHosts.forEach(host => {
        dns.resolve4(host, (err, addresses) => {
            if (!err && addresses.length > 0) {
                console.log(`[DNS Warmup] ${host} → ${addresses[0]}`);
            }
        });
    });
    (0, nycIntelligence_1.startConnectionWarming)();
    // Restart snipers that were running before crash/restart
    if (accountsToRestart.length > 0) {
        console.log(`[AutoRestart] Restarting ${accountsToRestart.length} snipers that were active before restart`);
        for (const acc of accountsToRestart) {
            console.log('[AutoRestart] Restarting sniper for ' + acc.email);
            (0, sniperEngine_1.startSniper)(acc.email, acc.sniper_interval_ms || 3000);
        }
    }
    else {
        console.log('[Boot] No snipers were running before restart');
    }
});
// ══ GRACEFUL SHUTDOWN ══
// Flush SQLite WAL to disk, persist state, and exit cleanly
const gracefulShutdown = (signal) => {
    console.log(`\n[Shutdown] ${signal} received. Flushing state...`);
    try {
        database_1.default.performMaintenance();
        console.log('[Shutdown] SQLite WAL checkpointed. Clean exit.');
    }
    catch (e) {
        console.error('[Shutdown] Flush error:', e.message);
    }
    process.exit(0);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// Catch unhandled rejections to prevent silent crashes
process.on('unhandledRejection', (reason) => {
    console.error('[CRITICAL] Unhandled Rejection:', reason?.message || reason);
    // Don't crash — log and continue. The watchdog will handle stalled loops.
});
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err.message);
    // Don't crash on transient network errors — they self-resolve
    const transient = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'EAI_AGAIN', 'SOCKET_TIMEOUT', 'ERR_SOCKET_CONNECTION_TIMEOUT'];
    if (transient.some(code => err.message.includes(code))) {
        return; // Swallow network errors
    }
    // For real bugs, flush and exit so PM2 restarts us
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});
exports.default = app;
//# sourceMappingURL=server.js.map