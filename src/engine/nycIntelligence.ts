// NYC Market Intelligence + Schedule Release Day Sniper + Telegram Alerts
import axios from 'axios';
import https from 'https';
import DB from '../db/database';
import { getBlocks, pickupBlock, refreshToken, isTokenExpiring, Block, API_ENDPOINTS, rawPickupBlock, getTrueTime } from '../api/grubhubApi';

// Dedicated stealth agent for schedule release (mirrors main engine)
const releaseAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: Infinity, // 🔥 ALMIGHTY: Uncapped for schedule release blitz
  maxFreeSockets: 500,
  timeout: 30000,
  scheduling: 'fifo',
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
});

// Nagle bypass + keep-alive probes on release sockets
releaseAgent.on('socket', (socket) => {
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 1000);
});

const ALL_BASES = [API_ENDPOINTS.primary, API_ENDPOINTS.east, API_ENDPOINTS.west, API_ENDPOINTS.altGtm];
const BLOCK_PATH = '/deliverymobilegateway/sws/v1/blocks/current?includeRemoved=false';

// ══ TELEGRAM NOTIFICATIONS ══
let telegramBotToken = '';
let telegramChatId = '';

export function setTelegramConfig(botToken: string, chatId: string) {
  telegramBotToken = botToken;
  telegramChatId = chatId;
  console.log('[Telegram] Configured: chat=' + chatId);
}

export function getTelegramConfig() {
  return { botToken: telegramBotToken ? '***' + telegramBotToken.slice(-6) : '', chatId: telegramChatId };
}

export async function sendTelegram(message: string) {
  if (!telegramBotToken || !telegramChatId) return;
  try {
    await axios.post('https://api.telegram.org/bot' + telegramBotToken + '/sendMessage', {
      chat_id: telegramChatId,
      text: message,
      parse_mode: 'HTML',
    }, { timeout: 5000 });
  } catch (e: any) {
    console.log('[Telegram] Send failed: ' + e.message);
  }
}

// ══ NYC MARKET INTELLIGENCE ══
// NYC block drop patterns based on market analysis
export const NYC_INTELLIGENCE = {
  // GH releases new schedule blocks at these times (EST)
  scheduleReleaseDays: {
    premier: 'Thursday',   // Premier drivers get first access
    pro: 'Friday',         // Pro drivers
    partner: 'Saturday',   // Partner (lowest tier)
  },
  // Schedule drops at midnight EST for the upcoming week
  scheduleReleaseHour: 0, // midnight
  scheduleReleaseMinute: 0,

  // Peak drop windows — when drivers drop blocks they don't want
  peakDropTimes: [
    { hour: 6, min: 0, reason: 'Morning shift drops (drivers who overslept)' },
    { hour: 10, min: 30, reason: 'Late morning adjustments' },
    { hour: 14, min: 0, reason: 'Afternoon shift changes' },
    { hour: 16, min: 0, reason: 'Pre-dinner rush drops' },
    { hour: 22, min: 0, reason: 'Late night drops' },
  ],

  // No-show release windows (every 30 min block)
  noShowWindows: [
    { offsetMin: 13, offsetMax: 16, reason: 'Hour blocks: 14-min grace period expired' },
    { offsetMin: 43, offsetMax: 46, reason: 'Half-hour blocks: 14-min grace period expired' },
  ],

  // NYC-specific: busiest regions
  hotRegions: ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],

  // Rate limit thresholds per subdomain
  maxRequestsPerMinute: 20, // Stay under radar
  backoffOnRateLimit: 5000, // 5s backoff on 429
};

// ══ SCHEDULE RELEASE DAY SNIPER ══
// Fires at EXACTLY midnight on schedule release day

interface ScheduleReleaseConfig {
  driverLevel: 'premier' | 'pro' | 'partner';
  email: string;
  enabled: boolean;
}

const releaseConfigs = new Map<string, ScheduleReleaseConfig>();
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

export function setScheduleReleaseConfig(email: string, driverLevel: 'premier' | 'pro' | 'partner') {
  releaseConfigs.set(email, { driverLevel, email, enabled: true });
  scheduleNextRelease();
}

export function getScheduleReleaseConfigs(): ScheduleReleaseConfig[] {
  return [...releaseConfigs.values()];
}

