# Web 版本 MVP 开发任务清单

## 1. 说明

本文基于 [web-mvp-technical-plan.md](D:/workspace/aiwork/CodexMonitor/docs/web-mvp-technical-plan.md) 拆分开发任务。

适用目标：

- 把 Web 版本 MVP 从方案拆成可排期、可分工、可验收的任务清单。
- 支持按多个迭代推进。
- 默认以“现有 daemon 增加 Web transport，现有前端增加 Web runtime 适配”为实施路线。

实施原则：

- 先打通主链路，再补外围能力。
- 先保证复用 shared core，再补 UI 体验。
- 先做 Tailscale 可用，再考虑 FRP 公网增强。
- 首期不把浏览器终端纳入硬性 MVP。

迁移策略：

- 无迁移，直接替换。

## 2. 迭代总览

### I0：设计冻结与基础准备

目标：

- 冻结 Web MVP 范围、默认端口、关键配置。
- 为后续开发准备好设置模型、状态模型、能力开关。

建议周期：

- 0.5 到 1 天

### I1：daemon Web 服务骨架

目标：

- daemon 能启动 Web listener。
- 提供登录、健康检查、基础 bootstrap、静态资源服务。

建议周期：

- 2 到 3 天

### I2：前端 Web runtime 基础

目标：

- 现有前端可在 Web runtime 下启动。
- 能完成登录、初始化、事件订阅。

建议周期：

- 2 到 4 天

### I3：线程消息主链路

目标：

- Web 端能工作区切换、线程列表、恢复线程、发消息、收消息。

建议周期：

- 2 到 4 天

### I4：文件与 Git 只读能力

目标：

- Web 端具备文件树、文件查看、Git 状态和 Diff 查看能力。

建议周期：

- 2 到 4 天

### I5：设置、Tailscale 接入与联调

目标：

- 桌面端可管理 Web listener。
- Web 地址可被 Tailscale 远程访问。
- 完成端到端联调。

建议周期：

- 2 到 3 天

### I6：浏览器终端（M1.5）

目标：

- 在 Web 中补齐终端能力。

建议周期：

- 4 到 6 天

## 3. I0 任务清单

### T0.1 冻结 Web MVP 范围

任务内容：

- 确认首期保留的能力。
- 确认首期隐藏的能力。
- 确认终端从 MVP 拆到 I6。

输出物：

- 当前技术方案作为范围真源。
- 当前任务清单作为执行真源。

验收标准：

- 团队对“首期不含浏览器终端”达成一致。
- 团队对“首期只做 Web 可用，不追求桌面 100% 对齐”达成一致。

### T0.2 冻结默认端口与监听策略

任务内容：

- 确认 TCP 端口继续为 `4732`。
- 确认 Web 默认端口为 `4733`。
- 确认默认 Web 监听地址为 `127.0.0.1:4733`。
- 确认显式开启远程时支持 `0.0.0.0:4733`。

建议涉及文件：

- `src-tauri/src/types.rs`
- `src-tauri/src/settings/mod.rs`
- `src-tauri/src/tailscale/*`

验收标准：

- 默认值有统一常量定义。
- 后续 I1/I5 不再反复改端口语义。

### T0.3 冻结 Web 设置字段

任务内容：

- 确认新增字段：
  - `webAccessEnabled`
  - `webAccessListenAddr`
  - `webAccessPort`
  - `webAccessPublicBaseUrl`
- 确认继续复用 `remoteBackendToken`。

建议涉及文件：

- `src-tauri/src/types.rs`
- `src/types.ts`

验收标准：

- Rust 与 TypeScript 类型定义一致。

## 4. I1 任务清单

### T1.1 引入 Web 服务依赖

任务内容：

- 在 Rust 后端引入 `axum` 及所需依赖。
- 引入静态资源和 WebSocket 所需依赖。

建议涉及文件：

- `src-tauri/Cargo.toml`

验收标准：

- `cargo check` 可通过。
- 新依赖不影响现有 Tauri app 与 daemon 编译。

### T1.2 新增 daemon Web 模块骨架

任务内容：

- 新增 Web server 模块。
- 新增认证子模块。
- 新增路由子模块。
- 新增事件 WS 子模块。

建议新增文件：

- `src-tauri/src/bin/codex_monitor_daemon/http.rs`
- `src-tauri/src/bin/codex_monitor_daemon/http/auth.rs`
- `src-tauri/src/bin/codex_monitor_daemon/http/routes.rs`
- `src-tauri/src/bin/codex_monitor_daemon/http/ws.rs`

验收标准：

- daemon 可在不启用 Web 的情况下保持原行为。
- Web 模块可以独立初始化。

