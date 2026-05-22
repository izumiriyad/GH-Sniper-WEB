"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startConnectionWarming = startConnectionWarming;
exports.getSniperStatus = getSniperStatus;
exports.getAllSniperStatuses = getAllSniperStatuses;
exports.startSniper = startSniper;
exports.stopSniper = stopSniper;
exports.autoRestartSnipers = autoRestartSnipers;
// Server-side sniper engine — manages per-account continuous snipers
const grubhubApi_1 = require("../api/grubhubApi");
const database_1 = __importDefault(require("../db/database"));
// Active snipers per account
const snipers = new Map();
// ── GLOBAL CONNECTION WARMING (SINGLETON) ─────────────────────────────
// One single interval for ALL accounts — not per-account to avoid leak
let _globalWarmupTimer = null;
function startConnectionWarming() {
    if (_globalWarmupTimer)
        return; // Already running
    _globalWarmupTimer = setInterval(() => {
        try {
            const { syncServerTime } = require('../api/grubhubApi');
            syncServerTime();
        }
        catch (e) { }
    }, 25000);
}
// ── MEMORY SWEEPER ─────────────────────────────
const triggerGC = () => {
    if (global.gc) {
        try {
            global.gc();
        }
        catch (e) { }
    }
};
function getSniperStatus(email) {
    return snipers.get(email);
}
function getAllSniperStatuses() {
    return [...snipers.values()];
}
async function startSniper(email, intervalMs = 3000) {
    if (snipers.has(email) && snipers.get(email).running) {
        return { started: false, message: 'Already running for ' + email };
    }
    const acc = database_1.default.getAccount(email);
    if (!acc?.access_token) {
        return { started: false, message: 'No token for ' + email + '. Login first.' };
    }
    const instance = {
        email,
        running: true,
        stopFlag: false,
        cycles: 0,
        lastLog: 'Starting...',
        logs: [],
        startedAt: Date.now(),
        result: null,
        warmupTimer: null,
    };
    snipers.set(email, instance);
    database_1.default.setSniperRunning(email, true);
    // Ensure global connection warming is active
    startConnectionWarming();
    database_1.default.addLog(email, 'SNIPER_START', undefined, 'ok', 'Interval: ' + intervalMs + 'ms');
    // Run in background (non-blocking) with auto-healing
    (async () => {
        while (!instance.stopFlag) {
            try {
                instance.running = true;
                if (instance.cycles % 100 === 0)
                    triggerGC();
                const result = await (0, grubhubApi_1.continuousPickup)(email, intervalMs, (msg) => {
                    instance.lastLog = msg;
                    instance.logs.push('[' + new Date().toLocaleTimeString() + '] ' + msg);
                    if (instance.logs.length > 500)
                        instance.logs.shift();
                    // Extract cycle count from message
                    const m = msg.match(/Cycle (\d+)/);
                    if (m)
                        instance.cycles = parseInt(m[1]);
                    // Detect grabs from log messages and fire Telegram
                    if (msg.includes('GRABBED')) {
                        const blockMatch = msg.match(/GRABBED (\S+)/);
                        try {
                            require('./nycIntelligence').sendTelegram(`🎯 <b>BLOCK SNIPED!</b>\nBlock: ${blockMatch?.[1] || 'unknown'}\nAccount: ${email}\nCycle: ${instance.cycles}`);
                        }
                        catch (e) { }
                    }
                }, () => instance.stopFlag);
                instance.result = result;
                // continuousPickup only exits on session expired or stopFlag
                if (!instance.stopFlag) {
                    instance.lastLog = 'Loop exited (session expired?). Auto-restarting in 10s...';
                    database_1.default.addLog(email, 'SNIPER_RESTART', undefined, 'warn', 'Auto-restarting: ' + result.message);
                    // Auto-refresh token before restart
                    try {
                        if ((0, grubhubApi_1.isTokenExpiring)(email)) {
                            instance.lastLog = 'Refreshing token before restart...';
                            await (0, grubhubApi_1.refreshToken)(email);
                        }
                    }
                    catch (e) { }
                    await new Promise(r => setTimeout(r, 10000));
                }
            }
            catch (e) {
                instance.lastLog = 'CRITICAL ERROR: ' + e.message + '. Rebooting in 5s...';
                database_1.default.addLog(email, 'SNIPER_ERROR', undefined, 'error', e.message);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
        instance.running = false;
        database_1.default.setSniperRunning(email, false);
    })();
    return { started: true, message: 'Sniper started for ' + email + ' (' + intervalMs + 'ms)' };
}
function stopSniper(email) {
    const inst = snipers.get(email);
    if (!inst || !inst.running) {
        return { stopped: false, message: 'No active sniper for ' + email };
    }
    inst.stopFlag = true;
    database_1.default.setSniperRunning(email, false);
    database_1.default.addLog(email, 'SNIPER_STOP', undefined, 'ok', 'Stopped after ' + inst.cycles + ' cycles');
    return { stopped: true, message: 'Stopping sniper for ' + email + ' (was at cycle ' + inst.cycles + ')' };
}
// Auto-refresh tokens for all active accounts every 30 minutes
setInterval(async () => {
    const accounts = database_1.default.getAllAccounts();
    for (const acc of accounts) {
        if (acc.status === 'active' && acc.access_token && (0, grubhubApi_1.isTokenExpiring)(acc.email)) {
            console.log('[TokenRefresh] Refreshing ' + acc.email);
            await (0, grubhubApi_1.refreshToken)(acc.email);
        }
    }
}, 30 * 60 * 1000);
// 🔥 ALMIGHTY: Periodic DB maintenance — flush WAL, clean old logs, re-optimize
setInterval(() => {
    try {
        database_1.default.performMaintenance();
        console.log('[Maintenance] WAL checkpointed & old logs cleaned');
    }
    catch (e) {
        console.error('[Maintenance] Error:', e.message);
    }
}, 6 * 60 * 60 * 1000); // Every 6 hours
// Auto-restart snipers that were running before server restart
function autoRestartSnipers() {
    const accounts = database_1.default.getAllAccounts();
    for (const acc of accounts) {
        if (acc.sniper_running && acc.access_token) {
            console.log('[AutoRestart] Restarting sniper for ' + acc.email);
            startSniper(acc.email, acc.sniper_interval_ms || 3000);
        }
    }
}
//# sourceMappingURL=sniperEngine.js.map