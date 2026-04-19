# Claude 实验功能后续开发任务列表

## 1. 说明

本文用于承接当前项目中 Claude 实验功能已经可以使用后的后续开发工作，目标是把“能用”推进到“稳定、可维护、可验收”。

- 文档定位：执行任务列表。
- 适用阶段：Claude 实验功能主链路已打通后的持续开发阶段。
- 变更策略：无迁移，直接替换。

## 2. 当前阶段判断

根据当前仓库现状，Claude 相关能力已经具备以下基础：

- 已存在 `codex` / `claude` provider 模型。
- 已存在 Claude 运行配置项，如 `claudeBin`、`claudeArgs`、`claudePermissionMode`、`claudeUseSdkSidecar`。
- 已存在实验开关 `experimentalClaudeEnabled`。
- 已存在 Claude sidecar 启动链路。
- 已存在 app 与 daemon 的 Claude 接入基础路径。

当前后续工作的重点，不再是“是否接入 Claude”，而是以下四件事：

1. 收口能力边界。
2. 补齐前端体验与降级逻辑。
3. 保证本地与远程模式行为一致。
4. 补测试、补验收、补文档。

## 3. 总体目标

后续阶段建议围绕以下目标推进：

1. 让 workspace 级别的 Claude 选择、保存、恢复稳定可用。
2. 让前端界面严格基于 provider capability 展示，不出现误导性入口。
3. 让 app 与 daemon 的 Claude 行为一致。
4. 让 Claude 链路具备基本回归测试和人工验收矩阵。
5. 为后续转正式能力预留稳定发布条件。

## 4. 任务列表

### T1. 收口 Provider 与能力模型

#### T1.1 核对 workspace provider 持久化

目标：
保证每个 workspace 的 `provider` 字段可以稳定保存、读取、恢复，不因旧数据、默认值或实验开关而产生错误回退。

执行项：

- 检查 workspace 新建、编辑、加载、恢复链路中的 `provider` 读写逻辑。
- 检查旧数据未设置 `provider` 时的默认值处理。
- 检查关闭 `experimentalClaudeEnabled` 后是否会错误污染已保存数据。
- 检查多 workspace 场景下 provider 是否串值。

重点文件：

- `src/types.ts`
- `src/utils/agentProvider.ts`
- `src/features/workspaces/hooks/*`
- `src-tauri/src/types.rs`
- `src-tauri/src/storage.rs`

验收标准：

- workspace 可独立保存 `codex` 或 `claude`。
- 重启应用后 provider 保持不变。
- 旧数据缺省时可自动回落到 `codex`。

#### T1.2 明确 Claude 一期 capability 边界

目标：
把 Claude 当前真实支持的能力明确下来，避免界面能力与实际运行能力不一致。

执行项：

- 逐项核对以下能力是否已经支持：
  - login
  - rate limits
  - skills
  - apps
  - steer
  - review
  - collaboration modes
- 明确哪些能力仍然属于“不可用”或“暂不支持”。
- 将 capability 结果沉淀为统一能力模型，不允许前端散落硬编码判断。

重点文件：

- `src/utils/agentProvider.ts`
- `src/types.ts`
- `src-tauri/src/shared/*`

验收标准：

- Claude capability 定义唯一且清晰。
- 前后端对 Claude capability 的理解一致。

#### T1.3 统一 provider 能力获取方式

目标：
前端展示逻辑优先基于后端返回能力，前端 fallback 仅作为兜底，不作为长期真实来源。

执行项：

- 检查 provider capability 是否已由后端稳定返回。
- 若仍以静态 fallback 为主，补齐后端能力返回链路。
- 确保前端在 capability 不存在时才走本地兜底。

重点文件：

- `src/utils/agentProvider.ts`
- `src/services/tauri.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/shared/*`

验收标准：

- 前端 capability 判断可统一走同一来源。
- 新增 capability 时不需要到处改 UI 判断逻辑。

### T2. 稳定 Claude 主链路

#### T2.1 核对 Claude session 生命周期

目标：
保证 Claude provider 在 session 维度上的行为稳定，不出现连接后不可恢复、恢复后不可发送等问题。

执行项：

- 验证 connect workspace。
- 验证 start thread。
- 验证 resume thread。
- 验证 send user message。
- 验证 interrupt / cancel。
- 验证 approval request / response。
- 验证 user input 流程。

重点文件：

- `src-tauri/src/backend/app_server.rs`
- `src-tauri/src/codex/mod.rs`
- `src-tauri/src/bin/codex_monitor_daemon.rs`

验收标准：

- 上述主链路在 Claude 模式下可连续执行。
- 线程恢复后仍能继续发送消息。
- 中断和审批场景行为可预期。

