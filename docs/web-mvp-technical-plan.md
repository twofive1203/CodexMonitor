# Web 版本 MVP 技术方案

## 1. 目标

本文定义 CodexMonitor Web 版本的最小可行方案（MVP）。

配套执行清单见 [web-mvp-task-list.md](D:/workspace/aiwork/CodexMonitor/docs/web-mvp-task-list.md)。

目标如下：

- 在现有 Windows 客户端基础上增加一个可监听本地端口的 Web 能力。
- 允许通过 Tailscale 或 FRP 访问该 Web 端口，实现远程使用 CodexMonitor。
- 尽量复用现有前端界面、现有 daemon、现有 shared core，不重做业务逻辑。
- 保持当前桌面端和当前 TCP 远程模式可继续工作，不破坏现有 iOS/TCP 方案。

## 2. 结论

该需求可行，推荐按“现有 daemon 增加 HTTP + WebSocket Web 接入层，前端增加 Web 运行时适配层”的方案实施。

不推荐的做法：

- 不建议直接把当前 Tauri 前端暴露成 Web 页面。
- 不建议让浏览器直接连接当前 raw TCP daemon。
- 不建议首期就追求桌面端 100% 全量能力。

推荐原因：

- 当前项目已经具备远程 backend 基础能力。
- 当前项目已经具备 token 认证、事件推送、工作区会话管理。
- 当前架构已经把核心逻辑放进 shared core，适合继续复用。
- 浏览器天然更适合 HTTP + WebSocket，而不是当前按行 JSON-RPC over TCP。

## 3. 当前基础

当前仓库已经具备以下基础：

- 已有独立 daemon，默认 TCP 监听地址为 `127.0.0.1:4732`。
- daemon 已支持 token 鉴权。
- daemon 已能把 `app-server-event`、`terminal-output`、`terminal-exit` 作为通知流推送给客户端。
- 桌面端已有 remote backend 模式，并已用于 iOS 远程接入。
- daemon 当前实际对 Tailscale 场景会推导为 `0.0.0.0:<port>` 监听。

当前限制也很明确：

- 当前浏览器无法直接连接现有 raw TCP 协议。
- 当前前端大量依赖 `@tauri-apps/*` API，不能直接作为纯 Web 运行。
- 当前 daemon RPC 分发未纳入终端 RPC 路由，Web 版首期不适合把终端作为硬性 MVP 范围。

## 4. MVP 范围

### 4.1 首期必须支持

- 登录与鉴权。
- 工作区列表与切换。
- 线程列表、恢复线程、创建线程。
- 发送消息、Steer、Interrupt。
- 实时接收 `app-server-event`。
- 文件树列表与文件只读查看。
- Git 状态、Diff、Log、Commit Diff 查看。
- Review 触发与结果查看。
- 基础设置读取与必要的模型列表读取。

### 4.2 首期明确不做

- 浏览器内完整终端。
- Dictation。
- 系统托盘。
- 原生菜单快捷键。
- 原生窗口控制。
- 本地文件选择器原生体验。
- 自动更新能力。
- Explorer/Finder 打开、Reveal in Dir、Open App Icon 这类强依赖桌面环境的能力。
- 桌面端 100% 全量功能对齐。

### 4.3 二期建议补充

- 浏览器终端。
- 浏览器内附件上传优化。
- 更完整的 Git 写操作。
- 多会话并发控制。
- HTTPS 与公网暴露强化方案。

## 5. 关键设计决策

### 5.1 复用现有 daemon，不新建第二套业务后端

推荐把 Web 接入能力加到 `codex_monitor_daemon`，而不是再新建一个独立业务服务。

原因：

- daemon 已是远程执行入口。
- daemon 已复用 shared core。
- daemon 已有认证、事件流、workspace session 生命周期。
- 这样最符合当前项目“shared core 为真源，app 和 daemon 只是适配层”的架构规则。

### 5.2 增加 HTTP + WebSocket 传输层，不替换现有 TCP

推荐保留现有 TCP 传输层，同时新增 Web 传输层。

建议默认端口：

- TCP 远程端口继续使用 `4732`。
- Web 端口新增 `4733`。

原因：

- 不破坏当前 iOS/TCP 远程模式。
- 不破坏当前桌面 remote backend 流程。
- Web 端口更容易被 Tailscale/FRP 单独转发和调试。

