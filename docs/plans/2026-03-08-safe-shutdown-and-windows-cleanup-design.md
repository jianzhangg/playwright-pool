# 安全退出与 Windows 清理 Design

**背景**

`playwright-pool 0.1.8` 已经补上默认诊断日志，但在 `Codex App` 断开 stdio 后暴露出一条新的高危路径：

- 主 `server.js` 收到 `stdin end/close` 后开始走关闭流程。
- 如果此时 `stderr` 对端已经断开，`process.stderr.write(...)` 会抛出 `EPIPE`。
- `uncaughtException` / `unhandledRejection` 处理器里又继续 `process.stderr.write(...)`，进而再次触发 `EPIPE`。
- 最终形成“异常处理本身再次抛异常”的递归风暴，`server-<pid>.log` 和主进程内存会一起飙升。

与此同时，Windows 上浏览器与子进程链路的回收仍不可靠：

- `slot-server` 关闭后会尝试清理当前 slot 对应的浏览器，但 `src/profile-process.ts` 仍只调用 `pkill -f`，在 Win11 上无效。
- `src/slot-guardian.ts` 的 `startDetachedLauncherWatcher` 在 `win32` 直接禁用，导致 `Codex App` 关闭后，`npx -> cmd -> server.js -> slot-server.js` 这条链缺少启动链脱离兜底。

**目标**

1. 让主 `server.js` 与 `slot-server.js` 在 stdio 已断开时不再因为诊断输出进入递归异常。
2. 让关闭路径具备“只执行一次”的语义，即便 `stdin end`、`stdin close`、`transport.onclose`、`uncaughtException` 交错发生，也不会重复写日志或重复退出。
3. 在 Windows 上补齐浏览器与子进程链的兜底清理，只清理由当前 slot profile 拉起的 `msedge.exe/chrome.exe`，不影响用户手动打开的浏览器。

**备选方案**

### 方案 A：只修主 `server.ts` 的 `EPIPE`

- 把主进程里的 `process.stderr.write(...)` 包一层 try/catch，吞掉 `EPIPE`。

优点：

- 改动最小，能直接止住当前最显眼的 2GB+ 风暴。

缺点：

- `slot-server.ts` 仍保留同类递归口。
- Windows 浏览器/子进程残留问题完全没动。
- 退出路径仍是多处散落写 `stderr`，后续容易复发。

### 方案 B：统一安全退出，但不补 Windows 清理

- 提炼安全诊断输出与单次退出逻辑，同时改主进程和 slot 进程。

优点：

- 可以从根上解决 `EPIPE` 递归异常。
- 改动集中在 `server.ts` / `slot-server.ts`，验证面较清晰。

缺点：

- `Codex App` 关闭后，Win11 上浏览器与子进程链仍可能残留。

### 方案 C：统一安全退出 + Windows 清理

- 用同一套“安全输出 + 单次退出”模型收口主/slot 关闭路径。
- 同时补上 Win11 按 `profileDir` 精确清浏览器，以及启动链脱离兜底。

优点：

- 一次收敛当前两个最高频故障面。
- 改动都在仓库内，可测试、可发布。
- “Codex 关闭后自动清理整个链路和打开的浏览器”这个用户目标可以真正落地。

缺点：

- 改动面比单点修复更大，需要更完整的回归测试。

**推荐方案**

采用方案 C。

原因：

- `EPIPE` 风暴和 Win11 残留不是两件完全独立的事，本质上都出在“退出路径不够稳”。
- 只修 `server.ts` 会留下 `slot-server.ts` 和 Windows 清理空洞，后面仍可能以另一种形式复发。
- 这次已经有默认诊断日志，正适合把退出路径收敛成统一模型，便于下一次复现时直接定位。

**设计**

### 1. 引入安全诊断输出

新增一个仓库内的小工具模块，提供：

