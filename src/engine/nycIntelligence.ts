// NYC Market Intelligence + GUARANTEED Schedule Release + Telegram Alerts
// v4 ALMIGHTY: Watchdog-based schedule release that NEVER misses
import axios from 'axios';
import https from 'https';
import DB from '../db/database';
import { getBlocks, pickupBlock, refreshToken, isTokenExpiring, Block, API_ENDPOINTS, rawPickupBlock, getTrueTime, syncServerTime, getProxyStatus } from '../api/grubhubApi';

// Dedicated stealth agent for schedule release
const releaseAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: Infinity,
  maxFreeSockets: 500,
  timeout: 30000,
  scheduling: 'fifo',
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
});

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
export const NYC_INTELLIGENCE = {
  scheduleReleaseDays: {
    premier: 'Thursday',
    pro: 'Friday',
    partner: 'Saturday',
  },
  scheduleReleaseHour: 0,
  scheduleReleaseMinute: 0,

  peakDropTimes: [
    { hour: 6, min: 0, reason: 'Morning shift drops (drivers who overslept)' },
    { hour: 10, min: 30, reason: 'Late morning adjustments' },
    { hour: 14, min: 0, reason: 'Afternoon shift changes' },
    { hour: 16, min: 0, reason: 'Pre-dinner rush drops' },
    { hour: 22, min: 0, reason: 'Late night drops' },
  ],

  noShowWindows: [
    { offsetMin: 13, offsetMax: 16, reason: 'Hour blocks: 14-min grace period expired' },
    { offsetMin: 43, offsetMax: 46, reason: 'Half-hour blocks: 14-min grace period expired' },
  ],

  hotRegions: ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],
  maxRequestsPerMinute: 20,
  backoffOnRateLimit: 5000,
};

// ══ PROPER EST/EDT TIMEZONE (No toLocaleString bullshit) ══
// EST = UTC-5, EDT = UTC-4. We calculate DST manually.
function getESTDate(): Date {
  const now = new Date();
  const year = now.getUTCFullYear();
  
  // US DST: Second Sunday of March to First Sunday of November
  const marchSecondSunday = new Date(Date.UTC(year, 2, 1));
  marchSecondSunday.setUTCDate(14 - marchSecondSunday.getUTCDay());
  marchSecondSunday.setUTCHours(7, 0, 0, 0); // 2AM EST = 7AM UTC
  
  const novFirstSunday = new Date(Date.UTC(year, 10, 1));
  novFirstSunday.setUTCDate(7 - novFirstSunday.getUTCDay());
  novFirstSunday.setUTCHours(6, 0, 0, 0); // 2AM EDT = 6AM UTC
  
  const isDST = now.getTime() >= marchSecondSunday.getTime() && now.getTime() < novFirstSunday.getTime();
  const offsetHours = isDST ? -4 : -5;
  
  return new Date(now.getTime() + offsetHours * 3600000);
}

function getESTNow(): { hour: number; minute: number; second: number; dayOfWeek: number; timestamp: number } {
  const est = getESTDate();
  return {
    hour: est.getUTCHours(),
    minute: est.getUTCMinutes(),
    second: est.getUTCSeconds(),
    dayOfWeek: est.getUTCDay(), // 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat
    timestamp: Date.now(),
  };
}

// ══ GUARANTEED SCHEDULE RELEASE SYSTEM ══
// Instead of one setTimeout, a persistent watchdog checks every 30s

interface ScheduleReleaseConfig {
  driverLevel: 'premier' | 'pro' | 'partner';
  email: string;
  enabled: boolean;
}

// In-memory state (loaded from DB on boot)
const releaseConfigs = new Map<string, ScheduleReleaseConfig>();

// Release state tracking
let releaseState: {
  phase: 'idle' | 'warming' | 'pre_refresh' | 'polling' | 'cooldown';
  lastFireTime: number;
  lastPhaseChange: number;
  totalGrabsThisSession: number;
  pollCount: number;
} = {
  phase: 'idle',
  lastFireTime: 0,
  lastPhaseChange: 0,
  totalGrabsThisSession: 0,
  pollCount: 0,
};

export function setScheduleReleaseConfig(email: string, driverLevel: 'premier' | 'pro' | 'partner') {
  releaseConfigs.set(email, { driverLevel, email, enabled: true });
  DB.setScheduleConfig(email, driverLevel);
  console.log('[ScheduleRelease] Config saved: ' + email + ' (' + driverLevel + ')');
}

export function getScheduleReleaseConfigs(): ScheduleReleaseConfig[] {
  return [...releaseConfigs.values()];
}

