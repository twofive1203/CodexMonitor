# 关闭调试日志配置

## Goal

降低 WebView2 内存压力排查成本，新增应用设置来关闭调试日志采集；默认关闭调试日志功能，避免调试面板在正常使用中长期保留日志 payload。

## What I already know

* 用户反馈 WebView2 内存仍然很大，怀疑调试日志导致，希望先关闭调试日志功能。
* 当前设置模型只有 `toggleDebugPanelShortcut`，没有发现控制调试日志采集的配置。
* `src/features/debug/hooks/useDebugLog.ts` 会维护 `debugEntries`，最多保留 200 条，并对 payload 做摘要截断。
* 当前逻辑在调试面板未打开时会丢弃普通日志，但错误/警告日志仍会被收集并触发调试入口显示。
* 这不一定是 4GB 内存的唯一原因，但新增关闭开关是低风险排查和默认省内存策略。

## Requirements

* 新增应用设置字段控制调试日志采集，字段默认值为关闭。
* 设置关闭时，不采集任何调试日志，不保留 `debugEntries`，不因调试告警显示调试按钮。
* 设置关闭时，菜单或快捷键尝试打开调试面板应保持无效或立即关闭，避免误以为日志仍启用。
* 设置打开后，保留现有调试面板行为：普通日志仅在面板打开时收集，警告/错误日志可触发提醒。
* 在设置界面提供一个开关，用户可手动启用调试日志用于排障。
* 前后端 AppSettings 类型、默认值、序列化字段保持一致。

## Acceptance Criteria

* [ ] 空设置反序列化时调试日志配置默认为 false。
* [ ] 前端默认设置中调试日志配置默认为 false。
* [ ] 关闭调试日志后调用 `addDebugEntry` 不会新增条目，也不会设置告警状态。
* [ ] 关闭调试日志后已有条目会被清空，调试面板关闭。
* [ ] 设置界面可以打开或关闭调试日志配置。
* [ ] `npm run typecheck` 通过。
* [ ] 相关前端单元测试通过。

## Definition of Done

* 测试按改动范围补充或更新。
* 类型检查通过。
* 无迁移，直接替换；旧设置缺字段时使用默认 false。
* 不修改 CI/CD 配置，不自动触发 CI/CD 流程。

## Technical Approach

* 在 Rust `AppSettings` 中新增 `debugLogEnabled` 布尔字段，serde 默认 false。
* 在 TypeScript `AppSettings` 和 `useAppSettings` 默认/归一化中新增同名字段。
* 将 `useDebugLog` 改为接收 `enabled` 参数，关闭时清空状态并直接忽略所有新增日志。
* `useAppBootstrap` 使用 `appSettings.debugLogEnabled` 传入调试日志 hook，并让液态玻璃调试回调受该开关自然约束。
* 在显示/外观设置分区添加“调试日志”开关，说明该功能用于排障且可能增加内存占用。

## Decision (ADR-lite)

**Context**: 当前调试日志没有全局开关，且告警日志即使面板关闭仍会被保留。用户需要快速排查内存占用。

**Decision**: 新增持久化设置 `debugLogEnabled`，默认关闭；只有用户主动开启时才采集调试日志。

**Consequences**: 默认状态下调试面板不会自动积累排障信息；需要排查问题时用户先手动开启。换来更低的常驻内存风险和更明确的调试意图。

## Out of Scope

* 不在本任务中定位 WebView2 4GB 内存的完整根因。
* 不改动普通 `console.warn` 浏览器控制台输出策略。
* 不引入日志落盘或日志级别系统。

## Technical Notes

* 关键文件：`src/features/debug/hooks/useDebugLog.ts`、`src/features/app/bootstrap/useAppBootstrap.ts`、`src/types.ts`、`src/features/settings/hooks/useAppSettings.ts`、`src-tauri/src/types.rs`。
* 设置界面现有显示类开关集中在 `src/features/settings/components/sections/SettingsDisplaySection.tsx`。
* Spec context: `.trellis/spec/frontend/index.md`。
