"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rawPickupBlock = exports.API_ENDPOINTS = void 0;
exports.getProxyAgent = getProxyAgent;
exports.rotateProxy = rotateProxy;
exports.getTrueTime = getTrueTime;
exports.getBlocks = getBlocks;
exports.pickupBlock = pickupBlock;
exports.refreshToken = refreshToken;
exports.isTokenExpiring = isTokenExpiring;
exports.cacheDesyncScan = cacheDesyncScan;
exports.bruteForcePickup = bruteForcePickup;
exports.dropWindowSniper = dropWindowSniper;
exports.microSnipe = microSnipe;
exports.continuousPickup = continuousPickup;
exports.instantBypass = instantBypass;
// GHSniper Web — Core GrubHub API (Node.js port)
// Ported from mobile app — no React Native dependencies
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const crypto_1 = __importDefault(require("crypto"));
const database_1 = __importDefault(require("../db/database"));
// Endpoints
const BASE_URL = 'https://api-managed-delivery-gtm.grubhub.com';
exports.API_ENDPOINTS = {
    primary: 'https://api-managed-delivery-gtm.grubhub.com',
    east: 'https://api-managed-delivery-us-east-1.grubhub.com',
    west: 'https://api-managed-delivery-us-west-2.grubhub.com',
    altGtm: 'https://api-md-gtm.grubhub.com',
    authGtm: 'https://api-gtm.grubhub.com',
};
const ALL_BASES = [exports.API_ENDPOINTS.primary, exports.API_ENDPOINTS.east, exports.API_ENDPOINTS.west, exports.API_ENDPOINTS.altGtm];
const BLOCK_PATH = '/deliverymobilegateway/sws/v1/blocks/current?includeRemoved=false';
const CLIENT_ID = 'grubhubfordrivers_android_ff790a1b3307';
const APP_VERSION = '5.32';
// Device profiles for anti-fingerprint
const DEVICE_PROFILES = [
    { brand: 'Samsung', model: 'SM-S918B', os: '14', api: '34', build: 'UP1A.231005.007' },
    { brand: 'Samsung', model: 'SM-A546B', os: '14', api: '34', build: 'UP1A.231005.007' },
    { brand: 'Google', model: 'Pixel 8 Pro', os: '14', api: '34', build: 'UD1A.231105.004' },
    { brand: 'Google', model: 'Pixel 7a', os: '13', api: '33', build: 'TQ3A.230901.001' },
    { brand: 'OnePlus', model: 'CPH2449', os: '14', api: '34', build: 'OP591BL1' },
    { brand: 'Samsung', model: 'SM-S928B', os: '14', api: '34', build: 'UP1A.231005.007' },
];
// Per-account device profiles cached in memory
const profileCache = new Map();
function getDeviceProfile(email) {
    if (profileCache.has(email))
        return profileCache.get(email);
    const idx = Math.abs([...email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % DEVICE_PROFILES.length;
    const base = DEVICE_PROFILES[idx];
    const deviceId = crypto_1.default.randomUUID();
    const androidId = crypto_1.default.randomBytes(8).toString('hex');
    const profile = { ...base, deviceId, androidId, installId: crypto_1.default.randomUUID(), pxSeed: crypto_1.default.randomBytes(16).toString('hex'), pxUuid: crypto_1.default.randomUUID() };
    profileCache.set(email, profile);
    return profile;
}
// Invalidate profile on 403/429 to force a new fingerprint
function invalidateProfile(email) {
    profileCache.delete(email);
}
const dns_1 = __importDefault(require("dns"));
// Permanent Zero-Latency DNS Cache (Bypass OS Resolver)
// ── INTELLIGENT PROXY ROTATOR (DATACENTER BLOCK EVASION) ─────────
const https_proxy_agent_1 = require("https-proxy-agent");
const proxyAgents = new Map();
let proxyList = [];
let proxyIndex = 0;
// Load proxies from environment or file (e.g. PROXY_URLS="http://user:pass@1.2.3.4:8000,http://...")
if (process.env.PROXY_URLS) {
    proxyList = process.env.PROXY_URLS.split(',').map(p => p.trim()).filter(Boolean);
    console.log('[ProxyInit] Loaded ' + proxyList.length + ' proxies for Datacenter IP Evasion');
}
function getProxyAgent(email) {
    if (proxyList.length === 0)
        return httpsAgent; // Fallback to direct connection if no proxies
    if (!proxyAgents.has(email)) {
        // Assign a dedicated mobile proxy IP to this specific driver email to avoid IP jumping bans
        const proxyUrl = proxyList[proxyIndex % proxyList.length];
        proxyIndex++;
        const agent = new https_proxy_agent_1.HttpsProxyAgent(proxyUrl);
        // Bind Nagle bypass to proxy socket too
        agent.on('socket', (socket) => socket.setNoDelay(true));
        proxyAgents.set(email, agent);
    }
    return proxyAgents.get(email);
}
// Rotate Proxy on WAF Block
function rotateProxy(email) {
    if (proxyList.length > 0) {
        proxyAgents.delete(email); // Force a new proxy to be drawn next time
        console.log('[Evasion] Rotated Proxy IP for ' + email);
    }
}
const dnsCache = new Map();
const DNS_TTL_MS = 300000; // 5 min TTL — rotate DNS to follow GH load balancer changes
const lookup = (hostname, options, callback) => {
    const cached = dnsCache.get(hostname);
    if (cached && Date.now() < cached.expires) {
        return callback(null, cached.ip, 4);
    }
    dns_1.default.resolve4(hostname, (err, addresses) => {
        if (!err && addresses.length > 0) {
            dnsCache.set(hostname, { ip: addresses[0], expires: Date.now() + DNS_TTL_MS });
            return callback(null, addresses[0], 4);
        }
        // Fallback to default
        dns_1.default.lookup(hostname, options, callback);
    });
};
// Aggressive keep-alive agents for maximum socket reuse (0ms handshake)
// GOD TIER: ALPN & Cipher matching to mimic Android 14 native OKHttp client perfectly
const httpsAgent = new https_1.default.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: Infinity, // 🔥 ALMIGHTY: Uncapped concurrency        // Absolute max concurrency
    maxFreeSockets: 10000, // Don't close free sockets, KEEP THEM HOT
    timeout: 60000,
    scheduling: 'fifo',
    lookup: lookup, // Zero-Latency DNS
    ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA',
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
});
// Axios clients
const apiClient = axios_1.default.create({
    baseURL: BASE_URL,
    timeout: 8000,
    validateStatus: () => true,
    httpsAgent,
    headers: { 'Connection': 'keep-alive', 'Accept-Encoding': 'identity' },
});
const fastClient = axios_1.default.create({
    baseURL: BASE_URL,
    timeout: 5000,
    validateStatus: () => true,
    httpsAgent,
    headers: { 'Connection': 'keep-alive', 'Accept-Encoding': 'identity' },
});
const authClient = axios_1.default.create({
    baseURL: exports.API_ENDPOINTS.authGtm,
    timeout: 20000,
    validateStatus: () => true,
    httpsAgent,
    headers: { 'Connection': 'keep-alive', 'Accept-Encoding': 'identity' },
});
let serverTimeOffset = 0; // Tracks difference between local time and GH server time
// Build headers for GH API
function buildHeaders(email, accessToken) {
    const p = getDeviceProfile(email);
    const ua = `GrubHub_Driver_Android/${APP_VERSION} (${p.brand} ${p.model}; Android ${p.os}; API ${p.api})`;
    // Spoof NYC Coordinates for realism (e.g. Times Square area)
    const lat = (40.7580 + (Math.random() * 0.01 - 0.005)).toFixed(6);
    const lon = (-73.9855 + (Math.random() * 0.01 - 0.005)).toFixed(6);
    return {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': ua,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-px-authorization': '3:' + p.pxSeed.substring(0, 40),
        'x-px-original-token': '3:' + p.pxUuid,
        'x-device-id': p.deviceId,
        'x-app-version': APP_VERSION,
        'x-client-identifier': CLIENT_ID,
        'x-locale': 'en-US',
        'X-GH-Location': `${lat},${lon}`, // Geo-spoofing
        'X-Network-Type': 'WIFI', // Bypass mobile connection throttles
        'X-Requested-With': 'com.grubhub.driver', // Critical Android stealth header
        'X-Android-Package': 'com.grubhub.driver',
        'Accept-Language': 'en-US,en;q=0.9',
    };
}
// Intercept responses to calculate Time Drift from GH Servers
function syncTimeDrift(headers) {
    if (headers['date']) {
        const serverTime = new Date(headers['date']).getTime();
        const localTime = Date.now();
        serverTimeOffset = serverTime - localTime;
    }
}
// Get the true, synchronized time
function getTrueTime() {
    return Date.now() + serverTimeOffset;
}
// Ensure TCP No-Delay is applied to sockets as they are created
httpsAgent.on('socket', (socket) => {
    socket.setNoDelay(true); // Disable Nagle's algorithm
    socket.setKeepAlive(true, 1000); // 🔥 ALMIGHTY: TCP Keep-Alive probes every 1s at OS level
});
function buildConfig(email, headers, opts) {
    return { headers, timeout: opts?.timeout || 8000, validateStatus: () => true, httpsAgent: getProxyAgent(email) };
}
// Extract blocks from GH response
function extractBlocks(data) {
    if (!data)
        return [];
    const blocks = [];
    const parse = (arr) => {
        if (!Array.isArray(arr))
            return;
        for (const b of arr) {
            blocks.push({
                id: b.id || b.block_id || '',
                start: b.scheduled_start || b.start_time || b.start || '',
                end: b.scheduled_end || b.end_time || b.end || '',
                type: b.type || b.status || 'UNKNOWN',
                couriers_needed: typeof b.couriers_needed === 'number' ? b.couriers_needed : 0,
                pay: b.pay || b.guaranteed_pay || null,
                overlapping_block_ids: b.overlapping_block_ids || [],
            });
        }
    };
    if (data.blocks)
        parse(data.blocks);
    else if (data.schedule_blocks)
        parse(data.schedule_blocks);
    else if (Array.isArray(data))
        parse(data);
    else if (data.data?.blocks)
        parse(data.data.blocks);
    return blocks;
}
// Get error detail from response
function errorDetail(res) {
    if (!res)
        return 'null response';
    try {
        const d = res.data;
        if (typeof d === 'string')
            return d.substring(0, 200);
        if (d?.error)
            return d.error;
        if (d?.message)
            return d.message;
        if (d?.error_description)
            return d.error_description;
        return JSON.stringify(d).substring(0, 200);
    }
    catch {
        return 'unparseable';
    }
}
// ══ CORE API FUNCTIONS ══
async function getBlocks(email) {
    const acc = database_1.default.getAccount(email);
    if (!acc?.access_token)
        throw new Error('No token for ' + email);
    const headers = buildHeaders(email, acc.access_token);
    const res = await fastClient.get(BLOCK_PATH, buildConfig(email, headers));
    if (res.headers)
        syncTimeDrift(res.headers); // Sync clock on every block fetch
    if (res.status === 401 || res.status === 462) {
        database_1.default.updateStatus(email, 'expired');
        throw new Error('SESSION_EXPIRED');
    }
    if (res.status !== 200)
        throw new Error('HTTP ' + res.status);
    return extractBlocks(res.data);
}
// ── ZERO-OVERHEAD RAW HTTP PICKUP (MAX SPEED) ─────────────────────────
const rawPickupBlock = (email, blockId, headers, baseUrl) => {
    return new Promise((resolve) => {
        const url = new URL(`${baseUrl}/deliverymobilegateway/sws/v1/blocks/open/${blockId}/pickup?includeRemoved=false`);
        const options = {
            method: 'POST',
            hostname: url.hostname,
            path: url.pathname + url.search,
            headers: { ...headers, 'Accept-Encoding': 'identity', 'Connection': 'keep-alive' },
            timeout: 2000,
            agent: getProxyAgent(email)
        };
        const req = https_1.default.request(options, (res) => {
            res.socket?.setNoDelay(true);
            // 🔥 ALMIGHTY: Instantly resolve on HEADERS (0ms body decode)
            if (res.statusCode === 200 || res.statusCode === 429) {
                res.resume(); // Drain socket instantly to keep it in the pool
                return resolve({ status: res.statusCode, raw: 'FAST_RESOLVE' });
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode || 0, raw: data }));
        });
        req.on('socket', (socket) => { socket.setNoDelay(true); });
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, raw: 'TIMEOUT' }); });
        req.on('error', () => resolve({ status: 0, raw: 'ERROR' }));
        req.write(`{"id":"${blockId}"}`);
        req.end();
    });
};
exports.rawPickupBlock = rawPickupBlock;
async function pickupBlock(email, blockId) {
    const acc = database_1.default.getAccount(email);
    if (!acc?.access_token)
        throw new Error('No token for ' + email);
    const headers = buildHeaders(email, acc.access_token);
    const res = await (0, exports.rawPickupBlock)(email, blockId, headers, fastClient.defaults.baseURL || BASE_URL);
    if (res.status === 403 || res.status === 429) {
        invalidateProfile(email);
        rotateProxy(email);
    }
    return { success: res.status === 200, status: res.status, detail: res.raw };
}
async function refreshToken(email) {
    const acc = database_1.default.getAccount(email);
    if (!acc?.refresh_token)
        return false;
    const headers = buildHeaders(email, acc.access_token || '');
    try {
        const res = await authClient.post('/security/oauth2/token', new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: acc.refresh_token,
            client_id: CLIENT_ID,
            scope: 'logistics:driver',
        }).toString(), {
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000,
            validateStatus: () => true,
        });
        if (res.status === 200 && res.data?.access_token) {
            const expiresAt = Date.now() + (res.data.expires_in || 3600) * 1000;
            database_1.default.updateTokens(email, res.data.access_token, res.data.refresh_token || acc.refresh_token, expiresAt);
            database_1.default.updateStatus(email, 'active');
            database_1.default.addLog(email, 'TOKEN_REFRESH', undefined, 'ok', 'Token refreshed');
            return true;
        }
        database_1.default.addLog(email, 'TOKEN_REFRESH_FAIL', undefined, 'fail', 'HTTP ' + res.status + ': ' + errorDetail(res), res.status);
        return false;
    }
    catch (e) {
        database_1.default.addLog(email, 'TOKEN_REFRESH_ERROR', undefined, 'error', e.message);
        return false;
    }
}
function isTokenExpiring(email) {
    const acc = database_1.default.getAccount(email);
    if (!acc)
        return true;
    return acc.token_expires_at < Date.now() + 300000; // 5 min buffer
}
// ══ INLINE RATE-LIMIT TRACKER (avoids circular import with nycIntelligence) ══
const rateLimitState = new Map();
function trackRequest(base, statusCode) {
    const state = rateLimitState.get(base) || { count: 0, resetAt: Date.now() + 60000, blocked: false };
    if (Date.now() > state.resetAt) {
        state.count = 0;
        state.resetAt = Date.now() + 60000;
        state.blocked = false;
    }
    state.count++;
    if (statusCode === 429) {
        state.blocked = true;
        state.resetAt = Date.now() + 5000;
    }
    rateLimitState.set(base, state);
}
function getAvailableBases() {
    return ALL_BASES.filter(base => {
        const state = rateLimitState.get(base);
        if (!state)
            return true;
        return !(state.blocked && Date.now() < state.resetAt);
    });
}
// ══ DUPLICATE GRAB PREVENTION ══
// Tracks block IDs we already grabbed so we never waste requests re-grabbing them
const grabbedBlockIds = new Set();
function markGrabbed(blockId) {
    grabbedBlockIds.add(blockId);
    // Auto-expire after 24 hours to prevent memory leak
    setTimeout(() => grabbedBlockIds.delete(blockId), 24 * 60 * 60 * 1000);
}
function isAlreadyGrabbed(blockId) {
    return grabbedBlockIds.has(blockId);
}
// Strategy 1: Multi-subdomain cache desync (Intelligent Routing)
async function cacheDesyncScan(email, log) {
    const acc = database_1.default.getAccount(email);
    if (!acc?.access_token)
        return { success: false, strategy: 'desync', message: 'No token' };
    const headers = buildHeaders(email, acc.access_token);
    const now = new Date(getTrueTime());
    const basesToUse = getAvailableBases();
    if (basesToUse.length === 0)
        return { success: false, strategy: 'desync', message: 'All subdomains rate limited. Cooling down.' };
    log(`Scanning ${basesToUse.length} available subdomains...`);
    const results = await Promise.all(basesToUse.map(async (base) => {
        try {
            const res = await axios_1.default.get(base + BLOCK_PATH, { headers, timeout: 5000, httpsAgent: getProxyAgent(email), validateStatus: () => true });
            trackRequest(base, res.status);
            return { base, blocks: res.status === 200 ? extractBlocks(res.data) : [], ok: res.status === 200 };
        }
        catch {
            return { base, blocks: [], ok: false };
        }
    }));
    const ok = results.filter(r => r.ok);
    log(ok.length + '/' + basesToUse.length + ' responded cleanly');
    const merged = new Map();
    for (const r of ok) {
        for (const b of r.blocks) {
            if (b.type === 'DELETED' || b.type === 'ASSIGNED' || new Date(b.start) <= now)
                continue;
            const ex = merged.get(b.id);
            if (!ex)
                merged.set(b.id, { block: b, sources: [r.base] });
            else {
                ex.sources.push(r.base);
                if (b.couriers_needed > ex.block.couriers_needed)
                    ex.block = b;
            }
        }
    }
    const open = [...merged.values()].filter(x => x.block.couriers_needed > 0 && !isAlreadyGrabbed(x.block.id));
    if (open.length > 0) {
        log('Found ' + open.length + ' open via desync!');
        const best = open.sort((a, b) => b.block.couriers_needed - a.block.couriers_needed)[0];
        for (const base of best.sources) {
            try {
                const res = await (0, exports.rawPickupBlock)(email, best.block.id, headers, base);
                if (res.status === 200) {
                    markGrabbed(best.block.id);
                    database_1.default.addLog(email, 'DESYNC_GRAB', best.block.id, 'grabbed', 'via ' + base);
                    database_1.default.addGrab(email, best.block.id, best.block.start, best.block.end, 'cache_desync');
                    return { success: true, strategy: 'desync', message: 'Grabbed via ' + base, httpStatus: 200, block: best.block };
                }
            }
            catch { }
        }
    }
    return { success: false, strategy: 'desync', message: ok.length + ' scanned, ' + merged.size + ' future, ' + open.length + ' open' };
}
// Strategy 2: Brute force pickup ALL blocks x ALL subdomains with Batched Socket Control
async function bruteForcePickup(email, log) {
    const acc = database_1.default.getAccount(email);
    if (!acc?.access_token)
        return { success: false, strategy: 'brute', message: 'No token' };
    const headers = buildHeaders(email, acc.access_token);
    const blocks = await getBlocks(email);
    const now = new Date(getTrueTime());
    const future = blocks.filter(b => b.type !== 'DELETED' && b.type !== 'ASSIGNED' && new Date(b.start) > now && !isAlreadyGrabbed(b.id));
    if (future.length === 0)
        return { success: false, strategy: 'brute', message: 'No future blocks' };
    log('Blasting ' + future.length + ' x ' + ALL_BASES.length + ' = ' + (future.length * ALL_BASES.length) + ' requests...');
    // Batch Execution to prevent Node.js ECONNRESET local socket exhaustion
    const allRequests = future.flatMap(block => ALL_BASES.map(base => () => (0, exports.rawPickupBlock)(email, block.id, headers, base).then(res => ({ block, base, status: res.status })).catch(() => ({ block, base, status: 0 }))));
    const results = [];
    const BATCH_SIZE = 40; // Max concurrent sockets to avoid WAF instant-kill
    for (let i = 0; i < allRequests.length; i += BATCH_SIZE) {
        const batch = allRequests.slice(i, i + BATCH_SIZE).map(fn => fn());
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
        // Check if we won in this batch to avoid unnecessary spam
        const won = batchResults.find(r => r.status === 200);
        if (won) {
            markGrabbed(won.block.id);
            database_1.default.addLog(email, 'BRUTE_GRAB', won.block.id, 'grabbed', 'via ' + won.base);
            database_1.default.addGrab(email, won.block.id, won.block.start, won.block.end, 'brute_force');
            return { success: true, strategy: 'brute', message: 'Grabbed via ' + won.base, httpStatus: 200, block: won.block };
        }
        // 10ms micro-sleep to flush socket buffers
        if (i + BATCH_SIZE < allRequests.length)
            await new Promise(r => setTimeout(r, 10));
    }
    const codes = {};
    results.forEach(r => { codes[r.status] = (codes[r.status] || 0) + 1; });
    return { success: false, strategy: 'brute', message: results.length + ' reqs. Codes: ' + Object.entries(codes).map(([k, v]) => k + 'x' + v).join(', ') };
}
// Strategy 3: Drop window sniper (:13-:16 / :43-:46) synced with True Server Time
async function dropWindowSniper(email, log) {
    const acc = database_1.default.getAccount(email);
    if (!acc?.access_token)
        return { success: false, strategy: 'drop_window', message: 'No token' };
    const headers = buildHeaders(email, acc.access_token);
    const now = new Date(getTrueTime()); // Use synced time
    const min = now.getMinutes();
    const sec = now.getSeconds();
    const windows = [{ s: 13, e: 16, l: ':13-:16' }, { s: 43, e: 46, l: ':43-:46' }];
    let inWindow = false, label = '';
    for (const w of windows) {
        if (min >= w.s && min <= w.e) {
            inWindow = true;
            label = w.l;
        }
    }
    if (!inWindow) {
        let best = Infinity, bestL = '';
        for (const w of windows) {
            let wm = w.s - min;
            if (wm < 0)
                wm += 60;
            const ms = (wm * 60 - sec) * 1000;
            if (ms < best) {
                best = ms;
                bestL = w.l;
            }
        }
        if (best > 240000)
            return { success: false, strategy: 'drop_window', message: 'Next ' + bestL + ' in ' + Math.round(best / 1000) + 's - too far' };
        log('Waiting ' + Math.round(best / 1000) + 's for ' + bestL + ' (Synced Time)');
        await new Promise(r => setTimeout(r, best));
        label = bestL;
    }
    log('DROP WINDOW ' + label + ' ACTIVE!');
    const deadline = getTrueTime() + 240000;
    let polls = 0;
    while (Date.now() < deadline) {
        polls++;
        if (polls % 30 === 0)
            log('Drop: ' + polls + ' polls, ' + Math.round((deadline - Date.now()) / 1000) + 's left');
        const scans = await Promise.all(ALL_BASES.map(base => axios_1.default.get(base + BLOCK_PATH, { headers, timeout: 3000, httpsAgent: getProxyAgent(email), validateStatus: () => true })
            .then(res => ({ base, blocks: res.status === 200 ? extractBlocks(res.data) : [], ok: res.status === 200 }))
            .catch(() => ({ base, blocks: [], ok: false }))));
        const n = new Date(getTrueTime());
        for (const scan of scans) {
            if (!scan.ok)
                continue;
            const open = scan.blocks.filter(b => b.type !== 'DELETED' && b.type !== 'ASSIGNED' && b.couriers_needed > 0 && new Date(b.start) > n && !isAlreadyGrabbed(b.id));
            if (open.length > 0) {
                const t = open[0];
                const rr = await Promise.all(ALL_BASES.map(base => (0, exports.rawPickupBlock)(email, t.id, headers, base).catch(() => null)));
                const w = rr.find(r => r && r.status === 200);
                if (w) {
                    markGrabbed(t.id);
                    database_1.default.addLog(email, 'DROPWIN_GRAB', t.id, 'grabbed', 'after ' + polls + ' polls');
                    database_1.default.addGrab(email, t.id, t.start, t.end, 'drop_window');
                    return { success: true, strategy: 'drop_window', message: 'Grabbed during ' + label + ' after ' + polls + ' polls', httpStatus: 200, block: t };
                }
            }
        }
        // Micro-jitter to prevent heuristic bans (30ms + random 0-15ms)
        await new Promise(r => setTimeout(r, 30 + Math.random() * 15));
    }
    return { success: false, strategy: 'drop_window', message: polls + ' polls during ' + label + ' - none released' };
}
// Strategy 4: Extended micro-snipe (5 min) — Multi-subdomain attack
async function microSnipe(email, durationMs, log) {
    const acc = database_1.default.getAccount(email);
    if (!acc?.access_token)
        return { success: false, strategy: 'micro', message: 'No token' };
    const headers = buildHeaders(email, acc.access_token);
    const deadline = Date.now() + durationMs;
    let polls = 0;
    log('Micro-snipe ' + (durationMs / 1000) + 's across all subdomains...');
    while (Date.now() < deadline) {
        polls++;
        if (polls % 40 === 0)
            log('Snipe: ' + polls + ' polls, ' + Math.round((deadline - Date.now()) / 1000) + 's left');
        try {
            // Scan ALL subdomains simultaneously for maximum coverage
            const scans = await Promise.all(ALL_BASES.map(base => axios_1.default.get(base + BLOCK_PATH, { headers, timeout: 3000, httpsAgent: getProxyAgent(email), validateStatus: () => true })
                .then(res => ({ base, blocks: res.status === 200 ? extractBlocks(res.data) : [], ok: res.status === 200 }))
                .catch(() => ({ base, blocks: [], ok: false }))));
            const now = new Date(getTrueTime());
            for (const scan of scans) {
                if (!scan.ok)
                    continue;
                const open = scan.blocks.filter(b => b.type !== 'DELETED' && b.type !== 'ASSIGNED' && b.couriers_needed > 0 && new Date(b.start) > now && !isAlreadyGrabbed(b.id));
                if (open.length > 0) {
                    const t = open[0];
                    // Fire pickup across ALL subdomains for maximum race advantage
                    const rr = await Promise.all(ALL_BASES.map(base => (0, exports.rawPickupBlock)(email, t.id, headers, base).catch(() => null)));
                    const w = rr.find(r => r && r.status === 200);
                    if (w) {
                        markGrabbed(t.id);
                        database_1.default.addLog(email, 'MICROSNIPE', t.id, 'grabbed', polls + ' polls');
                        database_1.default.addGrab(email, t.id, t.start, t.end, 'micro_snipe');
                        return { success: true, strategy: 'micro', message: 'Sniped after ' + polls + ' polls', httpStatus: 200, block: t };
                    }
                }
            }
        }
        catch { }
        await new Promise(r => setTimeout(r, 50 + Math.random() * 20));
    }
    return { success: false, strategy: 'micro', message: polls + ' polls in ' + (durationMs / 1000) + 's - none found' };
}
// ══ CONTINUOUS JOB:PICKUP (like GH Helper) ══
async function continuousPickup(email, intervalMs, log, shouldStop) {
    log('JOB:PICKUP started. Polling every ' + intervalMs + 'ms');
    let cycles = 0;
    while (!shouldStop()) {
        cycles++;
        try {
            // Auto-refresh every 100 cycles
            if (cycles % 100 === 0 && isTokenExpiring(email)) {
                log('Refreshing token at cycle ' + cycles);
                await refreshToken(email);
            }
            const acc = database_1.default.getAccount(email);
            if (!acc?.access_token) {
                log('No token!');
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }
            const headers = buildHeaders(email, acc.access_token);
            const res = await fastClient.get(BLOCK_PATH, { headers, timeout: 5000, validateStatus: () => true });
            // Sync time drift on every poll
            if (res.headers)
                syncTimeDrift(res.headers);
            if (res.status === 401 || res.status === 462) {
                log('SESSION EXPIRED at cycle ' + cycles);
                database_1.default.updateStatus(email, 'expired');
                database_1.default.addLog(email, 'SESSION_EXPIRED', undefined, 'error', 'HTTP ' + res.status, res.status);
                return { success: false, strategy: 'continuous', message: 'Session expired at cycle ' + cycles, httpStatus: res.status };
            }
            if (res.status === 403 || res.status === 429) {
                log('WARNING: WAF Block or Rate Limit (HTTP ' + res.status + '). Rotating Device Profile & Backing off...');
                invalidateProfile(email);
                rotateProxy(email);
                database_1.default.addLog(email, 'EVASION_TRIGGERED', undefined, 'warn', 'Profile regenerated due to ' + res.status);
                await new Promise(r => setTimeout(r, 5000)); // 5 second backoff
                continue;
            }
            if (res.status === 200) {
                const blocks = extractBlocks(res.data);
                const now = new Date(getTrueTime());
                const open = blocks.filter(b => b.type !== 'DELETED' && b.type !== 'ASSIGNED' && b.couriers_needed > 0 && new Date(b.start) > now && !isAlreadyGrabbed(b.id));
                const assigned = blocks.filter(b => b.type === 'ASSIGNED');
                if (cycles % 10 === 0) {
                    log('Cycle ' + cycles + ' | ' + open.length + ' open | ' + assigned.length + ' assigned | ' + now.toLocaleTimeString());
                }
                if (open.length > 0) {
                    log('OPEN BLOCK(S) DETECTED: ' + open.length + '! Grabbing...');
                    for (const block of open.slice(0, 3)) {
                        const pickups = ALL_BASES.map(base => (0, exports.rawPickupBlock)(email, block.id, headers, base).catch(() => null));
                        const rr = await Promise.all(pickups);
                        const won = rr.find(r => r && r.status === 200);
                        if (won) {
                            markGrabbed(block.id);
                            database_1.default.addLog(email, 'CONTINUOUS_GRAB', block.id, 'grabbed', 'cycle ' + cycles);
                            database_1.default.addGrab(email, block.id, block.start, block.end, 'continuous');
                            log('🎯 GRABBED ' + block.id + ' at cycle ' + cycles + '! Continuing to hunt...');
                            // DON'T return - keep the loop alive to grab MORE blocks throughout the day
                        }
                        else {
                            const ratelimited = rr.find(r => r && (r.status === 429 || r.status === 403));
                            if (ratelimited) {
                                invalidateProfile(email);
                                rotateProxy(email);
                            }
                        }
                    }
                }
            }
        }
        catch (e) {
            if (cycles % 20 === 0)
                log('Error: ' + e.message);
        }
        // 🔥 ALMIGHTY: Adaptive Polling — accelerate during no-show drop windows
        const nowMin = new Date(getTrueTime()).getMinutes();
        const inDropWindow = (nowMin >= 13 && nowMin <= 16) || (nowMin >= 43 && nowMin <= 46);
        const effectiveInterval = inDropWindow ? Math.min(intervalMs, 500) : intervalMs;
        const jitter = Math.floor(Math.random() * (effectiveInterval * 0.2));
        await new Promise(r => setTimeout(r, effectiveInterval + jitter));
    }
    log('Stopped after ' + cycles + ' cycles');
    return { success: false, strategy: 'continuous', message: 'Stopped after ' + cycles + ' cycles' };
}
// ══ MASTER: Run all 4 strategies ══
async function instantBypass(email, log) {
    const results = [];
    // Pre-flight
    if (isTokenExpiring(email)) {
        log('Refreshing token...');
        await refreshToken(email);
    }
    const acc = database_1.default.getAccount(email);
    if (!acc?.access_token) {
        results.push({ success: false, strategy: 'preflight', message: 'No token. Login required.' });
        return results;
    }
    // Test session
    try {
        const headers = buildHeaders(email, acc.access_token);
        const test = await fastClient.get(BLOCK_PATH, { headers, timeout: 8000, validateStatus: () => true });
        if (test.status === 401 || test.status === 462) {
            results.push({ success: false, strategy: 'preflight', message: 'SESSION EXPIRED (HTTP ' + test.status + ')' });
            return results;
        }
        if (test.status === 200) {
            const blocks = extractBlocks(test.data);
            const now = new Date(getTrueTime());
            const open = blocks.filter(b => b.type !== 'DELETED' && b.type !== 'ASSIGNED' && b.couriers_needed > 0 && new Date(b.start) > now);
            const future = blocks.filter(b => new Date(b.start) > now);
            const assigned = blocks.filter(b => b.type === 'ASSIGNED');
            log('Market: ' + blocks.length + ' total, ' + future.length + ' future, ' + open.length + ' open, ' + assigned.length + ' assigned');
        }
    }
    catch (e) {
        log('Preflight error: ' + e.message);
    }
    log('1/4: Cache desync...');
    const s1 = await cacheDesyncScan(email, log);
    results.push(s1);
    if (s1.success)
        return results;
    log('2/4: Brute force...');
    const s2 = await bruteForcePickup(email, log);
    results.push(s2);
    if (s2.success)
        return results;
    log('3/4: Drop window...');
    const s3 = await dropWindowSniper(email, log);
    results.push(s3);
    if (s3.success)
        return results;
    log('4/4: Micro-snipe (5min)...');
    const s4 = await microSnipe(email, 300000, log);
    results.push(s4);
    return results;
}
// 🔥 ALMIGHTY: HFT JIT WARMUP
// Force V8 TurboFan to pre-compile the rawPickupBlock HTTP pathway into 
// raw C++ machine code before the drop window ever hits.
if (!global.__hft_warmed) {
    global.__hft_warmed = true;
    console.log('[HFT] Warming up V8 TurboFan Compiler for rawPickupBlock...');
    for (let i = 0; i < 10000; i++) {
        // 10,000 silent executions to trigger Tier-4 optimization
        (0, exports.rawPickupBlock)('warmup@test', 'warmup', {}, 'http://127.0.0.1:9').catch(() => { });
    }
    console.log('[HFT] JIT Compilation locked to Machine Code.');
}
//# sourceMappingURL=grubhubApi.js.map