# Claude Code 支持开发任务清单

## 1. 说明

本文用于把“为当前项目增加 Claude Code 支持”拆成可排期、可分工、可验收的任务清单。

适用目标：

- 在保留现有 Codex 支持的前提下，为项目增加 Claude Code 运行时支持。
- 采用多 Provider 架构，不破坏现有 Codex 主链路。
- 先做可用版，再逐步补齐高级能力。

实施路线：

- 保留现有 Codex `app-server` 路线。
- 新增 `ClaudeProvider`。
- Claude 侧优先采用“Node sidecar + Claude Agent SDK”方案。
- 第一阶段不追求 Claude 与 Codex 100% 功能对齐。

实施原则：

- 先冻结范围，再改模型。
- 先抽象 Provider，再接 Claude。
- 先保证本地主链路，再补 daemon 对齐。
- 先复用现有前端事件模型，再补差异能力。
- 禁用 CI/CD 自动化，构建、测试、发布均需人工操作。

迁移策略：

- 无迁移，直接替换。

## 2. 一期范围

### 2.1 一期必须支持

- workspace 级别选择 `codex` 或 `claude`。
- 连接 workspace。
- 创建线程。
- 恢复线程。
- 发送消息。
- 流式接收消息。
- 中断当前运行。
- 基础审批请求。
- 基础用户输入请求。
- 本地模式可用。
- daemon 远程模式可用。

### 2.2 一期允许降级

- Claude 登录流程不做 Codex 同款实现。
- Claude 额度与套餐展示先不支持。
- Claude `skills/apps` 先不保证支持。
- Claude `collaboration modes` 先不保证支持。
- Claude `review/start` 先不作为一期硬性范围。
- Claude 自动更新不做。

### 2.3 一期关键结论

- 不能直接把 `codex` 二进制替换成 `claude`。
- 必须新增 Provider 抽象层。
- 必须按 Provider 隔离 session。
- 必须做能力开关，不能假设所有 Provider 完全同构。

## 3. 迭代总览

### I0：方案冻结与类型改造

目标：

- 冻结 Claude 支持范围。
- 为后续开发准备好 Provider、能力开关、设置模型和 workspace 模型。

建议周期：

- 1 到 2 天

### I1：Provider 抽象与 session 隔离

目标：

- 从当前 Codex 直连模式切到 Provider 抽象模式。
- 完成多 Provider session 管理。

建议周期：

- 2 到 3 天

### I2：Claude sidecar 与主链路打通

目标：

- Claude 能连接、开始会话、续接会话、收发消息、停止运行。

建议周期：

- 4 到 6 天

### I3：前端接入与能力降级

目标：

- 前端能识别 Claude workspace。
- 前端根据 capability 自动显示、隐藏或降级。

建议周期：

- 2 到 4 天

### I4：daemon 对齐、测试与人工验收

目标：

- app 与 daemon 行为一致。
- 完成验证矩阵和人工联调。

建议周期：

- 2 到 4 天

## 4. I0 任务清单

### T0.1 冻结一期范围

任务内容：

- 明确一期必须支持的能力。
- 明确一期允许降级的能力。
- 明确 Claude 不做 Codex 同款登录与额度展示。

输出物：

- 当前任务清单作为执行真源。

验收标准：

- 团队对“一期先做可用版，不追求 100% 对齐”达成一致。
- 团队对“Claude 不直接复用 Codex 协议”达成一致。

### T0.2 冻结 Provider 绑定粒度

任务内容：

- 确认 Provider 绑定到 workspace，而不是全局唯一 Provider。
- 确认不同 workspace 可分别选择 `codex` 或 `claude`。

输出物：

- workspace provider 设计结论。

验收标准：

- 设计文档和代码实现都以 workspace 维度保存 provider。

### T0.3 扩展前端类型模型

任务内容：

- 在 `src/types.ts` 增加 `AgentProvider`。
- 增加 `ProviderCapabilities`。
- 扩展 `AppSettings` 与 `WorkspaceInfo`。

输出物：

- 前端类型定义完成。

验收标准：

- 前端类型检查通过。
- 不会因为旧配置缺字段导致编译失败。

### T0.4 扩展 Rust 类型模型

