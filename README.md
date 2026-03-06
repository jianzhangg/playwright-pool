# playwright_pool

`playwright_pool` 是一个本地 `stdio` MCP 代理层，用来把多个持久化 Playwright profile 池化后统一暴露给 Codex 或其他 MCP 客户端。

它的目标不是替换官方 `@playwright/mcp`，而是在其上层增加：

- 多 profile slot 池化
- 会话到 slot 的绑定
- 共享租约与回收
- 额外的 pool 级工具，例如 `pool_status`

## 适用场景

- 你希望多个对话共享一组浏览器 profile，但互不抢占
- 你希望 MCP 客户端里只接一个 Playwright 入口
- 你希望默认用系统 Chrome，并复用本机登录态

## 安装前提

- Node.js `>=18`
- 本机已安装 Google Chrome
- 首次初始化时，Chrome 默认 profile 对应的浏览器实例必须关闭

## 快速开始

### 1. 初始化

```bash
npx @jianzhangg/playwright-pool init
```

初始化会自动：

- 检测本机 Google Chrome
- 检测默认 Chrome profile 源目录
- 在 `~/Documents/playwright-pool` 下生成默认配置与运行目录
- 默认准备 10 个 slot 的 profile 副本

默认配置文件位置：

```text
~/Documents/playwright-pool/config.toml
```

### 2. 启动 MCP

```bash
npx @jianzhangg/playwright-pool
```

默认会读取：

```text
~/Documents/playwright-pool/config.toml
```

也支持显式指定：

```bash
npx @jianzhangg/playwright-pool --config /absolute/path/to/config.toml
```

## MCP 客户端接入

### 通用 MCP 客户端

- 启动命令：`npx`
- 参数：`@jianzhangg/playwright-pool`

如果客户端不支持默认配置目录，或者你需要切换配置文件，则填写：

- 启动命令：`npx`
- 参数 1：`@jianzhangg/playwright-pool`
- 参数 2：`--config`
- 参数 3：`/absolute/path/to/config.toml`

### Codex 配置示例

```toml
[mcp_servers.playwright_pool]
command = "npx"
args = ["@jianzhangg/playwright-pool"]
enabled = true
```

如果需要指定配置文件：

```toml
[mcp_servers.playwright_pool]
command = "npx"
args = ["@jianzhangg/playwright-pool", "--config", "/absolute/path/to/config.toml"]
enabled = true
```

## 配置文件

示例见 `playwright-pool.example.toml`。

当前配置结构分为两部分：

- `[pool]`
  - `size`
  - `sourceProfileDir`
  - `profileDirTemplate`
  - `outputDirTemplate`
  - `leaseDir`
  - `logsDir`
  - `heartbeatSeconds`
  - `staleLeaseSeconds`
  - `sessionKeyEnv`
- `[playwright]`
  - 下游 Playwright MCP 配置

## 工具说明

`playwright_pool` 对外暴露两类工具：

### 1. 官方 Playwright MCP 工具

例如：

- `browser_tabs`
- `browser_navigate`
- `browser_snapshot`
- `browser_take_screenshot`
- `browser_click`

这些工具来自打包好的 tool manifest，会在 MCP 握手时通过 `tools/list` 直接暴露给客户端。

### 2. 额外工具

#### `pool_status`

用途：

- 查看当前 slot 租约
- 查看当前进程已拉起的 slot 子进程状态

返回内容包含：

- `leases`
- `runtimeStatuses`

## 运行目录

默认运行目录：

```text
~/Documents/playwright-pool
```

其中包含：

- `config.toml`：默认配置文件
- `profiles/{id}`：每个 slot 的浏览器 profile
- `output/{id}`：Playwright 运行期产物目录
- `leases`：共享租约
- `logs`：slot 子进程日志

## 截图和输出文件

默认情况下：

- `browser_take_screenshot` 的文件会落到当前 slot 的 `output/{id}`
- `browser_snapshot` 主要返回页面快照文本，不一定产出图片文件

## 需要安装什么

### 需要

- Node.js
- Google Chrome

### 不需要单独手动安装

- `@playwright/mcp`
- `playwright`

它们会作为本包依赖一起安装。

## 发布到 npm

发布前至少需要满足：

- 已有 npm 账号，并完成 `npm login`
- 账号邮箱已验证
- 包名没有被别人占用
- 当前代码通过测试、构建和 `npm pack --dry-run`

当前包名已经切到 `@jianzhangg/playwright-pool`，更完整的发布步骤见 `PUBLISHING.md`。

## 本地开发

```bash
cd /path/to/playwright-pool
npm install
npm test
npm run build
npm run init:local
```

开发用本地配置仍保留在：

```text
./playwright-pool.local.toml
```

## 当前限制

- 会话绑定优先依赖 `CODEX_THREAD_ID`，缺失时回退到当前 MCP 服务进程实例标识
- `browser_close` 只关闭浏览器，不释放 slot；slot 在进程退出或心跳超时后释放
- 初始化默认假设使用系统 Chrome，而不是 Playwright 自带的 Chromium 浏览器二进制
