# 发布说明

本文档描述 `@jianzhangg/playwright-pool` 发布到 npm 前后的最小流程。

## 发布前提

- 已有可用的 npm 账号
- npm 账号邮箱已验证
- 本机已完成 `npm login`
- 当前包名在 npm registry 中未被占用
- 代码已经通过测试、构建与 `npm pack --dry-run`

当前项目默认包名为 `@jianzhangg/playwright-pool`，并且 `package.json` 已设置 `publishConfig.access = "public"`。

## 官方要求要点

- 包名需要唯一，并遵守 npm 的命名规范
- 无 scope 的公开包可以直接发布
- 带 scope 的公开包发布时需要显式使用 `--access public`
- 建议为账号开启 2FA；如果账号或组织策略要求 2FA，则发布时必须满足

## 本项目发布步骤

### 1. 安装依赖并验证

```bash
cd /path/to/playwright-pool
npm install
npm test
npm run build
npm_config_cache=/tmp/playwright-pool-npm-cache npm pack --dry-run
```

### 2. 登录 npm

```bash
npm login
npm whoami
```

### 3. 检查包名是否可用

```bash
curl -I https://registry.npmjs.org/@jianzhangg%2fplaywright-pool
```

- 如果返回 `404`，通常表示当前包名未被占用
- 如果返回 `200`，说明该包名已存在，需要换名或改成 scope 包

### 4. 正式发布

```bash
cd /path/to/playwright-pool
npm publish
```

## 发布后建议

- 在仓库 README 中补上 npm 安装徽标或包链接
- 如果仓库地址发生变化，记得同步更新 `package.json` 中的 `repository`、`homepage`、`bugs`
- 每次发布前都重新执行一次测试、构建和 `npm pack --dry-run`