export function getScheduleReleaseState() {
  return { ...releaseState, configCount: releaseConfigs.size };
}

// Load configs from DB on boot
function loadScheduleConfigsFromDB() {
  try {
    const rows = DB.getScheduleConfigs();
    for (const row of rows) {
      releaseConfigs.set(row.email, {
        email: row.email,
        driverLevel: row.driver_level as 'premier' | 'pro' | 'partner',
        enabled: true,
      });
    }
    console.log('[ScheduleRelease] Loaded ' + releaseConfigs.size + ' configs from DB');
  } catch (e: any) {
    console.error('[ScheduleRelease] Failed to load configs:', e.message);
  }
}

// 🔥 CORE: Get minutes until next release for ANY config
function getMinutesToRelease(): { minutesAway: number; configs: ScheduleReleaseConfig[]; releaseLabel: string } | null {
  if (releaseConfigs.size === 0) return null;
  
  const dayMap: Record<string, number> = { premier: 4, pro: 5, partner: 6 }; // Thu=4, Fri=5, Sat=6
  const est = getESTNow();
  
  let bestMinutes = Infinity;
  let bestConfigs: ScheduleReleaseConfig[] = [];
  let bestLabel = '';
  
  for (const config of releaseConfigs.values()) {
    if (!config.enabled) continue;
    const targetDay = dayMap[config.driverLevel];
    
    let daysUntil = targetDay - est.dayOfWeek;
    if (daysUntil < 0) daysUntil += 7;
    // If it's the target day but past 00:10 EST, wait for next week
    if (daysUntil === 0 && (est.hour > 0 || est.minute > 10)) daysUntil = 7;
    
    const minutesAway = daysUntil * 24 * 60 + (0 - est.hour) * 60 + (0 - est.minute);
    const adjustedMinutes = minutesAway < 0 ? minutesAway + 7 * 24 * 60 : minutesAway;
    
    if (adjustedMinutes < bestMinutes) {
      bestMinutes = adjustedMinutes;
      bestConfigs = [config];
      bestLabel = config.driverLevel + ' (' + NYC_INTELLIGENCE.scheduleReleaseDays[config.driverLevel] + ')';
    } else if (adjustedMinutes === bestMinutes) {
      bestConfigs.push(config);
    }
  }
  
  if (bestMinutes === Infinity) return null;
  return { minutesAway: bestMinutes, configs: bestConfigs, releaseLabel: bestLabel };
}

// 🔥 WATCHDOG: Runs every 30 seconds, handles all schedule release phases
let watchdogInterval: ReturnType<typeof setInterval> | null = null;

function startScheduleWatchdog() {
  if (watchdogInterval) return;
  
  loadScheduleConfigsFromDB();
  
  watchdogInterval = setInterval(async () => {
    if (releaseConfigs.size === 0) return;
    if (releaseState.phase === 'polling' || releaseState.phase === 'cooldown') return; // Already firing
    
    const next = getMinutesToRelease();
    if (!next) return;
    
    // Phase transitions based on minutes to release
    if (next.minutesAway <= 5 && next.minutesAway > 2 && releaseState.phase === 'idle') {
      // T-5 MINUTES: Pre-warm connections
      releaseState.phase = 'warming';
      releaseState.lastPhaseChange = Date.now();
      console.log('[ScheduleRelease] T-5min: Pre-warming connections for ' + next.releaseLabel);
      sendTelegram('🔥 <b>T-5 MINUTES!</b>\nSchedule release warming up for ' + next.releaseLabel + '\nPre-warming connections to all GH subdomains...');
      
      // Warm connections to all subdomains
      for (const base of ALL_BASES) {
        try {
          await axios.head(base + '/healthcheck', { timeout: 3000, httpsAgent: releaseAgent, validateStatus: () => true });
        } catch {}
      }
      await syncServerTime();
    }
    
    if (next.minutesAway <= 2 && next.minutesAway > 0.5 && releaseState.phase === 'warming') {
      // T-2 MINUTES: Pre-refresh ALL tokens
      releaseState.phase = 'pre_refresh';
      releaseState.lastPhaseChange = Date.now();
      console.log('[ScheduleRelease] T-2min: Pre-refreshing tokens');
      sendTelegram('🔄 <b>T-2 MINUTES!</b>\nRefreshing all tokens before midnight drop...');
      
      for (const config of next.configs) {
        if (isTokenExpiring(config.email)) {
          await refreshToken(config.email);
          console.log('[ScheduleRelease] Token refreshed: ' + config.email);
        }
      }
      
      // Final connection warm
      await syncServerTime();
    }
    
    if (next.minutesAway <= 0.5 && (releaseState.phase as string) !== 'polling') {
      // T-30 SECONDS: START POLLING (blocks sometimes appear early!)
      releaseState.phase = 'polling';
      releaseState.lastPhaseChange = Date.now();
      releaseState.pollCount = 0;
      releaseState.totalGrabsThisSession = 0;
      console.log('[ScheduleRelease] 🚀 FIRING! Polling started for ' + next.releaseLabel);
      sendTelegram('🚀 <b>SCHEDULE RELEASE FIRING!</b>\n' + next.releaseLabel + '\nPolling ALL subdomains at 50ms intervals for 10 minutes...');
      
      // Fire the actual polling loop (non-blocking)
      fireGuaranteedRelease(next.configs).then(() => {
        releaseState.phase = 'cooldown';
        releaseState.lastFireTime = Date.now();
        // Return to idle after 15 minutes cooldown
        setTimeout(() => { releaseState.phase = 'idle'; }, 15 * 60 * 1000);
      });
    }
  }, 30000); // Check every 30 seconds
  
  console.log('[ScheduleRelease] Watchdog active. Checking every 30s. ' + releaseConfigs.size + ' configs loaded.');
}

