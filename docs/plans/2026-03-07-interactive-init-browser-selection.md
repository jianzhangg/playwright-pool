# 交互式初始化与浏览器选择 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `playwright-pool init` 改成始终交互的初始化向导，支持在 `Chrome` 与 `Edge` 间选择，允许用户确认或输入 profile 路径，并让 Windows 默认运行目录跟随系统真实 Documents 位置。

**Architecture:** 拆出独立的初始化向导模块处理标准输入输出交互、默认值展示和输入校验；将浏览器探测与 Documents 目录解析抽象到 `profile-source`，再让 `init` 只消费向导确认后的初始化参数并复用现有 profile 准备流程。

**Tech Stack:** Node.js、TypeScript、Vitest、PowerShell、MCP CLI

---

### Task 1: 为浏览器探测与 Documents 解析补失败测试

**Files:**
- Modify: `tests/profile-source.test.ts`
- Modify: `tests/init.test.ts`
- Modify: `src/profile-source.ts`

**Step 1: 写失败测试**

- 在 `tests/profile-source.test.ts` 增加以下断言：
  - Chrome 与 Edge 的 profile 候选目录会按平台返回不同路径。
  - Chrome 与 Edge 的可执行文件候选路径会按平台返回不同路径。
  - Windows Documents 解析优先使用系统真实路径，失败时回退到 `USERPROFILE\\Documents`。
- 在 `tests/init.test.ts` 增加以下断言：
  - 默认运行目录的推导会通过新的 Documents 解析入口，而不是硬编码 `homeDir/Documents`。

**Step 2: 跑测试确认失败**

Run: `npm test -- tests/profile-source.test.ts tests/init.test.ts`

Expected: 至少出现“缺少新导出函数”或“期望路径不匹配”的失败。

**Step 3: 写最小实现**

- 在 `src/profile-source.ts` 中：
  - 新增浏览器类型定义与元数据。
  - 提供按浏览器和平台返回 profile 候选目录的函数。
  - 提供按浏览器和平台返回可执行文件候选路径的函数。
  - 提供 Windows Documents 实际路径解析函数，并保留跨平台回退逻辑。
- 保持现有 Chrome 兼容导出，避免一次性破坏现有调用方。

**Step 4: 跑测试确认通过**

Run: `npm test -- tests/profile-source.test.ts tests/init.test.ts`

**Step 5: 提交**

```powershell
cd C:\code\playwright-pool
& git add tests/profile-source.test.ts tests/init.test.ts src/profile-source.ts
& git commit -m "test: cover browser source detection"
```

### Task 2: 为默认配置渲染与初始化参数补失败测试

**Files:**
- Modify: `tests/init.test.ts`
- Modify: `src/init.ts`

**Step 1: 写失败测试**

- 在 `tests/init.test.ts` 增加以下断言：
  - `renderDefaultConfig` 能根据浏览器类型写出 `channel = "chrome"` 或 `channel = "msedge"`。
  - `renderDefaultConfig` 会写入交互确认后的 `sourceProfileDir` 和运行目录。
  - `initializePlaywrightPool` 不再自行探测浏览器，而是消费外部传入的初始化结果。

**Step 2: 跑测试确认失败**

Run: `npm test -- tests/init.test.ts`

Expected: 由于 `renderDefaultConfig` 和 `initializePlaywrightPool` 参数签名尚未更新而失败。

**Step 3: 写最小实现**

- 在 `src/init.ts` 中：
  - 定义向导确认后的初始化输入结构。
  - 让 `renderDefaultConfig` 接收浏览器 channel、运行目录和 profile 路径。
  - 让 `initializePlaywrightPool` 专注于写配置和准备 profile，不再直接探测 Chrome。
  - 返回结果中的浏览器信息和源 profile 信息使用通用文案。

**Step 4: 跑测试确认通过**

Run: `npm test -- tests/init.test.ts`

**Step 5: 提交**

```powershell
cd C:\code\playwright-pool
& git add tests/init.test.ts src/init.ts
& git commit -m "refactor: parameterize init defaults"
```

### Task 3: 为交互向导补失败测试