任务内容：

- 在 `src-tauri/src/types.rs` 增加 Provider 相关字段。
- 为新字段补默认值。
- 保证旧 `settings.json` 和 `workspaces.json` 可继续反序列化。

输出物：

- Rust 类型定义完成。

验收标准：

- `cargo check` 通过。
- 空配置和旧配置都能正常加载。

### T0.5 改造 AppSettings

任务内容：

- 增加 `defaultAgentProvider`。
- 增加 `claudeBin`。
- 增加 `claudeArgs`。
- 增加 `claudePermissionMode`。
- 增加 `claudeUseSdkSidecar`。

输出物：

- 设置模型支持 Claude。

验收标准：

- 设置读写不报错。
- 新字段保存后，重启应用可恢复。

### T0.6 改造 workspace 存储模型

任务内容：

- 在 `WorkspaceEntry`、`WorkspaceInfo` 增加 `provider` 字段。
- 让新增 workspace、编辑 workspace、读取 workspace 都能处理 provider。

输出物：

- workspace provider 存储链路打通。

验收标准：

- 新建 workspace 后 provider 不丢失。
- 旧 workspace 没有 provider 时默认按 `codex` 处理。

## 5. I1 任务清单

### T1.1 引入统一 Provider 抽象

任务内容：

- 新增统一运行时抽象层。
- 定义统一接口：
  - `connect_workspace`
  - `start_thread`
  - `resume_thread`
  - `send_user_message`
  - `interrupt_turn`
  - `respond_to_server_request`
  - `list_models`
  - `get_capabilities`

输出物：

- Provider trait 或等价抽象完成。

验收标准：

- 业务命令不再直接依赖 Codex 协议方法名。

### T1.2 包装现有 Codex 实现

任务内容：

- 把现有 `codex_core` 能力包进 `CodexProvider`。
- 保持现有行为与事件流不变。

输出物：

- `CodexProvider` 基础实现完成。

验收标准：

- 仅使用 Codex 时，现有主链路不回归。

### T1.3 改造 session key 设计

任务内容：

- 把 session 管理从“单一共享 session”改为“按 Provider 隔离”。
- 引入 provider 维度的 session key。

输出物：

- 多 Provider session 管理结构。

验收标准：

- Codex 和 Claude 并存时不会复用同一个 session。

### T1.4 调整 workspace 连接流程

任务内容：

- `connect_workspace` 根据 workspace provider 选择不同 Provider。
- 保证 provider 变化后能重新连接正确的运行时。

输出物：

- workspace 连接分发逻辑完成。

验收标准：

- 同一个应用中可同时连接 Codex workspace 和 Claude workspace。

### T1.5 限制 Claude 一期 session 复用策略

任务内容：

- Claude 一期先采用“1 workspace 1 session”。
- 暂不做 Claude 跨 workspace session 复用。

输出物：

- Claude session 生命周期策略落地。

验收标准：

- Claude workspace 切换不会串上下文。

### T1.6 引入 capability 模型

任务内容：

- 定义 Provider capability。
- 区分：
  - `supportsLogin`
  - `supportsRateLimits`
  - `supportsSkills`
  - `supportsApps`
  - `supportsSteer`
  - `supportsReview`
  - `supportsCollaborationModes`

输出物：

- capability 真源模型完成。

验收标准：

- 前后端都能读取 capability。

## 6. I2 任务清单

### T2.1 设计 Claude sidecar 协议

任务内容：

- 定义 Rust 与 sidecar 之间的 stdio JSON 协议。
- 至少覆盖：
  - `initialize`
  - `connect`
  - `start_thread`
  - `resume_thread`
  - `send_user_message`
  - `interrupt_turn`
  - `respond_to_server_request`
  - `list_models`
  - `get_capabilities`
  - `event_stream`

输出物：

- sidecar 协议文档或代码常量定义。

验收标准：

- 协议字段稳定。
- 错误、结果、事件格式一致。

### T2.2 新建 Claude sidecar 工程

任务内容：

- 新建 Node sidecar。
- 接入 Claude Agent SDK。
- 实现初始化与基础日志输出。

输出物：

- sidecar 工程骨架。

验收标准：

