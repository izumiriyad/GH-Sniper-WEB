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
export declare const DB: {
    addAccount(email: string, accessToken: string, refreshToken: string, expiresAt: number, deviceProfile?: object, capturedHeaders?: object): AccountRow;
    getAccount(email: string): AccountRow | undefined;
    getAccountById(id: string): AccountRow | undefined;
    getAllAccounts(): AccountRow[];
    updateTokens(email: string, accessToken: string, refreshToken: string, expiresAt: number): void;
    updateStatus(email: string, status: string): void;
    setSniperRunning(email: string, running: boolean): void;
    setSniperInterval(email: string, intervalMs: number): void;
    deleteAccount(email: string): void;
    addLog(email: string, action: string, blockId?: string, status?: string, message?: string, httpCode?: number): void;
    addLogsBatch(entries: Array<{
        email: string;
        action: string;
        blockId?: string;
        status?: string;
        message?: string;
        httpCode?: number;
    }>): void;
    getLogs(email: string, limit?: number): unknown[];
    getAllLogs(limit?: number): unknown[];
    addGrab(email: string, blockId: string, blockStart: string, blockEnd: string, strategy: string): void;
    getGrabs(email: string, limit?: number): unknown[];
    getAllGrabs(limit?: number): unknown[];
    getGrabCount(email: string): number;
    getTotalGrabCount(): number;
    performMaintenance(): void;
    resetAllSniperFlags(): void;
    getStats(): {
        accounts: any;
        logs: any;
        grabs: any;
        dbSizeBytes: number;
        walSizeBytes: number;
    };
};
export default DB;
//# sourceMappingURL=database.d.ts.map