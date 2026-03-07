import type { Root } from '@modelcontextprotocol/sdk/types.js';

import { measureSerializedBytes, noopServerLogger, type ServerLoggerLike } from './server-logger.js';
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
  logger?: ServerLoggerLike;
};

type ToolRequest = {
  name: string;
  arguments?: Record<string, unknown>;
};

export class PoolService {
  private readonly heartbeatTimers = new Map<number, NodeJS.Timeout>();
  private readonly logger: ServerLoggerLike;

  constructor(private readonly options: PoolServiceOptions) {
    this.logger = options.logger ?? noopServerLogger;
  }

  async callTool(request: ToolRequest, env: NodeJS.ProcessEnv, roots: Root[] = []): Promise<ToolCallResult> {
    if (request.name === 'pool_status') {
      return this.buildStatusResult();
    }

    const threadId = env[this.options.sessionKeyEnv] ?? this.options.sessionFallbackKey;
    if (!threadId) {
      throw new Error(`缺少会话标识环境变量 ${this.options.sessionKeyEnv}`);
    }

    const args = request.arguments ?? {};
    const argsBytes = measureSerializedBytes(args);
    const lease = await this.options.leaseManager.acquire(threadId, process.pid);
    this.logger.info('lease_acquired', {
      slotId: lease.slotId,
      threadId,
      ownerPid: lease.ownerPid
    });

    this.ensureHeartbeat(lease.slotId);

    try {
      const refreshedLease = await this.options.leaseManager.heartbeat(lease.slotId);
      this.logger.info('heartbeat_tick', {
        slotId: lease.slotId,
        active: refreshedLease !== null,
        reason: 'tool_call'
      });
    } catch (error) {
      this.logger.error('heartbeat_error', {
        slotId: lease.slotId,
        reason: 'tool_call',
        error: serializeError(error)
      });
      throw error;
    }

    const startedAt = Date.now();
    this.logger.info('tool_call_start', {
      slotId: lease.slotId,
      threadId,
      tool: request.name,
      rootsCount: roots.length,
      argsBytes
    });

    try {
      const result = await this.options.slotRuntime.callTool(lease.slotId, request.name, args, roots);
      this.logger.info('tool_call_end', {
        slotId: lease.slotId,
        threadId,
        tool: request.name,
        rootsCount: roots.length,
        argsBytes,
        resultBytes: measureSerializedBytes(result),
        durationMs: Date.now() - startedAt,
        isError: result.isError ?? false
      });
      return result;
    } catch (error) {
      this.logger.error('tool_call_error', {
        slotId: lease.slotId,
        threadId,
        tool: request.name,
        rootsCount: roots.length,
        argsBytes,
        durationMs: Date.now() - startedAt,
        error: serializeError(error)
      });
      throw error;
    }
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
    this.logger.info('heartbeat_timer_started', {
      slotId,
      intervalMs
    });
    const timer = setInterval(() => {
      void this.runHeartbeat(slotId);
    }, intervalMs);
    timer.unref?.();
    this.heartbeatTimers.set(slotId, timer);
  }

  private async runHeartbeat(slotId: number): Promise<void> {
    try {
      const lease = await this.options.leaseManager.heartbeat(slotId);
      this.logger.info('heartbeat_tick', {
        slotId,
        active: lease !== null
      });
      if (!lease) {
        const timer = this.heartbeatTimers.get(slotId);
        if (timer) {
          clearInterval(timer);
          this.heartbeatTimers.delete(slotId);
        }
      }
    } catch (error) {
      this.logger.error('heartbeat_error', {
        slotId,
        error: serializeError(error)
      });
    }
  }
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}
