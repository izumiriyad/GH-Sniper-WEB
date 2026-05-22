export declare const API_ENDPOINTS: {
    primary: string;
    east: string;
    west: string;
    altGtm: string;
    authGtm: string;
};
export declare function getProxyAgent(email: string): any;
export declare function rotateProxy(email: string): void;
export interface Block {
    id: string;
    start: string;
    end: string;
    type: string;
    couriers_needed: number;
    pay: any;
    overlapping_block_ids: string[];
}
export declare function getTrueTime(): number;
export declare function getBlocks(email: string): Promise<Block[]>;
export declare const rawPickupBlock: (email: string, blockId: string, headers: Record<string, string>, baseUrl: string) => Promise<{
    status: number;
    raw: string;
}>;
export declare function pickupBlock(email: string, blockId: string): Promise<{
    success: boolean;
    status: number;
    detail: string;
}>;
export declare function refreshToken(email: string): Promise<boolean>;
export declare function isTokenExpiring(email: string): boolean;
export interface SniperResult {
    success: boolean;
    strategy: string;
    message: string;
    httpStatus?: number;
    block?: Block | null;
}
export declare function cacheDesyncScan(email: string, log: (m: string) => void): Promise<SniperResult>;
export declare function bruteForcePickup(email: string, log: (m: string) => void): Promise<SniperResult>;
export declare function dropWindowSniper(email: string, log: (m: string) => void): Promise<SniperResult>;
export declare function microSnipe(email: string, durationMs: number, log: (m: string) => void): Promise<SniperResult>;
export declare function continuousPickup(email: string, intervalMs: number, log: (m: string) => void, shouldStop: () => boolean): Promise<SniperResult>;
export declare function instantBypass(email: string, log: (m: string) => void): Promise<SniperResult[]>;
//# sourceMappingURL=grubhubApi.d.ts.map