function getNextReleaseTime(level: 'premier' | 'pro' | 'partner'): Date {
  const dayMap = { premier: 4, pro: 5, partner: 6 }; // Thu=4, Fri=5, Sat=6
  const targetDay = dayMap[level];
  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentDay = estNow.getDay();

  let daysUntil = targetDay - currentDay;
  if (daysUntil < 0) daysUntil += 7;
  if (daysUntil === 0 && estNow.getHours() >= 0 && estNow.getMinutes() >= 5) daysUntil = 7; // Already passed today

  const release = new Date(estNow);
  release.setDate(release.getDate() + daysUntil);
  release.setHours(0, 0, 0, 0);
  return release;
}

function scheduleNextRelease() {
  if (releaseTimer) clearTimeout(releaseTimer);

  let earliestMs = Infinity;
  let earliestConfig: ScheduleReleaseConfig | null = null;

  for (const config of releaseConfigs.values()) {
    if (!config.enabled) continue;
    const releaseTime = getNextReleaseTime(config.driverLevel);
    const ms = releaseTime.getTime() - Date.now();
    if (ms > 0 && ms < earliestMs) {
      earliestMs = ms;
      earliestConfig = config;
    }
  }

  if (earliestConfig && earliestMs < 7 * 24 * 60 * 60 * 1000) {
    console.log('[ScheduleRelease] Next fire in ' + Math.round(earliestMs / 3600000) + 'h for ' + earliestConfig.email + ' (' + earliestConfig.driverLevel + ')');
    releaseTimer = setTimeout(() => fireScheduleRelease(), earliestMs);
  }
}

async function fireScheduleRelease() {
  console.log('[ScheduleRelease] FIRING!');
  sendTelegram('🔥 <b>SCHEDULE RELEASE FIRING!</b>\nNew blocks dropping NOW!');

  for (const config of releaseConfigs.values()) {
    if (!config.enabled) continue;
    const releaseTime = getNextReleaseTime(config.driverLevel);
    if (Math.abs(releaseTime.getTime() - Date.now()) > 60000) continue; // Not this config's time

    const email = config.email;
    DB.addLog(email, 'SCHEDULE_RELEASE', undefined, 'info', 'Release day sniper firing for ' + config.driverLevel);

    // Refresh token first
    if (isTokenExpiring(email)) await refreshToken(email);

    const acc = DB.getAccount(email);
    if (!acc?.access_token) continue;

    // Full stealth headers for schedule release (critical: use same fingerprint as main engine)
    const headers: Record<string, string> = {
      'Authorization': 'Bearer ' + acc.access_token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'GrubHub_Driver_Android/5.32 (Samsung SM-S918B; Android 14; API 34)',
      'x-app-version': '5.32',
      'x-client-identifier': 'grubhubfordrivers_android_ff790a1b3307',
      'x-locale': 'en-US',
      'X-Network-Type': 'WIFI',
      'X-Requested-With': 'com.grubhub.driver',
      'X-Android-Package': 'com.grubhub.driver',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      'Connection': 'keep-alive',
    };

    const deadline = Date.now() + 180000; // 3 minutes of aggressive polling (increased from 2)
    let polls = 0;
    let totalGrabbed = 0;

    while (Date.now() < deadline) {
      polls++;
      try {
        const scans = await Promise.all(ALL_BASES.map(base =>
          axios.get(base + BLOCK_PATH, { headers, timeout: 3000, httpsAgent: releaseAgent, validateStatus: () => true })
            .then(res => {
              if (res.status !== 200) return [];
              const blocks = extractBlocksSimple(res.data);
              return blocks.filter(b => b.couriers_needed > 0 && new Date(b.start) > new Date(getTrueTime()));
            })
            .catch(() => [] as any[])
        ));

        const allOpen = scans.flat();
        // De-duplicate blocks by ID
        const unique = [...new Map(allOpen.map(b => [b.id, b])).values()];

        if (unique.length > 0) {
          console.log('[ScheduleRelease] FOUND ' + unique.length + ' NEW BLOCKS!');
          sendTelegram('🎯 Found ' + unique.length + ' new blocks! Grabbing...');

          // Grab up to 10 blocks (fill the entire week)
          for (const block of unique.slice(0, 10)) {
            const pickups = ALL_BASES.map(base =>
              rawPickupBlock(email, block.id, headers, base).catch(() => ({ status: 0, raw: 'ERROR' }))
            );
            const rr = await Promise.all(pickups);
            const won = rr.find(r => r && r.status === 200);
            if (won) {
              totalGrabbed++;
              DB.addLog(email, 'RELEASE_GRAB', block.id, 'grabbed', 'Schedule release grab at poll ' + polls);
              DB.addGrab(email, block.id, block.start, block.end, 'schedule_release');
              sendTelegram('✅ <b>GRABBED!</b> ' + new Date(block.start).toLocaleString() + ' for ' + email);
              console.log('[ScheduleRelease] GRABBED ' + block.id + ' for ' + email + ' (total: ' + totalGrabbed + ')');
            }
          }
        }
      } catch {}
      // 🔥 ALMIGHTY: 150ms polling during schedule release — every ms counts at midnight
      await new Promise(r => setTimeout(r, 150));
    }

    if (totalGrabbed === 0) {
      DB.addLog(email, 'RELEASE_MISS', undefined, 'fail', polls + ' polls, no blocks found');
      sendTelegram('❌ Release sniper: ' + polls + ' polls, no new blocks for ' + email);
    } else {
      sendTelegram('🏆 <b>RELEASE COMPLETE:</b> Grabbed ' + totalGrabbed + ' blocks for ' + email + ' in ' + polls + ' polls');
    }
  }

  // Schedule next release
  scheduleNextRelease();
}

