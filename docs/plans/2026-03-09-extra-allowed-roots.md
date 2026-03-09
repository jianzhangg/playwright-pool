# extraAllowedRoots Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `playwright-pool` 增加可选的 `pool.extraAllowedRoots` 配置，让 npm 包在客户端未传入 `roots` 时仍可显式放行指定目录用于文件上传，同时保持默认行为不变。

**Architecture:** 在配置层解析 `extraAllowedRoots`，在 roots 转发层把客户端 `roots` 与配置 roots 合并，最终只在“客户端 roots + 配置 roots 都为空”时回退到旧的 fallback root。这样既兼容旧行为，又允许用户显式扩大允许目录。

**Tech Stack:** TypeScript、Vitest、TOML、MCP Roots、Node.js 18

---

### Task 1: 配置解析

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`
- Test: `tests/fixtures/basic-config.toml`

**Step 1: Write the failing test**

在 `tests/config.test.ts` 增加断言：

- `basic-config.toml` 配了 `extraAllowedRoots`
- `loadPoolConfig()` 解析后 `config.pool.extraAllowedRoots` 等于预期数组
- 未配置时保持 `undefined`

**Step 2: Run test to verify it fails**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/config.test.ts`

Expected: FAIL，提示 `extraAllowedRoots` 未定义或 fixture 不匹配

**Step 3: Write minimal implementation**

- 在 `PoolConfig` 增加 `extraAllowedRoots?: string[]`
- 在 `src/config.ts` 解析 `rawPool?.extraAllowedRoots`
- 复用 `normalizePath()` 处理每一项

**Step 4: Run test to verify it passes**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/config.test.ts`

Expected: PASS

### Task 2: roots 合并工具

**Files:**
- Modify: `src/forwarded-roots.ts`
- Test: `tests/forwarded-roots.test.ts`

**Step 1: Write the failing test**

在 `tests/forwarded-roots.test.ts` 增加场景：

- 只有客户端 roots
- 只有配置 roots
- 客户端 roots + 配置 roots 合并去重
- 三者都空时回退 fallback root

**Step 2: Run test to verify it fails**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/forwarded-roots.test.ts`

Expected: FAIL，提示当前 `ForwardedRootsState` 不支持配置 roots 合并

**Step 3: Write minimal implementation**

- 让 `ForwardedRootsState` 同时接收客户端 roots 与配置 roots
- 新增合并去重逻辑，统一转成 `Root`

**Step 4: Run test to verify it passes**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/forwarded-roots.test.ts`

Expected: PASS

### Task 3: SlotRuntime 接入配置 roots

**Files:**
- Modify: `src/slot-runtime.ts`
- Test: `tests/slot-runtime.test.ts`

**Step 1: Write the failing test**

新增测试：

- 当 `config.pool.extraAllowedRoots` 变化时，roots 签名发生变化
- 当客户端 roots 为空、但配置 roots 存在时，slot client 仍会按配置 roots 启动

**Step 2: Run test to verify it fails**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/slot-runtime.test.ts`

Expected: FAIL，提示 roots 签名或 handle 替换行为不符合新预期

**Step 3: Write minimal implementation**

- `SlotRuntime.startClient()` 构造 `ForwardedRootsState` 时带上 `config.pool.extraAllowedRoots`
- `ensureClient()` 计算签名时把配置 roots 纳入比较

**Step 4: Run test to verify it passes**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/slot-runtime.test.ts`

Expected: PASS

### Task 4: 文档与示例

**Files:**
- Modify: `README.md`
- Modify: `playwright-pool.example.toml`

**Step 1: Update docs**

- README 配置章节增加 `extraAllowedRoots` 说明
- 示例配置增加注释示例，强调这是可选项，未配置保持默认行为

**Step 2: Verify docs reflect final behavior**

人工核对：

- 文档明确写出“优先客户端 roots，其次额外允许目录，最后 fallback”
- 文档明确写出“不配置不改变默认行为”

### Task 5: 验证

**Files:**
- Verify: `tests/config.test.ts`
- Verify: `tests/forwarded-roots.test.ts`
- Verify: `tests/slot-runtime.test.ts`

**Step 1: Run focused test suite**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test -- tests/config.test.ts tests/forwarded-roots.test.ts tests/slot-runtime.test.ts`

Expected: PASS

**Step 2: Run broader regression**

Run: `cd /Users/senguoyun/PycharmProjects/playwright-pool && npm test`

Expected: PASS
