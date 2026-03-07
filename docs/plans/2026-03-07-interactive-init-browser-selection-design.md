# 交互式初始化与浏览器选择设计

## 背景

当前 `playwright_pool init` 会直接探测本机 Google Chrome，并在默认运行目录下生成配置与 profile 副本。这套流程存在三个明显限制：

1. 初始化逻辑写死为 Chrome，无法在 `Chrome` 与 `Edge` 之间选择。
2. `sourceProfileDir` 只能依赖自动探测，无法在初始化过程中由用户交互输入。
3. 默认运行目录依赖 `HOME/Documents` 推导，在 Windows 上如果用户重定位了“文档”目录，生成路径会偏离系统真实位置。

本次调整要把 `init` 改成始终交互式向导，并让默认值与当前系统环境保持一致。

## 目标

- `init` 始终进入交互流程，不再提供静默初始化路径。
- 用户可以在交互中选择 `Chrome` 或 `Edge`。
- 用户可以确认自动探测到的 profile 目录，也可以手动输入自定义目录。
- Windows 上默认运行目录要遵循系统当前“Documents”真实位置，而不是硬编码用户主目录下的 `Documents`。
- 现有的配置结构、profile 复制流程和运行期 slot 逻辑保持兼容。

## 非目标

- 不增加图形界面。
- 不扩展到 `firefox`、`webkit` 或 Playwright 自带 `chromium` 二进制选择。
- 不修改运行期工具协议与 slot 分配策略。

## 设计概览

新增一个独立的初始化向导层，负责：

- 浏览器选项展示与输入解析
- 按浏览器类型探测默认 profile 路径与可执行文件
- 解析默认运行目录
- 采集用户对 profile 路径、运行目录和 slot 数量的输入
- 汇总确认并调用现有初始化/prepare 逻辑

原有 `initializePlaywrightPool` 会从“自动探测 + 直接落盘”改成“消费已经确认过的初始化参数”，把交互与副作用隔离开。这样测试可以分别覆盖：

- 纯路径解析逻辑
- 向导交互流程
- 最终配置渲染与 profile 准备行为

## 交互流程

`npx @jianzhangg/playwright-pool init` 执行后，固定按以下顺序进行：

1. 选择浏览器：`Chrome` 或 `Edge`
2. 探测所选浏览器的默认 profile 目录
3. 显示探测结果，询问是否使用
4. 如果不使用或探测失败，要求用户输入自定义 profile 目录，并做存在性校验
5. 解析默认运行目录
6. 显示默认运行目录，允许用户直接回车接受或手动输入新目录
7. 询问 slot 数量，默认值为 `10`
8. 展示汇总信息并请求最终确认
9. 写入配置、准备 profiles，输出结果摘要

交互全部基于标准输入输出，不引入额外第三方提示库。输入形式遵循两条原则：

- 选择题使用编号输入，降低大小写和拼写误差
- 文本题允许回车接受默认值

## 浏览器模型

将当前 Chrome 专属探测逻辑抽象为按浏览器类型驱动的模型，至少包含：

- 内部标识：`chrome` / `edge`
- 展示名称：`Google Chrome` / `Microsoft Edge`
- Playwright channel：`chrome` / `msedge`
- profile 目录候选列表
- 浏览器可执行文件候选列表

初始化完成后，生成的配置继续保持：

```toml
[playwright.browser]
browserName = "chromium"

[playwright.browser.launchOptions]
channel = "chrome" | "msedge"
```

也就是说，浏览器切换仍通过 `channel` 完成，不改变现有运行期配置结构。

## Documents 目录解析

默认运行目录仍为 `<Documents>/playwright-pool`，但 `Documents` 的解析策略需要平台感知：

- Windows：优先读取系统已知文件夹里的当前 Documents 真实路径，失败时回退到 `USERPROFILE\\Documents`
- macOS / Linux：继续用当前 `homeDir/Documents`

这样在 Windows 用户把“文档”移动到其他盘符后，初始化默认路径会自动跟随系统设置，例如 `D:\\Users\\name\\Documents\\playwright-pool`。

## 错误处理

向导把“缺少探测结果”和“执行失败”分开处理：

- 探测不到默认 profile：不终止，直接转为手动输入
- 路径不存在或不可访问：立即提示并重新输入
- slot 数量非法：提示并重新输入
- 写配置失败、profile 正被占用、目录创建失败：明确报错并终止

所有用户可见文案统一改为“浏览器”或具体浏览器名称，不再在 Edge 流程里输出写死的 Chrome 提示。

## 对现有代码的影响

需要调整的主要区域如下：

- `src/profile-source.ts`
  - 增加浏览器枚举与候选路径解析
  - 增加 Windows Documents 真实路径解析
- `src/init.ts`
  - 从固定 Chrome 初始化改为消费交互收集后的初始化参数
  - 让默认配置渲染支持不同 channel 和 source profile
- `src/server.ts`
  - `init` 命令改为始终启动交互向导
- 新增向导模块
  - 负责标准输入输出交互、输入校验和默认值展示
- 测试
  - 更新现有 init/profile-source 测试
  - 新增交互向导测试

## 测试策略

严格按 TDD 分层推进：

1. 为浏览器候选路径与 Windows Documents 解析补纯函数测试
2. 为向导输入输出流程写失败测试，覆盖浏览器选择、接受默认值、手输路径和探测失败回退
3. 更新初始化配置渲染测试，确认会写出正确 `channel`、`sourceProfileDir` 和运行目录
4. 运行相关测试集，确认旧行为未回归

## 风险与取舍

- 标准输入输出交互需要谨慎处理 `stdin`/`stdout` 生命周期，避免影响后续 MCP 启动路径。
- Windows Documents 真实路径解析如果依赖系统命令，测试必须抽象依赖，避免单元测试绑定当前机器。
- 始终交互意味着自动化脚本调用 `init` 的能力下降，这是本次需求的明确取舍。

## 结论

采用“独立交互向导 + 通用浏览器探测模型 + 平台感知 Documents 解析”的方案，能在最小化运行期改动的前提下满足以下需求：

- 初始化时选择 `Chrome` 或 `Edge`
- 初始化时交互输入或确认 profile 路径
- Windows 上默认运行目录自动跟随已重定位的 Documents
