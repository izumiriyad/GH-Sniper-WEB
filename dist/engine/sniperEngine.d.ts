import { SniperResult } from '../api/grubhubApi';
interface SniperInstance {
    email: string;
    running: boolean;
    stopFlag: boolean;
    cycles: number;
    lastLog: string;
    logs: string[];
    startedAt: number;
    result: SniperResult | null;
    warmupTimer: ReturnType<typeof setInterval> | null;
}
export declare function startConnectionWarming(): void;
export declare function getSniperStatus(email: string): SniperInstance | undefined;
export declare function getAllSniperStatuses(): SniperInstance[];
export declare function startSniper(email: string, intervalMs?: number): Promise<{
    started: boolean;
    message: string;
}>;
export declare function stopSniper(email: string): {
    stopped: boolean;
    message: string;
};
export declare function autoRestartSnipers(): void;
export {};
//# sourceMappingURL=sniperEngine.d.ts.map