- sidecar 可单独启动。
- Rust 能检测 sidecar 初始化成功。

### T2.3 实现 Claude 连接与 session 创建

任务内容：

- 让 sidecar 为 workspace 创建 Claude session。
- 保存 Claude session id。

输出物：

- Claude connect 链路完成。

验收标准：

- 连接 Claude workspace 后可进入可发送状态。

### T2.4 实现 Claude 线程开始与恢复

任务内容：

- 实现 `start_thread`。
- 实现 `resume_thread`。
- 支持继续最近会话或按指定 session 恢复。

输出物：

- Claude 线程主链路完成。

验收标准：

- 新线程和恢复线程都可正常工作。

### T2.5 实现 Claude 发消息与流式输出

任务内容：

- sidecar 调 Claude 发送消息。
- 把 Claude 流式事件回传 Rust。
- Rust 转发给前端。

输出物：

- Claude 消息流链路完成。

验收标准：

- 前端消息区能实时看到 Claude 增量输出。

### T2.6 实现 Claude 中断与取消

任务内容：

- 提供运行取消能力。
- 保证 sidecar、Rust、前端状态一致收敛。

输出物：

- Claude interrupt 链路完成。

验收标准：

- 点击停止后，运行可以结束，不残留挂起状态。

### T2.7 实现 Claude 审批流

任务内容：

- 把 Claude 权限请求转换成当前审批请求事件。
- 支持前端审批结果回传。

输出物：

- Claude approval 主链路完成。

验收标准：

- Claude 需要审批时，前端可以接收、确认、拒绝并继续流程。

### T2.8 实现 Claude 用户输入流

任务内容：

- 把 Claude 的补充提问或结构化提问转换成当前 `requestUserInput` 数据结构。
- 支持用户回答回传 Claude。

输出物：

- Claude user input 主链路完成。

验收标准：

- Claude 需要用户回答时，前端表单可正常展示与提交。

### T2.9 实现 Claude 模型列表

任务内容：

- 实现 Claude 模型列表获取。
- 输出统一模型结构。

输出物：

- `list_models` 对 Claude 可用。

验收标准：

- 设置页和消息发送区可读取 Claude 可用模型。

## 7. I3 任务清单

### T3.1 改造设置页为运行时视角

任务内容：

- 把当前单一 Codex 设置区改成统一运行时设置区。
- 拆出：
  - 通用设置
  - Codex 设置
  - Claude 设置

输出物：

- 新设置页结构。

验收标准：

- 用户可在 UI 中分别配置 Codex 和 Claude。

### T3.2 增加 workspace provider 编辑能力

任务内容：

- 新增 workspace 时可选 provider。
- 编辑 workspace 时可切换 provider。

输出物：

- workspace provider 交互完成。

验收标准：

- 切换 provider 后重新连接走对应 Provider。

### T3.3 做前端事件归一化兼容

任务内容：

- 尽量把 Claude 事件映射为现有事件名：
  - `thread/started`
  - `turn/started`
  - `item/agentMessage/delta`
  - `item/completed`
  - `error`
  - `item/tool/requestUserInput`

输出物：

- Claude 到前端事件兼容层。

验收标准：

- 现有线程和消息组件大体无需重写。

### T3.4 做 capability 驱动 UI 降级

任务内容：

- 根据 capability 动态隐藏或禁用不支持的能力。
- 明确 Claude 一期降级项：
  - 登录
  - 额度
  - `skills`
  - `apps`
  - 高级协作模式
  - 自动更新

输出物：

- UI 降级策略完成。

验收标准：

- Claude workspace 下不会出现明显不可用入口。

### T3.5 增加 Provider 可视标识

任务内容：

- 在 workspace 区域显示当前 provider。
- 在调试面板显示当前 provider。
- 在设置页显示 provider 状态。

输出物：

- Provider 可视化标识。

验收标准：

- 用户能明确区分当前对话来自 Codex 还是 Claude。

### T3.6 改造前端 RPC 包装层

任务内容：

- 保持前端调用名尽量不变。
- 让前端通过统一 RPC 命令访问不同 Provider。

输出物：

- 统一 RPC 包装。

验收标准：

- 业务组件不需要大量写 Provider 特判。

