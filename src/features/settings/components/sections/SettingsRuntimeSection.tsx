import type { AppSettings } from "@/types";
import {
  SettingsSection,
  SettingsSubsection,
  SettingsToggleRow,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import { useProviderCapabilities } from "@/features/providers/hooks/useProviderCapabilities";
import {
  getEnabledAgentProviders,
  getAgentProviderLabel,
  isClaudeProviderEnabled,
  resolveAgentProviderForSettings,
  resolveProviderCapabilities,
} from "@utils/agentProvider";

type SettingsRuntimeSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

/**
 * 生成 provider 的能力摘要。
 *
 * `providerLabel`：provider 展示名。
 * `items`：能力文案列表。
 */
function buildCapabilitySummary(providerLabel: string, items: string[]): string {
  return `${providerLabel}：${items.join("、")}`;
}

export function SettingsRuntimeSection({
  appSettings,
  onUpdateAppSettings,
}: SettingsRuntimeSectionProps) {
  const claudeEnabled = isClaudeProviderEnabled(appSettings);
  const enabledProviders = getEnabledAgentProviders(appSettings);
  const { capabilities: codexCapabilities, error: codexError } =
    useProviderCapabilities("codex");
  const { capabilities: claudeCapabilities, error: claudeError } =
    useProviderCapabilities("claude");

  const codexResolvedCapabilities = resolveProviderCapabilities(
    "codex",
    codexCapabilities,
  );
  const claudeResolvedCapabilities = resolveProviderCapabilities(
    "claude",
    claudeCapabilities,
  );

  return (
    <SettingsSection
      title="运行时"
      subtitle="配置默认 provider，以及跨 provider 共享的运行行为。"
    >
      <SettingsToggleRow
        title={<label htmlFor="runtime-default-provider">默认 provider</label>}
        subtitle="新建项目时默认使用的运行时，项目级设置可单独覆盖。"
      >
        <select
          id="runtime-default-provider"
          className="settings-select"
          value={resolveAgentProviderForSettings(
            appSettings.defaultAgentProvider,
            appSettings,
          )}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              defaultAgentProvider:
                event.target.value as AppSettings["defaultAgentProvider"],
            })
          }
        >
          <option value="codex">Codex</option>
          {enabledProviders.includes("claude") && (
            <option value="claude">Claude</option>
          )}
        </select>
      </SettingsToggleRow>

      <SettingsToggleRow
        title={<label htmlFor="runtime-default-access">默认访问模式</label>}
        subtitle="在没有会话级覆盖时使用。"
      >
        <select
          id="runtime-default-access"
          className="settings-select"
          value={appSettings.defaultAccessMode}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              defaultAccessMode:
                event.target.value as AppSettings["defaultAccessMode"],
            })
          }
        >
          <option value="read-only">只读</option>
          <option value="current">按需申请</option>
          <option value="full-access">完全访问</option>
        </select>
      </SettingsToggleRow>

      <SettingsToggleRow
        title={<label htmlFor="runtime-review-delivery">评审模式</label>}
        subtitle="仅在当前 provider 支持 review 时生效。"
      >
        <select
          id="runtime-review-delivery"
          className="settings-select"
          value={appSettings.reviewDeliveryMode}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              reviewDeliveryMode:
                event.target.value as AppSettings["reviewDeliveryMode"],
            })
          }
        >
          <option value="inline">内联（同一会话）</option>
          <option value="detached">独立（新评审会话）</option>
        </select>
      </SettingsToggleRow>

      <div className="settings-help">
        当前默认 provider 为{" "}
        <code>
          {getAgentProviderLabel(
            resolveAgentProviderForSettings(appSettings.defaultAgentProvider, appSettings),
          )}
        </code>
        。{claudeEnabled
          ? "Claude 一期会自动隐藏不支持的登录、额度、skills、apps、steer、协作与 review 入口。"
          : "Claude 当前挂在实验功能开关下，默认不展示。"}
      </div>

      <SettingsSubsection
        title="Provider 能力"
        subtitle="这里展示一期前端用于降级的关键能力。"
      />
      <div className="settings-help">
        {buildCapabilitySummary(getAgentProviderLabel("codex"), [
          codexResolvedCapabilities.supportsLogin ? "支持登录" : "不支持登录",
          codexResolvedCapabilities.supportsRateLimits ? "支持额度" : "不支持额度",
          codexResolvedCapabilities.supportsSkills ? "支持 skills" : "不支持 skills",
          codexResolvedCapabilities.supportsApps ? "支持 apps" : "不支持 apps",
          codexResolvedCapabilities.supportsSteer ? "支持 steer" : "不支持 steer",
          codexResolvedCapabilities.supportsReview ? "支持 review" : "不支持 review",
          codexResolvedCapabilities.supportsCollaborationModes
            ? "支持协作模式"
            : "不支持协作模式",
        ])}
      </div>
      {claudeEnabled ? (
        <div className="settings-help">
          {buildCapabilitySummary(getAgentProviderLabel("claude"), [
            claudeResolvedCapabilities.supportsLogin ? "支持登录" : "不支持登录",
            claudeResolvedCapabilities.supportsRateLimits ? "支持额度" : "不支持额度",
            claudeResolvedCapabilities.supportsSkills ? "支持 skills" : "不支持 skills",
            claudeResolvedCapabilities.supportsApps ? "支持 apps" : "不支持 apps",
            claudeResolvedCapabilities.supportsSteer ? "支持 steer" : "不支持 steer",
            claudeResolvedCapabilities.supportsReview ? "支持 review" : "不支持 review",
            claudeResolvedCapabilities.supportsCollaborationModes
              ? "支持协作模式"
              : "不支持协作模式",
          ])}
        </div>
      ) : (
        <div className="settings-help">
          Claude 能力摘要会在开启实验功能后显示。
        </div>
      )}
      {(codexError || claudeError) && (
        <div className="settings-help">
          能力状态读取失败，当前使用前端兜底值。
        </div>
      )}
    </SettingsSection>
  );
}