### T1.3 扩展 daemon 启动参数

任务内容：

- 新增 `--web-listen <addr>`。
- 新增 `--web-static-dir <path>`。
- 修改 usage 帮助文案。
- 为 daemon config 增加 Web 配置字段。

建议涉及文件：

- `src-tauri/src/bin/codex_monitor_daemon.rs`

验收标准：

- 不传 `--web-listen` 时 Web 服务不启动。
- 传入 `--web-listen` 时 Web 服务正常启动。

### T1.4 增加 `GET /healthz`

任务内容：

- 提供最小健康检查接口。
- 返回 daemon 基础状态、版本、Web 服务状态。

验收标准：

- 本机访问 `/healthz` 能返回 200。
- 返回体可用于桌面端探测和运维探测。

### T1.5 增加登录与会话管理

任务内容：

- 实现 `POST /api/session/login`。
- 使用 `remoteBackendToken` 校验登录。
- 创建 HttpOnly session cookie。
- 实现 `POST /api/session/logout`。

建议涉及文件：

- `src-tauri/src/bin/codex_monitor_daemon/http/auth.rs`
- `src-tauri/src/bin/codex_monitor_daemon/http/routes.rs`

验收标准：

- 正确 token 可登录。
- 错误 token 被拒绝。
- 退出登录后会话失效。

### T1.6 增加 `GET /api/bootstrap`

任务内容：

- 返回基础初始化信息：
  - app 信息
  - Web 能力开关
  - 当前设置摘要
  - 工作区列表

验收标准：

- Web 前端无需多次首屏 RPC 即可完成初始化。

### T1.7 增加 `POST /api/rpc`

任务内容：

- 设计统一 RPC 包装结构。
- 将 HTTP RPC 转发到现有 daemon dispatcher。
- 返回统一 result/error 响应。

建议涉及文件：

- `src-tauri/src/bin/codex_monitor_daemon/http/routes.rs`
- `src-tauri/src/bin/codex_monitor_daemon/rpc/dispatcher.rs`

验收标准：

- `list_workspaces`
- `get_app_settings`
- `model_list`

以上 RPC 可通过 HTTP 正常调用。

### T1.8 增加 `GET /api/ws/events`

任务内容：

- WebSocket 接入 daemon 现有事件广播。
- 至少转发：
  - `app-server-event`
  - 预留 `terminal-output`
  - 预留 `terminal-exit`

验收标准：

- 前端订阅后能收到线程事件。
- 断开连接后服务端资源可正常释放。

### T1.9 增加静态资源服务

任务内容：

- 提供 `/` 与 `/assets/*`。
- 开发模式支持从独立目录读取静态资源。
- 生产模式支持从内置资源或固定输出目录读取。

验收标准：

- 浏览器访问 `/` 可返回前端页面。

## 5. I2 任务清单

### T2.1 新增 runtime 抽象层

任务内容：

- 增加统一 runtime client 抽象。
- 将 Tauri 与 Web transport 适配统一接口。

建议新增文件：

- `src/services/runtime/client.ts`
- `src/services/runtime/tauriClient.ts`
- `src/services/runtime/webClient.ts`
- `src/services/runtime/events.ts`
- `src/services/runtime/capabilities.ts`

验收标准：

- 业务层不直接感知 transport 差异。

### T2.2 改造 `src/services/tauri.ts`

任务内容：

- 保留现有导出 API。
- 内部改为按 runtime 选择实现。
- 首先打通以下 API：
  - `getAppSettings`
  - `listWorkspaces`
  - `listThreads`
  - `resumeThread`
  - `startThread`
  - `sendUserMessage`

建议涉及文件：

- `src/services/tauri.ts`

验收标准：

- 现有调用方不需要大规模改造。

### T2.3 改造 `src/services/events.ts`

任务内容：

- 在 Web runtime 下改用 WebSocket 作为事件源。
- 保持现有订阅函数签名不变。

建议涉及文件：

- `src/services/events.ts`

验收标准：

- `subscribeAppServerEvents` 在 Web 下可工作。
- Tauri 下现有行为不受影响。

### T2.4 新增 Web 登录页与初始化壳层

任务内容：

- 无 session 时显示登录页。
- 登录成功后请求 `/api/bootstrap`。
- 初始化能力开关与工作区列表。

建议涉及文件：

- `src/App.tsx`
- `src/features/app/bootstrap/*`
- `src/features/app/hooks/*`

验收标准：

- 浏览器首次访问可完成登录。
- 刷新页面时可基于 session 自动恢复。

### T2.5 增加 Web capability 控制

任务内容：

- 对 Web 不支持能力做统一隐藏。
- 避免在组件里散落过多运行时判断。