### 5.3 前端采用“同一套 React 界面 + 双运行时适配”

推荐保留当前 React 代码为主，新增 Web runtime adapter。

不推荐：

- 单独重写一套 Web UI。
- 在业务组件里到处写 `if (isWeb) ... else ...`。

推荐实现：

- 保持 `src/services/tauri.ts` 对上层 API 形态尽量稳定。
- 在其内部增加 runtime 分发。
- `src/services/events.ts` 增加 WebSocket 事件源实现。
- 对无法 Web 化的能力，通过统一 capability 开关隐藏或禁用。

## 6. 目标架构

```text
Browser
  -> HTTP/HTTPS
  -> WebSocket
Web Server in codex_monitor_daemon
  -> Session Auth
  -> RPC Route
  -> Event Stream Route
  -> Static Assets
Daemon RPC Dispatcher
  -> workspace / codex / git / prompts handlers
Shared Core
  -> workspaces_core / codex_core / git_ui_core / files_core / settings_core
Codex app-server sessions
```

## 7. 后端方案

### 7.1 传输层方案

建议在 daemon 中新增一个基于 `axum` 的 HTTP/WS 服务。

HTTP 路由建议如下：

- `GET /healthz`
- `POST /api/session/login`
- `POST /api/session/logout`
- `GET /api/bootstrap`
- `POST /api/rpc`
- `GET /api/ws/events`
- `GET /`
- `GET /assets/*`

说明：

- `POST /api/rpc` 负责普通请求响应。
- `GET /api/ws/events` 负责推送 `app-server-event`。
- 静态资源建议同源托管，避免首期引入跨域复杂度。

### 7.2 RPC 形态

建议 Web API 继续复用现有 method + params 结构，避免重新定义一套业务契约。

建议请求体：

```json
{
  "method": "list_workspaces",
  "params": {}
}
```

建议响应体：

```json
{
  "result": {}
}
```

错误响应：

```json
{
  "error": {
    "message": "..."
  }
}
```

这样做的好处：

- 可以直接复用现有 daemon dispatcher。
- 可以减少前端 API 适配成本。
- 后续 TCP 和 Web 两套 transport 可以共享同一批 handler。

### 7.3 鉴权方案

首期不建议让浏览器直接在 URL 上带长期 token。

推荐流程：

1. 用户首次访问 Web 页面。
2. 页面展示登录页。
3. 用户输入远程 token。
4. `POST /api/session/login` 校验 token。
5. 后端签发短期 session cookie。
6. 后续 `POST /api/rpc` 和 `GET /api/ws/events` 全部走 cookie 会话。

建议：

- Session cookie 使用 HttpOnly。
- 设置合理过期时间，例如 12 小时。
- 对写操作请求增加 CSRF header 校验。
- 仅允许同源访问，不开放 `*` CORS。

### 7.4 监听地址策略

建议提供两个运行模式：

- 本机模式：默认监听 `127.0.0.1:<web-port>`。
- 远程模式：显式启用后监听 `0.0.0.0:<web-port>`。

建议在设置页提供开关：

- `启用 Web 访问`
- `Web 监听地址`
- `Web 端口`
- `复制本机访问地址`
- `复制 Tailscale 地址`

### 7.5 与现有 daemon 的关系

建议对 `codex_monitor_daemon` 新增启动参数：

```text
--web-listen <addr>
--web-static-dir <path>   # 开发模式可选
```

建议行为：

- 不传 `--web-listen` 时，Web 服务默认关闭。
- TCP 远程能力保持不变。
- Tauri 桌面端负责启动、停止、探测 daemon + Web listener 状态。

### 7.6 代码落点建议

建议新增以下模块：

- `src-tauri/src/bin/codex_monitor_daemon/http.rs`
- `src-tauri/src/bin/codex_monitor_daemon/http/auth.rs`
- `src-tauri/src/bin/codex_monitor_daemon/http/routes.rs`
- `src-tauri/src/bin/codex_monitor_daemon/http/ws.rs`

建议修改以下模块：

- `src-tauri/src/bin/codex_monitor_daemon.rs`
- `src-tauri/src/bin/codex_monitor_daemon/rpc.rs`
- `src-tauri/src/bin/codex_monitor_daemon/rpc/dispatcher.rs`
- `src-tauri/src/tailscale/*`
- `src-tauri/src/settings/mod.rs`
- `src-tauri/src/types.rs`