#### T2.2 核对 Claude sidecar 启动参数

目标：
确保 Claude 启动链路的配置来源清晰、参数稳定、错误提示可理解。

执行项：

- 检查 `claudeBin` 生效逻辑。
- 检查 `claudeArgs` 生效逻辑。
- 检查 `claudePermissionMode` 生效逻辑。
- 检查 `claudeUseSdkSidecar` 的开关行为。
- 检查 sidecar 缺失、路径错误、权限模式错误时的报错文案。

重点文件：

- `src-tauri/src/backend/app_server.rs`
- `src-tauri/resources/claude_sdk_sidecar.mjs`
- `src/features/settings/components/*`

验收标准：

- Claude 启动配置可被正确透传。
- 常见配置错误能给出清晰提示。

#### T2.3 核对事件映射与线程归属

目标：
保证 Claude 事件进入前端后，线程、消息、工具项和状态项都能落到正确位置。

执行项：

- 检查 `app-server-event` 在 Claude 模式下的字段结构。
- 检查线程 ID、父子线程、工具调用、审批、用户输入等事件映射。
- 检查事件丢失或字段不齐时的容错逻辑。

重点文件：

- `src/services/events.ts`
- `src/features/app/hooks/useAppServerEvents.ts`
- `src/utils/appServerEvents.ts`
- `src/features/threads/hooks/*`

验收标准：

- Claude 线程内事件展示完整。
- 不会因字段差异导致消息错位或线程错挂。

### T3. 补齐前端体验

#### T3.1 完成 capability 驱动的 UI 降级

目标：
Claude 不支持的功能不应继续暴露为可点击入口。

执行项：

- 核查以下界面是否按 capability 处理：
  - 登录入口
  - 额度展示
  - skills
  - apps
  - review
  - steer
  - collaboration modes
- 对不支持的能力采用隐藏或禁用策略。
- 对禁用项补充简短说明文案。

重点文件：

- `src/features/settings/components/*`
- `src/features/composer/components/*`
- `src/features/threads/components/*`
- `src/features/git/components/*`
- `src/utils/agentProvider.ts`

验收标准：

- Claude 模式下看不到误导性入口。
- 用户不会点进明显不可用的功能。

#### T3.2 增加 Provider 标识

目标：
让用户在多 workspace、多线程场景下，能快速识别当前使用的是 Codex 还是 Claude。

执行项：

- 在 workspace 列表加 provider 标识。
- 在线程区域或会话头部加 provider 标识。
- 在必要时增加 provider 风格提示，但不做过重设计。

重点文件：

- `src/features/workspaces/components/*`
- `src/features/threads/components/*`
- `src/App.tsx`

验收标准：

- 用户在主要操作区域都能识别当前 provider。

#### T3.3 改造设置页为 provider 视角

目标：
让设置页从“只围绕 Codex”转为“围绕 provider 运行配置”，降低理解成本。

执行项：

- 将 Codex 与 Claude 的运行配置分组展示。
- 明确实验开关、provider 二进制路径、额外参数、权限模式、sidecar 开关的含义。
- 补充必要的字段说明。

重点文件：

- `src/features/settings/components/SettingsView.tsx`
- `src/features/settings/hooks/useAppSettings.ts`
- `src/types.ts`

验收标准：

- 用户可以从设置页直接理解 Claude 如何启用和运行。

### T4. 保证 app / daemon 一致性

#### T4.1 核对 app 与 daemon Provider 抽象是否共源

目标：
避免桌面端与远程端使用不同实现路径，导致行为不一致。

执行项：

- 检查 provider 路由逻辑是否已经尽量下沉到 shared 层。
- 若 app 和 daemon 存在重复分支逻辑，优先收敛到 shared 核心。
- 保持方法名、参数结构、返回结构一致。

重点文件：

- `src-tauri/src/shared/*`
- `src-tauri/src/lib.rs`
- `src-tauri/src/bin/codex_monitor_daemon.rs`

验收标准：

- 主要 provider 判断逻辑共源。
- app 与 daemon 的行为差异最小化。

#### T4.2 核对 daemon RPC 分发

目标：
保证远程模式下 Claude 相关调用都能完整透传和返回。

执行项：

- 核对 start/resume/send/interrupt/approval/user input 的 RPC 分发。
- 核对相关参数是否缺失或命名不一致。
- 核对错误信息是否能透传给前端。

重点文件：

- `src-tauri/src/bin/codex_monitor_daemon/rpc.rs`
- `src-tauri/src/bin/codex_monitor_daemon/rpc/*`
- `src/services/tauri.ts`

验收标准：

- 远程 Claude 核心调用链与本地保持一致。

#### T4.3 核对远程事件透传