**Files:**
- Create: `tests/init-wizard.test.ts`
- Create: `src/init-wizard.ts`

**Step 1: 写失败测试**

- 新建 `tests/init-wizard.test.ts`，覆盖以下场景：
  - 选择 Chrome 并接受探测到的默认 profile 与运行目录。
  - 选择 Edge 且探测失败后手动输入 profile 路径。
  - 用户输入非法 slot 数量时会被重新提示。
  - 用户在汇总确认时取消，向导会中止且不会进入初始化。
- 测试中把输入输出抽象成可注入接口，避免直接依赖真实终端。

**Step 2: 跑测试确认失败**

Run: `npm test -- tests/init-wizard.test.ts`

Expected: 因为 `src/init-wizard.ts` 尚不存在或缺少向导函数而失败。

**Step 3: 写最小实现**

- 在 `src/init-wizard.ts` 中：
  - 提供统一的 `runInitWizard` 入口。
  - 通过注入式 `readLine`/`writeLine` 或等价接口处理交互。
  - 实现浏览器选择、默认值展示、路径输入、slot 校验和最终确认。
  - 复用 `profile-source` 中的浏览器探测与 Documents 解析结果。

**Step 4: 跑测试确认通过**

Run: `npm test -- tests/init-wizard.test.ts`

**Step 5: 提交**

```powershell
cd C:\code\playwright-pool
& git add tests/init-wizard.test.ts src/init-wizard.ts
& git commit -m "test: cover interactive init wizard"
```

### Task 4: 把交互向导接入 init 命令

**Files:**
- Modify: `src/server.ts`
- Modify: `src/init.ts`
- Modify: `src/profile-source.ts`
- Modify: `README.md`

**Step 1: 写失败测试**

- 在 `tests/init.test.ts` 或新测试中补一条集成级断言：
  - `init` 命令路径会先走向导，再把结果传给初始化逻辑。
- 在 `README.md` 对应说明更新前，先记录旧文案中写死 Chrome 与非交互 init 的位置，作为修改清单。

**Step 2: 跑测试确认失败**

Run: `npm test -- tests/init.test.ts tests/init-wizard.test.ts`

Expected: 因为 `server.ts` 仍直接调用旧初始化流程而失败。

**Step 3: 写最小实现**

- 在 `src/server.ts` 中：
  - `init` 命令改为始终执行交互向导。
  - 将向导结果传入 `initializePlaywrightPool`。
  - 输出摘要改成通用“浏览器可执行文件/源 profile/运行目录”文案。
- 在 `README.md` 中更新：
  - 初始化流程改为交互式。
  - 支持 `Chrome` / `Edge` 选择。
  - Windows 默认运行目录遵循实际 Documents 位置。

**Step 4: 跑针对性测试**

Run: `npm test -- tests/profile-source.test.ts tests/init.test.ts tests/init-wizard.test.ts`

**Step 5: 提交**

```powershell
cd C:\code\playwright-pool
& git add src/server.ts src/init.ts src/profile-source.ts README.md tests/profile-source.test.ts tests/init.test.ts tests/init-wizard.test.ts
& git commit -m "feat: add interactive init wizard"
```

### Task 5: 全量验证

**Files:**
- Modify: none

**Step 1: 跑相关测试**

Run: `npm test -- tests/profile-source.test.ts tests/init.test.ts tests/init-wizard.test.ts tests/config.test.ts tests/playwright-config.test.ts tests/server.integration.test.ts`

Expected: 全部通过。

**Step 2: 跑构建**

Run: `npm run build`

Expected: `tsc` 成功，无类型错误。

**Step 3: 人工冒烟**

- 在 Windows 机器上执行一次 `npx @jianzhangg/playwright-pool@latest init`。
- 选择 `Edge`，观察默认运行目录是否落在重定位后的 Documents 下。
- 再执行一次选择 `Chrome`，验证 profile 复制和配置写入是否正确。

**Step 4: 最终提交**

```powershell
cd C:\code\playwright-pool
& git status --short
```

确认只有本次改动后，再视情况整理提交说明。
