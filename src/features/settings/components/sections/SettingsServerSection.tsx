import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import Copy from "lucide-react/dist/esm/icons/copy";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import X from "lucide-react/dist/esm/icons/x";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  AppSettings,
  TailscaleDaemonCommandPreview,
  TailscaleStatus,
  TcpDaemonStatus,
  WebAccessStatus,
} from "@/types";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";
import {
  SettingsSection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";

type AddRemoteBackendDraft = {
  name: string;
  host: string;
  token: string;
};

type SettingsServerSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  isMobilePlatform: boolean;
  mobileConnectBusy: boolean;
  mobileConnectStatusText: string | null;
  mobileConnectStatusError: boolean;
  remoteBackends: AppSettings["remoteBackends"];
  activeRemoteBackendId: string | null;
  remoteStatusText: string | null;
  remoteStatusError: boolean;
  remoteNameError: string | null;
  remoteHostError: string | null;
  remoteNameDraft: string;
  remoteHostDraft: string;
  remoteTokenDraft: string;
  remoteTokenGenerationBlockedReason: string | null;
  nextRemoteNameSuggestion: string;
  tailscaleStatus: TailscaleStatus | null;
  tailscaleStatusBusy: boolean;
  tailscaleStatusError: string | null;
  tailscaleCommandPreview: TailscaleDaemonCommandPreview | null;
  tailscaleCommandBusy: boolean;
  tailscaleCommandError: string | null;
  tcpDaemonStatus: TcpDaemonStatus | null;
  tcpDaemonBusyAction: "start" | "stop" | "status" | null;
  webAccessStatus: WebAccessStatus | null;
  webAccessBusy: boolean;
  webAccessStatusText: string | null;
  webAccessStatusError: boolean;
  webAccessListenAddrError: string | null;
  webAccessPortError: string | null;
  webAccessPublicBaseUrlError: string | null;
  webAccessListenAddrDraft: string;
  webAccessPortDraft: string;
  webAccessPublicBaseUrlDraft: string;
  webAccessLocalUrl: string | null;
  webAccessRemoteUrl: string | null;
  onSetRemoteNameDraft: Dispatch<SetStateAction<string>>;
  onSetRemoteHostDraft: Dispatch<SetStateAction<string>>;
  onSetRemoteTokenDraft: Dispatch<SetStateAction<string>>;
  onSetWebAccessListenAddrDraft: Dispatch<SetStateAction<string>>;
  onSetWebAccessPortDraft: Dispatch<SetStateAction<string>>;
  onSetWebAccessPublicBaseUrlDraft: Dispatch<SetStateAction<string>>;
  onCommitRemoteName: () => Promise<void>;
  onCommitRemoteHost: () => Promise<void>;
  onCommitRemoteToken: () => Promise<void>;
  onGenerateRemoteToken: () => Promise<void>;
  onToggleWebAccessEnabled: () => Promise<void>;
  onCommitWebAccessListenAddr: () => Promise<void>;
  onCommitWebAccessPort: () => Promise<void>;
  onCommitWebAccessPublicBaseUrl: () => Promise<void>;
  onSelectRemoteBackend: (id: string) => Promise<void>;
  onAddRemoteBackend: (draft: AddRemoteBackendDraft) => Promise<void>;
  onMoveRemoteBackend: (id: string, direction: "up" | "down") => Promise<void>;
  onDeleteRemoteBackend: (id: string) => Promise<void>;
  onRefreshWebAccessStatus: () => void;
  onRefreshTailscaleStatus: () => void;
  onRefreshTailscaleCommandPreview: () => void;
  onUseSuggestedTailscaleHost: () => Promise<void>;
  onTcpDaemonStart: () => Promise<void>;
  onTcpDaemonStop: () => Promise<void>;
  onTcpDaemonStatus: () => Promise<void>;
  onMobileConnectTest: () => void;
};

type RemoteTokenControlProps = {
  token: string;
  disabled: boolean;
  blockedReason: string | null;
  onTokenChange: Dispatch<SetStateAction<string>>;
  onCommitToken: () => Promise<void>;
  onGenerateToken: () => Promise<void>;
};

/**
 * 将指定值写入系统剪贴板。
 * @param value 需要复制的文本；为空时直接忽略。
 */