目标：
确保远程模式下 `app-server-event` 及相关通知不会丢失、乱序或缺字段。

执行项：

- 检查 websocket / rpc 事件转发链路。
- 核查线程事件、工具事件、审批事件、终端事件。
- 对异常场景补日志与容错。

重点文件：

- `src-tauri/src/bin/codex_monitor_daemon/http/ws.rs`
- `src-tauri/src/bin/codex_monitor_daemon/rpc.rs`
- `src/services/events.ts`

验收标准：

- 远程模式与本地模式的事件表现基本一致。

### T5. 测试与人工验收

#### T5.1 增加 Rust 单元测试

目标：
为 Claude 主链路和 provider 路由提供基础回归保护。

执行项：

- 补 provider 相关类型与路由测试。
- 补 Claude sidecar 启动参数测试。
- 补线程恢复、事件提取、线程归属相关测试。

重点文件：

- `src-tauri/src/backend/app_server.rs`
- `src-tauri/src/shared/*`

验收标准：

- 核心 Claude 路径具备最小可用回归测试。

#### T5.2 增加前端测试

目标：
保证 provider 切换和 capability 降级逻辑不会在后续迭代中被破坏。

执行项：

- 补 `agentProvider` 相关测试。
- 补设置页 provider 配置测试。
- 补 workspace/provider 展示测试。
- 补 capability 驱动的 UI 显隐测试。

重点文件：

- `src/utils/agentProvider.test.ts`
- `src/features/settings/**/*.test.*`
- `src/features/workspaces/**/*.test.*`

验收标准：

- 前端 provider 相关关键行为有测试覆盖。

#### T5.3 建立人工验收矩阵

目标：
用统一清单验证 Claude 功能在不同运行模式下的可用性。

执行项：

- 至少覆盖以下四类场景：
  - 本地 Codex
  - 本地 Claude
  - 远程 Codex
  - 远程 Claude
- 每类场景至少验证：
  - 连接 workspace
  - 新建线程
  - 恢复线程
  - 发送消息
  - 中断
  - 审批
  - 用户输入

验收标准：

- 四类场景均有验收记录。
- 关键链路均可复现验证。

### T6. 发布准备

#### T6.1 补 README 与使用文档

目标：
让 Claude 功能的启用方式、限制项、依赖要求对使用者透明。

执行项：

- 在 README 中补充 Claude 使用说明。
- 补充限制项、已支持项、未支持项。
- 补充常见问题与错误排查说明。

重点文件：

- `README.md`
- `docs/*`

验收标准：

- 使用者可以按文档完成 Claude 配置和验证。

#### T6.2 确认打包与依赖策略

目标：
确保 Claude sidecar 及依赖在构建和发布后可正常使用。

执行项：

- 核对 sidecar 脚本打包行为。
- 核对依赖路径解析逻辑。
- 核对不同平台下的运行前提。

重点文件：

- `src-tauri/resources/claude_sdk_sidecar.mjs`
- `src-tauri/tauri.conf.json`
- 构建与发布脚本

验收标准：

- 安装包中的 Claude 能力可正常启动。

#### T6.3 决定实验开关策略

目标：
确定 Claude 后续是继续实验开关控制、灰度开放，还是转为稳定入口。

执行项：

- 根据测试和人工验收结果决定是否继续默认关闭。
- 若保持实验态，补充更明确的界面提示。
- 若进入稳定态，准备移除部分实验提示和分支判断。

重点文件：

- `src/features/settings/hooks/useAppSettings.ts`
- `src/features/settings/components/*`
- `src/utils/agentProvider.ts`

验收标准：

- Claude 功能的对外开放策略明确。

## 5. 建议执行顺序

建议按以下顺序推进：

1. `T1.1` workspace provider 持久化
2. `T1.2` Claude capability 收口
3. `T2.1` Claude 主链路稳定性核对
4. `T3.1` capability 驱动 UI 降级
5. `T4.1` / `T4.2` app 与 daemon 对齐
6. `T5.1` / `T5.2` 自动化测试补齐
7. `T5.3` 人工验收矩阵
8. `T6.*` 发布准备

## 6. 第一批必做任务

如果当前只安排一轮短周期开发，建议优先做以下任务：

1. `T1.1` workspace provider 持久化
2. `T1.2` Claude capability 收口
3. `T2.1` Claude session 生命周期核对
4. `T3.1` capability 驱动 UI 降级
5. `T4.2` daemon RPC 分发核对
6. `T5.3` 人工验收矩阵建立

## 7. 变更说明

- 新增 Claude 实验功能后续开发任务文档。
- 文档聚焦执行落地，不替代已有设计类任务清单。
- 当前结论：无迁移，直接替换。