首批控制项：

- 托盘
- 原生窗口控制
- 自动更新
- Dictation
- Reveal in Dir
- Open App Icon

验收标准：

- Web 页面不会渲染无效入口。

## 6. I3 任务清单

### T3.1 打通工作区与线程列表

任务内容：

- Web 下打通：
  - `list_workspaces`
  - `connect_workspace`
  - `list_threads`
  - `resume_thread`

建议涉及文件：

- `src/features/workspaces/hooks/*`
- `src/features/threads/hooks/*`
- `src/services/tauri.ts`

验收标准：

- 用户可进入任一工作区并看到线程列表。

### T3.2 打通新建线程与恢复线程

任务内容：

- 打通：
  - `start_thread`
  - `resume_thread`
  - `fork_thread`（可选，若工作量可控）

验收标准：

- 用户可以新建线程。
- 用户可以恢复已有线程。

### T3.3 打通消息发送与回复流

任务内容：

- 打通：
  - `send_user_message`
  - `turn_steer`
  - `turn_interrupt`
- 确保 WebSocket 事件能驱动消息流渲染。

验收标准：

- 用户发送消息后能持续看到回复流。
- Interrupt 生效。
- Steer 生效或失败时有清晰提示。

### T3.4 打通远端线程实时订阅

任务内容：

- 在 Web 下打通：
  - `thread_live_subscribe`
  - `thread_live_unsubscribe`
- 保持现有远程线程恢复逻辑。

建议涉及文件：

- `src/features/app/hooks/useRemoteThreadLiveConnection.ts`
- `src/features/app/hooks/useRemoteThreadRefreshOnFocus.ts`

验收标准：

- 当前活跃线程在 Web 下可实时更新。
- 切线程、切窗口、刷新页面不出现明显异常状态。

### T3.5 Web 消息与附件最小兼容

任务内容：

- 先支持纯文本主链路。
- 保留图片附件能力的接口位置。
- 若首期附件处理成本过高，可先限制为 data URL 上传。

验收标准：

- 文本消息主链路稳定可用。

## 7. I4 任务清单

### T4.1 打通文件树列表

任务内容：

- 打通：
  - `list_workspace_files`
  - `read_workspace_file`
- 在 Web 中显示文件树与文件内容。

建议涉及文件：

- `src/features/files/components/FileTreePanel.tsx`
- `src/features/workspaces/hooks/*`
- `src/services/tauri.ts`

验收标准：

- 用户可查看文件树。
- 用户可打开 UTF-8 文本文件。

### T4.2 屏蔽 Web 不支持的文件动作

任务内容：

- 隐藏以下动作：
  - Reveal in Dir
  - 原生菜单
  - 依赖 Tauri `convertFileSrc` 的本地文件路径直出逻辑

验收标准：

- Web 页面不出现点击后必失败的文件操作。

### T4.3 打通 Git 只读能力

任务内容：

- 打通：
  - `get_git_status`
  - `get_git_diffs`
  - `get_git_log`
  - `get_git_commit_diff`

验收标准：

- 用户可查看当前工作区 Git 状态。
- 用户可查看文件 Diff 和提交 Diff。

### T4.4 补齐 Review 主链路

任务内容：

- 打通 `start_review`。
- 保证 Review 结果能在消息流中正常显示。

验收标准：

- 用户可从 Web 端发起 Review。
- Review 结果可被正确渲染。

## 8. I5 任务清单

### T5.1 扩展设置模型与持久化

任务内容：

- Rust 与 TS 同步增加 Web 设置字段。
- 设置读写持久化。

建议涉及文件：

- `src-tauri/src/types.rs`
- `src/types.ts`
- `src-tauri/src/settings/mod.rs`
- `src/features/settings/hooks/useAppSettings.ts`

验收标准：

- Web 设置可保存。
- 应用重启后仍可恢复。

### T5.2 桌面端设置页新增 Web 服务区块

任务内容：

- 在设置页增加：
  - Web 开关
  - 监听地址
  - 端口
  - 当前状态
  - 推荐访问地址

建议涉及文件：

- `src/features/settings/components/SettingsView.tsx`
- `src/features/settings/components/sections/*`
- `src/features/settings/hooks/*`

验收标准：

- 用户可在桌面端管理 Web listener。

### T5.3 桌面端新增 Web listener 状态与控制命令

任务内容：

- 增加启动、停止、状态探测命令。
- 复用现有 daemon 生命周期管理风格。

建议涉及文件：

- `src-tauri/src/lib.rs`
- `src-tauri/src/tailscale/*`
- `src/services/tauri.ts`

验收标准：

- 用户可在 UI 中看到 Web 服务运行状态。

