import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  AppSettings,
  TailscaleDaemonCommandPreview,
  TailscaleStatus,
  TcpDaemonStatus,
  WebAccessStatus,
} from "@/types";
import {
  listWorkspaces,
  tailscaleDaemonCommandPreview as fetchTailscaleDaemonCommandPreview,
  tailscaleDaemonStart,
  tailscaleDaemonStatus,
  tailscaleDaemonStop,
  tailscaleStatus as fetchTailscaleStatus,
  webAccessStatus as fetchWebAccessStatus,
} from "@services/tauri";
import { isMobilePlatform } from "@utils/platformPaths";
import { DEFAULT_REMOTE_HOST } from "@settings/components/settingsViewConstants";

type UseSettingsServerSectionArgs = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onMobileConnectSuccess?: () => Promise<void> | void;
};

export type AddRemoteBackendDraft = {
  name: string;
  host: string;
  token: string;
};

export type SettingsServerSectionProps = {
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

const formatErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return fallback;
};

type RemoteBackendTarget = AppSettings["remoteBackends"][number];

const createRemoteBackendId = () =>
  `remote-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const buildFallbackRemoteBackend = (settings: AppSettings): RemoteBackendTarget => ({
  id: settings.activeRemoteBackendId ?? "remote-default",
  name: "主远程配置",
  provider: "tcp",
  host: settings.remoteBackendHost,
  token: settings.remoteBackendToken,
  lastConnectedAtMs: null,
});

const getConfiguredRemoteBackends = (settings: AppSettings): RemoteBackendTarget[] => {
  if (settings.remoteBackends.length > 0) {
    return settings.remoteBackends;
  }
  return [buildFallbackRemoteBackend(settings)];
};

const getActiveRemoteBackend = (settings: AppSettings): RemoteBackendTarget => {
  const configured = getConfiguredRemoteBackends(settings);
  return configured.find((entry) => entry.id === settings.activeRemoteBackendId) ?? configured[0];
};

const validateRemoteHost = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "主机地址不能为空。";
  }
  const match = trimmed.match(/^([^:\s]+|\[[^\]]+\]):([0-9]{1,5})$/);
  if (!match) {
    return "请使用 host:port 格式，例如 `macbook.tailnet.ts.net:4732`。";
  }
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "端口必须在 1 到 65535 之间。";
  }
  return null;
};

const validateWebAccessListenAddr = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Web 监听地址不能为空。";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return "Web 监听地址不需要包含协议。";
  }
  if (/\s/.test(trimmed)) {
    return "Web 监听地址不能包含空格。";
  }
  return null;
};

const validateWebAccessPort = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Web 端口不能为空。";
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "Web 端口必须在 1 到 65535 之间。";
  }
  return null;
};

const normalizePublicBaseUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    return candidate.replace(/\/$/, "");
  } catch {
    return null;
  }
};

const normalizeUrlHost = (host: string): string => {
  const trimmed = host.trim();
  if (trimmed.includes(":") && !trimmed.startsWith("[")) {
    return `[${trimmed}]`;
  }
  return trimmed;
};

const buildHttpUrl = (host: string, port: number): string => {
  return `http://${normalizeUrlHost(host)}:${port}`;
};

/**
 * 生成高熵十六进制远程令牌。
 *
 * 无入参；返回可直接保存的随机字符串。
 */
const createRandomRemoteToken = (): string => {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("当前运行环境不支持安全随机令牌生成。");
  }
  const bytes = new Uint8Array(24);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
};

const extractSuggestedRemoteHost = (status: TailscaleStatus | null): string | null => {
  const suggested = status?.suggestedRemoteHost?.trim();
  if (suggested) {
    if (suggested.startsWith("[")) {
      const closingIndex = suggested.indexOf("]");
      if (closingIndex > 0) {
        return suggested.slice(0, closingIndex + 1);
      }
    }
    const lastColonIndex = suggested.lastIndexOf(":");
    if (lastColonIndex > 0 && suggested.indexOf(":") === lastColonIndex) {
      return suggested.slice(0, lastColonIndex);
    }
    return suggested;
  }
  if (status?.dnsName?.trim()) {
    return status.dnsName.trim();
  }
  if (status?.ipv4?.[0]?.trim()) {
    return status.ipv4[0].trim();
  }
  if (status?.ipv6?.[0]?.trim()) {
    return status.ipv6[0].trim();
  }
  return null;
};