const copyValueToClipboard = (value: string | null) => {
  if (!value) {
    return;
  }
  const clipboard = typeof navigator === "undefined" ? null : navigator.clipboard;
  if (!clipboard) {
    return;
  }
  void clipboard.writeText(value).catch(() => {
    // Ignore clipboard failures and keep the settings UI responsive.
  });
};

/**
 * 渲染远程令牌输入、复制、显隐和生成控件。
 * @param props 远程令牌草稿、提交回调、生成回调和禁用原因。
 */
function RemoteTokenControl({
  token,
  disabled,
  blockedReason,
  onTokenChange,
  onCommitToken,
  onGenerateToken,
}: RemoteTokenControlProps) {
  const [showRemoteToken, setShowRemoteToken] = useState(false);

  return (
    <>
      <div className="settings-remote-token-group">
        <input
          type={showRemoteToken ? "text" : "password"}
          className="settings-input settings-input--compact settings-remote-token-input"
          value={token}
          placeholder="令牌（必填）"
          onChange={(event) => onTokenChange(event.target.value)}
          onBlur={() => {
            void onCommitToken();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void onCommitToken();
            }
          }}
          aria-label="远程后端令牌"
        />
        <div className="settings-remote-token-actions">
          <button
            type="button"
            className="ghost icon-button settings-remote-token-copy"
            aria-label="复制远程后端令牌"
            title="复制远程后端令牌"
            onClick={() => copyValueToClipboard(token.trim())}
            disabled={!token.trim()}
          >
            <Copy aria-hidden />
          </button>
          <button
            type="button"
            className="ghost icon-button settings-remote-token-visibility"
            aria-label={showRemoteToken ? "隐藏远程后端令牌" : "显示远程后端令牌"}
            title={showRemoteToken ? "隐藏远程后端令牌" : "显示远程后端令牌"}
            onClick={() => setShowRemoteToken((current) => !current)}
          >
            {showRemoteToken ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </button>
        </div>
      </div>
      <button
        type="button"
        className="button settings-button-compact settings-remote-token-generate"
        onClick={() => {
          void onGenerateToken();
        }}
        disabled={disabled || blockedReason !== null}
        title={blockedReason ?? "生成新的随机远程令牌"}
        aria-label="生成随机远程令牌"
      >
        <RefreshCw aria-hidden />
        生成令牌
      </button>
    </>
  );
}

/**
 * 渲染远程服务设置页内的分区标题。
 * @param props 分区标题和说明文案。
 */
function SettingsServerAreaHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="settings-server-area-heading">
      <div className="settings-server-area-title">{title}</div>
      <div className="settings-server-area-description">{description}</div>
    </div>
  );
}

