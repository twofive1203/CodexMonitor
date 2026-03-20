import type { RuntimeEventName, RuntimeSubscribeOptions } from "./events";

type TerminalRuntimeEventName = "terminal-output" | "terminal-exit";

type TerminalListener = (payload: unknown) => void;

type PendingTerminalRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

const TERMINAL_EVENT_NAMES = new Set<TerminalRuntimeEventName>([
  "terminal-output",
  "terminal-exit",
]);
const TERMINAL_COMMANDS = new Set([
  "terminal_open",
  "terminal_write",
  "terminal_resize",
  "terminal_close",
]);
const TERMINAL_CLIENT_ID_STORAGE_KEY = "codexmonitor:web-terminal-client-id";

let terminalSocket: WebSocket | null = null;
let terminalConnectPromise: Promise<void> | null = null;
let terminalReconnectTimer: number | null = null;
let terminalRequestId = 0;
let terminalSocketOptions: RuntimeSubscribeOptions | undefined;
const pendingTerminalRequests = new Map<number, PendingTerminalRequest>();
const terminalListeners = new Map<TerminalRuntimeEventName, Set<TerminalListener>>();

function isBrowserRuntime() {
  return typeof window !== "undefined";
}

function createTerminalClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web-terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 返回浏览器终端复用的客户端标识。
 *
 * 无入参，优先从 `sessionStorage` 读取；不存在时自动生成并写回。
 */
export function getWebTerminalClientId() {
  if (!isBrowserRuntime()) {
    return "web-terminal-server";
  }
  try {
    const stored = window.sessionStorage.getItem(TERMINAL_CLIENT_ID_STORAGE_KEY)?.trim();
    if (stored) {
      return stored;
    }
    const nextId = createTerminalClientId();
    window.sessionStorage.setItem(TERMINAL_CLIENT_ID_STORAGE_KEY, nextId);
    return nextId;
  } catch {
    return createTerminalClientId();
  }
}

function hasActiveTerminalListeners() {
  return Array.from(terminalListeners.values()).some((entries) => entries.size > 0);
}

function hasTerminalActivity() {
  return hasActiveTerminalListeners() || pendingTerminalRequests.size > 0;
}

function clearTerminalReconnectTimer() {
  if (terminalReconnectTimer !== null && isBrowserRuntime()) {
    window.clearTimeout(terminalReconnectTimer);
  }
  terminalReconnectTimer = null;
}

function rejectPendingTerminalRequests(message: string) {
  pendingTerminalRequests.forEach(({ reject }) => reject(new Error(message)));
  pendingTerminalRequests.clear();
}

function scheduleTerminalReconnect() {
  if (!hasTerminalActivity()) {
    return;
  }
  clearTerminalReconnectTimer();
  terminalReconnectTimer = window.setTimeout(() => {
    terminalReconnectTimer = null;
    ensureTerminalConnection(terminalSocketOptions, hasTerminalActivity());
  }, 1000);
}

function buildTerminalSocketCloseMessage(event?: CloseEvent, phase: "connect" | "active" = "active") {
  const reason = event?.reason?.trim();
  if (reason) {
    return reason;
  }
  if (typeof event?.code === "number" && event.code !== 1000) {
    return phase === "connect"
      ? `terminal websocket connection failed (${event.code})`
      : `terminal websocket disconnected (${event.code})`;
  }
  return phase === "connect"
    ? "terminal websocket connection failed"
    : "terminal websocket disconnected";
}

function dispatchTerminalEvent(eventName: TerminalRuntimeEventName, payload: unknown) {
  const listeners = terminalListeners.get(eventName);
  if (!listeners || listeners.size === 0) {
    return;
  }
  listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.error(`[runtime:web-terminal] ${eventName} listener failed`, error);
    }
  });
}

function handleTerminalSocketMessage(raw: string) {
  let payload: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown };
  try {
    payload = JSON.parse(raw) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: unknown;
    };
  } catch (error) {
    console.error("[runtime:web-terminal] failed to parse websocket payload", error);
    return;
  }

  if (typeof payload.id === "number") {
    const pending = pendingTerminalRequests.get(payload.id);
    if (!pending) {
      return;
    }
    pendingTerminalRequests.delete(payload.id);
    if (payload.error?.message) {
      pending.reject(new Error(payload.error.message));
      return;
    }
    pending.resolve(payload.result ?? null);
    return;
  }

  if (payload.method && TERMINAL_EVENT_NAMES.has(payload.method as TerminalRuntimeEventName)) {
    dispatchTerminalEvent(payload.method as TerminalRuntimeEventName, payload.params ?? null);
  }
}

