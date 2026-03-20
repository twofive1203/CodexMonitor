import type { AppSettings, WorkspaceInfo } from "@/types";
import {
  WEB_RUNTIME_CAPABILITIES,
  mergeRuntimeCapabilities,
  type RuntimeCapabilities,
} from "./capabilities";
import type { RuntimeEventName, RuntimeSubscribeOptions } from "./events";
import type { RuntimeClient, RuntimeUnsubscribe } from "./tauriClient";
import {
  disconnectWebTerminalClient,
  invokeWebTerminalCommand,
  subscribeWebTerminalEvent,
} from "./webTerminalClient";

type WebBootstrapPayload = {
  app?: {
    name?: string;
    version?: string;
  };
  capabilities?: Partial<Omit<RuntimeCapabilities, "kind">> | null;
  settings: AppSettings;
  workspaces: WorkspaceInfo[];
};

type SessionState = {
  resolved: boolean;
  authenticated: boolean;
};

const SESSION_EVENT_NAME = "codexmonitor:web-session-changed";
const WEBSOCKET_EVENT_NAMES = new Set<RuntimeEventName>(["app-server-event"]);
const TERMINAL_EVENT_NAMES = new Set<RuntimeEventName>(["terminal-output", "terminal-exit"]);
const TERMINAL_COMMANDS = new Set([
  "terminal_open",
  "terminal_write",
  "terminal_resize",
  "terminal_close",
]);

let sessionState: SessionState = {
  resolved: false,
  authenticated: false,
};
let bootstrapCache: WebBootstrapPayload | null = null;
let bootstrapPromise: Promise<WebBootstrapPayload> | null = null;
let bootstrapHydration = {
  settings: false,
  workspaces: false,
};
const listeners = new Map<RuntimeEventName, Set<(payload: unknown) => void>>();
let socket: WebSocket | null = null;
let socketConnectPromise: Promise<void> | null = null;
let reconnectTimer: number | null = null;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emitSessionState() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(SESSION_EVENT_NAME, {
      detail: {
        ...sessionState,
      },
    }),
  );
}

function setSessionState(next: SessionState) {
  sessionState = next;
  emitSessionState();
}

function resetBootstrapCache() {
  bootstrapCache = null;
  bootstrapPromise = null;
  bootstrapHydration = {
    settings: false,
    workspaces: false,
  };
}

function clearReconnectTimer() {
  if (reconnectTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(reconnectTimer);
  }
  reconnectTimer = null;
}

function disconnectSocket() {
  clearReconnectTimer();
  socketConnectPromise = null;
  if (socket) {
    try {
      socket.close();
    } catch {
      // 忽略浏览器在关闭中的竞态错误。
    }
  }
  socket = null;
}

function webHttpUrl(path: string) {
  return new URL(path, window.location.href).toString();
}

function webSocketUrl(path: string) {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function hasActiveWebSocketListener() {
  return Array.from(listeners.entries()).some(
    ([eventName, entries]) => WEBSOCKET_EVENT_NAMES.has(eventName) && entries.size > 0,
  );
}

function dispatchWebSocketEvent(eventName: RuntimeEventName, payload: unknown) {
  const entries = listeners.get(eventName);
  if (!entries || entries.size === 0) {
    return;
  }
  entries.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.error(`[runtime:web] ${eventName} listener failed`, error);
    }
  });
}

function updateBootstrapCacheAfterRpc(
  method: string,
  result: unknown,
  args?: Record<string, unknown>,
) {
  if (!bootstrapCache) {
    return;
  }

  if (method === "update_app_settings" && result && typeof result === "object") {
    bootstrapCache = {
      ...bootstrapCache,
      settings: applyWebRuntimeSettings(result as AppSettings),
    };
    return;
  }

  if (method === "connect_workspace") {
    const workspaceId = typeof args?.id === "string" ? args.id : null;
    if (!workspaceId) {
      return;
    }
    bootstrapCache = {
      ...bootstrapCache,
      workspaces: bootstrapCache.workspaces.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, connected: true } : workspace,
      ),
    };
    return;
  }

  if (
    (method === "add_workspace" ||
      method === "add_workspace_from_git_url" ||
      method === "update_workspace_settings") &&
    result &&
    typeof result === "object"
  ) {
    const workspace = result as WorkspaceInfo;
    const existingIndex = bootstrapCache.workspaces.findIndex(
      (entry) => entry.id === workspace.id,
    );
    if (existingIndex >= 0) {
      const nextWorkspaces = [...bootstrapCache.workspaces];
      nextWorkspaces[existingIndex] = workspace;
      bootstrapCache = {
        ...bootstrapCache,
        workspaces: nextWorkspaces,
      };
    } else {
      bootstrapCache = {
        ...bootstrapCache,
        workspaces: [...bootstrapCache.workspaces, workspace],
      };
    }
    return;
  }

  if (method === "remove_workspace" || method === "remove_worktree") {
    const workspaceId = typeof args?.id === "string" ? args.id : null;
    if (!workspaceId) {
      return;
    }
    bootstrapCache = {
      ...bootstrapCache,
      workspaces: bootstrapCache.workspaces.filter(
        (workspace) =>
          workspace.id !== workspaceId && workspace.parentId !== workspaceId,
      ),
    };
  }
}

function applyWebRuntimeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    backendMode: "remote",
    automaticAppUpdateChecksEnabled: false,
    dictationEnabled: false,
    showMessageFilePath: false,
  };
}

function getCachedCapabilities(): RuntimeCapabilities {
  return mergeRuntimeCapabilities(
    WEB_RUNTIME_CAPABILITIES,
    bootstrapCache?.capabilities ?? null,
  );
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  const hasBody = init?.body !== undefined && init?.body !== null;
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(webHttpUrl(path), {
    credentials: "include",
    ...init,
    headers,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload =
    contentType.includes("application/json") && response.status !== 204
      ? ((await response.json()) as T & { error?: { message?: string } })
      : (null as unknown as T & { error?: { message?: string } });
  if (response.status === 401) {
    resetBootstrapCache();
    disconnectSocket();
    disconnectWebTerminalClient("session required");
    setSessionState({
      resolved: true,
      authenticated: false,
    });
    throw new WebSessionRequiredError("session required");
  }
  if (!response.ok) {
    const message =
      payload?.error?.message ??
      `${response.status} ${response.statusText}`.trim();
    throw new Error(message);
  }
  return payload;
}

function ensureWebSocketConnection(options?: RuntimeSubscribeOptions) {
  if (
    typeof window === "undefined" ||
    socket ||
    socketConnectPromise ||
    !sessionState.authenticated ||
    !hasActiveWebSocketListener()
  ) {
    return;
  }

  socketConnectPromise = new Promise<void>((resolve) => {
    const nextSocket = new WebSocket(webSocketUrl("/api/ws/events"));
    socket = nextSocket;

    nextSocket.onopen = () => {
      socketConnectPromise = null;
      resolve();
    };

    nextSocket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          method?: RuntimeEventName;
          params?: unknown;
        };
        if (!payload.method) {
          return;
        }
        dispatchWebSocketEvent(payload.method, payload.params ?? null);
      } catch (error) {
        console.error("[runtime:web] failed to parse websocket payload", error);
      }
    };

    nextSocket.onerror = (error) => {
      options?.onError?.(error);
    };

    nextSocket.onclose = () => {
      socket = null;
      socketConnectPromise = null;
      if (!sessionState.authenticated || !hasActiveWebSocketListener()) {
        return;
      }
      clearReconnectTimer();
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        ensureWebSocketConnection(options);
      }, 1000);
    };
  });
}

async function fetchBootstrap(force = false): Promise<WebBootstrapPayload> {
  if (bootstrapCache && !force) {
    return cloneJson(bootstrapCache);
  }
  if (bootstrapPromise && !force) {
    return bootstrapPromise.then((payload) => cloneJson(payload));
  }

  bootstrapPromise = requestJson<WebBootstrapPayload>("/api/bootstrap", {
    method: "GET",
  })
    .then((payload) => {
      const normalized: WebBootstrapPayload = {
        ...payload,
        settings: applyWebRuntimeSettings(payload.settings),
        workspaces: payload.workspaces ?? [],
      };
      bootstrapCache = normalized;
      bootstrapHydration = {
        settings: true,
        workspaces: true,
      };
      setSessionState({
        resolved: true,
        authenticated: true,
      });
      return normalized;
    })
    .finally(() => {
      bootstrapPromise = null;
    });

  return bootstrapPromise.then((payload) => cloneJson(payload));
}

