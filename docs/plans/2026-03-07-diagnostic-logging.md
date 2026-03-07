# 诊断日志实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 给 `playwright-pool` 主进程增加默认开启的低开销诊断日志，便于未来复现内存问题时快速还原现场。

**Architecture:** 新增一个轻量主进程日志器，统一写入 `pool.logsDir/server-<pid>.log`。`server.ts` 创建日志器并注入 `PoolService` / `SlotRuntime`，在工具调用、租约心跳、slot 生命周期等关键边界记录单行结构化日志和内存快照。

**Tech Stack:** TypeScript、Node.js 文件流、Vitest

---

### Task 1: 主进程日志接口

**Files:**
- Create: `C:\code\playwright-pool\src\server-logger.ts`

**Step 1: 写失败测试**

- 本任务先不单独写测试，日志接口由下游 `PoolService` / `SlotRuntime` 测试覆盖。

**Step 2: 写最小实现**

- 提供 `createServerLogger(logsDir)`：
  - 创建 `server-<pid>.log`
  - 暴露 `info(event, fields)` / `error(event, fields)` / `close()`
  - 自动附带 PID 和内存字段

**Step 3: 本地自检**

Run: `npm test -- tests/pool-service.test.ts tests/slot-runtime.test.ts`

Expected: 先失败，因为还没接入。

### Task 2: PoolService 日志

**Files:**
- Modify: `C:\code\playwright-pool\src\pool-service.ts`
- Test: `C:\code\playwright-pool\tests\pool-service.test.ts`

**Step 1: 写失败测试**

- 新增用例验证：
  - 普通工具调用会写 `tool_call_start`
  - 调用成功会写 `tool_call_end`
  - 心跳定时器建立后会写 `heartbeat_timer_started`

**Step 2: 跑测试确认失败**

Run: `npm test -- tests/pool-service.test.ts`

Expected: FAIL，提示缺少日志调用。

**Step 3: 写最小实现**

- 给 `PoolServiceOptions` 增加可选 logger
- 在 `callTool()` 里记录：
  - threadId
  - slotId
  - tool
  - argsBytes / rootsCount
  - resultBytes / durationMs
- 在 `ensureHeartbeat()` 里记录 timer 建立
- 在每次 heartbeat tick 后记录结果，异常时写 error

**Step 4: 跑测试确认通过**

Run: `npm test -- tests/pool-service.test.ts`

Expected: PASS

### Task 3: SlotRuntime 生命周期日志

**Files:**
- Modify: `C:\code\playwright-pool\src\slot-runtime.ts`
- Test: `C:\code\playwright-pool\tests\slot-runtime.test.ts`

**Step 1: 写失败测试**

- 新增用例验证：
  - 启动 client 时写 `slot_client_start` / `slot_client_connected`
  - transport 自然关闭时写 `slot_transport_close`
  - roots 变化替换旧 handle 时写 `slot_client_replace`

**Step 2: 跑测试确认失败**

Run: `npm test -- tests/slot-runtime.test.ts`

Expected: FAIL

**Step 3: 写最小实现**

- 给 `SlotRuntime` 增加可选 logger
- 在 `startClient()`、`transport.onclose`、`ensureClient()` 替换 handle 时打点
- 在 `stopClient()` / `closeAll()` 主动关闭路径打点

**Step 4: 跑测试确认通过**

Run: `npm test -- tests/slot-runtime.test.ts`

Expected: PASS

### Task 4: server.ts 接线

**Files:**
- Modify: `C:\code\playwright-pool\src\server.ts`

**Step 1: 接入日志器**

- 配置加载后创建主进程日志器
- 注入 `PoolService` 与 `SlotRuntime`
- 在启动、连接成功、关闭、异常退出时打点

**Step 2: 关闭资源**

- 在 `shutdown()` 中关闭日志器

**Step 3: 验证构建**

Run: `npm run build`

Expected: PASS

### Task 5: 版本和发布

**Files:**
- Modify: `C:\code\playwright-pool\package.json`
- Modify: `C:\code\playwright-pool\package-lock.json`
- Modify: `C:\code\playwright-pool\src\server.ts`

**Step 1: 升版本号**

- `0.1.7 -> 0.1.8`

**Step 2: 跑回归**

Run: `npm test -- tests/pool-service.test.ts tests/slot-runtime.test.ts tests/server.integration.test.ts tests/slot-guardian.test.ts tests/stdio-client-transport.test.ts`

Expected: PASS

**Step 3: 构建**

Run: `npm run build`

Expected: PASS

**Step 4: 提交、推送、发布**

Run:

```powershell
cd C:\code\playwright-pool; git status --short
cd C:\code\playwright-pool; git add docs/plans/2026-03-07-diagnostic-logging-design.md docs/plans/2026-03-07-diagnostic-logging.md src/server-logger.ts src/server.ts src/pool-service.ts src/slot-runtime.ts tests/pool-service.test.ts tests/slot-runtime.test.ts package.json package-lock.json
cd C:\code\playwright-pool; git commit -m "feat: add server diagnostic logging"
cd C:\code\playwright-pool; git push origin HEAD
npm publish
```

Expected:

- git push 成功
- npm publish 成功