### T5.4 Tailscale 地址生成与展示

任务内容：

- 基于现有 Tailscale helper 补 Web 地址推荐逻辑。
- 优先展示 Tailscale 设备名地址。

验收标准：

- 用户能直接复制 Web 远程访问地址。

### T5.5 本机与远程联调

任务内容：

- 验证本机浏览器访问。
- 验证局域网或 Tailscale 访问。
- 验证断连重连、daemon 重启恢复。

验收标准：

- 在另一台设备上通过 Tailscale 可成功访问 Web 页面并完成一次消息发送。

### T5.6 FRP 可选验证

任务内容：

- 用最小配置验证 FRP 能转发 Web 端口。
- 输出一份简单使用说明。

验收标准：

- FRP 环境下可完成登录与消息主链路。

## 9. I6 任务清单

### T6.1 梳理终端能力缺口

任务内容：

- 明确 daemon 当前终端相关能力缺口。
- 明确浏览器终端需要的新路由与协议。

验收标准：

- 输出终端子方案结论。

### T6.2 新增终端 WebSocket 通道

任务内容：

- 新增 `GET /api/ws/terminal`。
- 支持打开、写入、resize、关闭。

建议涉及文件：

- `src-tauri/src/bin/codex_monitor_daemon/http/ws.rs`
- `src-tauri/src/bin/codex_monitor_daemon/rpc/*`

验收标准：

- 后端可管理浏览器终端会话。

### T6.3 前端接入浏览器终端

任务内容：

- 复用现有 `xterm`。
- 改造 terminal session transport。

建议涉及文件：

- `src/features/terminal/hooks/useTerminalSession.ts`
- `src/services/tauri.ts`
- `src/services/events.ts`

验收标准：

- Web 端可打开终端并收发数据。

## 10. 公共任务

### C1 测试补齐

任务内容：

- 新增 runtime adapter 单测。
- 新增 Web 登录与 bootstrap 测试。
- 新增 Web 事件订阅测试。
- 新增关键 RPC 路由测试。

验收标准：

- 新增模块具备最小回归覆盖。

### C2 文档补齐

任务内容：

- 更新 README。
- 更新设置页说明。
- 补充 Tailscale 与 FRP 使用说明。

建议涉及文件：

- `README.md`
- `docs/web-mvp-technical-plan.md`
- 需要时新增 `docs/web-mvp-usage.md`

验收标准：

- 使用者能按文档完成本机与远程访问。

### C3 验证矩阵执行

任务内容：

- 每个迭代收尾执行：
  - `npm run typecheck`
  - `npm run test`
  - `cd src-tauri && cargo check`

验收标准：

- 迭代合入前完成对应验证。

## 11. 建议分工

如果多人并行，建议如下：

- A 线：daemon Web 服务、认证、设置模型、状态管理。
- B 线：前端 runtime adapter、登录壳层、能力开关。
- C 线：线程消息主链路、文件/Git 只读能力、联调与测试。

并行前提：

- I0 完成。
- I1 的路由与鉴权接口先稳定。

## 12. 优先级建议

最高优先级：

- T1.3
- T1.5
- T1.7
- T1.8
- T2.1
- T2.2
- T2.3
- T3.1
- T3.2
- T3.3

中优先级：

- T3.4
- T4.1
- T4.3
- T4.4
- T5.1
- T5.2
- T5.4

低优先级：

- T5.6
- 全部 I6

## 13. 建议里程碑

### M0：骨架可启动

完成条件：

- Web listener 可启动。
- `/healthz`、登录、bootstrap、RPC、WS 可用。

### M1：主链路可用

完成条件：

- Web 可登录。
- 可查看工作区与线程。
- 可发消息并收到回复流。

### M2：可日常试用

完成条件：

- 文件树和 Git 只读能力可用。
- Tailscale 远程访问通过。

### M3：增强版

完成条件：

- FRP 可选验证通过。
- 浏览器终端进入开发或完成。

## 14. 建议首批执行顺序

建议第一周按下面顺序推进：

1. T0.1
2. T0.2
3. T0.3
4. T1.1
5. T1.2
6. T1.3
7. T1.4
8. T1.5
9. T1.7
10. T1.8
11. T2.1
12. T2.2
13. T2.3
14. T2.4

第一周结束预期：

- 本机可打开 Web 页面。
- 可登录。
- 可完成最小初始化。

## 15. 变更说明

日期：2026-03-20

本次输出内容：

- 将 Web MVP 技术方案拆分为多迭代开发任务清单。
- 为每个迭代补充目标、任务、建议文件落点、验收标准。
- 明确浏览器终端进入 I6，不纳入首期硬性范围。
