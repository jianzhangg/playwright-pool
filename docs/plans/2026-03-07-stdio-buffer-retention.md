# stdio 大响应缓冲滞留 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 `playwright-pool` 在转发大响应后主进程长期保留高额内存的问题，并在 slot 子进程自然退出时及时释放对应 handle。

**Architecture:** 在仓库内增加一个轻量 stdio client transport 包装层，修正大消息读缓冲 retention；同时让 `SlotRuntime` 监听 slot 子进程自然关闭并摘除死 handle。保持现有 `server -> slot-runtime -> slot-server` 数据流不变。

**Tech Stack:** Node.js、TypeScript、Vitest、MCP stdio

---

### Task 1: 补 transport 大消息缓冲回归测试

**Files:**
- Create: `tests/stdio-client-transport.test.ts`
- Create: `src/stdio-client-transport.ts`

**Step 1: 写失败测试**

- 构造一个只返回大文本的临时 MCP 子进程。
- 用新 transport 连接它，读取大消息后关闭子进程。
- 断言 transport 的内部读缓冲不会继续持有与大消息同量级的残留数据。

**Step 2: 跑测试确认失败**

Run: `npm test -- tests/stdio-client-transport.test.ts`

**Step 3: 写最小实现**

- 提供与现有 `StdioClientTransport` 兼容的接口：
  - `start`
  - `close`
  - `send`
  - `stderr`
  - `pid`
  - `onmessage`
  - `onclose`
  - `onerror`
- 读缓冲实现按换行切帧，消费后复制剩余字节，避免保留历史大 Buffer。
- 在自然关闭和显式关闭时都清空读缓冲。

**Step 4: 跑测试确认通过**

Run: `npm test -- tests/stdio-client-transport.test.ts`

### Task 2: 补 slot-runtime 子进程关闭清理测试

**Files:**
- Create: `tests/slot-runtime.test.ts`
- Modify: `src/slot-runtime.ts`

**Step 1: 写失败测试**

- 模拟一个 slot transport 自然关闭。
- 断言对应 handle 会从 `clients` map 中移除。
- 断言不会误删后续已替换的新 handle。

**Step 2: 跑测试确认失败**

Run: `npm test -- tests/slot-runtime.test.ts`

**Step 3: 写最小实现**

- 在 `startClient()` 注册 transport 关闭回调。
- 关闭日志流。
- 仅当 `clients.get(slotId) === 当前 handle` 时才移除 map 中条目。

**Step 4: 跑测试确认通过**

Run: `npm test -- tests/slot-runtime.test.ts`

### Task 3: 接入新 transport

**Files:**
- Modify: `src/slot-runtime.ts`

**Step 1: 写失败测试**

- 让现有 slot-runtime 测试改用新 transport 类型，确保接口兼容。

**Step 2: 写最小实现**

- 将 `SlotRuntime` 从 SDK 原生 `StdioClientTransport` 切到本地实现。
- 保持现有 `stderr: 'pipe'`、`pid`、`close()` 等行为一致。

**Step 3: 跑针对性测试**

Run: `npm test -- tests/stdio-client-transport.test.ts tests/slot-runtime.test.ts`

### Task 4: 全量验证

**Files:**
- Modify: none

**Step 1: 跑相关单元与集成测试**

Run: `npm test -- tests/pool-service.test.ts tests/server.integration.test.ts tests/slot-guardian.test.ts tests/stdio-client-transport.test.ts tests/slot-runtime.test.ts`

**Step 2: 跑构建**

Run: `npm run build`

**Step 3: 如全部通过，再总结风险与后续观察点**

- 观察真实环境中 `server.js` 的 `external` 内存是否随 slot 关闭回落。
- 如仍有残留，再继续调查 Playwright 下游返回对象形态。