## 8. I4 任务清单

### T4.1 保证 app 与 daemon 共用 Provider 抽象

任务内容：

- 把 Provider 真源放在 shared core。
- app 和 daemon 共用同一套调度逻辑。

输出物：

- shared core 为单一真源。

验收标准：

- 不存在一套桌面逻辑、一套 daemon 逻辑的重复实现。

### T4.2 改造 daemon RPC 分发

任务内容：

- 让 daemon RPC 也按 workspace provider 分发到不同 Provider。
- 保证远程模式支持 Claude。

输出物：

- daemon provider dispatch 完成。

验收标准：

- 远程模式可连接 Claude workspace。

### T4.3 改造远程事件透传

任务内容：

- 保持远程事件流格式与本地模式一致。
- Claude 事件也通过统一事件流发送给前端。

输出物：

- 远程模式事件透传完成。

验收标准：

- 前端在本地模式和远程模式下表现一致。

### T4.4 增加 Rust 单元测试

任务内容：

- 覆盖设置默认值。
- 覆盖 workspace provider 默认值。
- 覆盖 session key 隔离。
- 覆盖 provider dispatch。

输出物：

- Rust 单元测试补齐。

验收标准：

- `cargo check` 通过。
- 相关测试可稳定通过。

### T4.5 增加前端测试

任务内容：

- 覆盖 provider 切换。
- 覆盖 Claude capability 降级。
- 覆盖 Claude 消息流。
- 覆盖 Claude 审批与用户输入。

输出物：

- 前端测试补齐。

验收标准：

- `npm run test` 通过。

### T4.6 增加 sidecar 协议测试

任务内容：

- 覆盖初始化。
- 覆盖消息发送。
- 覆盖流式事件。
- 覆盖取消。
- 覆盖错误回传。

输出物：

- sidecar 协议测试。

验收标准：

- sidecar 升级后可及时发现协议回归。

### T4.7 制定人工验证矩阵

任务内容：

- 至少验证以下场景：
  - Codex 本地
  - Claude 本地
  - Codex 远程
  - Claude 远程

每个场景至少验证：

- 连接 workspace
- 新建线程
- 恢复线程
- 发消息
- 流式输出
- 停止运行
- 审批确认
- 用户输入回传

输出物：

- 人工验证清单。

验收标准：

- 四类场景均完成验收记录。

### T4.8 确认打包与依赖策略

任务内容：

- 确认 sidecar 如何随应用一起分发。
- 确认生产包是否需要内置 Node 运行时或做单独构建产物。

输出物：

- Claude sidecar 分发方案。

验收标准：

- 不是只有开发环境能跑，安装包环境也可运行。

### T4.9 增加实验开关

任务内容：

- 把 Claude 支持挂在实验功能开关下。
- 默认不影响现有用户。

输出物：

- Claude 实验开关。

验收标准：

- 未开启开关时，现有 Codex 用户体验不变。

## 9. 建议开发顺序

建议先按以下顺序推进：

1. `T0.3` 到 `T0.6`
2. `T1.1` 到 `T1.6`
3. `T2.1` 到 `T2.6`
4. `T2.7` 到 `T2.9`
5. `T3.1` 到 `T3.6`
6. `T4.1` 到 `T4.9`

## 10. 第一批必做任务

如果只做第一批可开工任务，建议优先处理：

- `T0.3` 扩展前端类型模型
- `T0.4` 扩展 Rust 类型模型
- `T0.5` 改造 AppSettings
- `T0.6` 改造 workspace 存储模型
- `T1.1` 引入统一 Provider 抽象
- `T1.2` 包装现有 Codex 实现
- `T1.3` 改造 session key 设计
- `T2.1` 设计 Claude sidecar 协议

## 11. 人工验证命令

建议人工执行以下验证命令：

```bash
npm run typecheck
npm run test
cd src-tauri && cargo check
```

说明：

- 禁止自动触发 CI/CD。
- 构建、测试、发布均采用人工执行。

## 12. 变更说明

- 新增文档：`docs/claude-code-support-task-list.md`
- 文档用途：为 Claude Code 支持方案提供可执行任务清单
- 当前状态：仅整理任务，不含代码改动
