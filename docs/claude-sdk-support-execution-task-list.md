# Claude SDK 支持执行任务列表

## 1. 文档说明

本文用于整理当前项目补齐 Claude 模式能力的执行任务列表。

- 调研日期：2026-03-23
- 文档用途：为 Claude 模式命令支持、工具调用展示、详细模式与首页体验改造提供执行清单
- 当前结论：先做命令入口裁剪与项目能力接入，再补工具事件映射，最后做详细模式
- 当前策略：无迁移，直接替换

## 2. 调研结论

### 2.1 官方 SDK 现状

根据官方文档，Claude Code SDK 已更名为 Claude Agent SDK。

- 官方文档明确说明：
  - SDK 现在支持内置工具、Hooks、Subagents、MCP、Permissions、Sessions
  - Claude Code 的项目能力也可以通过 SDK 使用
  - 这些项目能力包括：
    - Skills
    - Slash commands
    - Memory
    - Plugins
- 官方文档明确说明：
  - `CLAUDE.md` 或 `.claude/CLAUDE.md` 是项目级 Memory 文件
  - 自定义命令目录是 `.claude/commands/*.md`
  - 如果要启用这些 Claude Code 项目能力，需要显式设置 `settingSources: ['project']`

### 2.2 与当前仓库的差异

当前仓库的 Claude 侧实现存在以下差异：

- 仓库当前依赖仍是 `@anthropic-ai/claude-agent-sdk` `^0.2.81`
- 官方文档已转向 Claude Agent SDK 新命名体系，且公开文档更强调 Claude Code 项目能力接入
- 当前 sidecar 已支持：
  - `thread/start`
  - `thread/resume`
  - `thread/fork`
  - `turn/start`
  - `turn/interrupt`
  - 审批请求
  - 用户补充输入请求
  - 模型列表
- 当前 sidecar 还没有完整支持：
  - Claude 项目命令体系接入确认
  - 自定义 slash commands 显示与调用
  - 工具调用全过程事件映射
  - 类似 Claude Code `ctrl+o` 的详细模式

### 2.3 关键判断

- `CLAUDE.md` 显示错误，本质是项目规则文件路由没按 provider 切换，这部分已经修正
- Claude 命令支持缺口，不只是前端自动补全问题，更可能是 SDK 项目能力没有完整启用
- 工具调用显示缺口，核心在 sidecar 没把 SDK 工具事件映射成现有前端协议
- `ctrl+o` 详细模式不能直接靠前端补按钮，前提是要先有足够完整的工具事件和执行轨迹

## 3. 官方资料摘要

### 3.1 官方已确认支持的能力

- Built-in tools
- Hooks
- Subagents
- MCP
- Permissions
- Sessions
- Skills
- Slash commands
- Memory
- Plugins

### 3.2 对当前项目最关键的官方要求

- 要启用 Claude Code 项目能力，需要设置 `settingSources: ['project']`
- 项目记忆文件应走 `CLAUDE.md` 或 `.claude/CLAUDE.md`
- 自定义命令应从 `.claude/commands/*.md` 读取
- Anthropic 不允许第三方产品直接提供 claude.ai 登录与额度展示，这与当前项目把 Claude 登录、额度入口降级隐藏是对齐的

## 4. 执行顺序

建议按以下顺序执行：

1. 先核对 SDK 项目能力是否真正开启
2. 再做 Claude 命令入口裁剪和接入
3. 再补 Claude 工具调用事件映射
4. 最后做类似 `ctrl+o` 的详细模式

## 5. 执行任务列表

### T1：核对并固定 Claude SDK 接入基线

任务目标：

- 明确当前仓库使用的 SDK 版本、命名、可用 API 与官方文档差异
- 明确是否继续沿用现有包，还是切换到官方当前主命名体系

任务内容：