## 8. 前端方案

### 8.1 运行时抽象

建议新增统一 runtime 层，而不是把 Web 逻辑塞进各业务组件。

建议新增：

- `src/services/runtime/client.ts`
- `src/services/runtime/tauriClient.ts`
- `src/services/runtime/webClient.ts`
- `src/services/runtime/events.ts`
- `src/services/runtime/capabilities.ts`

建议保留：

- `src/services/tauri.ts`
- `src/services/events.ts`

做法：

- 对外导出 API 尽量不改。
- 内部根据当前 runtime 选择 Tauri 或 Web 实现。

### 8.2 Web 前端适配原则

必须适配：

- `list_workspaces`
- `list_threads`
- `resume_thread`
- `start_thread`
- `send_user_message`
- `turn_steer`
- `turn_interrupt`
- `thread_live_subscribe`
- `thread_live_unsubscribe`
- `list_workspace_files`
- `read_workspace_file`
- `get_git_status`
- `get_git_diffs`
- `get_git_log`
- `get_git_commit_diff`
- `start_review`
- `model_list`

首期隐藏或禁用：

- 托盘相关入口。
- 窗口拖拽与窗口状态控制。
- 系统更新入口。
- Dictation。
- Reveal in Dir / Open App / 原生上下文菜单。

### 8.3 Web 登录与初始化

建议增加一个非常轻量的 Web 登录壳层。

页面流程：

1. 打开 `/`。
2. 若无会话，显示 token 登录页。
3. 登录成功后调用 `/api/bootstrap`。
4. 获取基础配置、能力开关、工作区列表。
5. 进入现有主界面。

### 8.4 首期 UI 处理原则

建议优先复用当前 UI，不做大改版。

Web 首期只处理三类差异：

- 能工作：保持原状。
- 能替代：改为浏览器通用行为。
- 不能工作：直接隐藏。

例如：

- `openUrl` 可改为浏览器 `window.open`。
- `@tauri-apps/plugin-opener` 相关入口可在 Web 中隐藏。
- `WindowCaptionControls` 在 Web 中直接不渲染。

## 9. 终端策略

首期建议把终端从 MVP 中移出，作为 M1.5。

原因：

- 当前 daemon transport 已能转发 `terminal-output` 和 `terminal-exit`，但 daemon RPC 分发未纳入 `terminal_open`、`terminal_write`、`terminal_resize`、`terminal_close` 的完整 Web 路由。
- 浏览器终端要额外处理会话复用、断线重连、输入回显、窗口大小同步。
- 这部分会明显拉长首期交付时间。

M1.5 方案建议：

- 新增 `GET /api/ws/terminal`
- 浏览器侧继续复用 `xterm`
- 终端输入输出全部走 WS 多路复用

如果产品上必须“可远程编码且带终端”，建议把 M1.5 与 MVP 合并评估，整体工期按更高档位计算。

## 10. 配置与设置改动

建议在应用设置中新增以下字段：

- `webAccessEnabled`
- `webAccessListenAddr`
- `webAccessPort`
- `webAccessPublicBaseUrl`（可选，首期可不落盘）

兼容策略：

- 继续复用 `remoteBackendToken` 作为 Web 登录的基础 token。
- 不新增第二套 token，避免用户配置复杂化。

迁移策略：

- 无迁移，直接替换。

## 11. Tailscale 与 FRP 接入策略

### 11.1 Tailscale

推荐作为首选方案。

原因：

- 接入简单。
- 安全面更清晰。
- 已有项目内 Tailscale helper 基础。
- 用户只需通过 Tailscale 设备名或 Tailscale IP 加端口访问服务。

建议交付内容：

- 在设置页显示推荐 Web 地址。
- 例如：`http://<device>.tailnet.ts.net:4733`

### 11.2 FRP

建议作为可选方案，不作为默认推荐路径。

原因：

- FRP 更适合公网穿透，但暴露面更大。
- 若直接公网暴露，必须补 HTTPS、会话安全、限流和失败告警。

建议最低要求：

- FRP 侧开启 HTTPS。
- Web 侧保留 token 登录与 session。
- 不允许关闭鉴权。

## 12. 实施阶段

### P0：后端骨架

目标：

- daemon 可选启动 Web listener。
- 有 `healthz`、登录、登出、bootstrap。
- 有静态资源服务能力。

