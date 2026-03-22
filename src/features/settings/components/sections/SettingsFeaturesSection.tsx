import type { CodexFeature } from "@/types";
import {
  SettingsSection,
  SettingsSubsection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import type { SettingsFeaturesSectionProps } from "@settings/hooks/useSettingsFeaturesSection";
import { fileManagerName, openInFileManagerLabel } from "@utils/platformPaths";

const FEATURE_DESCRIPTION_FALLBACKS: Record<string, string> = {
  undo: "每轮创建一个幽灵提交。",
  shell_tool: "启用默认 Shell 工具。",
  unified_exec: "使用基于 PTY 的统一 exec 工具。",
  shell_snapshot: "启用 Shell 快照。",
  js_repl: "启用基于持久 Node 内核的 JavaScript REPL 工具。",
  js_repl_tools_only: "只向模型直接暴露 js_repl 工具。",
  web_search_request: "已弃用。请改用顶层 web_search。",
  web_search_cached: "已弃用。请改用顶层 web_search。",
  search_tool: "已移除的旧搜索开关，仅为兼容保留。",
  runtime_metrics: "通过手动读取器启用运行时指标快照。",
  sqlite: "将 rollout 元数据持久化到本地 SQLite 数据库。",
  memory_tool: "启用启动内存提取和内存整合。",
  child_agents_md: "将额外的 AGENTS.md 指南追加到用户指令中。",
  apply_patch_freeform: "包含自由格式的 apply_patch 工具。",
  use_linux_sandbox_bwrap: "使用基于 bubblewrap 的 Linux 沙箱流程。",
  request_rule: "允许审批请求和 exec 规则建议。",
  experimental_windows_sandbox:
    "已移除的 Windows 沙箱开关，仅为兼容保留。",
  elevated_windows_sandbox:
    "已移除的高权限 Windows 沙箱开关，仅为兼容保留。",
  remote_models: "在 AppReady 前刷新远程模型。",
  powershell_utf8: "在 PowerShell 中强制使用 UTF-8 输出。",
  enable_request_compression:
    "压缩发送到 codex-backend 的流式请求体。",
  apps: "启用 ChatGPT Apps 集成。",
  apps_mcp_gateway: "通过已配置网关转发 Apps MCP 调用。",
  skill_mcp_dependency_install:
    "允许提示并安装缺失的 MCP 依赖。",
  skill_env_var_dependency_prompt:
    "为缺失的技能环境变量依赖提供提示。",
  steer: "在 Codex 支持时启用引导能力。",
  collaboration_modes: "启用协作模式预设。",
  personality: "启用人格风格选择。",
  responses_websockets:
    "默认对 OpenAI 使用 Responses API WebSocket 传输。",
  responses_websockets_v2: "启用 Responses API WebSocket v2 模式。",
};

const FEATURE_LABEL_FALLBACKS: Record<string, string> = {
  undo: "撤销",
  shell_tool: "Shell 工具",
  unified_exec: "统一执行",
  shell_snapshot: "Shell 快照",
  js_repl: "JavaScript REPL",
  js_repl_tools_only: "仅暴露 js_repl 工具",
  web_search_request: "网页搜索请求",
  web_search_cached: "缓存网页搜索",
  search_tool: "搜索工具",
  runtime_metrics: "运行时指标",
  sqlite: "SQLite",
  memory_tool: "内存工具",
  child_agents_md: "子智能体 AGENTS.md",
  apply_patch_freeform: "自由格式 Apply Patch",
  use_linux_sandbox_bwrap: "Linux Bubblewrap 沙箱",
  request_rule: "请求规则",
  experimental_windows_sandbox: "实验性 Windows 沙箱",
  elevated_windows_sandbox: "高权限 Windows 沙箱",
  remote_models: "远程模型",
  powershell_utf8: "PowerShell UTF-8",
  enable_request_compression: "请求压缩",
  apps: "Apps 集成",
  apps_mcp_gateway: "Apps MCP 网关",
  skill_mcp_dependency_install: "技能 MCP 依赖安装",
  skill_env_var_dependency_prompt: "技能环境变量依赖提示",
  steer: "引导",
  collaboration_modes: "协作模式",
  personality: "人格风格",
  responses_websockets: "Responses WebSocket",
  responses_websockets_v2: "Responses WebSocket V2",
};

function formatFeatureLabel(feature: CodexFeature): string {
  const fallbackLabel = FEATURE_LABEL_FALLBACKS[feature.name];
  if (fallbackLabel) {
    return fallbackLabel;
  }
  const displayName = feature.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return feature.name
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function featureSubtitle(feature: CodexFeature): string {
  const fallbackDescription = FEATURE_DESCRIPTION_FALLBACKS[feature.name];
  if (fallbackDescription) {
    return fallbackDescription;
  }
  if (feature.description?.trim()) {
    return feature.description;
  }
  if (feature.announcement?.trim()) {
    return feature.announcement;
  }
  if (feature.stage === "deprecated") {
    return "已弃用功能开关。";
  }
  if (feature.stage === "removed") {
    return "已移除的旧功能开关，仅为兼容保留。";
  }
  return `功能键：features.${feature.name}`;
}

export function SettingsFeaturesSection({
  appSettings,
  hasFeatureWorkspace,
  openConfigError,
  featureError,
  featuresLoading,
  featureUpdatingKey,
  stableFeatures,
  experimentalFeatures,
  hasDynamicFeatureRows,
  onOpenConfig,
  onToggleCodexFeature,
  onUpdateAppSettings,
}: SettingsFeaturesSectionProps) {
  return (
    <SettingsSection
      title="功能"
      subtitle="管理稳定版和实验版 Codex 功能。"
    >
      <SettingsToggleRow
        title="配置文件"
        subtitle={`在 ${fileManagerName()} 中打开 Codex 配置。`}
      >
        <button type="button" className="ghost" onClick={onOpenConfig}>
          {openInFileManagerLabel()}
        </button>
      </SettingsToggleRow>
      {openConfigError && <div className="settings-help">{openConfigError}</div>}
      <SettingsSubsection
        title="稳定功能"
        subtitle="默认启用、可直接用于生产的功能。"
      />
      <SettingsToggleRow
        title="人格风格"
        subtitle={
          <>
            选择 Codex 的沟通风格（会写入 config.toml 顶层的 <code>personality</code>）。
          </>
        }
      >
        <select
          id="features-personality-select"
          className="settings-select"
          value={appSettings.personality}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              personality: event.target.value as (typeof appSettings)["personality"],
            })
          }
          aria-label="人格风格"
        >
          <option value="friendly">友好</option>
          <option value="pragmatic">务实</option>
        </select>
      </SettingsToggleRow>
      <SettingsToggleRow
        title="需要响应时暂停排队消息"
        subtitle="当 Codex 正等待计划确认、计划修改或你的回答时，暂停排队消息。"
      >
        <SettingsToggleSwitch
          pressed={appSettings.pauseQueuedMessagesWhenResponseRequired}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              pauseQueuedMessagesWhenResponseRequired:
                !appSettings.pauseQueuedMessagesWhenResponseRequired,
            })
          }
        />
      </SettingsToggleRow>
      {stableFeatures.map((feature) => (
        <SettingsToggleRow
          key={feature.name}
          title={formatFeatureLabel(feature)}
          subtitle={featureSubtitle(feature)}
        >
          <SettingsToggleSwitch
            pressed={feature.enabled}
            onClick={() => onToggleCodexFeature(feature)}
            disabled={featureUpdatingKey === feature.name}
          />
        </SettingsToggleRow>
      ))}
      {hasFeatureWorkspace &&
        !featuresLoading &&
        !featureError &&
        stableFeatures.length === 0 && (
        <div className="settings-help">Codex 没有返回稳定功能开关。</div>
      )}
      <SettingsSubsection
        title="实验性功能"
        subtitle="预览中和开发中的功能。"
      />
      <SettingsToggleRow
        title="Claude Provider"
        subtitle={
          appSettings.experimentalClaudeEnabled
            ? "实验功能已开启，会显示 Claude 设置分区、项目 provider 切换和相关新建入口。"
            : "默认关闭。开启后才会显示 Claude 设置分区、项目 provider 切换和相关新建入口。"
        }
      >
        <SettingsToggleSwitch
          pressed={appSettings.experimentalClaudeEnabled}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              experimentalClaudeEnabled: !appSettings.experimentalClaudeEnabled,
              defaultAgentProvider:
                appSettings.defaultAgentProvider === "claude" &&
                appSettings.experimentalClaudeEnabled
                  ? "codex"
                  : appSettings.defaultAgentProvider,
            })
          }
        />
      </SettingsToggleRow>
      <div className="settings-help">
        当前策略：Claude 继续保持实验态并默认关闭，建议先完成本地与远程人工验收，再面向稳定环境开启。
      </div>
      {experimentalFeatures.map((feature) => (
        <SettingsToggleRow
          key={feature.name}
          title={formatFeatureLabel(feature)}
          subtitle={featureSubtitle(feature)}
        >
          <SettingsToggleSwitch
            pressed={feature.enabled}
            onClick={() => onToggleCodexFeature(feature)}
            disabled={featureUpdatingKey === feature.name}
          />
        </SettingsToggleRow>
      ))}
      {hasFeatureWorkspace &&
        !featuresLoading &&
        !featureError &&
        hasDynamicFeatureRows &&
        experimentalFeatures.length === 0 && (
          <div className="settings-help">
            Codex 没有返回预览中或开发中的功能开关。
          </div>
        )}
      {featuresLoading && (
        <div className="settings-help">正在加载 Codex 功能开关...</div>
      )}
      {!hasFeatureWorkspace && !featuresLoading && (
        <div className="settings-help">
          请先连接工作区，再加载 Codex 功能开关。
        </div>
      )}
      {featureError && <div className="settings-help">{featureError}</div>}
    </SettingsSection>
  );
}