- 核对当前依赖 `@anthropic-ai/claude-agent-sdk` 与官方当前文档命名之间的关系
- 核对当前 sidecar 使用的 API 是否仍被官方支持：
  - `query`
  - `listSessions`
  - `getSessionInfo`
  - `getSessionMessages`
  - `forkSession`
  - `supportedModels`
- 输出一份本仓库 Claude SDK capability matrix
- 明确是否需要补迁移任务

输出物：

- Claude SDK capability matrix
- Claude SDK 版本与命名决策说明

验收标准：

- 团队清楚当前依赖是否继续可用
- 团队清楚后续任务是基于现有 SDK 继续补齐，还是先升级 SDK

### T2：启用 Claude 项目级能力入口

任务目标：

- 让 Claude 工作区真正按 Claude Code 项目规则工作

任务内容：

- 在 Claude sidecar `buildQueryOptions` 中核对并补齐项目配置来源
- 调研并验证是否需要显式设置：
  - `settingSources: ['project']`
- 验证以下能力是否随之生效：
  - `CLAUDE.md`
  - `.claude/CLAUDE.md`
  - `.claude/commands/*.md`
  - `.claude/skills/SKILL.md`
- 若官方行为对旧包和新包有差异，记录差异并做兼容处理

输出物：

- Claude 项目能力启用补丁
- 项目规则与命令加载验证记录

验收标准：

- Claude 工作区确实读取 `CLAUDE.md`
- Claude 自定义命令可以被 SDK 识别
- Claude skills 项目能力有明确结论，支持则接入，不支持则显式降级

### T3：按 provider 裁剪命令入口

任务目标：

- Claude 模式下不再暴露明显不可用命令
- Claude 模式下暴露的命令与真实能力一致

任务内容：

- 梳理当前前端斜杠命令：
  - `/new`
  - `/resume`
  - `/fork`
  - `/status`
  - `/fast`
  - `/mcp`
  - `/compact`
  - `/review`
  - `/apps`
- 按 Claude provider 做命令分层：
  - 本地辅助命令
  - Claude SDK 已支持命令
  - 当前不支持命令
- 自动补全、快捷说明、发送路由统一按 provider 裁剪
- 对不支持命令给出明确提示，不再让用户先点进去再报错

建议的 Claude 一期命令分组：

- 可保留：
  - `/new`
  - `/resume`
  - `/fork`
  - `/status`
  - `/fast`
- 需调研后决定：
  - `/mcp`
- 先隐藏或禁用：
  - `/compact`
  - `/review`
  - `/apps`

输出物：

- Claude provider 命令矩阵
- 自动补全和发送路由改造

验收标准：

- Claude 模式下不会出现必然失败命令
- 前端展示的命令与后端实际支持一致

### T4：接入 Claude 自定义命令

任务目标：

- 让 Claude 工作区支持 Claude 项目自带命令和项目自定义命令

任务内容：

- 调研 SDK 是否直接暴露 slash command 列表
- 若 SDK 可直接提供命令列表，则直接接入
- 若 SDK 不直接提供命令列表，则补一层项目文件扫描：
  - 读取 `.claude/commands/*.md`
  - 解析命令名、描述、参数说明
- 将命令列表注入前端自动补全
- 保持 Codex 与 Claude 两套命令体系互不污染

输出物：

- Claude 命令发现器
- Claude 自定义命令自动补全

验收标准：

- Claude 模式下能看到 Claude 项目的自定义命令
- 自定义命令发送后能按 Claude 语义执行

### T5：补齐 Claude 工具调用事件映射

任务目标：

- 让 Claude 工具调用在消息区可见、可追踪、可聚合

任务内容：

- 调研 Claude SDK 流式输出中可观测的工具事件类型
- 梳理当前前端已支持的工具事件模型：
  - `commandExecution`
  - `fileChange`
  - `mcpToolCall`
  - `reasoning`
  - `plan`
  - `webSearch`
- 在 sidecar 中为 Claude 工具过程补齐事件映射：
  - `item/started`
  - `item/completed`
  - `item/commandExecution/outputDelta`
  - `item/fileChange/outputDelta`
  - 必要的 reasoning delta
