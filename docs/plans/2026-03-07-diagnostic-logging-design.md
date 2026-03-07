# 主进程诊断日志设计

**日期：** 2026-03-07

## 背景

`playwright-pool` 之前在 `Codex App` 内部 MCP 调用链上出现过主 `server.js` 内存异常增长，但问题并不能稳定复现。现有仓库里：

- slot 子进程已有 `slot-<id>.log`
- 主进程只在少数退出路径写 `stderr`
- `PoolService` / `SlotRuntime` 对租约、工具转发、transport 关闭等关键边界没有持久化诊断日志

这导致再次出现现场时，很难回答下面几个核心问题：

- 哪个会话占了哪个 slot
- 哪个工具、哪次调用、返回了多大的结果
- 主进程内存在调用前后是如何变化的
- slot / transport 是正常关闭还是异常断开

## 目标

为主进程增加默认开启的低开销诊断日志，确保未来再次出现内存增长时，可以只靠运行目录内日志快速还原调用链和内存变化。

## 非目标

- 不做高频定时采样
- 不做复杂日志轮转或压缩
- 不修改 slot 子进程日志格式
- 不引入额外第三方日志库

## 方案

### 日志文件位置

主进程日志直接写到现有运行目录：

- `pool.logsDir/server-<pid>.log`

在当前用户机器上，对应路径会是：

- `D:\Users\jianzhangg\Documents\playwright-pool\logs\server-<pid>.log`

slot 子进程继续沿用：

- `pool.logsDir/slot-<id>.log`

### 日志格式

采用单行文本日志，字段形式为 `key=value`，避免引入 JSON logger，降低实现和阅读成本。例如：

```text
2026-03-07T12:34:56.789Z level=info event=tool_call_start pid=14600 slotId=1 tool=browser_snapshot threadId=playwright-pool:14600:abc argsBytes=2 rssMB=104.12 heapUsedMB=13.44 externalMB=52.01
```

固定字段：

- `time`：ISO 时间戳，直接放行首
- `level`：`info` / `error`
- `event`：事件名
- `pid`：当前主进程 PID

按事件追加字段：

- 会话：`threadId`、`slotId`、`ownerPid`
- 工具：`tool`、`argsBytes`、`resultBytes`、`rootsCount`、`durationMs`
- 运行时：`slotPid`、`logFile`
- 内存：`rssMB`、`heapUsedMB`、`externalMB`
- 错误：`error`

### 事件覆盖面

主进程应至少覆盖下面这些边界：

1. 服务启动与关闭
2. `PoolService` 工具调用开始 / 结束 / 失败
3. slot 租约分配与心跳定时器建立
4. 心跳执行结果与异常
5. `SlotRuntime` 启动 slot client
6. slot client 连接成功
7. transport 自然关闭
8. `closeAll()` / `stopClient()` 主动关闭
9. roots 变化导致旧 handle 被替换

### 内存采样策略

只在关键边界调用 `process.memoryUsage()`：

- tool start
- tool end
- tool error
- slot start
- slot transport close
- server shutdown

不增加定时采样，避免无意义刷日志和额外噪音。

### 结果大小统计

为排查大响应导致的内存抬升，工具调用完成后记录：

- `argsBytes`
- `resultBytes`

实现上使用 `JSON.stringify` + `Buffer.byteLength`，若序列化失败则退回 `-1`。

### 资源约束

默认开启，但要满足：

- 常驻额外内存只包含一个主进程写流和少量格式化字符串
- 不引入轮询型日志
- 心跳日志允许保留，但每次仅 1 行
- 故障外的日常写入量应控制在“几百 KB 到几 MB / 天”量级

## 代码落点

- 新增：`src/server-logger.ts`
- 修改：`src/server.ts`
- 修改：`src/pool-service.ts`
- 修改：`src/slot-runtime.ts`
- 测试：`tests/pool-service.test.ts`
- 测试：`tests/slot-runtime.test.ts`

## 测试策略

1. `PoolService`：
   - 工具调用开始和结束都会写日志
   - 日志中带 `slotId`、`tool`、`argsBytes`、`resultBytes`
   - 心跳 timer 建立和执行也会写日志

2. `SlotRuntime`：
   - 新建 slot handle 时写 `slot_client_start` / `slot_client_connected`
   - transport 自然关闭时写 `slot_transport_close`
   - roots 变化替换旧 handle 时写 `slot_client_replace`

3. 验证：
   - 相关单测通过
   - `npm run build` 通过
   - 发版后可在运行目录看到 `server-<pid>.log`

## 风险

- 默认开启日志会略微增加 IO，但远低于浏览器和 Playwright 自身开销
- `resultBytes` 统计需要序列化结果，可能对超大响应增加一点 CPU，但仅在调用边界执行一次，可接受
- 如果未来日志量明显偏大，再补轮转，不在本次范围内
