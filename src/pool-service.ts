import type { Root } from '@modelcontextprotocol/sdk/types.js';

import type { LeaseRecord, ToolCallResult } from './types.js';

type LeaseManagerLike = {
  acquire(threadId: string, ownerPid: number): Promise<LeaseRecord>;
  heartbeat(slotId: number): Promise<LeaseRecord | null>;
  releaseOwnedByPid(ownerPid: number): Promise<void>;
  list(): Promise<LeaseRecord[]>;
};

type SlotRuntimeLike = {
  callTool(slotId: number, toolName: string, args: Record<string, unknown>, roots: Root[]): Promise<ToolCallResult>;
  listStatuses?(): Array<{
    slotId: number;
    started: boolean;
    pid: number | null;
    logFile: string;
  }>;
};

type PoolServiceOptions = {
  sessionKeyEnv: string;
  sessionFallbackKey: string;
  heartbeatSeconds?: number;
  leaseManager: LeaseManagerLike;
  slotRuntime: SlotRuntimeLike;
};

type ToolRequest = {
  name: string;
  arguments?: Record<string, unknown>;
};

export class PoolService {
  private readonly heartbeatTimers = new Map<number, NodeJS.Timeout>();

  constructor(private readonly options: PoolServiceOptions) {}

  async callTool(request: ToolRequest, env: NodeJS.ProcessEnv, roots: Root[] = []): Promise<ToolCallResult> {
    if (request.name === 'pool_status') {
      return this.buildStatusResult();
    }

    const threadId = env[this.options.sessionKeyEnv] ?? this.options.sessionFallbackKey;
    if (!threadId) {
      throw new Error(`缺少会话标识环境变量 ${this.options.sessionKeyEnv}`);
    }

    const lease = await this.options.leaseManager.acquire(threadId, process.pid);
    this.ensureHeartbeat(lease.slotId);
    await this.options.leaseManager.heartbeat(lease.slotId);
    return this.options.slotRuntime.callTool(lease.slotId, request.name, request.arguments ?? {}, roots);
  }

  async shutdown(): Promise<void> {
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();
    await this.options.leaseManager.releaseOwnedByPid(process.pid);
  }

  private async buildStatusResult(): Promise<ToolCallResult> {
    const leases = await this.options.leaseManager.list();
    const runtimeStatuses = this.options.slotRuntime.listStatuses?.() ?? [];
    const lines = leases.length === 0
      ? ['当前没有活跃租约']
      : leases.map((lease) => `slot ${lease.slotId}: ${lease.threadId} (pid ${lease.ownerPid})`);

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n')
        }
      ],
      structuredContent: {
        leases,
        runtimeStatuses
      }
    };
  }

  private ensureHeartbeat(slotId: number): void {
    if (this.heartbeatTimers.has(slotId)) {
      return;
    }

    const intervalMs = (this.options.heartbeatSeconds ?? 10) * 1000;
    const timer = setInterval(() => {
      void this.options.leaseManager.heartbeat(slotId);
    }, intervalMs);
    timer.unref?.();
    this.heartbeatTimers.set(slotId, timer);
  }
}