function extractBlocksSimple(data: any): any[] {
  if (!data) return [];
  const blocks: any[] = [];
  const parse = (arr: any[]) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      blocks.push({
        id: b.id || b.block_id || '',
        start: b.scheduled_start || b.start_time || b.start || '',
        end: b.scheduled_end || b.end_time || b.end || '',
        type: b.type || b.status || 'UNKNOWN',
        couriers_needed: typeof b.couriers_needed === 'number' ? b.couriers_needed : 0,
      });
    }
  };
  if (data.blocks) parse(data.blocks);
  else if (data.schedule_blocks) parse(data.schedule_blocks);
  else if (Array.isArray(data)) parse(data);
  else if (data.data?.blocks) parse(data.data.blocks);
  return blocks;
}

// ══ CONNECTION PRE-WARMING ══
// Keep TCP connections alive to all subdomains
let warmingInterval: ReturnType<typeof setInterval> | null = null;

export function startConnectionWarming() {
  if (warmingInterval) return;
  warmingInterval = setInterval(async () => {
    for (const base of ALL_BASES) {
      try {
        await axios.head(base + '/healthcheck', { timeout: 2000, httpsAgent: releaseAgent, validateStatus: () => true });
      } catch {}
    }
  }, 25000); // Every 25s keeps connections alive
  console.log('[Warming] Connection pre-warming started');
}

export function stopConnectionWarming() {
  if (warmingInterval) { clearInterval(warmingInterval); warmingInterval = null; }
}

// ══ RATE LIMIT TRACKER ══
const rateLimitState = new Map<string, { count: number; resetAt: number; blocked: boolean }>();

export function trackRequest(base: string, statusCode: number) {
  const state = rateLimitState.get(base) || { count: 0, resetAt: Date.now() + 60000, blocked: false };

  if (Date.now() > state.resetAt) {
    state.count = 0;
    state.resetAt = Date.now() + 60000;
    state.blocked = false;
  }

  state.count++;

  if (statusCode === 429) {
    state.blocked = true;
    state.resetAt = Date.now() + NYC_INTELLIGENCE.backoffOnRateLimit;
    console.log('[RateLimit] ' + base + ' rate limited. Backing off ' + NYC_INTELLIGENCE.backoffOnRateLimit + 'ms');
  }

  rateLimitState.set(base, state);
}

export function getAvailableBases(): string[] {
  return ALL_BASES.filter(base => {
    const state = rateLimitState.get(base);
    if (!state) return true;
    if (state.blocked && Date.now() < state.resetAt) return false;
    return true;
  });
}

export function getRateLimitStatus(): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [base, state] of rateLimitState) {
    result[base] = { ...state, blockedFor: state.blocked ? Math.max(0, state.resetAt - Date.now()) : 0 };
  }
  return result;
}

// ══ NYC PEAK TIME TRACKER ══
export function getNextPeakDrop(): { time: string; reason: string; minutesAway: number } | null {
  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentHour = estNow.getHours();
  const currentMin = estNow.getMinutes();

  for (const peak of NYC_INTELLIGENCE.peakDropTimes) {
    let minsAway = (peak.hour - currentHour) * 60 + (peak.min - currentMin);
    if (minsAway < 0) minsAway += 24 * 60;
    if (minsAway < 120) { // Within 2 hours
      return {
        time: peak.hour + ':' + (peak.min < 10 ? '0' : '') + peak.min + ' EST',
        reason: peak.reason,
        minutesAway: minsAway,
      };
    }
  }
  return null;
}