async function invokeWebRuntime<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (TERMINAL_COMMANDS.has(command)) {
    return invokeWebTerminalCommand<T>(command, args);
  }
  if (command === "get_app_settings" && bootstrapHydration.settings && bootstrapCache) {
    bootstrapHydration.settings = false;
    return cloneJson(bootstrapCache.settings) as T;
  }
  if (command === "list_workspaces" && bootstrapHydration.workspaces && bootstrapCache) {
    bootstrapHydration.workspaces = false;
    return cloneJson(bootstrapCache.workspaces) as T;
  }
  if (command === "is_mobile_runtime") {
    return false as T;
  }
  if (command === "app_build_type") {
    return "release" as T;
  }
  if (command === "is_macos_debug_build") {
    return false as T;
  }
  if (command === "menu_set_accelerators") {
    return undefined as T;
  }
  if (command === "set_tray_recent_threads" || command === "set_tray_session_usage") {
    return undefined as T;
  }
  if (command === "send_notification_fallback") {
    return undefined as T;
  }
  if (command === "get_open_app_icon") {
    return null as T;
  }
  if (command === "dictation_request_permission") {
    return false as T;
  }
  if (command === "dictation_model_status") {
    return {
      state: "missing",
      modelId: typeof args?.modelId === "string" ? args.modelId : "base",
      error: "Web runtime 不支持听写。",
      path: null,
    } as T;
  }
  if (
    command === "dictation_download_model" ||
    command === "dictation_cancel_download" ||
    command === "dictation_remove_model"
  ) {
    return {
      state: "missing",
      modelId: typeof args?.modelId === "string" ? args.modelId : "base",
      error: "Web runtime 不支持听写。",
      path: null,
    } as T;
  }
  if (
    command === "dictation_start" ||
    command === "dictation_stop" ||
    command === "dictation_cancel"
  ) {
    return "idle" as T;
  }
  if (command === "codex_doctor") {
    return {
      ok: false,
      codexBin: null,
      version: null,
      appServerOk: true,
      details: "Web runtime 不支持本地环境探测。",
      path: null,
      nodeOk: false,
      nodeVersion: null,
      nodeDetails: "请在桌面端运行诊断。",
    } as T;
  }
  if (command === "codex_update") {
    return {
      ok: false,
      method: "unknown",
      package: null,
      beforeVersion: null,
      afterVersion: null,
      upgraded: false,
      output: null,
      details: "Web runtime 不支持自动更新 Codex CLI。",
    } as T;
  }

  const response = await requestJson<{ result: T; error?: { message?: string } }>(
    "/api/rpc",
    {
      method: "POST",
      body: JSON.stringify({
        method: command,
        params: args ?? {},
      }),
    },
  );
  const normalizedResult =
    command === "update_app_settings" &&
    response.result &&
    typeof response.result === "object"
      ? (applyWebRuntimeSettings(response.result as unknown as AppSettings) as T)
      : response.result;
  updateBootstrapCacheAfterRpc(command, normalizedResult, args);
  return normalizedResult;
}

async function subscribeWebRuntime<T>(
  eventName: RuntimeEventName,
  onEvent: (payload: T) => void,
  options?: RuntimeSubscribeOptions,
): Promise<RuntimeUnsubscribe> {
  if (TERMINAL_EVENT_NAMES.has(eventName)) {
    return subscribeWebTerminalEvent(eventName, (payload) => {
      onEvent(payload as T);
    }, options);
  }
  const current = listeners.get(eventName) ?? new Set<(payload: unknown) => void>();
  const wrapped = (payload: unknown) => {
    onEvent(payload as T);
  };
  current.add(wrapped);
  listeners.set(eventName, current);
  if (WEBSOCKET_EVENT_NAMES.has(eventName)) {
    ensureWebSocketConnection(options);
  }
  return () => {
    const entries = listeners.get(eventName);
    if (!entries) {
      return;
    }
    entries.delete(wrapped);
    if (entries.size === 0) {
      listeners.delete(eventName);
    }
    if (!hasActiveWebSocketListener()) {
      disconnectSocket();
    }
  };
}

export class WebSessionRequiredError extends Error {
  constructor(message = "session required") {
    super(message);
    this.name = "WebSessionRequiredError";
  }
}

/**
 * 登录 Web 会话并立即拉取 bootstrap。
 *
 * `token`：用户在 Web 登录页输入的远程访问 token。
 */
export async function loginWebSession(token: string) {
  await requestJson<{ ok: boolean }>("/api/session/login", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  setSessionState({
    resolved: true,
    authenticated: true,
  });
  await fetchBootstrap(true);
}

/**
 * 退出当前 Web 会话。
 *
 * 无入参，会清理本地 bootstrap 缓存和事件连接。
 */
export async function logoutWebSession() {
  await requestJson<{ ok: boolean }>("/api/session/logout", {
    method: "POST",
  }).catch(() => undefined);
  resetBootstrapCache();
  disconnectSocket();
  disconnectWebTerminalClient("session logged out");
  setSessionState({
    resolved: true,
    authenticated: false,
  });
}

/**
 * 确保当前浏览器已完成 bootstrap 初始化。
 *
 * `force`：为 `true` 时忽略缓存，强制重新拉取。
 */
export async function ensureWebBootstrap(force = false) {
  return fetchBootstrap(force);
}

/**
 * 返回当前缓存中的 Web bootstrap。
 *
 * 无入参；若尚未初始化则返回 `null`。
 */
export function getCachedWebBootstrap() {
  return bootstrapCache ? cloneJson(bootstrapCache) : null;
}

/**
 * 返回 Web 会话状态变更事件名。
 *
 * 无入参，供 React 壳层监听登录态变化。
 */
export function getWebSessionEventName() {
  return SESSION_EVENT_NAME;
}

/**
 * 返回当前 Web 会话状态。
 *
 * 无入参，返回是否已解析以及是否已认证。
 */
export function getWebSessionState() {
  return { ...sessionState };
}

export const webRuntimeClient: RuntimeClient = {
  kind: "web",
  getCapabilities: () => getCachedCapabilities(),
  invoke: invokeWebRuntime,
  subscribe: subscribeWebRuntime,
};
