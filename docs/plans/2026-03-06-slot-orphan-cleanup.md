# Slot 孤儿回收 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Codex / playwright_pool 异常断开后，slot-server 立即清理自己仍持有的 lease 和 Chrome 进程。

**Architecture:** 保持现有 `Codex -> playwright_pool -> slot-server -> Chrome` 架构不变，只在 `slot-server` 增加父进程失联守护和统一清理逻辑。清理前先校验当前 lease 是否仍归属于原父进程，避免误删新会话的 slot 与浏览器。

**Tech Stack:** Node 18、TypeScript、Vitest、MCP stdio、Playwright MCP

---

### Task 1: 补 Lease 归属保护测试

**Files:**
- Modify: `tests/lease-manager.test.ts`
- Modify: `src/lease-manager.ts`

**Step 1: 写失败测试**
- 增加 `releaseIfOwnedBy` 的测试：
  - 归属匹配时删除 lease 并返回 `true`
  - 归属不匹配时保留 lease 并返回 `false`

**Step 2: 跑测试确认失败**

Run: `npm test`

**Step 3: 写最小实现**
- 在 `LeaseManager` 中增加只读 lease 和按 `slotId + ownerPid + configPath` 条件释放的方法。

**Step 4: 跑测试确认通过**

Run: `npm test`

### Task 2: 补父进程守护测试

**Files:**
- Create: `tests/slot-guardian.test.ts`
- Create: `src/slot-guardian.ts`

**Step 1: 写失败测试**
- 父进程存活时不触发清理
- 父进程消失时触发一次清理
- 多次触发信号时仍只清理一次

**Step 2: 跑测试确认失败**

Run: `npm test`

**Step 3: 写最小实现**
- 实现父进程存活探测
- 实现定时 watcher 和幂等清理包装

**Step 4: 跑测试确认通过**

Run: `npm test`

### Task 3: 接入 slot-server

**Files:**
- Modify: `src/slot-server.ts`

**Step 1: 写失败测试**
- 复用单元测试覆盖新的守护逻辑，不额外搭重型集成测试

**Step 2: 写最小实现**
- `slot-server` 注册：
  - `transport.onclose`
  - `stdin end/close`
  - `SIGINT/SIGTERM`
  - `uncaughtException/unhandledRejection`
  - 父进程 PID watcher
- 统一走 `cleanupOnce`
- 清理前校验 slot 归属；仅在 lease 仍归自己时才删 lease 并 `pkill` 当前 profile

**Step 3: 跑测试和构建**

Run:
- `npm test`
- `npm run build`

### Task 4: 做真实 smoke test

**Files:**
- Modify: none

**Step 1: 启动一个外部 `npx @jianzhangg/playwright-pool` 客户端**
- 导航到一个真实网页，拿到 lease 和 slot

**Step 2: 模拟父进程退出**
- 结束对应 client 进程

**Step 3: 验证清理**
- lease 被删除
- 对应 profile 的 Chrome 进程被清掉

**Step 4: 如验证通过，再总结并准备发版**
