export declare function setTelegramConfig(botToken: string, chatId: string): void;
export declare function getTelegramConfig(): {
    botToken: string;
    chatId: string;
};
export declare function sendTelegram(message: string): Promise<void>;
export declare const NYC_INTELLIGENCE: {
    scheduleReleaseDays: {
        premier: string;
        pro: string;
        partner: string;
    };
    scheduleReleaseHour: number;
    scheduleReleaseMinute: number;
    peakDropTimes: {
        hour: number;
        min: number;
        reason: string;
    }[];
    noShowWindows: {
        offsetMin: number;
        offsetMax: number;
        reason: string;
    }[];
    hotRegions: string[];
    maxRequestsPerMinute: number;
    backoffOnRateLimit: number;
};
interface ScheduleReleaseConfig {
    driverLevel: 'premier' | 'pro' | 'partner';
    email: string;
    enabled: boolean;
}
export declare function setScheduleReleaseConfig(email: string, driverLevel: 'premier' | 'pro' | 'partner'): void;
export declare function getScheduleReleaseConfigs(): ScheduleReleaseConfig[];
export declare function startConnectionWarming(): void;
export declare function stopConnectionWarming(): void;
export declare function trackRequest(base: string, statusCode: number): void;
export declare function getAvailableBases(): string[];
export declare function getRateLimitStatus(): Record<string, any>;
export declare function getNextPeakDrop(): {
    time: string;
    reason: string;
    minutesAway: number;
} | null;
export {};
//# sourceMappingURL=nycIntelligence.d.ts.map