预计工期：

- 2 到 3 天

### P1：前端运行时抽象

目标：

- 现有前端能在 Tauri 和 Web 双 runtime 下运行。
- 工作区、线程、消息发送、事件订阅跑通。

预计工期：

- 3 到 5 天

### P2：MVP 业务能力

目标：

- 文件树、文件查看、Git 状态与 Diff 跑通。
- Review 跑通。
- Unsupported 能力正确隐藏。

预计工期：

- 3 到 5 天

### P3：联调与发布

目标：

- 本机浏览器验证通过。
- Tailscale 远程验证通过。
- 可选 FRP 验证通过。

预计工期：

- 2 到 3 天

### M1.5：浏览器终端

目标：

- 浏览器终端可打开、输入、重连、关闭。

预计工期：

- 4 到 6 天

## 13. 验收标准

满足以下条件即可视为 MVP 可用：

- 用户能在浏览器访问 Web 地址。
- 用户能通过 token 登录。
- 用户能看到工作区和线程列表。
- 用户能恢复线程并发送消息。
- 用户能实时看到回复流和状态更新。
- 用户能查看文件树和文件内容。
- 用户能查看 Git 状态、Diff、Log。
- 用户能通过 Tailscale 从另一台设备访问成功。

## 14. 验证方案

代码级验证：

- `npm run typecheck`
- `npm run test`
- `cd src-tauri && cargo check`

手工验证：

1. 本机访问 `http://127.0.0.1:<web-port>`。
2. 本机登录并完成一次线程发送。
3. 远端设备通过 Tailscale 访问 `http://<tailscale-host>:<web-port>`。
4. 查看线程恢复、消息流、文件树、Git Diff。
5. 断网或关闭 daemon，验证前端断线提示与恢复逻辑。

## 15. 风险与对策

风险一：前端 Tauri 耦合点较多。

对策：

- 统一收口到 runtime adapter。
- 不在业务组件里分散写运行时判断。

风险二：公网暴露的安全风险。

对策：

- 首选 Tailscale。
- FRP 只作为可选方案。
- 保持 token 登录、session cookie、CSRF 校验。

风险三：终端能力拖慢首期交付。

对策：

- 终端从 MVP 拆出，进入 M1.5。

风险四：现有 daemon 与 Web listener 生命周期耦合。

对策：

- 让 Web listener 挂在 daemon 上。
- 桌面端只负责启动、停止和状态探测。

## 16. 推荐实施顺序

建议按以下顺序推进：

1. 先做 daemon Web listener 与登录。
2. 再做前端 runtime adapter。
3. 再打通线程消息主链路。
4. 再补文件树和 Git 只读能力。
5. 最后做设置页、Tailscale 地址展示和联调。

## 17. 最终建议

最终建议如下：

- 方案采用“现有 daemon 增加 Web transport”的路线。
- 首期按“不含终端的 Web MVP”实施。
- 首选 Tailscale，FRP 作为补充能力。
- 端口建议与现有 TCP 远程端口分离，避免破坏既有客户端。

如果后续验证用户确实强依赖浏览器终端，再进入 M1.5。

## 18. 调研记录

日期：2026-03-19

Context7 记录：

- 话题：Tauri 2 localhost plugin、external URL、security headers
- Library ID：`/tauri-apps/tauri-docs`
- tokens：3000

- 话题：Axum 0.8 本地 HTTP 与 WebSocket 服务模式
- Library ID：`/tokio-rs/axum/axum_v0_8_4`
- tokens：3000

Exa 记录：

- 话题：Tailscale 设备互连与端口访问
- 日期：2026-03-19
- 来源：`https://tailscale.com/docs/how-to/connect-to-devices`

- 话题：FRP 暴露本地 HTTP 服务
- 日期：2026-03-19
- 来源：`https://gofrp.org/en/docs/examples/https2http/`
- 来源：`https://github.com/fatedier/frp`

## 19. 参考

- Tauri localhost plugin：<https://v2.tauri.app/plugin/localhost>
- Tauri 安全配置：<https://v2.tauri.app/security>
- Axum：<https://github.com/tokio-rs/axum>
- Tailscale Connect to devices：<https://tailscale.com/docs/how-to/connect-to-devices>
- FRP：<https://gofrp.org/en/docs/>
