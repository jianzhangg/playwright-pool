# extraAllowedRoots Design

**背景**

当前 `@jianzhangg/playwright-pool@0.1.9` 已支持把 MCP 客户端传入的 `roots` 转发给 slot 子进程，但在 Codex 当前这条 `npx` 接入链路里，客户端并没有把工作区 roots 传进来。

这会导致：

- `src/server.ts` 里的 `listClientRoots()` 返回空数组
- `src/slot-runtime.ts` 在 `roots` 为空时把 fallback root 设为 `launchTarget.cwd`
- npm 包 JS 模式下，`launchTarget.cwd` 实际落到 `dist/src`
- `browser_file_upload` 因为只允许访问 fallback root 下的文件，最终拒绝上传工作区外文件

用户希望的行为是：

- 默认不配置时保持旧行为，避免影响已有使用者
- 有需要时允许显式配置额外允许目录，用于上传工作区外的文件
- 这项能力会发布到 npm，继续通过 `npx @jianzhangg/playwright-pool` 使用

**目标**

1. 新增一个可选配置 `pool.extraAllowedRoots`，用于声明额外允许访问的本地目录。
2. 当客户端传入 `roots` 时，继续优先保留这些 roots；`extraAllowedRoots` 作为补充，而不是替代。
3. 当未配置 `extraAllowedRoots` 时，行为与当前版本完全一致。
4. 不修改 `browser_close` 的 slot 生命周期，不试图在本次修复里处理多标签页元数据陈旧问题。

**备选方案**

### 方案 A：新增可选配置 `extraAllowedRoots`

- 在配置文件中增加 `pool.extraAllowedRoots = ["/path/a", "/path/b"]`
- 运行时把客户端 `roots` 与这组额外 roots 合并后转发给 slot 子进程
- 未配置时仍沿用当前 fallback 行为

优点：

- 行为明确，可控，适合发 npm 公共包
- 保持向后兼容
- 不依赖 Codex 客户端是否支持 `roots`

缺点：

- 需要用户在确有需要时手动配置

### 方案 B：自动改用 `process.cwd()` 作为 fallback root

优点：

- 用户无需新增配置

缺点：

- 在当前 `npx` 场景下，主进程 `cwd` 可能是 `/`，并不可靠
- 行为不可预测，跨客户端差异大

### 方案 C：对 `browser_file_upload` 按传入路径自动放行

优点：

- 代码最少，表面体验最好

缺点：

- 直接绕过现有 `roots` 安全模型
- 不适合发 npm 公共包

**推荐方案**

采用方案 A。

原因：

- 它是唯一既能解决问题、又不破坏默认安全边界的方案
- 对已有用户完全兼容
- 用户是否要扩大权限是显式决定，不是隐式猜测

**设计**

### 1. 配置模型

在 `PoolConfig` 中新增：

- `extraAllowedRoots?: string[]`

解析规则：

- 可选
- 每项必须是非空字符串
- 解析时沿用现有 `normalizePath()` 逻辑，支持 `~/`
- 存储时统一保留为绝对或规范化路径字符串

### 2. roots 合并逻辑

新增一个小工具，把三类来源合成最终 roots：

1. 客户端传入的 `roots`
2. 配置里的 `extraAllowedRoots`
3. 若前两者都为空，则保留当前 fallback root

约束：

- 配置 roots 只作为追加，不覆盖客户端 roots
- 需要去重，避免同一路径重复出现
- 保持 `Root` 结构兼容现有 `ForwardedRootsState`

### 3. 初始化与文档

- `renderDefaultConfig()` 不写出 `extraAllowedRoots`，因为它不是必填项
- README 配置示例中补一段“如果要上传工作区外文件，可配置 `extraAllowedRoots`”
- `playwright-pool.example.toml` 也补注释示例

### 4. 明确不处理的范围

本次不处理：

- 多标签页下 `Page URL` / `Page Title` 陈旧
  - 当前 `playwright-pool` 对 tool result 基本透传，问题更像上游 `@playwright/mcp` 或客户端展示层
- `browser_close` 后 slot lease 继续存在
  - 当前设计本来就是租约绑定线程/进程，在 `shutdown()` 时统一释放

**测试策略**

1. 为配置解析补单元测试：
   - 配置 `extraAllowedRoots` 时能正确解析
   - 未配置时结果保持 `undefined`

2. 为 roots 合并补单元测试：
   - 只有客户端 roots 时，保留客户端 roots
   - 只有配置 roots 时，使用配置 roots
   - 两者同时存在时，合并且去重
   - 两者都为空时，仍回退到 fallback root

3. 为 `SlotRuntime` 补回归测试：
   - `extraAllowedRoots` 变化时会触发 slot client 替换
   - 生成的 roots 签名包含配置 roots

4. 跑相关测试：
   - `tests/config.test.ts`
   - `tests/forwarded-roots.test.ts`
   - `tests/slot-runtime.test.ts`
   - 如有需要补 `tests/init.test.ts`

**风险与约束**

- 这次修复只能解决“客户端没传 roots，但用户仍希望额外放行某些目录”的场景
- 如果用户要传任意系统目录，仍需要显式配置；这属于安全边界的有意设计
- 由于最终交付是 npm 包，修复完成后还需要版本发布，当前 Codex 会话不会自动切到新版本
