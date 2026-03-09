# init 体验优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 优化 `npx @jianzhangg/playwright-pool init` 的首次使用体验，让非技术用户更容易理解流程，并避免“失败后留下半成品目录”与“长时间复制无状态”的问题。

**Architecture:** 保持现有 CLI 入口不变，只重构 init 链路的执行顺序和提示方式。关键策略是把浏览器占用检查提前到任何落盘前，再通过简单的阶段进度回调把初始化状态显式输出给用户，并在失败时做受控清理。

**Tech Stack:** TypeScript、Vitest、Node.js fs/promises、现有 CLI IO 抽象

---

### Task 1: 为 init 写失败测试

**Files:**
- Modify: `tests/init.test.ts`
- Modify: `tests/server-init.test.ts`
- Modify: `tests/init-wizard.test.ts`

**Step 1: Write the failing test**

补 3 类测试：

- 浏览器仍占用时，`initializePlaywrightPool()` 不会先写配置
- 初始化过程会输出阶段进度
- 向导关键术语改成更友好的中文

**Step 2: Run test to verify it fails**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/init.test.ts tests/server-init.test.ts tests/init-wizard.test.ts`

Expected: FAIL，原因是当前实现还没有预检查前移、进度回调和新文案

**Step 3: Commit**

等实现通过后统一提交

### Task 2: 重构 initializePlaywrightPool 执行顺序

**Files:**
- Modify: `src/init.ts`
- Modify: `src/profile-usage.ts`（如需复用更友好的错误）
- Test: `tests/init.test.ts`

**Step 1: Write minimal implementation**

- 在 `initializePlaywrightPool()` 中先做浏览器占用检查，再创建目录和写配置
- 增加受控清理逻辑，只清理本次新建的目录/配置
- 为用户可读错误预留统一包装

**Step 2: Run focused tests**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/init.test.ts`

Expected: PASS

### Task 3: 加入初始化进度提示

**Files:**
- Modify: `src/init.ts`
- Modify: `src/prepare-profiles.ts`
- Modify: `src/server.ts`
- Test: `tests/init.test.ts`
- Test: `tests/server-init.test.ts`

**Step 1: Write minimal implementation**

- 给 `initializePlaywrightPool()` 增加简单的进度回调
- `prepareProfiles()` 逐个副本复制前上报进度
- `runInitCommand()` 把这些消息输出到终端

**Step 2: Run focused tests**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/init.test.ts tests/server-init.test.ts`

Expected: PASS

### Task 4: 调整向导文案

**Files:**
- Modify: `src/init-wizard.ts`
- Test: `tests/init-wizard.test.ts`
- Modify: `README.md`

**Step 1: Write minimal implementation**

- 把 `profile`、`slot` 等词替换成更易懂中文
- 汇总确认时突出用户真正关心的信息
- README 的初始化章节同步更新

**Step 2: Run focused tests**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/init-wizard.test.ts`

Expected: PASS

### Task 5: 全量验证

**Files:**
- Verify: `tests/init.test.ts`
- Verify: `tests/server-init.test.ts`
- Verify: `tests/init-wizard.test.ts`
- Verify: 全量测试与构建

**Step 1: Run targeted suite**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/init.test.ts tests/server-init.test.ts tests/init-wizard.test.ts`

Expected: PASS

**Step 2: Run full suite**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test`

Expected: PASS

**Step 3: Run build**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm run build`

Expected: PASS