// 🔥 THE ACTUAL GUARANTEED RELEASE POLLER
async function fireGuaranteedRelease(configs: ScheduleReleaseConfig[]) {
  const POLL_DURATION_MS = 10 * 60 * 1000; // 10 full minutes
  const POLL_INTERVAL_MS = 50; // 50ms = 20 polls/second = blazing fast
  const deadline = Date.now() + POLL_DURATION_MS;
  
  const grabbedIds = new Set<string>();
  let totalGrabbed = 0;
  let polls = 0;
  
  for (const config of configs) {
    const email = config.email;
    DB.addLog(email, 'SCHEDULE_RELEASE', undefined, 'info', 'GUARANTEED release firing for ' + config.driverLevel);
    
    const acc = DB.getAccount(email);
    if (!acc?.access_token) {
      console.log('[ScheduleRelease] No token for ' + email + ' — skipping');
      continue;
    }
    
    // Build stealth headers
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
    
    while (Date.now() < deadline) {
      polls++;
      releaseState.pollCount = polls;
      
      if (polls % 200 === 0) {
        console.log('[ScheduleRelease] Poll #' + polls + ' | ' + totalGrabbed + ' grabs | ' + Math.round((deadline - Date.now()) / 1000) + 's remaining');
      }
      
      try {
        // Scan ALL subdomains simultaneously
        const scans = await Promise.all(ALL_BASES.map(base =>
          axios.get(base + BLOCK_PATH, { headers, timeout: 3000, httpsAgent: releaseAgent, validateStatus: () => true })
            .then(res => {
              if (res.status !== 200) return [];
              return extractBlocksSimple(res.data).filter(b =>
                b.couriers_needed > 0 &&
                new Date(b.start) > new Date(getTrueTime()) &&
                !grabbedIds.has(b.id)
              );
            })
            .catch(() => [] as any[])
        ));
        
        // De-duplicate across all subdomains
        const allOpen = scans.flat();
        const unique = [...new Map(allOpen.map(b => [b.id, b])).values()];
        
        if (unique.length > 0) {
          console.log('[ScheduleRelease] 🎯 FOUND ' + unique.length + ' BLOCKS at poll #' + polls + '!');
          sendTelegram('🎯 Found <b>' + unique.length + '</b> new blocks at poll #' + polls + '! Grabbing ALL...');
          
          // Grab EVERY single block — NO LIMIT
          for (const block of unique) {
            if (grabbedIds.has(block.id)) continue;
            
            // Fire pickup across ALL subdomains for maximum race advantage
            const pickups = ALL_BASES.map(base =>
              rawPickupBlock(email, block.id, headers, base).catch(() => ({ status: 0, raw: 'ERROR' }))
            );
            const results = await Promise.all(pickups);
            const won = results.find(r => r && r.status === 200);
            
            if (won) {
              grabbedIds.add(block.id);
              totalGrabbed++;
              releaseState.totalGrabsThisSession = totalGrabbed;
              DB.addLog(email, 'RELEASE_GRAB', block.id, 'grabbed', 'Schedule release @ poll #' + polls);
              DB.addGrab(email, block.id, block.start, block.end, 'schedule_release');
              sendTelegram('✅ <b>GRABBED #' + totalGrabbed + '!</b>\n' + new Date(block.start).toLocaleString() + '\nPoll: #' + polls + ' | Account: ' + email);
              console.log('[ScheduleRelease] ✅ GRABBED ' + block.id + ' (#' + totalGrabbed + ') for ' + email);
            } else {
              // Retry failed grabs after 100ms
              await new Promise(r => setTimeout(r, 100));
              const retryResults = await Promise.all(ALL_BASES.map(base =>
                rawPickupBlock(email, block.id, headers, base).catch(() => ({ status: 0, raw: 'RETRY_ERROR' }))
              ));
              const retryWon = retryResults.find(r => r && r.status === 200);
              if (retryWon) {
                grabbedIds.add(block.id);
                totalGrabbed++;
                releaseState.totalGrabsThisSession = totalGrabbed;
                DB.addLog(email, 'RELEASE_GRAB_RETRY', block.id, 'grabbed', 'Retry succeeded @ poll #' + polls);
                DB.addGrab(email, block.id, block.start, block.end, 'schedule_release_retry');
                sendTelegram('✅ <b>GRABBED (RETRY) #' + totalGrabbed + '!</b>\n' + new Date(block.start).toLocaleString());
              }
            }
          }
        }
        
        // Auto-refresh token mid-session if needed (every 500 polls)
        if (polls % 500 === 0 && isTokenExpiring(email)) {
          console.log('[ScheduleRelease] Mid-session token refresh for ' + email);
          const refreshed = await refreshToken(email);
          if (refreshed) {
            const newAcc = DB.getAccount(email);
            if (newAcc?.access_token) {
              headers['Authorization'] = 'Bearer ' + newAcc.access_token;
            }
          }
        }
        
      } catch (e: any) {
        if (polls % 100 === 0) console.log('[ScheduleRelease] Poll error: ' + e.message);
      }
      
      // 50ms interval — 20 polls per second
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    
    // Session complete
    if (totalGrabbed === 0) {
      DB.addLog(email, 'RELEASE_MISS', undefined, 'fail', polls + ' polls in 10 minutes, no blocks found');
      sendTelegram('❌ Schedule release: <b>' + polls + ' polls</b> in 10 minutes, no new blocks for ' + email + '. Will retry next week.');
    } else {
      sendTelegram('🏆 <b>RELEASE COMPLETE!</b>\nGrabbed <b>' + totalGrabbed + '</b> blocks for ' + email + '\nTotal polls: ' + polls);
    }
  }
  
  console.log('[ScheduleRelease] Session complete. ' + totalGrabbed + ' total grabs in ' + polls + ' polls.');
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
let warmingInterval: ReturnType<typeof setInterval> | null = null;

export function startConnectionWarming() {
  if (warmingInterval) return;
  warmingInterval = setInterval(async () => {
    for (const base of ALL_BASES) {
      try {
        await axios.head(base + '/healthcheck', { timeout: 2000, httpsAgent: releaseAgent, validateStatus: () => true });
      } catch {}
    }
    // Also sync server time
    try { await syncServerTime(); } catch {}
  }, 25000);
  console.log('[Warming] Connection pre-warming started (every 25s + time sync)');
  
  // Also start the schedule release watchdog
  startScheduleWatchdog();
}

export function stopConnectionWarming() {
  if (warmingInterval) { clearInterval(warmingInterval); warmingInterval = null; }
  if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
}

// ══ RATE LIMIT TRACKER ══
const rateLimitState = new Map<string, { count: number; resetAt: number; blocked: boolean }>();

export function trackRequest(base: string, statusCode: number) {
  const state = rateLimitState.get(base) || { count: 0, resetAt: Date.now() + 60000, blocked: false };
  if (Date.now() > state.resetAt) { state.count = 0; state.resetAt = Date.now() + 60000; state.blocked = false; }
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
  const est = getESTNow();
  
  for (const peak of NYC_INTELLIGENCE.peakDropTimes) {
    let minsAway = (peak.hour - est.hour) * 60 + (peak.min - est.minute);
    if (minsAway < 0) minsAway += 24 * 60;
    if (minsAway < 120) {
      return {
        time: peak.hour + ':' + (peak.min < 10 ? '0' : '') + peak.min + ' EST',
        reason: peak.reason,
        minutesAway: minsAway,
      };
    }
  }
  return null;
}

// 🔥 v4: Get next schedule release info for dashboard
export function getNextScheduleRelease() {
  const next = getMinutesToRelease();
  if (!next) return null;
  return {
    minutesAway: next.minutesAway,
    label: next.releaseLabel,
    accounts: next.configs.map(c => c.email),
    state: releaseState,
  };
}