const buildNextRemoteName = (remoteBackends: RemoteBackendTarget[]) => {
  const normalized = new Set(remoteBackends.map((entry) => entry.name.trim().toLowerCase()));
  let index = remoteBackends.length + 1;
  let candidate = `远程配置 ${index}`;
  while (normalized.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `远程配置 ${index}`;
  }
  return candidate;
};

export const useSettingsServerSection = ({
  appSettings,
  onUpdateAppSettings,
  onMobileConnectSuccess,
}: UseSettingsServerSectionArgs): SettingsServerSectionProps => {
  const initialActiveRemoteBackend = getActiveRemoteBackend(appSettings);
  const [remoteNameDraft, setRemoteNameDraft] = useState(initialActiveRemoteBackend.name);
  const [remoteHostDraft, setRemoteHostDraft] = useState(initialActiveRemoteBackend.host);
  const [remoteTokenDraft, setRemoteTokenDraft] = useState(initialActiveRemoteBackend.token ?? "");
  const [remoteStatusText, setRemoteStatusText] = useState<string | null>(null);
  const [remoteStatusError, setRemoteStatusError] = useState(false);
  const [remoteNameError, setRemoteNameError] = useState<string | null>(null);
  const [remoteHostError, setRemoteHostError] = useState<string | null>(null);
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
  const [tailscaleStatusBusy, setTailscaleStatusBusy] = useState(false);
  const [tailscaleStatusError, setTailscaleStatusError] = useState<string | null>(null);
  const [tailscaleCommandPreview, setTailscaleCommandPreview] =
    useState<TailscaleDaemonCommandPreview | null>(null);
  const [tailscaleCommandBusy, setTailscaleCommandBusy] = useState(false);
  const [tailscaleCommandError, setTailscaleCommandError] = useState<string | null>(null);
  const [tcpDaemonStatus, setTcpDaemonStatus] = useState<TcpDaemonStatus | null>(null);
  const [tcpDaemonBusyAction, setTcpDaemonBusyAction] = useState<
    "start" | "stop" | "status" | null
  >(null);
  const [webAccessStatus, setWebAccessStatus] = useState<WebAccessStatus | null>(null);
  const [webAccessBusy, setWebAccessBusy] = useState(false);
  const [webAccessStatusText, setWebAccessStatusText] = useState<string | null>(null);
  const [webAccessStatusError, setWebAccessStatusError] = useState(false);
  const [webAccessListenAddrDraft, setWebAccessListenAddrDraft] = useState(
    appSettings.webAccessListenAddr,
  );
  const [webAccessPortDraft, setWebAccessPortDraft] = useState(
    String(appSettings.webAccessPort),
  );
  const [webAccessPublicBaseUrlDraft, setWebAccessPublicBaseUrlDraft] = useState(
    appSettings.webAccessPublicBaseUrl ?? "",
  );
  const [webAccessListenAddrError, setWebAccessListenAddrError] = useState<string | null>(null);
  const [webAccessPortError, setWebAccessPortError] = useState<string | null>(null);
  const [webAccessPublicBaseUrlError, setWebAccessPublicBaseUrlError] =
    useState<string | null>(null);
  const [mobileConnectBusy, setMobileConnectBusy] = useState(false);
  const [mobileConnectStatusText, setMobileConnectStatusText] = useState<string | null>(null);
  const [mobileConnectStatusError, setMobileConnectStatusError] = useState(false);
  const mobilePlatform = useMemo(() => isMobilePlatform(), []);

  const latestSettingsRef = useRef(appSettings);
  const activeRemoteBackend = useMemo(() => getActiveRemoteBackend(appSettings), [appSettings]);
  const webAccessLocalUrl = useMemo(() => {
    const host = appSettings.webAccessListenAddr.trim();
    if (!host) {
      return null;
    }
    if (host === "0.0.0.0") {
      return buildHttpUrl("127.0.0.1", appSettings.webAccessPort);
    }
    if (host === "::" || host === "[::]") {
      return buildHttpUrl("::1", appSettings.webAccessPort);
    }
    return buildHttpUrl(host, appSettings.webAccessPort);
  }, [appSettings.webAccessListenAddr, appSettings.webAccessPort]);
  const webAccessRemoteUrl = useMemo(() => {
    const explicit = normalizePublicBaseUrl(appSettings.webAccessPublicBaseUrl ?? "");
    if (explicit) {
      return explicit;
    }
    const suggestedHost = extractSuggestedRemoteHost(tailscaleStatus);
    if (!suggestedHost) {
      return null;
    }
    return buildHttpUrl(suggestedHost.replace(/^\[(.*)\]$/, "$1"), appSettings.webAccessPort);
  }, [appSettings.webAccessPort, appSettings.webAccessPublicBaseUrl, tailscaleStatus]);
  const remoteTokenGenerationBlockedReason = useMemo(() => {
    if (webAccessBusy) {
      return "正在检测 Web 服务状态，请稍后再试。";
    }
    if (appSettings.webAccessEnabled) {
      return "请先关闭 Web 服务，再生成新的远程令牌。";
    }
    if (webAccessStatus?.state === "running") {
      return "Web 服务仍在运行，请先关闭并等待完全停止。";
    }
    return null;
  }, [appSettings.webAccessEnabled, webAccessBusy, webAccessStatus?.state]);

  const setRemoteStatus = useCallback((message: string | null, isError = false) => {
    setRemoteStatusText(message);
    setRemoteStatusError(isError);
  }, []);

  const setWebAccessNotice = useCallback((message: string | null, isError = false) => {
    setWebAccessStatusText(message);
    setWebAccessStatusError(isError);
  }, []);

  useEffect(() => {
    latestSettingsRef.current = appSettings;
  }, [appSettings]);

  useEffect(() => {
    setRemoteNameDraft(activeRemoteBackend.name);
    setRemoteHostDraft(activeRemoteBackend.host);
    setRemoteTokenDraft(activeRemoteBackend.token ?? "");
    setRemoteNameError(null);
    setRemoteHostError(null);
  }, [activeRemoteBackend]);

  useEffect(() => {
    setWebAccessListenAddrDraft(appSettings.webAccessListenAddr);
    setWebAccessPortDraft(String(appSettings.webAccessPort));
    setWebAccessPublicBaseUrlDraft(appSettings.webAccessPublicBaseUrl ?? "");
    setWebAccessListenAddrError(null);
    setWebAccessPortError(null);
    setWebAccessPublicBaseUrlError(null);
  }, [
    appSettings.webAccessListenAddr,
    appSettings.webAccessPort,
    appSettings.webAccessPublicBaseUrl,
  ]);

  const normalizeRemoteBackendEntry = (
    entry: RemoteBackendTarget,
    index: number,
  ): RemoteBackendTarget => ({
    id: entry.id?.trim() || `remote-${index + 1}`,
    name: entry.name?.trim() || `远程配置 ${index + 1}`,
    provider: "tcp",
    host: entry.host?.trim() || DEFAULT_REMOTE_HOST,
    token: entry.token?.trim() ? entry.token.trim() : null,
    lastConnectedAtMs:
      typeof entry.lastConnectedAtMs === "number" && Number.isFinite(entry.lastConnectedAtMs)
        ? entry.lastConnectedAtMs
        : null,
  });

  const buildSettingsFromRemoteBackends = useCallback(
    (
      latestSettings: AppSettings,
      remoteBackends: RemoteBackendTarget[],
      preferredActiveId?: string | null,
    ): AppSettings => {
      const normalizedBackends = remoteBackends.length
        ? remoteBackends.map(normalizeRemoteBackendEntry)
        : [normalizeRemoteBackendEntry(buildFallbackRemoteBackend(latestSettings), 0)];
      const active =
        normalizedBackends.find((entry) => entry.id === preferredActiveId) ??
        normalizedBackends.find((entry) => entry.id === latestSettings.activeRemoteBackendId) ??
        normalizedBackends[0];
      return {
        ...latestSettings,
        remoteBackends: normalizedBackends,
        activeRemoteBackendId: active.id,
        remoteBackendProvider: "tcp",
        remoteBackendHost: active.host,
        remoteBackendToken: active.token,
        ...(mobilePlatform
          ? {
              backendMode: "remote",
            }
          : {}),
      };
    },
    [mobilePlatform],
  );

  const persistRemoteBackends = useCallback(
    async (remoteBackends: RemoteBackendTarget[], preferredActiveId?: string | null) => {
      const latestSettings = latestSettingsRef.current;
      const nextSettings = buildSettingsFromRemoteBackends(
        latestSettings,
        remoteBackends,
        preferredActiveId,
      );
      const unchanged =
        nextSettings.remoteBackendHost === latestSettings.remoteBackendHost &&
        nextSettings.remoteBackendToken === latestSettings.remoteBackendToken &&
        nextSettings.backendMode === latestSettings.backendMode &&
        nextSettings.remoteBackendProvider === latestSettings.remoteBackendProvider &&
        nextSettings.activeRemoteBackendId === latestSettings.activeRemoteBackendId &&
        JSON.stringify(nextSettings.remoteBackends) === JSON.stringify(latestSettings.remoteBackends);
      if (unchanged) {
        return;
      }
      await onUpdateAppSettings(nextSettings);
      latestSettingsRef.current = nextSettings;
    },
    [buildSettingsFromRemoteBackends, onUpdateAppSettings],
  );

  /**
   * 持久化应用设置补丁。
   *
   * `patch`：需要写回的设置字段；`message`：成功后的状态提示。
   */
  const persistSettingsPatch = useCallback(
    async (patch: Partial<AppSettings>, message?: string) => {
      const latestSettings = latestSettingsRef.current;
      const nextSettings = {
        ...latestSettings,
        ...patch,
      };
      await onUpdateAppSettings(nextSettings);
      latestSettingsRef.current = nextSettings;
      if (message) {
        setWebAccessNotice(message);
      }
      return nextSettings;
    },
    [onUpdateAppSettings, setWebAccessNotice],
  );

  const handleRefreshWebAccessStatus = useCallback(() => {
    void (async () => {
      setWebAccessBusy(true);
      try {
        const status = await fetchWebAccessStatus();
        setWebAccessStatus(status);
        if (status.lastError) {
          setWebAccessNotice(status.lastError, true);
        } else {
          setWebAccessNotice(null);
        }
      } catch (error) {
        const message = formatErrorMessage(error, "无法刷新 Web 服务状态。");
        setWebAccessStatus(null);
        setWebAccessNotice(message, true);
      } finally {
        setWebAccessBusy(false);
      }
    })();
  }, [setWebAccessNotice]);

  /**
   * 切换 Web 访问开关并立即同步守护进程状态。
   *
   * 无入参；保存成功后会刷新 Web 服务状态。
   */
  const handleToggleWebAccessEnabled = async () => {
    const latestSettings = latestSettingsRef.current;
    const nextEnabled = !latestSettings.webAccessEnabled;
    await persistSettingsPatch(
      { webAccessEnabled: nextEnabled },
      nextEnabled ? "Web 访问已开启，正在刷新状态。" : "Web 访问已关闭。",
    );
    handleRefreshWebAccessStatus();
  };

  /**
   * 保存 Web 监听地址。
   *
   * 无入参；会校验地址格式并在成功后刷新状态。
   */
  const handleCommitWebAccessListenAddr = async () => {
    const nextValue = webAccessListenAddrDraft.trim();
    const validationError = validateWebAccessListenAddr(nextValue);
    if (validationError) {
      setWebAccessListenAddrError(validationError);
      setWebAccessNotice(validationError, true);
      return;
    }
    setWebAccessListenAddrError(null);
    setWebAccessListenAddrDraft(nextValue);
    await persistSettingsPatch(
      { webAccessListenAddr: nextValue },
      "Web 监听地址已保存。",
    );
    handleRefreshWebAccessStatus();
  };

  /**
   * 保存 Web 监听端口。
   *
   * 无入参；会校验端口范围并在成功后刷新状态。
   */
  const handleCommitWebAccessPort = async () => {
    const validationError = validateWebAccessPort(webAccessPortDraft);
    if (validationError) {
      setWebAccessPortError(validationError);
      setWebAccessNotice(validationError, true);
      return;
    }
    const nextPort = Number.parseInt(webAccessPortDraft.trim(), 10);
    setWebAccessPortError(null);
    setWebAccessPortDraft(String(nextPort));
    await persistSettingsPatch({ webAccessPort: nextPort }, "Web 端口已保存。");
    handleRefreshWebAccessStatus();
  };

  /**
   * 保存 Web 外部访问地址。
   *
   * 无入参；允许为空，非空时需为可访问的 HTTP/HTTPS 地址。
   */
  const handleCommitWebAccessPublicBaseUrl = async () => {
    const normalized = normalizePublicBaseUrl(webAccessPublicBaseUrlDraft);
    if (webAccessPublicBaseUrlDraft.trim() && !normalized) {
      const message = "外部访问地址格式无效，请输入完整 URL 或主机名。";
      setWebAccessPublicBaseUrlError(message);
      setWebAccessNotice(message, true);
      return;
    }
    setWebAccessPublicBaseUrlError(null);
    setWebAccessPublicBaseUrlDraft(normalized ?? "");
    await persistSettingsPatch(
      { webAccessPublicBaseUrl: normalized },
      normalized ? "外部访问地址已保存。" : "已清空外部访问地址。",
    );
  };

  useEffect(() => {
    if (mobilePlatform) {
      return;
    }
    handleRefreshWebAccessStatus();
  }, [
    appSettings.remoteBackendToken,
    appSettings.webAccessEnabled,
    appSettings.webAccessListenAddr,
    appSettings.webAccessPort,
    handleRefreshWebAccessStatus,
    mobilePlatform,
  ]);

  const updateActiveRemoteBackend = useCallback(
    async (patch: Partial<RemoteBackendTarget>) => {
      const latestSettings = latestSettingsRef.current;
      const active = getActiveRemoteBackend(latestSettings);
      const nextBackends = [...getConfiguredRemoteBackends(latestSettings)];
      const activeIndex = nextBackends.findIndex((entry) => entry.id === active.id);
      const safeIndex = activeIndex >= 0 ? activeIndex : 0;
      nextBackends[safeIndex] = {
        ...nextBackends[safeIndex],
        ...patch,
        provider: "tcp",
      };
      await persistRemoteBackends(nextBackends, nextBackends[safeIndex].id);
    },
    [persistRemoteBackends],
  );

  const applyRemoteHost = async (rawValue: string) => {
    const nextHost = rawValue.trim();
    const validationError = validateRemoteHost(nextHost);
    if (validationError) {
      setRemoteHostError(validationError);
      setRemoteStatus(validationError, true);
      return false;
    }
    const normalizedHost = nextHost || DEFAULT_REMOTE_HOST;
    setRemoteHostError(null);
    setRemoteHostDraft(normalizedHost);
    await updateActiveRemoteBackend({ host: normalizedHost });
    setRemoteStatus("远程主机已保存。");
    return true;
  };

  const handleCommitRemoteName = async () => {
    const latestSettings = latestSettingsRef.current;
    const active = getActiveRemoteBackend(latestSettings);
    const nextName = remoteNameDraft.trim();
    if (!nextName) {
      const message = "名称不能为空。";
      setRemoteNameError(message);
      setRemoteStatus(message, true);
      return;
    }
    const duplicate = getConfiguredRemoteBackends(latestSettings).some(
      (entry) => entry.id !== active.id && entry.name.trim().toLowerCase() === nextName.toLowerCase(),
    );
    if (duplicate) {
      const message = `名为“${nextName}”的远程配置已存在。`;
      setRemoteNameError(message);
      setRemoteStatus(message, true);
      return;
    }
    setRemoteNameError(null);
    setRemoteNameDraft(nextName);
    await updateActiveRemoteBackend({ name: nextName });
    setRemoteStatus(`远程名称“${nextName}”已保存。`);
  };

  const handleCommitRemoteHost = async () => {
    await applyRemoteHost(remoteHostDraft);
  };

  const handleCommitRemoteToken = async () => {
    const nextToken = remoteTokenDraft.trim() ? remoteTokenDraft.trim() : null;
    setRemoteTokenDraft(nextToken ?? "");
    await updateActiveRemoteBackend({ token: nextToken });
    setRemoteStatus("远程令牌已保存。");
  };

  /**
   * 为当前远程配置生成并保存新的随机令牌。
   *
   * 无入参；生成前要求 Web 服务已关闭，避免旧守护进程继续持有过期令牌。
   */
  const handleGenerateRemoteToken = async () => {
    if (remoteTokenGenerationBlockedReason) {
      setRemoteStatus(remoteTokenGenerationBlockedReason, true);
      return;
    }
    try {
      const nextToken = createRandomRemoteToken();
      setRemoteTokenDraft(nextToken);
      await updateActiveRemoteBackend({ token: nextToken });
      setRemoteStatus("已生成新的远程令牌并保存。");
    } catch (error) {
      const message = formatErrorMessage(error, "无法生成新的远程令牌。");
      setRemoteStatus(message, true);
    }
  };

  const handleSelectRemoteBackend = async (id: string) => {
    const latestSettings = latestSettingsRef.current;
    const candidates = getConfiguredRemoteBackends(latestSettings);
    const selected = candidates.find((entry) => entry.id === id);
    if (!selected) {
      return;
    }
    await persistRemoteBackends(candidates, id);
    setRemoteStatus(`当前远程配置已切换为“${selected.name}”。`);
  };

  const handleAddRemoteBackend = async (draft: AddRemoteBackendDraft) => {
    const latestSettings = latestSettingsRef.current;
    const existingBackends = getConfiguredRemoteBackends(latestSettings);
    const nextName = draft.name.trim();
    if (!nextName) {
      const message = "名称不能为空。";
      setRemoteStatus(message, true);
      throw new Error(message);
    }
    const duplicate = existingBackends.some(
      (entry) => entry.name.trim().toLowerCase() === nextName.toLowerCase(),
    );
    if (duplicate) {
      const message = `名为“${nextName}”的远程配置已存在。`;
      setRemoteStatus(message, true);
      throw new Error(message);
    }
    const nextHost = draft.host.trim();
    const hostError = validateRemoteHost(nextHost);
    if (hostError) {
      setRemoteStatus(hostError, true);
      throw new Error(hostError);
    }
    const nextToken = draft.token.trim() ? draft.token.trim() : null;
    if (!nextToken) {
      const message = "远程后端令牌不能为空。";
      setRemoteStatus(message, true);
      throw new Error(message);
    }

    const nextId = createRemoteBackendId();
    const nextRemote: RemoteBackendTarget = {
      id: nextId,
      name: nextName,
      provider: "tcp",
      host: nextHost,
      token: nextToken,
      lastConnectedAtMs: null,
    };

    const previousSettings = latestSettings;
    const candidateBackends = [...existingBackends, nextRemote];
    const candidateSettings = buildSettingsFromRemoteBackends(
      previousSettings,
      candidateBackends,
      nextId,
    );

    let candidatePersisted = false;
    try {
      await onUpdateAppSettings(candidateSettings);
      latestSettingsRef.current = candidateSettings;
      candidatePersisted = true;

      const workspaces = await listWorkspaces();
      const workspaceCount = workspaces.length;
      const connectedBackends = candidateBackends.map((entry) =>
        entry.id === nextId ? { ...entry, lastConnectedAtMs: Date.now() } : entry,
      );
      const connectedSettings = buildSettingsFromRemoteBackends(
        candidateSettings,
        connectedBackends,
        nextId,
      );
      await onUpdateAppSettings(connectedSettings);
      latestSettingsRef.current = connectedSettings;
      setRemoteStatus(
        `已添加并连接“${nextName}”。远程后端当前可访问 ${workspaceCount} 个工作区。`,
      );
      await onMobileConnectSuccess?.();
    } catch (error) {
      if (candidatePersisted) {
        try {
          await onUpdateAppSettings(previousSettings);
          latestSettingsRef.current = previousSettings;
        } catch {
          // Keep the original connection error surfaced below.
        }
      }
      const message = formatErrorMessage(error, "无法连接新的远程后端。");
      setRemoteStatus(message, true);
      throw new Error(message);
    }
  };

  const handleSetRemoteNameDraft: Dispatch<SetStateAction<string>> = (value) => {
    setRemoteNameError(null);
    setRemoteStatus(null);
    setRemoteNameDraft((previous) => (typeof value === "function" ? value(previous) : value));
  };

  const handleSetRemoteHostDraft: Dispatch<SetStateAction<string>> = (value) => {
    setRemoteHostError(null);
    setRemoteStatus(null);
    setRemoteHostDraft((previous) => (typeof value === "function" ? value(previous) : value));
  };

  const handleSetRemoteTokenDraft: Dispatch<SetStateAction<string>> = (value) => {
    setRemoteStatus(null);
    setRemoteTokenDraft((previous) => (typeof value === "function" ? value(previous) : value));
  };

  const handleSetWebAccessListenAddrDraft: Dispatch<SetStateAction<string>> = (value) => {
    setWebAccessListenAddrError(null);
    setWebAccessNotice(null);
    setWebAccessListenAddrDraft((previous) =>
      typeof value === "function" ? value(previous) : value,
    );
  };

  const handleSetWebAccessPortDraft: Dispatch<SetStateAction<string>> = (value) => {
    setWebAccessPortError(null);
    setWebAccessNotice(null);
    setWebAccessPortDraft((previous) =>
      typeof value === "function" ? value(previous) : value,
    );
  };

  const handleSetWebAccessPublicBaseUrlDraft: Dispatch<SetStateAction<string>> = (value) => {
    setWebAccessPublicBaseUrlError(null);
    setWebAccessNotice(null);
    setWebAccessPublicBaseUrlDraft((previous) =>
      typeof value === "function" ? value(previous) : value,
    );
  };

  const handleMoveRemoteBackend = async (id: string, direction: "up" | "down") => {
    const latestSettings = latestSettingsRef.current;
    const nextBackends = [...getConfiguredRemoteBackends(latestSettings)];
    const index = nextBackends.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return;
    }
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= nextBackends.length) {
      return;
    }
    const entry = nextBackends[index];
    nextBackends[index] = nextBackends[targetIndex];
    nextBackends[targetIndex] = entry;
    await persistRemoteBackends(nextBackends);
    setRemoteStatus(
      direction === "up"
        ? `已将“${entry.name}”上移。`
        : `已将“${entry.name}”下移。`,
    );
  };

  const handleDeleteRemoteBackend = async (id: string) => {
    const latestSettings = latestSettingsRef.current;
    const existingBackends = getConfiguredRemoteBackends(latestSettings);
    if (existingBackends.length <= 1) {
      setRemoteStatus("至少需要保留一个远程配置。", true);
      return;
    }
    const index = existingBackends.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return;
    }
    const removed = existingBackends[index];
    const remaining = existingBackends.filter((entry) => entry.id !== id);
    const nextActiveId =
      latestSettings.activeRemoteBackendId === id
        ? remaining[Math.min(index, remaining.length - 1)]?.id ?? remaining[0]?.id ?? null
        : latestSettings.activeRemoteBackendId;
    await persistRemoteBackends(remaining, nextActiveId);
    setRemoteStatus(`已删除“${removed.name}”。`);
  };

  const handleMobileConnectTest = () => {
    void (async () => {
      const nextToken = remoteTokenDraft.trim() ? remoteTokenDraft.trim() : null;
      setRemoteTokenDraft(nextToken ?? "");

      if (!nextToken) {
        setMobileConnectStatusError(true);
        setMobileConnectStatusText("远程后端令牌不能为空。");
        return;
      }

      const hostError = validateRemoteHost(remoteHostDraft);
      if (hostError) {
        setRemoteHostError(hostError);
        setMobileConnectStatusError(true);
        setMobileConnectStatusText(hostError);
        return;
      }

      setMobileConnectBusy(true);
      setMobileConnectStatusText(null);
      setMobileConnectStatusError(false);
      try {
        const nextHost = remoteHostDraft.trim() || DEFAULT_REMOTE_HOST;
        setRemoteHostDraft(nextHost);
        await updateActiveRemoteBackend({
          host: nextHost,
          token: nextToken,
        });

        const workspaces = await listWorkspaces();
        const workspaceCount = workspaces.length;
        try {
          await updateActiveRemoteBackend({ lastConnectedAtMs: Date.now() });
        } catch {
          // Keep successful connectivity outcome even if timestamp persistence fails.
        }
        setMobileConnectStatusText(
          `连接成功。远程后端当前可访问 ${workspaceCount} 个工作区。`,
        );
        await onMobileConnectSuccess?.();
      } catch (error) {
        setMobileConnectStatusError(true);
        setMobileConnectStatusText(
          error instanceof Error ? error.message : "无法连接远程后端。",
        );
      } finally {
        setMobileConnectBusy(false);
      }
    })();
  };

  useEffect(() => {
    if (!mobilePlatform) {
      return;
    }
    setMobileConnectStatusText(null);
    setMobileConnectStatusError(false);
  }, [mobilePlatform, remoteHostDraft, remoteTokenDraft]);

  const handleRefreshTailscaleStatus = useCallback(() => {
    void (async () => {
      setTailscaleStatusBusy(true);
      setTailscaleStatusError(null);
      try {
        const status = await fetchTailscaleStatus();
        setTailscaleStatus(status);
      } catch (error) {
        setTailscaleStatusError(
          formatErrorMessage(error, "无法加载 Tailscale 状态。"),
        );
      } finally {
        setTailscaleStatusBusy(false);
      }
    })();
  }, []);

  const handleRefreshTailscaleCommandPreview = useCallback(() => {
    void (async () => {
      setTailscaleCommandBusy(true);
      setTailscaleCommandError(null);
      try {
        const preview = await fetchTailscaleDaemonCommandPreview();
        setTailscaleCommandPreview(preview);
      } catch (error) {
        setTailscaleCommandError(
          formatErrorMessage(error, "无法生成 Tailscale 守护进程命令。"),
        );
      } finally {
        setTailscaleCommandBusy(false);
      }
    })();
  }, []);

  const handleUseSuggestedTailscaleHost = async () => {
    const suggestedHost = tailscaleStatus?.suggestedRemoteHost ?? null;
    if (!suggestedHost) {
      return;
    }
    await applyRemoteHost(suggestedHost);
  };

  const runTcpDaemonAction = useCallback(
    async (
      action: "start" | "stop" | "status",
      run: () => Promise<TcpDaemonStatus>,
    ) => {
      setTcpDaemonBusyAction(action);
      try {
        const status = await run();
        setTcpDaemonStatus(status);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "无法更新移动端访问守护进程状态。";
        setTcpDaemonStatus((prev) => ({
          state: "error",
          pid: null,
          startedAtMs: null,
          lastError: errorMessage,
          listenAddr: prev?.listenAddr ?? null,
        }));
      } finally {
        setTcpDaemonBusyAction(null);
      }
    },
    [],
  );

  const handleTcpDaemonStart = useCallback(async () => {
    await runTcpDaemonAction("start", tailscaleDaemonStart);
  }, [runTcpDaemonAction]);

  const handleTcpDaemonStop = useCallback(async () => {
    await runTcpDaemonAction("stop", tailscaleDaemonStop);
  }, [runTcpDaemonAction]);

  const handleTcpDaemonStatus = useCallback(async () => {
    await runTcpDaemonAction("status", tailscaleDaemonStatus);
  }, [runTcpDaemonAction]);

  useEffect(() => {
    if (!mobilePlatform) {
      handleRefreshTailscaleCommandPreview();
      void handleTcpDaemonStatus();
    }
    if (tailscaleStatus === null && !tailscaleStatusBusy && !tailscaleStatusError) {
      handleRefreshTailscaleStatus();
    }
  }, [
    appSettings.remoteBackendToken,
    handleRefreshTailscaleCommandPreview,
    handleRefreshTailscaleStatus,
    handleTcpDaemonStatus,
    mobilePlatform,
    tailscaleStatus,
    tailscaleStatusBusy,
    tailscaleStatusError,
  ]);

  return {
    appSettings,
    onUpdateAppSettings,
    remoteBackends: getConfiguredRemoteBackends(appSettings),
    activeRemoteBackendId:
      appSettings.activeRemoteBackendId ?? getConfiguredRemoteBackends(appSettings)[0]?.id ?? null,
    remoteStatusText,
    remoteStatusError,
    remoteNameError,
    remoteHostError,
    remoteNameDraft,
    remoteHostDraft,
    remoteTokenDraft,
    remoteTokenGenerationBlockedReason,
    nextRemoteNameSuggestion: buildNextRemoteName(getConfiguredRemoteBackends(appSettings)),
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
    onSetRemoteNameDraft: handleSetRemoteNameDraft,
    onSetRemoteHostDraft: handleSetRemoteHostDraft,
    onSetRemoteTokenDraft: handleSetRemoteTokenDraft,
    onSetWebAccessListenAddrDraft: handleSetWebAccessListenAddrDraft,
    onSetWebAccessPortDraft: handleSetWebAccessPortDraft,
    onSetWebAccessPublicBaseUrlDraft: handleSetWebAccessPublicBaseUrlDraft,
    onCommitRemoteName: handleCommitRemoteName,
    onCommitRemoteHost: handleCommitRemoteHost,
    onCommitRemoteToken: handleCommitRemoteToken,
    onGenerateRemoteToken: handleGenerateRemoteToken,
    onToggleWebAccessEnabled: handleToggleWebAccessEnabled,
    onCommitWebAccessListenAddr: handleCommitWebAccessListenAddr,
    onCommitWebAccessPort: handleCommitWebAccessPort,
    onCommitWebAccessPublicBaseUrl: handleCommitWebAccessPublicBaseUrl,
    onSelectRemoteBackend: handleSelectRemoteBackend,
    onAddRemoteBackend: handleAddRemoteBackend,
    onMoveRemoteBackend: handleMoveRemoteBackend,
    onDeleteRemoteBackend: handleDeleteRemoteBackend,
    onRefreshWebAccessStatus: handleRefreshWebAccessStatus,
    onRefreshTailscaleStatus: handleRefreshTailscaleStatus,
    onRefreshTailscaleCommandPreview: handleRefreshTailscaleCommandPreview,
    onUseSuggestedTailscaleHost: handleUseSuggestedTailscaleHost,
    onTcpDaemonStart: handleTcpDaemonStart,
    onTcpDaemonStop: handleTcpDaemonStop,
    onTcpDaemonStatus: handleTcpDaemonStatus,
    isMobilePlatform: mobilePlatform,
    mobileConnectBusy,
    mobileConnectStatusText,
    mobileConnectStatusError,
    onMobileConnectTest: handleMobileConnectTest,
  };
};
