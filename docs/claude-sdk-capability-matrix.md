# Claude SDK Capability Matrix

## 1. 文档目的

本文记录当前仓库 Claude SDK 的 P0 基线结论，作为后续 Claude provider 功能补齐的统一参考。

- 状态：生效中
- 日期：2026-03-23
- 当前策略：无迁移，直接替换

## 2. 当前依赖基线

- npm 包：`@anthropic-ai/claude-agent-sdk`
- 当前版本：`0.2.81`
- 对应 Claude Code 版本：`2.1.81`
- 本仓库当前侧车实现文件：`src-tauri/resources/claude_sdk_sidecar.mjs`

结论：

- 当前仓库继续沿用 `@anthropic-ai/claude-agent-sdk@0.2.81`
- 当前版本仍导出本仓库正在使用的核心 API
- P0 阶段不做 SDK 包名迁移，只补齐项目能力入口和命令裁剪

## 3. API 能力矩阵

| 能力 | 官方/本地基线 | 仓库现状 | P0 结论 |
| --- | --- | --- | --- |
| `query` | 支持 | 已使用 | 保留 |
| `listSessions` | 支持 | 已使用 | 保留 |
| `getSessionInfo` | 本地类型导出可用 | 已使用 | 保留 |
| `getSessionMessages` | 本地类型导出可用 | 已使用 | 保留 |
| `forkSession` | 支持 | 已使用 | 保留 |
| `supportedModels` | 支持 | 已使用 | 保留 |
| `supportedCommands` | 支持 | 未接入前端 | 作为后续 T4 输入 |
| `settingSources` | 支持 | 之前未显式设置 | P0 补齐 `['project']` |

说明：

- `listSessions`、`query`、`supportedModels` 可在官方 TypeScript 文档中确认
- `getSessionInfo`、`getSessionMessages`、`forkSession` 在当前安装包类型声明中仍然导出
- `supportedCommands` 已在当前安装包 `Query` 接口中导出，但 P0 先不做前端命令发现

## 4. Claude 项目能力结论

### 4.1 项目规则文件

- 官方要求显式设置 `settingSources: ['project']`
- P0 已在 Claude sidecar `buildQueryOptions` 中补齐
- 生效后 Claude 工作区会按项目目录加载：
  - `CLAUDE.md`
  - `.claude/CLAUDE.md`

### 4.2 自定义 slash commands

- 官方文档确认 SDK 支持项目级 slash commands
- 项目命令目录为 `.claude/commands/*.md`
- 当前产品在 P0 阶段不做命令列表发现
- 当前产品在 P0 阶段允许用户手输自定义命令，文本会直接发给 Claude SDK 执行

### 4.3 Skills

- 官方文档确认 SDK 支持 Skills
- 项目 skills 目录为 `.claude/skills/*`
- P0 阶段仅打开项目配置来源，不新增 Claude skills 自动补全
- 因此前端产品能力仍按“未接入 skills 展示”处理，避免 UI 与真实接入状态混淆

## 5. Claude P0 命令矩阵

### 5.1 Codex

- 保留：`/new`、`/resume`、`/fork`、`/status`、`/fast`、`/mcp`、`/compact`、`/review`
- 条件保留：`/apps`

### 5.2 Claude

- 保留：`/new`、`/resume`、`/fork`、`/status`、`/fast`
- P0 隐藏：`/mcp`、`/compact`、`/review`、`/apps`

说明：

- `/mcp` 当前仍走现有 `list_mcp_server_status` 本地接口，属于现阶段 Codex 命令链路
- `/compact`、`/review`、`/apps` 当前没有 Claude 对齐实现，P0 不再暴露

## 6. 变更说明

- Claude sidecar 已显式启用 `settingSources: ['project']`
- Composer slash 自动补全已按 provider 裁剪
- slash 发送路由已按 provider 裁剪
- Claude 模式下不再拦截不支持的内置命令，未支持命令会按普通文本发给 SDK

## 7. 调研记录

### 7.1 Context7

- 日期：2026-03-23
- 话题：Claude Agent SDK `settingSources`、项目 Memory、slash commands、sessions API
- token：7000
- 结论：项目级 `CLAUDE.md` 与 slash commands 需要显式启用 `settingSources`

- 日期：2026-03-23
- 话题：Claude Agent SDK `listSessions`、`query`、`supportedModels`
- token：5000
- 结论：以上 API 在官方 TypeScript 文档中可确认

- 日期：2026-03-23
- 话题：Claude Agent SDK sessions / `forkSession`
- token：5000
- 结论：官方文档明确说明 `forkSession` 作为恢复会话时的分叉能力存在

### 7.2 本地校验

- 校验文件：`node_modules/@anthropic-ai/claude-agent-sdk/package.json`
- 校验文件：`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
- 结论：当前安装版本仍导出 `query`、`listSessions`、`getSessionInfo`、`getSessionMessages`、`forkSession`、`supportedCommands`、`supportedModels`
