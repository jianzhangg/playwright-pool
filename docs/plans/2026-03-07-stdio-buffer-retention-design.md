# stdio 大响应缓冲滞留 Design

**背景**

在 Windows 上，`playwright-pool` 主 `server.js` 进程会在转发下游 `slot-server` 的大响应后长期保留高额 `external` 内存。即使下游子进程已经退出，这部分内存仍可能继续停留在主进程中，导致多个会话叠加后 RAM 爆满。

**已确认的根因**

- 主进程直接返回大响应时，不会出现线性内存滞留。
- 主进程通过 `StdioClientTransport` 转发下游大响应时，会保留与历史最大响应近似同量级的 `external` 内存。
- 下游子进程自然退出后，如果主进程没有显式关闭对应 client/transport，这块缓冲仍会继续停留。
- `@modelcontextprotocol/sdk` 的 `ReadBuffer` 使用 `Buffer.concat()` 和 `subarray()` 维护读取窗口，读完消息后剩余视图仍可能引用整块历史 Buffer。

**目标**

让 `playwright-pool` 在下游 slot 子进程关闭后及时释放对应 handle 与 transport，并避免 stdio 读缓冲因历史大消息继续引用整块 Buffer。

**备选方案**

### 方案 A：只修 `slot-runtime` 生命周期

- 在 slot 子进程自然关闭时，主动从 `clients` 中摘掉 handle，并调用清理逻辑。

优点：

- 改动小，直接命中“子进程已经死了但主进程还占内存”的主症状。

缺点：

- 仍然依赖第三方 transport 在关闭路径上一定释放底层缓冲。
- 如果未来出现其他使用 `StdioClientTransport` 的位置，问题可能复发。

### 方案 B：只修 stdio 读缓冲

- 在本仓库内实现一个轻量 transport 包装层，避免读完消息后仍用 `subarray()` 挂住大 Buffer。

优点：

- 直接针对内存滞留根因。

缺点：

- 只修底层缓冲，不修业务层死 handle 长驻问题。
- 如果 slot handle 不摘除，仍会残留无效连接对象和日志流。

### 方案 C：两者都做

- 业务层在子进程关闭时主动清理 handle。
- 本地包装 `StdioClientTransport`，修正读缓冲 retention。

优点：

- 同时解决“死 handle 长驻”和“历史大 Buffer 滞留”。
- 风险集中在本仓库内，避免直接 patch 第三方包。

缺点：

- 代码改动比单点修复稍大。

**推荐方案**

采用方案 C。

原因：

- 现象证明仅靠“等子进程退出”不足以回收内存。
- 业务层和缓冲层都存在问题，单修一层只能降低概率，不能彻底收敛。
- 本地包装 transport 的改动面可控，不需要修改 `node_modules`。

**设计**

### 1. transport 包装层

新增一个本仓库内的 stdio client transport 实现，接口与现有 `StdioClientTransport` 保持兼容，重点只改读取缓冲策略：

- 收到 chunk 后继续按换行切帧。
- 一条完整消息解析完成后，不再保留对旧大 Buffer 的切片引用。
- 在 `close()` 和子进程自然 `close` 时都主动清空读缓冲。

### 2. slot-runtime 生命周期收口

`SlotRuntime` 在 `startClient()` 后注册 transport 关闭回调：

- 若 slot 子进程自然退出，立即关闭日志流。
- 若当前 `clients` map 里仍指向这个 handle，则将其移除。
- 后续对同一 slot 的下一次调用会自动拉起新 client。

### 3. 测试策略

- 为 transport 包装层补一个大消息回归测试，验证读取大消息后不会继续保留整块旧 Buffer。
- 为 `SlotRuntime` 补一个生命周期测试，验证子进程自然关闭后会从 `clients` map 清掉对应 handle。
- 保留现有行为：tool 转发、roots 转发、slot 复用语义不变。

**风险与约束**

- 不能改协议 framing 语义，避免影响 MCP 兼容性。
- 不能在 slot 子进程自然退出时误杀新的同 slot 连接，因此移除 map 时要校验对象身份。
- Windows 为主要复现场景，但修复应保持跨平台一致。
