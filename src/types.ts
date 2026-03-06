export interface PoolConfig {
  size: number;
  sourceProfileDir?: string;
  profileDirTemplate: string;
  outputDirTemplate: string;
  leaseDir: string;
  logsDir: string;
  heartbeatSeconds: number;
  staleLeaseSeconds: number;
  sessionKeyEnv: string;
}

export interface PoolSlotPaths {
  profileDir: string;
  outputDir: string;
  logFile: string;
  leaseFile: string;
  lockDir: string;
}

export interface LeaseRecord {
  slotId: number;
  threadId: string;
  ownerPid: number;
  acquiredAt: string;
  lastHeartbeatAt: string;
  configPath: string;
}

export interface PlaywrightPoolConfig {
  pool: PoolConfig;
  playwright: Record<string, unknown>;
}

export interface ToolCallResult {
  content: Array<
    | {
        type: 'text';
        text: string;
      }
    | Record<string, unknown>
  >;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}