function ensureTerminalConnection(options?: RuntimeSubscribeOptions, force = false) {
  if (
    !isBrowserRuntime() ||
    terminalSocket ||
    terminalConnectPromise ||
    (!force && !hasTerminalActivity())
  ) {
    return;
  }

  terminalSocketOptions = options ?? terminalSocketOptions;
  const url = new URL("/api/ws/terminal", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("clientId", getWebTerminalClientId());

  terminalConnectPromise = new Promise<void>((resolve, reject) => {
    const nextSocket = new WebSocket(url.toString());
    let opened = false;
    terminalSocket = nextSocket;

    nextSocket.onopen = () => {
      opened = true;
      terminalConnectPromise = null;
      resolve();
    };

    nextSocket.onmessage = (event) => {
      handleTerminalSocketMessage(String(event.data));
    };

    nextSocket.onerror = (error) => {
      terminalSocketOptions?.onError?.(error);
    };

    nextSocket.onclose = (event) => {
      const disconnectMessage = buildTerminalSocketCloseMessage(
        event,
        opened ? "active" : "connect",
      );
      terminalSocket = null;
      terminalConnectPromise = null;
      if (!opened) {
        scheduleTerminalReconnect();
        reject(new Error(disconnectMessage));
        return;
      }
      rejectPendingTerminalRequests(disconnectMessage);
      scheduleTerminalReconnect();
    };
  });
  terminalConnectPromise.catch(() => undefined);
}

/**
 * 主动断开浏览器终端 WebSocket。
 *
 * `message`：断开后用于拒绝待处理请求的错误提示。
 */
export function disconnectWebTerminalClient(message = "terminal websocket disconnected") {
  clearTerminalReconnectTimer();
  terminalConnectPromise = null;
  if (terminalSocket) {
    try {
      terminalSocket.close();
    } catch {
      // 忽略关闭中的竞态错误。
    }
  }
  terminalSocket = null;
  rejectPendingTerminalRequests(message);
}

/**
 * 发送浏览器终端命令。
 *
 * `command`：终端命令名；`args`：命令参数对象；`options`：可选订阅错误处理。
 */
export async function invokeWebTerminalCommand<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: RuntimeSubscribeOptions,
): Promise<T> {
  if (!TERMINAL_COMMANDS.has(command)) {
    throw new Error(`unsupported terminal command: ${command}`);
  }
  ensureTerminalConnection(options, true);
  if (terminalConnectPromise) {
    await terminalConnectPromise;
  }
  if (!terminalSocket || terminalSocket.readyState !== WebSocket.OPEN) {
    throw new Error("terminal websocket unavailable");
  }

  const id = ++terminalRequestId;
  const payload = JSON.stringify({
    id,
    method: command,
    params: args ?? {},
  });

  return new Promise<T>((resolve, reject) => {
    pendingTerminalRequests.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    try {
      terminalSocket?.send(payload);
    } catch (error) {
      pendingTerminalRequests.delete(id);
      reject(error);
    }
  });
}

/**
 * 订阅浏览器终端事件。
 *
 * `eventName`：终端事件名；`listener`：事件处理函数；`options`：可选错误处理。
 */
export async function subscribeWebTerminalEvent(
  eventName: RuntimeEventName,
  listener: (payload: unknown) => void,
  options?: RuntimeSubscribeOptions,
) {
  if (!TERMINAL_EVENT_NAMES.has(eventName as TerminalRuntimeEventName)) {
    throw new Error(`unsupported terminal event: ${eventName}`);
  }
  const typedEventName = eventName as TerminalRuntimeEventName;
  const current = terminalListeners.get(typedEventName) ?? new Set<TerminalListener>();
  current.add(listener);
  terminalListeners.set(typedEventName, current);
  ensureTerminalConnection(options);

  return () => {
    const entries = terminalListeners.get(typedEventName);
    if (!entries) {
      return;
    }
    entries.delete(listener);
    if (entries.size === 0) {
      terminalListeners.delete(typedEventName);
    }
    if (!hasTerminalActivity()) {
      disconnectWebTerminalClient();
    }
  };
}