- 审批流继续复用当前 host request 模型
- MCP 调用结果统一映射到 `mcpToolCall`

输出物：

- Claude 工具事件兼容层
- Claude 工具项映射测试

验收标准：

- Claude 执行命令时，消息区能看到命令项和输出增量
- Claude 修改文件时，消息区能看到文件变更项
- Claude MCP 工具调用时，消息区能看到工具名、参数、结果

### T6：补齐 Claude 工具调用详细展示

任务目标：

- 让 Claude 工具调用展示达到接近 Codex 当前可读性的水平

任务内容：

- 对 Claude 工具项补齐标题、状态、输入、输出、变更摘要
- 对长输出做截断策略和展开策略
- 对命令、文件变更、MCP 分别补齐摘要文案
- 统一 Claude 与 Codex 的工具项视觉层，不重写整套消息区

输出物：

- Claude 工具项展示对齐改造

验收标准：

- Claude 工具项在消息区能稳定显示
- 用户能分清“执行了什么”“结果是什么”“是否完成”

### T7：评估并实现类似 `ctrl+o` 的详细模式

任务目标：

- 评估 Claude Code `ctrl+o` 详细模式是否能在当前架构中合理支持

任务内容：

- 先确认官方 SDK 是否直接暴露与 `ctrl+o` 对应的结构化事件
- 若官方没有直接暴露，则在当前产品中定义“等价详细模式”
- 等价详细模式建议基于以下信息组合：
  - 工具调用列表
  - 命令输出增量
  - 文件改动摘要
  - reasoning 片段
  - 审批与用户补充输入记录
- 选择展示方式：
  - 方案 A：消息区内联展开
  - 方案 B：右侧详情面板
  - 方案 C：工具组展开卡片

建议优先级：

- 先做方案 C
- 再决定是否演进到方案 B

输出物：

- Claude 详细模式设计说明
- 第一版详细模式实现

验收标准：

- 用户能在 Claude 模式下查看更细的执行轨迹
- 不要求完全复刻终端 `ctrl+o`
- 但需要达到“可看懂工具过程”的产品目标

### T8：补齐测试与人工验收

任务目标：

- 防止 Claude 与 Codex 双 provider 行为继续漂移

任务内容：

- 增加以下测试：
  - Claude provider 命令自动补全裁剪测试
  - Claude 工作区 `CLAUDE.md` 读写测试
  - Claude sidecar 工具事件映射测试
  - Claude 详细模式展示测试
- 更新人工验收矩阵
- 覆盖本地模式和远程模式

输出物：

- 自动化测试
- 人工验收补充项

验收标准：

- Claude 模式主链路改动有测试兜底
- 新增能力在本地与远程模式下都有可执行验收项

## 6. 优先级建议

### P0

- T1 核对 SDK 基线
- T2 启用 Claude 项目级能力入口
- T3 按 provider 裁剪命令入口

当前状态：

- 已完成
- 相关基线文档见 `docs/claude-sdk-capability-matrix.md`

### P1

- T4 接入 Claude 自定义命令
- T5 补齐 Claude 工具调用事件映射
- T6 补齐 Claude 工具调用详细展示

### P2

- T7 评估并实现类似 `ctrl+o` 的详细模式
- T8 补齐测试与人工验收

## 7. 已完成项

以下问题已完成修正：

- Claude 工作区首页提示文案已按 provider 切换
- Claude 工作区首页规则文件卡片已切换为 `CLAUDE.md`
- 工作区规则文件读写已按 provider 路由到 `CLAUDE.md` 或 `AGENTS.md`

## 8. 参考资料

- Anthropic 官方文档：Agent SDK overview
  - https://platform.claude.com/docs/en/agent-sdk/overview
- Anthropic 官方 Changelog：claude-code
  - https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- 当前仓库依赖版本
  - `package.json` 中为 `@anthropic-ai/claude-agent-sdk` `^0.2.81`
