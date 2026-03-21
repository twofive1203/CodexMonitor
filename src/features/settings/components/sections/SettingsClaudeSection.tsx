import type { AppSettings } from "@/types";
import { useProviderCapabilities } from "@/features/providers/hooks/useProviderCapabilities";
import {
  SettingsSection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import type { SettingsClaudeSectionProps } from "@settings/hooks/useSettingsClaudeSection";
import { resolveProviderCapabilities } from "@utils/agentProvider";

const CLAUDE_PERMISSION_MODE_OPTIONS = [
  { value: "default", label: "默认" },
  { value: "acceptEdits", label: "接受编辑" },
  { value: "plan", label: "计划模式" },
  { value: "dontAsk", label: "不再询问" },
  { value: "bypassPermissions", label: "跳过权限检查" },
];

/**
 * 生成 Claude capability 摘要文本。
 *
 * `appSettings`：当前应用设置。
 * `supportsReview`：是否支持 review。
 */
function buildClaudeHint(
  appSettings: AppSettings,
  supportsReview: boolean,
): string {
  const sidecarLabel = appSettings.claudeUseSdkSidecar
    ? "当前使用 SDK sidecar"
    : "当前直连 Claude CLI";
  const reviewLabel = supportsReview ? "支持 review" : "一期不支持 review";
  return `${sidecarLabel}，${reviewLabel}。`;
}

export function SettingsClaudeSection({
  appSettings,
  claudePathDraft,
  claudeArgsDraft,
  claudePermissionModeDraft,
  claudeDirty,
  isSavingSettings,
  onUpdateAppSettings,
  onSetClaudePathDraft,
  onSetClaudeArgsDraft,
  onSetClaudePermissionModeDraft,
  onSaveClaudeSettings,
}: SettingsClaudeSectionProps) {
  const { capabilities, error } = useProviderCapabilities("claude");
  const resolvedCapabilities = resolveProviderCapabilities("claude", capabilities);

  return (
    <SettingsSection
      title="Claude"
      subtitle="配置 Claude CLI 与一期降级能力。"
    >
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="claude-path">
          Claude 路径
        </label>
        <div className="settings-field-row">
          <input
            id="claude-path"
            className="settings-input"
            value={claudePathDraft}
            placeholder="claude"
            onChange={(event) => onSetClaudePathDraft(event.target.value)}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => onSetClaudePathDraft("")}
          >
            使用 PATH
          </button>
        </div>
        <div className="settings-help">留空则使用系统 PATH 中的 Claude CLI。</div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="claude-args">
          Claude 参数
        </label>
        <div className="settings-field-row">
          <input
            id="claude-args"
            className="settings-input"
            value={claudeArgsDraft}
            placeholder="--verbose"
            onChange={(event) => onSetClaudeArgsDraft(event.target.value)}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => onSetClaudeArgsDraft("")}
          >
            清空
          </button>
        </div>
        <div className="settings-help">
          这里的参数会传给 Claude 运行时；一期建议只配置稳定参数。
        </div>
      </div>

      <SettingsToggleRow
        title={<label htmlFor="claude-permission-mode">权限模式</label>}
        subtitle="对应 sidecar 的基础权限策略。"
      >
        <select
          id="claude-permission-mode"
          className="settings-select"
          value={claudePermissionModeDraft}
          onChange={(event) => onSetClaudePermissionModeDraft(event.target.value)}
        >
          {CLAUDE_PERMISSION_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingsToggleRow>

      <SettingsToggleRow
        title="使用 SDK sidecar"
        subtitle="建议保持开启，用统一事件模型适配 Claude。"
      >
        <SettingsToggleSwitch
          pressed={appSettings.claudeUseSdkSidecar}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              claudeUseSdkSidecar: !appSettings.claudeUseSdkSidecar,
            })
          }
        />
      </SettingsToggleRow>

      <div className="settings-help">
        {buildClaudeHint(appSettings, resolvedCapabilities.supportsReview)}
      </div>
      <div className="settings-help">
        一期降级项：登录、额度、skills、apps、协作模式、review、自动更新。
      </div>
      {error && <div className="settings-help">能力状态读取失败，当前使用前端兜底值。</div>}

      <div className="settings-field-actions">
        {claudeDirty && (
          <button
            type="button"
            className="primary"
            onClick={() => {
              void onSaveClaudeSettings();
            }}
            disabled={isSavingSettings}
          >
            {isSavingSettings ? "保存中..." : "保存"}
          </button>
        )}
      </div>
    </SettingsSection>
  );
}
