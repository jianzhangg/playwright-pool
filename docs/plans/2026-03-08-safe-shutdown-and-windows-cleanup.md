# 安全退出与 Windows 清理 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 `playwright-pool 0.1.8` 在 stdio 断开后的 `EPIPE` 递归日志/内存风暴，并让 Windows 上的子进程链与当前 slot 浏览器在 `Codex` 关闭后能可靠回收。

**Architecture:** 提炼一个仓库内的安全诊断输出层，统一收口 `server.ts` 与 `slot-server.ts` 的退出路径；同时给 `profile-process.ts` 补 Windows 按 `profileDir` 精确清理逻辑，给 `slot-guardian.ts` 补 Win32 启动链脱离检测。优雅关闭路径保持不变，但兜底路径变得可测试且可跨平台工作。

**Tech Stack:** Node.js、TypeScript、Vitest、PowerShell/WMI、MCP stdio、Playwright

---

### Task 1: 为安全 stderr 写入补失败测试

**Files:**
- Create: `tests/safe-stderr.test.ts`
- Create: `src/safe-stderr.ts`

**Step 1: 写失败测试**

- 覆盖 `safeStderrWrite()` 在 `stderr.write` 抛 `EPIPE` 时不会继续抛错。
- 覆盖 `safeStderrWrite()` 在非 broken pipe 错误时会重新抛出。
- 覆盖 `isBrokenPipeError()` 对 `EPIPE`、`ERR_STREAM_DESTROYED`、`ERR_STREAM_WRITE_AFTER_END` 的识别。

**Step 2: 跑测试确认失败**

Run: `cd C:\code\playwright-pool; npm test -- tests/safe-stderr.test.ts`

Expected: 失败，因为 `src/safe-stderr.ts` 尚不存在。

**Step 3: 写最小实现**

- 实现 `safeStderrWrite(message, options?)`。
- 实现 `isBrokenPipeError(error)`。
- 保持 API 只负责“安全写诊断”，不包含退出逻辑。

**Step 4: 跑测试确认通过**

Run: `cd C:\code\playwright-pool; npm test -- tests/safe-stderr.test.ts`

Expected: 全部通过。

### Task 2: 为主/slot 退出保护补失败测试

**Files:**
- Create: `tests/server-shutdown.test.ts`
- Modify: `src/server.ts`
- Modify: `src/slot-server.ts`

**Step 1: 写失败测试**

- 抽出可单测的退出助手或事件处理工厂。
- 覆盖“`stderr.write` 抛 `EPIPE` 时不会递归触发新的异常”。
- 覆盖“同一轮关闭中多次调用 `shutdownAndExit()` / `cleanupAndExit()` 只会执行一次核心清理”。

**Step 2: 跑测试确认失败**

Run: `cd C:\code\playwright-pool; npm test -- tests/server-shutdown.test.ts`

Expected: 失败，当前代码没有可测试的安全退出层。

**Step 3: 写最小实现**

- 把主/slot 的裸 `process.stderr.write(...)` 改成 `safeStderrWrite(...)`。
- 为主/slot 退出路径增加单次退出保护。
- 对 `uncaughtException` / `unhandledRejection` 做 broken pipe 特判，避免把坏掉的 stdio 再次当作诊断通道。

**Step 4: 跑测试确认通过**

Run: `cd C:\code\playwright-pool; npm test -- tests/server-shutdown.test.ts`

Expected: 全部通过。

### Task 3: 为 Windows 浏览器清理补失败测试

**Files:**
- Create: `tests/profile-process.test.ts`
- Modify: `src/profile-process.ts`

**Step 1: 写失败测试**

- 注入假的 Windows 进程列表。
- 验证仅命令行里带当前 `profileDir` 的 `msedge.exe/chrome.exe` 会被选中。
- 验证不匹配 profile 的浏览器、其他程序不会被选中。

**Step 2: 跑测试确认失败**

Run: `cd C:\code\playwright-pool; npm test -- tests/profile-process.test.ts`

Expected: 失败，因为当前实现只有 `pkill -f`。

**Step 3: 写最小实现**

- 保留 Unix `pkill -f` 分支。
- Windows 下使用可注入的命令执行器查询进程命令行，并终止匹配 `profileDir` 的浏览器 PID。
- 对“没有匹配进程”与“查询失败”保持幂等。

**Step 4: 跑测试确认通过**

Run: `cd C:\code\playwright-pool; npm test -- tests/profile-process.test.ts`

Expected: 全部通过。

### Task 4: 为 Win32 启动链脱离检测补失败测试

**Files:**
- Modify: `tests/slot-guardian.test.ts`
- Modify: `src/slot-guardian.ts`

**Step 1: 写失败测试**

- 构造 Win32 的 lineage 数据。
- 覆盖“`npx -> cmd -> server.js` 已脱离上层宿主”会触发 detached。
- 覆盖“链路仍挂在宿主下”不会误判。

**Step 2: 跑测试确认失败**

Run: `cd C:\code\playwright-pool; npm test -- tests/slot-guardian.test.ts`

Expected: 失败，因为当前 `win32` 直接返回 no-op watcher。

**Step 3: 写最小实现**

- 为 Win32 增加读取进程 lineage 的实现与匹配逻辑。
- 让 `startDetachedLauncherWatcher()` 在 Windows 上也能工作。

**Step 4: 跑测试确认通过**

Run: `cd C:\code\playwright-pool; npm test -- tests/slot-guardian.test.ts`

Expected: 全部通过。

### Task 5: 跑回归验证

**Files:**
- Modify: none

**Step 1: 跑针对性测试集**

Run: `cd C:\code\playwright-pool; npm test -- tests/safe-stderr.test.ts tests/server-shutdown.test.ts tests/profile-process.test.ts tests/slot-guardian.test.ts tests/slot-runtime.test.ts tests/server.integration.test.ts`

Expected: 全绿。

**Step 2: 跑构建**

Run: `cd C:\code\playwright-pool; npm run build`

Expected: 退出码 `0`。

**Step 3: 真实复现场景复核**

- 重新拉起 `Codex App` 内置 `playwright-pool`
- 观察 `server-<pid>.log` 不再出现 `EPIPE` 无限刷屏
- 观察关闭 `Codex` 后，当前 slot 对应浏览器与子进程链会被回收

**Step 4: 如验证通过，再准备提交与发布**

- 更新版本号
- 记录仍存在的上层宿主限制或已知风险