- `safeStderrWrite(message)`：尝试写 `process.stderr`，若遇到 `EPIPE`、`ERR_STREAM_DESTROYED`、`ERR_STREAM_WRITE_AFTER_END` 或底层 pipe 已断开，则静默忽略。
- `isBrokenPipeError(error)`：统一识别 Node 在 stdio 已断开时的错误码与消息。

约束：

- 只吞“输出通道已断开”类错误，不能吞掉其他真实逻辑错误。
- 不在这个层里做 `process.exit()`，只负责安全输出。

### 2. 收敛主 `server.js` 退出路径

主进程关闭改成以下语义：

- `shutdownAndExit()` 只记录 `shutdownReason`、写文件日志、触发一次 `shutdown()` 和最终 `process.exit()`。
- 对外的诊断信息统一走 `safeStderrWrite()`，不再直接裸写 `process.stderr.write(...)`。
- `uncaughtException` / `unhandledRejection` 里先记录文件日志，再调用 `shutdownAndExit()`；如果异常本身就是 `EPIPE`，不再额外把完整栈回写到坏掉的 `stderr`。
- 增加单次退出保护，避免 `stdin end`、`stdin close`、`transport.onclose` 等事件在关闭窗口内重复触发多次退出。

### 3. 收敛 `slot-server` 退出路径

`slot-server.ts` 采用与主进程一致的模型：

- 所有诊断输出改走 `safeStderrWrite()`。
- `cleanupAndExit()` 增加单次退出保护。
- `uncaughtException` / `unhandledRejection` 不再直接裸写 `stderr`。

这样即使 slot 侧也遇到 broken pipe，也不会放大成日志/内存风暴。

### 4. Windows 按 profileDir 精确清理浏览器

`profile-process.ts` 改成跨平台实现：

- Unix 保持现有 `pkill -f profileDir` 逻辑。
- Windows 使用 PowerShell / WMI 查询 `msedge.exe` 与 `chrome.exe` 的命令行。
- 仅终止命令行里明确包含当前 `profileDir` 的浏览器进程。

约束：

- 必须按完整 `profileDir` 精确匹配，避免误杀用户手动打开的浏览器。
- 对“找不到进程”或“查询受限”保持幂等，不把清理失败放大成新的致命错误。

### 5. Windows 启动链脱离检测

`slot-guardian.ts` 为 Win32 补一条启动链检测路径：

- 读取 `PID / PPID / CommandLine` 形成 lineage。
- 识别 `npx` / `npm exec` / `cmd /c playwright-pool` 这类启动链是否已经脱离 `codex.exe app-server`。
- 一旦检测到链路已脱离，触发主进程安全关闭。

这条是对“父进程没退干净但启动链已经脱离”的额外兜底。

**测试策略**

1. 为安全 stderr 写工具补纯单元测试：
   - broken pipe 错误会被吞掉。
   - 非 broken pipe 错误会继续抛出。

2. 为主 `server` 补回归测试：
   - 模拟 `stderr.write` 抛 `EPIPE`，验证不会递归触发 `uncaughtException` 风暴。
   - 验证 `shutdownAndExit()` 在多事件触发时只执行一次。

3. 为 `slot-server` 或抽出的公共退出助手补回归测试：
   - 验证 slot 侧也不会在 `stderr` 断开时递归异常。

4. 为 `profile-process` 补 Windows 专属逻辑测试：
   - 命令行包含当前 `profileDir` 的 Edge/Chrome 会被选中。
   - 不包含当前 `profileDir` 的浏览器不会被误杀。

5. 为 `slot-guardian` 补 Win32 lineage 解析与脱离检测测试。

**风险与约束**

- `Codex App` 的后台 `app-server` 回收仍有可能存在上层问题，本次只能把 `playwright-pool` 侧做到更健壮，不能保证修复所有宿主侧残留。
- Windows 查询进程命令行需要 PowerShell / WMI，可测试中需要通过依赖注入隔离外部命令。
- 退出路径收敛后，日志量会下降；这是预期变化，不应再依赖 `stderr` 输出作为主诊断面。
