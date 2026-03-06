import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';

import { buildSlotPaths } from './config.js';
import type { LeaseRecord, PoolConfig } from './types.js';

export class LeaseManager {
  constructor(
    private readonly poolConfig: PoolConfig,
    private readonly configPath: string
  ) {}

  async acquire(threadId: string, ownerPid: number): Promise<LeaseRecord> {
    const existingLease = await this.findLeaseByThread(threadId);
    if (existingLease && !this.isStale(existingLease)) {
      if (existingLease.ownerPid === ownerPid && existingLease.configPath === this.configPath) {
        return existingLease;
      }

      return this.persistLease(existingLease.slotId, {
        ...existingLease,
        ownerPid,
        configPath: this.configPath,
        lastHeartbeatAt: new Date().toISOString()
      });
    }

    if (existingLease && this.isStale(existingLease)) {
      await this.release(existingLease.slotId);
    }

    for (let slotId = 1; slotId <= this.poolConfig.size; slotId += 1) {
      const slotPaths = buildSlotPaths(this.poolConfig, slotId);
      const lease = await this.readLease(slotId);

      if (lease && !this.isStale(lease)) {
        continue;
      }

      if (lease && this.isStale(lease)) {
        await this.release(slotId);
      }

      const lockAcquired = await this.tryAcquireLock(slotPaths.lockDir);
      if (!lockAcquired) {
        continue;
      }

      try {
        const latestLease = await this.readLease(slotId);
        if (latestLease && !this.isStale(latestLease)) {
          continue;
        }

        const now = new Date().toISOString();
        const nextLease: LeaseRecord = {
          slotId,
          threadId,
          ownerPid,
          acquiredAt: now,
          lastHeartbeatAt: now,
          configPath: this.configPath
        };
        return this.persistLease(slotId, nextLease);
      } finally {
        await rm(slotPaths.lockDir, { recursive: true, force: true });
      }
    }

    throw new Error('当前没有可用 Playwright 资源');
  }

  async heartbeat(slotId: number): Promise<LeaseRecord | null> {
    const lease = await this.readLease(slotId);
    if (!lease) {
      return null;
    }

    const nextLease = {
      ...lease,
      lastHeartbeatAt: new Date().toISOString()
    };
    return this.persistLease(slotId, nextLease);
  }

  async release(slotId: number): Promise<void> {
    const slotPaths = buildSlotPaths(this.poolConfig, slotId);
    await rm(slotPaths.leaseFile, { force: true });
    await rm(slotPaths.lockDir, { recursive: true, force: true });
  }

  async releaseOwnedByPid(ownerPid: number): Promise<void> {
    const leases = await this.list();
    await Promise.all(
      leases
        .filter((lease) => lease.ownerPid === ownerPid)
        .map((lease) => this.release(lease.slotId))
    );
  }

  async list(): Promise<LeaseRecord[]> {
    const leases = await Promise.all(
      Array.from({ length: this.poolConfig.size }, (_, index) => this.readLease(index + 1))
    );
    return leases.filter((lease): lease is LeaseRecord => lease !== null);
  }

  private async findLeaseByThread(threadId: string): Promise<LeaseRecord | null> {
    const leases = await this.list();
    return leases.find((lease) => lease.threadId === threadId) ?? null;
  }

  private isStale(lease: LeaseRecord): boolean {
    const staleAfterMs = this.poolConfig.staleLeaseSeconds * 1000;
    return Date.now() - Date.parse(lease.lastHeartbeatAt) > staleAfterMs;
  }

  private async readLease(slotId: number): Promise<LeaseRecord | null> {
    const slotPaths = buildSlotPaths(this.poolConfig, slotId);
    try {
      const content = await readFile(slotPaths.leaseFile, 'utf8');
      return JSON.parse(content) as LeaseRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async tryAcquireLock(lockDir: string): Promise<boolean> {
    await mkdir(this.poolConfig.leaseDir, { recursive: true });
    try {
      await mkdir(lockDir);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const fileStat = await stat(lockDir).catch(() => null);
        if (fileStat?.isDirectory()) {
          return false;
        }
      }
      throw error;
    }
  }

  private async persistLease(slotId: number, lease: LeaseRecord): Promise<LeaseRecord> {
    const slotPaths = buildSlotPaths(this.poolConfig, slotId);
    await mkdir(this.poolConfig.leaseDir, { recursive: true });
    await writeFile(slotPaths.leaseFile, `${JSON.stringify(lease, null, 2)}\n`, 'utf8');
    return lease;
  }
}
