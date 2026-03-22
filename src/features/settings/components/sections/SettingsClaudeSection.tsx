import { useEffect, useState } from "react";
import type { AppSettings } from "@/types";
import type { ClaudeSdkSource, ClaudeSdkStatus } from "@/types";
import { useProviderCapabilities } from "@/features/providers/hooks/useProviderCapabilities";
import {
  SettingsSection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import type { SettingsClaudeSectionProps } from "@settings/hooks/useSettingsClaudeSection";
import {
  getClaudeSdkStatus,
  installClaudeSdk,
  removeClaudeSdk,
} from "@services/tauri";
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

/**
 * 生成 Claude SDK 来源文案。
 *
 * `source`：SDK 当前来源。
 */
function buildClaudeSdkSourceLabel(source: ClaudeSdkSource | null | undefined): string {
  switch (source) {
    case "app_data":
      return "应用数据目录";
    case "project_node_modules":
      return "项目 node_modules";
    case "bundle":
      return "旧安装包资源";
    default:
      return "未知来源";
  }
}

/**
 * 生成 Claude SDK 状态说明。
 *
 * `status`：SDK 状态快照。
 */
function buildClaudeSdkStatusLabel(status: ClaudeSdkStatus | null): string {
  if (!status) {
    return "正在检测 Claude SDK...";
  }
  if (status.state === "ready") {
    const sourceLabel = buildClaudeSdkSourceLabel(status.source);
    const versionLabel = status.version ? `，版本 ${status.version}` : "";
    return `Claude SDK 已就绪，来源：${sourceLabel}${versionLabel}。`;
  }
  if (status.state === "error") {
    return status.error ?? "Claude SDK 状态异常。";
  }
  return status.error ?? "未检测到 Claude SDK。";
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
  const [sdkStatus, setSdkStatus] = useState<ClaudeSdkStatus | null>(null);
  const [sdkAction, setSdkAction] = useState<"loading" | "installing" | "removing" | null>(
    "loading",
  );
  const [sdkActionError, setSdkActionError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setSdkAction("loading");
    setSdkActionError(null);
    void getClaudeSdkStatus()
      .then((status) => {
        if (canceled) {
          return;
        }
        setSdkStatus(status);
        setSdkAction(null);
      })
      .catch((loadError) => {
        if (canceled) {
          return;
        }
        setSdkStatus(null);
        setSdkAction(null);
        setSdkActionError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      });
    return () => {
      canceled = true;
    };
  }, []);

  const handleInstallClaudeSdk = async () => {
    setSdkAction("installing");
    setSdkActionError(null);
    try {
      const status = await installClaudeSdk();
      setSdkStatus(status);
    } catch (installError) {
      setSdkActionError(
        installError instanceof Error ? installError.message : String(installError),
      );
    } finally {
      setSdkAction(null);
    }
  };

  const handleRemoveClaudeSdk = async () => {
    setSdkAction("removing");
    setSdkActionError(null);
    try {
      const status = await removeClaudeSdk();
      setSdkStatus(status);
    } catch (removeError) {
      setSdkActionError(
        removeError instanceof Error ? removeError.message : String(removeError),
      );
    } finally {
      setSdkAction(null);
    }
  };

  const handleRefreshClaudeSdk = async () => {
    setSdkAction("loading");
    setSdkActionError(null);
    try {
      const status = await getClaudeSdkStatus();
      setSdkStatus(status);
    } catch (refreshError) {
      setSdkActionError(
        refreshError instanceof Error ? refreshError.message : String(refreshError),
      );
    } finally {
      setSdkAction(null);
    }
  };

  return (
    <SettingsSection
      title="Claude"
      subtitle="配置 Claude CLI、SDK sidecar 与一期降级能力。"
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
        <div className="settings-help">
          开发态需要先执行 npm install；安装包请在设置页按需下载 Claude SDK 到本地应用数据目录。
        </div>
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
        subtitle="建议保持开启，用统一事件模型适配 Claude；安装包默认不再内置 SDK。"
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
      <div className="settings-field">
        <div className="settings-field-label">Claude SDK</div>
        <div className="settings-help">
          打包版默认不内置 Claude SDK。首次使用 Claude 前，请先检测并按需下载到本地应用数据目录。
        </div>
        <div className="settings-help">{buildClaudeSdkStatusLabel(sdkStatus)}</div>
        {sdkStatus?.path && (
          <div className="settings-help">
            当前路径：<code>{sdkStatus.path}</code>
          </div>
        )}
        {sdkActionError && <div className="settings-help">{sdkActionError}</div>}
        <div className="settings-field-actions">
          {(sdkStatus?.state !== "ready" || sdkStatus?.source !== "app_data") && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                void handleInstallClaudeSdk();
              }}
              disabled={sdkAction !== null}
            >
              {sdkAction === "installing" ? "下载中..." : "下载 SDK"}
            </button>
          )}
          {sdkStatus?.state === "ready" && sdkStatus?.source === "app_data" && (
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={() => {
                void handleRemoveClaudeSdk();
              }}
              disabled={sdkAction !== null}
            >
              {sdkAction === "removing" ? "移除中..." : "移除 SDK"}
            </button>
          )}
          <button
            type="button"
            className="ghost settings-button-compact"
            onClick={() => {
              void handleRefreshClaudeSdk();
            }}
            disabled={sdkAction !== null}
          >
            {sdkAction === "loading" ? "检测中..." : "刷新状态"}
          </button>
        </div>
      </div>

      <div className="settings-help">
        {buildClaudeHint(appSettings, resolvedCapabilities.supportsReview)}
      </div>
      <div className="settings-help">
        当前策略：Claude 仍保持实验态并默认关闭，建议先按人工验收矩阵完成本地与远程验证。
      </div>
      <div className="settings-help">
        一期降级项：登录、额度、skills、apps、steer、协作模式、review、自动更新。
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