export function SettingsServerSection({
  appSettings,
  onUpdateAppSettings,
  isMobilePlatform,
  mobileConnectBusy,
  mobileConnectStatusText,
  mobileConnectStatusError,
  remoteBackends,
  activeRemoteBackendId,
  remoteStatusText,
  remoteStatusError,
  remoteNameError,
  remoteHostError,
  remoteNameDraft,
  remoteHostDraft,
  remoteTokenDraft,
  remoteTokenGenerationBlockedReason,
  nextRemoteNameSuggestion,
  tailscaleStatus,
  tailscaleStatusBusy,
  tailscaleStatusError,
  tailscaleCommandPreview,
  tailscaleCommandBusy,
  tailscaleCommandError,
  tcpDaemonStatus,
  tcpDaemonBusyAction,
  webAccessStatus,
  webAccessBusy,
  webAccessStatusText,
  webAccessStatusError,
  webAccessListenAddrError,
  webAccessPortError,
  webAccessPublicBaseUrlError,
  webAccessListenAddrDraft,
  webAccessPortDraft,
  webAccessPublicBaseUrlDraft,
  webAccessLocalUrl,
  webAccessRemoteUrl,
  onSetRemoteNameDraft,
  onSetRemoteHostDraft,
  onSetRemoteTokenDraft,
  onSetWebAccessListenAddrDraft,
  onSetWebAccessPortDraft,
  onSetWebAccessPublicBaseUrlDraft,
  onCommitRemoteName,
  onCommitRemoteHost,
  onCommitRemoteToken,
  onGenerateRemoteToken,
  onToggleWebAccessEnabled,
  onCommitWebAccessListenAddr,
  onCommitWebAccessPort,
  onCommitWebAccessPublicBaseUrl,
  onSelectRemoteBackend,
  onAddRemoteBackend,
  onMoveRemoteBackend,
  onDeleteRemoteBackend,
  onRefreshWebAccessStatus,
  onRefreshTailscaleStatus,
  onRefreshTailscaleCommandPreview,
  onUseSuggestedTailscaleHost,
  onTcpDaemonStart,
  onTcpDaemonStop,
  onTcpDaemonStatus,
  onMobileConnectTest,
}: SettingsServerSectionProps) {
  const [pendingDeleteRemoteId, setPendingDeleteRemoteId] = useState<string | null>(
    null,
  );
  const [addRemoteOpen, setAddRemoteOpen] = useState(false);
  const [addRemoteBusy, setAddRemoteBusy] = useState(false);
  const [addRemoteError, setAddRemoteError] = useState<string | null>(null);
  const [addRemoteNameDraft, setAddRemoteNameDraft] = useState("");
  const [addRemoteHostDraft, setAddRemoteHostDraft] = useState("");
  const [addRemoteTokenDraft, setAddRemoteTokenDraft] = useState("");
  const isMobileSimplified = isMobilePlatform;
  const pendingDeleteRemote = useMemo(
    () =>
      pendingDeleteRemoteId == null
        ? null
        : remoteBackends.find((entry) => entry.id === pendingDeleteRemoteId) ?? null,
    [pendingDeleteRemoteId, remoteBackends],
  );
  const tcpRunnerStatusText = (() => {
    if (!tcpDaemonStatus) {
      return null;
    }
    if (tcpDaemonStatus.state === "running") {
      return tcpDaemonStatus.pid
        ? `移动端守护进程正在运行（PID ${tcpDaemonStatus.pid}），监听地址为 ${tcpDaemonStatus.listenAddr ?? "已配置的监听地址"}。`
        : `移动端守护进程正在运行，监听地址为 ${tcpDaemonStatus.listenAddr ?? "已配置的监听地址"}。`;
    }
    if (tcpDaemonStatus.state === "error") {
      return tcpDaemonStatus.lastError ?? "移动端守护进程当前处于错误状态。";
    }
    return `移动端守护进程已停止${tcpDaemonStatus.listenAddr ? `（${tcpDaemonStatus.listenAddr}）` : ""}。`;
  })();
  const webAccessStatusLabel = (() => {
    if (!webAccessStatus) {
      return "未探测";
    }
    if (!webAccessStatus.enabled) {
      return "已关闭";
    }
    if (webAccessStatus.state === "running") {
      return "运行中";
    }
    if (webAccessStatus.state === "error") {
      return "异常";
    }
    return "已停止";
  })();
  const webAccessStatusTone =
    !webAccessStatus || !webAccessStatus.enabled
      ? "is-muted"
      : webAccessStatus.state === "running"
        ? "is-running"
        : webAccessStatus.state === "error"
          ? "is-error"
          : "is-stopped";
  const webAccessStatusSummary = (() => {
    if (!webAccessStatus) {
      return "正在等待状态探测。";
    }
    if (!webAccessStatus.enabled) {
      return "网页访问当前未启用。";
    }
    if (webAccessStatus.state === "running") {
      return webAccessStatus.pid
        ? `网页服务正在运行（PID ${webAccessStatus.pid}）。`
        : "网页服务正在运行。";
    }
    if (webAccessStatus.state === "error") {
      return webAccessStatus.lastError ?? "网页服务当前处于异常状态。";
    }
    return "网页服务当前已停止。";
  })();

  const openAddRemoteModal = () => {
    setAddRemoteError(null);
    setAddRemoteNameDraft(nextRemoteNameSuggestion);
    setAddRemoteHostDraft(remoteHostDraft);
    setAddRemoteTokenDraft("");
    setAddRemoteOpen(true);
  };

  const closeAddRemoteModal = () => {
    if (addRemoteBusy) {
      return;
    }
    setAddRemoteOpen(false);
    setAddRemoteError(null);
  };

  const handleAddRemoteConfirm = () => {
    void (async () => {
      if (addRemoteBusy) {
        return;
      }
      setAddRemoteBusy(true);
      setAddRemoteError(null);
      try {
        await onAddRemoteBackend({
          name: addRemoteNameDraft,
          host: addRemoteHostDraft,
          token: addRemoteTokenDraft,
        });
        setAddRemoteOpen(false);
      } catch (error) {
        setAddRemoteError(error instanceof Error ? error.message : "无法添加远程配置。");
      } finally {
        setAddRemoteBusy(false);
      }
    })();
  };

  return (
    <SettingsSection
      title="服务"
      subtitle={
        isMobileSimplified
          ? "从桌面端配置中填写 TCP 主机和令牌，然后执行连接测试。"
          : "配置 CodexMonitor 如何向移动端和远程客户端暴露 TCP 后端访问。除非你显式切换到远程模式，否则桌面端仍使用本地模式。"
      }
    >

      {!isMobileSimplified && (
        <>
        <SettingsServerAreaHeading
          title="本机服务"
          description="选择桌面端请求走本地进程还是远程守护进程，并控制应用退出后的守护进程生命周期。"
        />
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="backend-mode">
            后端模式
          </label>
          <select
            id="backend-mode"
            className="settings-select"
            value={appSettings.backendMode}
            onChange={(event) =>
              void onUpdateAppSettings({
                ...appSettings,
                backendMode: event.target.value as AppSettings["backendMode"],
              })
            }
          >
            <option value="local">本地（默认）</option>
            <option value="remote">远程（守护进程）</option>
          </select>
          <div className="settings-help">
            本地模式会在进程内处理桌面请求；远程模式会让桌面请求走与移动端相同的 TCP 传输链路。
          </div>
        </div>
        </>
      )}

      <>
        {isMobileSimplified && (
          <>
            <SettingsServerAreaHeading
              title="远程连接"
              description="管理移动端保存的远程桌面配置，并测试当前配置是否可连接。"
            />
            <div className="settings-field">
              <div className="settings-field-label">已保存的远程配置</div>
              <div className="settings-mobile-remotes" role="list" aria-label="已保存的远程配置">
                {remoteBackends.map((entry, index) => {
                  const isActive = entry.id === activeRemoteBackendId;
                  return (
                    <div
                      className={`settings-mobile-remote${isActive ? " is-active" : ""}`}
                      role="listitem"
                      key={entry.id}
                    >
                      <div className="settings-mobile-remote-main">
                        <div className="settings-mobile-remote-name-row">
                          <div className="settings-mobile-remote-name">{entry.name}</div>
                          {isActive && <span className="settings-mobile-remote-badge">当前使用</span>}
                        </div>
                        <div className="settings-mobile-remote-meta">TCP · {entry.host}</div>
                        <div className="settings-mobile-remote-last">
                          上次连接：{" "}
                          {typeof entry.lastConnectedAtMs === "number"
                            ? new Date(entry.lastConnectedAtMs).toLocaleString()
                            : "从未"}
                        </div>
                      </div>
                      <div className="settings-mobile-remote-actions">
                        <button
                          type="button"
                          className="ghost settings-mobile-remote-action"
                          onClick={() => {
                            void onSelectRemoteBackend(entry.id);
                          }}
                          disabled={isActive}
                          aria-label={`使用远程配置 ${entry.name}`}
                        >
                          {isActive ? "使用中" : "使用"}
                        </button>
                        <button
                          type="button"
                          className="ghost settings-mobile-remote-action"
                          onClick={() => {
                            void onMoveRemoteBackend(entry.id, "up");
                          }}
                          disabled={index === 0}
                          aria-label={`上移 ${entry.name}`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="ghost settings-mobile-remote-action"
                          onClick={() => {
                            void onMoveRemoteBackend(entry.id, "down");
                          }}
                          disabled={index === remoteBackends.length - 1}
                          aria-label={`下移 ${entry.name}`}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="ghost settings-mobile-remote-action settings-mobile-remote-action-danger"
                          onClick={() => {
                            setPendingDeleteRemoteId(entry.id);
                          }}
                          aria-label={`删除 ${entry.name}`}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="settings-field-row">
                <button
                  type="button"
                  className="button settings-button-compact"
                  onClick={openAddRemoteModal}
                >
                  添加远程配置
                </button>
              </div>
              {remoteStatusText && (
                <div className={`settings-help${remoteStatusError ? " settings-help-error" : ""}`}>
                  {remoteStatusText}
                </div>
              )}
              <div className="settings-help">
                在这里切换当前远程配置。下面的字段会编辑当前激活项。
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-field-label" htmlFor="mobile-remote-name">
                远程名称
              </label>
              <input
                id="mobile-remote-name"
                className="settings-input settings-input--compact"
                value={remoteNameDraft}
                placeholder="我的桌面端"
                onChange={(event) => onSetRemoteNameDraft(event.target.value)}
                onBlur={() => {
                  void onCommitRemoteName();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void onCommitRemoteName();
                  }
                }}
              />
              {remoteNameError && <div className="settings-help settings-help-error">{remoteNameError}</div>}
            </div>
          </>
        )}

        {!isMobileSimplified && (
          <SettingsToggleRow
            title="应用关闭后保持守护进程运行"
            subtitle="关闭后若未启用该项，CodexMonitor 会在退出前停止受管 TCP 守护进程。"
          >
            <SettingsToggleSwitch
              pressed={appSettings.keepDaemonRunningAfterAppClose}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  keepDaemonRunningAfterAppClose: !appSettings.keepDaemonRunningAfterAppClose,
                })
              }
            />
          </SettingsToggleRow>
        )}

        {!isMobileSimplified && (
          <>
              <SettingsServerAreaHeading
                title="移动端访问"
                description="开启浏览器访问入口，配置监听地址、端口和推荐访问链接。"
              />
              <SettingsToggleRow
                title="网页访问"
                subtitle="开启后会复用当前守护进程，在桌面端暴露浏览器访问入口。关闭时会停止当前受管网页服务。"
              >
                <SettingsToggleSwitch
                  pressed={appSettings.webAccessEnabled}
                  aria-label="切换网页访问"
                  onClick={() => {
                    void onToggleWebAccessEnabled();
                  }}
                  disabled={webAccessBusy}
                />
              </SettingsToggleRow>

              <div className="settings-field">
                <div className="settings-web-status-header">
                  <div>
                    <div className="settings-field-label">网页服务状态</div>
                    <div className={`settings-web-status-badge ${webAccessStatusTone}`}>
                      {webAccessBusy ? "检测中..." : webAccessStatusLabel}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="button settings-button-compact"
                    aria-label="刷新网页服务状态"
                    onClick={onRefreshWebAccessStatus}
                    disabled={webAccessBusy}
                  >
                    {webAccessBusy ? "刷新中..." : "刷新状态"}
                  </button>
                </div>
                <div className="settings-help">{webAccessStatusSummary}</div>
                {webAccessStatus?.listenAddr && (
                  <div className="settings-help">
                    当前监听：<code>{webAccessStatus.listenAddr}</code>
                  </div>
                )}
                {webAccessStatus?.startedAtMs && (
                  <div className="settings-help">
                    最近启动：{new Date(webAccessStatus.startedAtMs).toLocaleString()}
                  </div>
                )}
                {webAccessStatusText && (
                  <div className={`settings-help${webAccessStatusError ? " settings-help-error" : ""}`}>
                    {webAccessStatusText}
                  </div>
                )}
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="web-access-listen-addr">
                  网页监听地址
                </label>
                <input
                  id="web-access-listen-addr"
                  className="settings-input settings-input--compact"
                  value={webAccessListenAddrDraft}
                  placeholder="127.0.0.1 或 0.0.0.0"
                  onChange={(event) => onSetWebAccessListenAddrDraft(event.target.value)}
                  onBlur={() => {
                    void onCommitWebAccessListenAddr();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void onCommitWebAccessListenAddr();
                    }
                  }}
                />
                {webAccessListenAddrError && (
                  <div className="settings-help settings-help-error">{webAccessListenAddrError}</div>
                )}
                <div className="settings-help">
                  默认仅本机开放；如需通过 Tailscale 或局域网访问，可改为 <code>0.0.0.0</code>。
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="web-access-port">
                  网页端口
                </label>
                <input
                  id="web-access-port"
                  className="settings-input settings-input--compact"
                  inputMode="numeric"
                  value={webAccessPortDraft}
                  placeholder="4733"
                  onChange={(event) => onSetWebAccessPortDraft(event.target.value)}
                  onBlur={() => {
                    void onCommitWebAccessPort();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void onCommitWebAccessPort();
                    }
                  }}
                />
                {webAccessPortError && (
                  <div className="settings-help settings-help-error">{webAccessPortError}</div>
                )}
              </div>

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="web-access-public-url">
                  外部访问地址（可选）
                </label>
                <input
                  id="web-access-public-url"
                  className="settings-input settings-input--compact"
                  value={webAccessPublicBaseUrlDraft}
                  placeholder="https://macbook.tailnet.ts.net:4733"
                  onChange={(event) => onSetWebAccessPublicBaseUrlDraft(event.target.value)}
                  onBlur={() => {
                    void onCommitWebAccessPublicBaseUrl();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void onCommitWebAccessPublicBaseUrl();
                    }
                  }}
                />
                {webAccessPublicBaseUrlError && (
                  <div className="settings-help settings-help-error">
                    {webAccessPublicBaseUrlError}
                  </div>
                )}
                <div className="settings-help">
                  如果你已经固定了 Tailscale、反向代理或自定义域名入口，可以在这里覆盖推荐地址。
                </div>
              </div>

              <div className="settings-field">
                <div className="settings-field-label">推荐访问地址</div>
                <div className="settings-web-link-grid">
                  <div className="settings-web-link-card">
                    <div className="settings-web-link-title">本机访问</div>
                    <code>{webAccessStatus?.localUrl ?? webAccessLocalUrl ?? "未生成"}</code>
                    <div className="settings-field-row">
                      <button
                        type="button"
                        className="button settings-button-compact"
                        onClick={() => copyValueToClipboard(webAccessStatus?.localUrl ?? webAccessLocalUrl)}
                        disabled={!webAccessStatus?.localUrl && !webAccessLocalUrl}
                      >
                        复制地址
                      </button>
                      <button
                        type="button"
                        className="button settings-button-compact"
                        onClick={() => {
                          const nextUrl = webAccessStatus?.localUrl ?? webAccessLocalUrl;
                          if (nextUrl) {
                            void openUrl(nextUrl);
                          }
                        }}
                        disabled={!webAccessStatus?.localUrl && !webAccessLocalUrl}
                      >
                        浏览器打开
                      </button>
                    </div>
                  </div>
                  <div className="settings-web-link-card">
                    <div className="settings-web-link-title">远程访问</div>
                    <code>{webAccessRemoteUrl ?? "未生成"}</code>
                    <div className="settings-field-row">
                      <button
                        type="button"
                        className="button settings-button-compact"
                        onClick={() => copyValueToClipboard(webAccessRemoteUrl)}
                        disabled={!webAccessRemoteUrl}
                      >
                        复制地址
                      </button>
                    </div>
                  </div>
                </div>
                <div className="settings-help">
                  推荐优先使用 Tailscale 设备名地址；如果你填了“外部访问地址”，这里会优先展示该地址。
                </div>
              </div>
          </>
        )}

        {!isMobileSimplified && (
          <SettingsServerAreaHeading
            title="远程连接"
            description="维护桌面端和移动端共用的 TCP 主机、令牌和当前激活的远程后端。"
          />
        )}
        <div className="settings-field">
          <div className="settings-field-label">远程后端</div>
          <div className="settings-field-row settings-remote-backend-row">
            <input
              className="settings-input settings-input--compact"
              value={remoteHostDraft}
              placeholder="127.0.0.1:4732"
              onChange={(event) => onSetRemoteHostDraft(event.target.value)}
              onBlur={() => {
                void onCommitRemoteHost();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void onCommitRemoteHost();
                }
              }}
              aria-label="远程后端主机"
            />
            <RemoteTokenControl
              token={remoteTokenDraft}
              disabled={false}
              blockedReason={remoteTokenGenerationBlockedReason}
              onTokenChange={onSetRemoteTokenDraft}
              onCommitToken={onCommitRemoteToken}
              onGenerateToken={onGenerateRemoteToken}
            />
          </div>
          {remoteHostError && <div className="settings-help settings-help-error">{remoteHostError}</div>}
          <div className="settings-help">
            {isMobileSimplified
              ? "请使用桌面端 CodexMonitor（服务分区）中的 Tailscale 主机，例如 `macbook.your-tailnet.ts.net:4732`。"
              : "此主机和令牌会用于移动端访问以及桌面端远程模式测试。"}
          </div>
          <div className={`settings-help${remoteTokenGenerationBlockedReason ? " settings-help-error" : ""}`}>
            {remoteTokenGenerationBlockedReason ?? "可一键生成新的随机令牌，生成后会立即保存到当前远程配置。"}
          </div>
        </div>

        {isMobileSimplified && (
          <div className="settings-field">
            <div className="settings-field-label">连接测试</div>
            <div className="settings-field-row">
              <button
                type="button"
                className="button settings-button-compact"
                onClick={onMobileConnectTest}
                disabled={mobileConnectBusy}
              >
                {mobileConnectBusy ? "连接中..." : "连接并测试"}
              </button>
            </div>
            {mobileConnectStatusText && (
              <div className={`settings-help${mobileConnectStatusError ? " settings-help-error" : ""}`}>
                {mobileConnectStatusText}
              </div>
            )}
            <div className="settings-help">
              请确认桌面端应用守护进程已启动，且可通过 Tailscale 访问，然后再重试。
            </div>
          </div>
        )}

        {!isMobileSimplified && (
          <div className="settings-field">
            <SettingsServerAreaHeading
              title="诊断"
              description="启动或刷新移动端守护进程，并查看 Tailscale 推荐主机与兜底命令。"
            />
            <div className="settings-field-label">移动端访问守护进程</div>
            <div className="settings-field-row">
              <button
                type="button"
                className="button settings-button-compact"
                onClick={() => {
                  void onTcpDaemonStart();
                }}
                disabled={tcpDaemonBusyAction !== null}
              >
                {tcpDaemonBusyAction === "start" ? "启动中..." : "启动守护进程"}
              </button>
              <button
                type="button"
                className="button settings-button-compact"
                onClick={() => {
                  void onTcpDaemonStop();
                }}
                disabled={tcpDaemonBusyAction !== null}
              >
                {tcpDaemonBusyAction === "stop" ? "停止中..." : "停止守护进程"}
              </button>
              <button
                type="button"
                className="button settings-button-compact"
                onClick={() => {
                  void onTcpDaemonStatus();
                }}
                disabled={tcpDaemonBusyAction !== null}
              >
                {tcpDaemonBusyAction === "status" ? "刷新中..." : "刷新状态"}
              </button>
            </div>
            {tcpRunnerStatusText && <div className="settings-help">{tcpRunnerStatusText}</div>}
            {tcpDaemonStatus?.startedAtMs && (
              <div className="settings-help">
                启动时间：{new Date(tcpDaemonStatus.startedAtMs).toLocaleString()}
              </div>
            )}
            <div className="settings-help">
              从 iOS 连接前请先启动该守护进程。它会使用你当前的令牌，并监听
              <code>0.0.0.0:&lt;port&gt;</code>，端口与配置的主机端口保持一致。
            </div>
          </div>
        )}

        {!isMobileSimplified && (
          <div className="settings-field">
            <div className="settings-field-label">Tailscale 辅助工具</div>
            <div className="settings-field-row">
              <button
                type="button"
                className="button settings-button-compact"
                onClick={onRefreshTailscaleStatus}
                disabled={tailscaleStatusBusy}
              >
                {tailscaleStatusBusy ? "检测中..." : "检测 Tailscale"}
              </button>
              <button
                type="button"
                className="button settings-button-compact"
                onClick={onRefreshTailscaleCommandPreview}
                disabled={tailscaleCommandBusy}
              >
                {tailscaleCommandBusy ? "刷新中..." : "刷新守护进程命令"}
              </button>
              <button
                type="button"
                className="button settings-button-compact"
                disabled={!tailscaleStatus?.suggestedRemoteHost}
                onClick={() => {
                  void onUseSuggestedTailscaleHost();
                }}
              >
                使用推荐主机
              </button>
            </div>
            {tailscaleStatusError && (
              <div className="settings-help settings-help-error">{tailscaleStatusError}</div>
            )}
            {tailscaleStatus && (
              <>
                <div className="settings-help">{tailscaleStatus.message}</div>
                <div className="settings-help">
                  {tailscaleStatus.installed
                    ? `版本：${tailscaleStatus.version ?? "未知"}`
                    : "请在桌面端和 iOS 端都安装 Tailscale 后再继续。"}
                </div>
                {tailscaleStatus.suggestedRemoteHost && (
                  <div className="settings-help">
                    推荐远程主机：<code>{tailscaleStatus.suggestedRemoteHost}</code>
                  </div>
                )}
                {tailscaleStatus.tailnetName && (
                  <div className="settings-help">
                    Tailnet：<code>{tailscaleStatus.tailnetName}</code>
                  </div>
                )}
              </>
            )}
            {tailscaleCommandError && (
              <div className="settings-help settings-help-error">{tailscaleCommandError}</div>
            )}
            {tailscaleCommandPreview && (
              <>
                <div className="settings-help">
                  启动守护进程的命令模板（手动兜底方案）：
                </div>
                <pre className="settings-command-preview">
                  <code>{tailscaleCommandPreview.command}</code>
                </pre>
                {!tailscaleCommandPreview.tokenConfigured && (
                  <div className="settings-help settings-help-error">
                    远程后端令牌为空。暴露守护进程访问前请先设置令牌。
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </>

      <div className="settings-help">
        {isMobileSimplified
          ? "仅建议在你自己的基础设施中使用。iOS 端请从桌面端 CodexMonitor 配置中获取 Tailscale 主机名和令牌。"
          : "移动端访问应限制在你自己的基础设施（tailnet）内。CodexMonitor 不提供托管后端服务。"}
      </div>
      {addRemoteOpen && (
        <ModalShell
          className="settings-add-remote-overlay"
          cardClassName="settings-add-remote-card"
          onBackdropClick={closeAddRemoteModal}
          ariaLabel="添加远程配置"
        >
          <div className="settings-add-remote-header">
            <div className="settings-add-remote-title">添加远程配置</div>
            <button
              type="button"
              className="ghost icon-button settings-add-remote-close"
              onClick={closeAddRemoteModal}
              aria-label="关闭添加远程配置弹窗"
              disabled={addRemoteBusy}
            >
              <X aria-hidden />
            </button>
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-add-remote-name">
              新远程名称
            </label>
            <input
              id="settings-add-remote-name"
              className="settings-input settings-input--compact"
              value={addRemoteNameDraft}
              onChange={(event) => setAddRemoteNameDraft(event.target.value)}
              disabled={addRemoteBusy}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-add-remote-host">
              新远程主机
            </label>
            <input
              id="settings-add-remote-host"
              className="settings-input settings-input--compact"
              value={addRemoteHostDraft}
              placeholder="macbook.your-tailnet.ts.net:4732"
              onChange={(event) => setAddRemoteHostDraft(event.target.value)}
              disabled={addRemoteBusy}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-add-remote-token">
              新远程令牌
            </label>
            <input
              id="settings-add-remote-token"
              type="password"
              className="settings-input settings-input--compact"
              value={addRemoteTokenDraft}
              placeholder="令牌"
              onChange={(event) => setAddRemoteTokenDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddRemoteConfirm();
                }
              }}
              disabled={addRemoteBusy}
            />
          </div>
          {addRemoteError && <div className="settings-help settings-help-error">{addRemoteError}</div>}
          <div className="settings-add-remote-actions">
            <button type="button" className="ghost" onClick={closeAddRemoteModal} disabled={addRemoteBusy}>
              取消
            </button>
            <button
              type="button"
              className="button"
              onClick={handleAddRemoteConfirm}
              disabled={addRemoteBusy}
            >
              {addRemoteBusy ? "连接中..." : "连接并添加"}
            </button>
          </div>
        </ModalShell>
      )}
      {pendingDeleteRemote && (
        <ModalShell
          className="settings-delete-remote-overlay"
          cardClassName="settings-delete-remote-card"
          onBackdropClick={() => setPendingDeleteRemoteId(null)}
          ariaLabel="删除远程配置确认"
        >
          <div className="settings-delete-remote-title">删除远程配置？</div>
          <div className="settings-delete-remote-message">
            确认从已保存的远程配置中移除 <strong>{pendingDeleteRemote.name}</strong> 吗？此操作只会删除当前设备上的配置。
          </div>
          <div className="settings-delete-remote-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setPendingDeleteRemoteId(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                void onDeleteRemoteBackend(pendingDeleteRemote.id);
                setPendingDeleteRemoteId(null);
              }}
            >
              删除远程配置
            </button>
          </div>
        </ModalShell>
      )}
    </SettingsSection>
  );
}
