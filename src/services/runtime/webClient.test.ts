// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent, AppSettings, WorkspaceInfo } from "@/types";

const disconnectWebTerminalClientMock = vi.hoisted(() => vi.fn());
const invokeWebTerminalCommandMock = vi.hoisted(() => vi.fn());
const subscribeWebTerminalEventMock = vi.hoisted(() => vi.fn());

vi.mock("./webTerminalClient", () => ({
  disconnectWebTerminalClient: (...args: unknown[]) =>
    disconnectWebTerminalClientMock(...args),
  invokeWebTerminalCommand: (...args: unknown[]) =>
    invokeWebTerminalCommandMock(...args),
  subscribeWebTerminalEvent: (...args: unknown[]) =>
    subscribeWebTerminalEventMock(...args),
}));

/**
 * 模拟浏览器事件 WebSocket。
 *
 * `url`：连接地址。
 *
 * 作者：lichong
 */
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  closeCalls = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  /**
   * 兼容浏览器 `WebSocket.send` 接口。
   *
   * `data`：待发送文本。
   */
  send(_data: string) {}

  /**
   * 模拟浏览器主动关闭连接。
   *
   * `code`：关闭码；`reason`：关闭原因。
   */
  close(code = 1000, reason = "") {
    this.closeCalls += 1;
    this.emitClose(code, reason);
  }

  /**
   * 触发连接建立事件。
   *
   * 无入参，仅模拟 `onopen`。
   */
  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  /**
   * 触发服务端消息事件。
   *
   * `data`：服务端发来的原始消息文本。
   */
  emitMessage(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  /**
   * 触发底层连接错误事件。
   *
   * 无入参，仅模拟 `onerror`。
   */
  emitError() {
    this.onerror?.(new Event("error"));
  }

  /**
   * 触发连接关闭事件。
   *
   * `code`：关闭码；`reason`：关闭原因。
   */
  emitClose(code = 1006, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code, reason }));
  }

  /**
   * 重置测试中缓存的 socket 实例。
   *
   * 无入参，供每个用例清理现场。
   */
  static reset() {
    MockWebSocket.instances = [];
  }
}

/**
 * 构造测试用 bootstrap 载荷。
 *
 * 无入参，返回 Web runtime 初始化所需的最小数据。
 */
function createBootstrapPayload() {
  return {
    settings: {
      backendMode: "remote",
      automaticAppUpdateChecksEnabled: true,
      dictationEnabled: true,
      showMessageFilePath: true,
    } as AppSettings,
    workspaces: [] as WorkspaceInfo[],
    capabilities: null,
  };
}

/**
 * 构造 JSON fetch 响应。
 *
 * `payload`：返回给调用方的 JSON 数据；`status`：HTTP 状态码。
 */
function createJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "application/json" : null,
    } as Headers,
    json: async () => payload,
  } as Response;
}

describe("webClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    MockWebSocket.reset();
    disconnectWebTerminalClientMock.mockReset();
    invokeWebTerminalCommandMock.mockReset();
    subscribeWebTerminalEventMock.mockReset();
    Object.defineProperty(globalThis, "WebSocket", {
      value: MockWebSocket,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, "fetch", {
      value: vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/api/bootstrap")) {
          return createJsonResponse(createBootstrapPayload());
        }
        if (url.includes("/api/session/logout")) {
          return createJsonResponse({ ok: true });
        }
        throw new Error(`Unexpected fetch request: ${url}`);
      }),
      writable: true,
      configurable: true,
    });
    window.history.replaceState({}, "", "/app");
  });

  afterEach(async () => {
    try {
      const module = await import("./webClient");
      await module.logoutWebSession();
    } catch {
      // Ignore cleanup races from failed imports.
    }
    MockWebSocket.reset();
    vi.useRealTimers();
  });

  it("fans out app-server websocket events to multiple subscribers with one socket", async () => {
    const module = await import("./webClient");
    await module.ensureWebBootstrap(true);

    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const cleanupFirst = await module.webRuntimeClient.subscribe<AppServerEvent>(
      "app-server-event",
      firstListener,
    );
    const cleanupSecond = await module.webRuntimeClient.subscribe<AppServerEvent>(
      "app-server-event",
      secondListener,
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    const socket = MockWebSocket.instances[0];
    expect(socket.url).toBe(new URL("/api/ws/events", window.location.href).toString().replace(/^http/, "ws"));

    socket.emitOpen();

    const payload: AppServerEvent = {
      workspace_id: "ws-1",
      message: {
        method: "thread/live_attached",
        thread_id: "thread-1",
      },
    };
    socket.emitMessage(
      JSON.stringify({
        method: "app-server-event",
        params: payload,
      }),
    );

    expect(firstListener).toHaveBeenCalledWith(payload);
    expect(secondListener).toHaveBeenCalledWith(payload);

    cleanupFirst();
    cleanupSecond();
    expect(socket.closeCalls).toBe(1);
  });

  it("reconnects the app-server websocket after disconnect when listeners remain active", async () => {
    const module = await import("./webClient");
    await module.ensureWebBootstrap(true);

    const onEvent = vi.fn();
    const cleanup = await module.webRuntimeClient.subscribe<AppServerEvent>(
      "app-server-event",
      onEvent,
    );

    const firstSocket = MockWebSocket.instances[0];
    firstSocket.emitOpen();
    firstSocket.emitClose(1006, "network lost");

    await vi.advanceTimersByTimeAsync(1000);

    expect(MockWebSocket.instances).toHaveLength(2);
    const secondSocket = MockWebSocket.instances[1];
    secondSocket.emitOpen();

    const payload: AppServerEvent = {
      workspace_id: "ws-remote",
      message: {
        method: "thread/started",
        thread: {
          id: "thread-2",
        },
      },
    };
    secondSocket.emitMessage(
      JSON.stringify({
        method: "app-server-event",
        params: payload,
      }),
    );

    expect(onEvent).toHaveBeenCalledWith(payload);
    cleanup();
  });

  it("stops reconnect scheduling after the last websocket listener unsubscribes", async () => {
    const module = await import("./webClient");
    await module.ensureWebBootstrap(true);

    const cleanup = await module.webRuntimeClient.subscribe<AppServerEvent>(
      "app-server-event",
      vi.fn(),
    );

    const socket = MockWebSocket.instances[0];
    socket.emitOpen();
    socket.emitClose(1006, "disconnect before unsubscribe");
    cleanup();

    await vi.advanceTimersByTimeAsync(1000);

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("keeps later app-server events flowing after malformed websocket payloads", async () => {
    const module = await import("./webClient");
    await module.ensureWebBootstrap(true);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onEvent = vi.fn();
    const cleanup = await module.webRuntimeClient.subscribe<AppServerEvent>(
      "app-server-event",
      onEvent,
    );

    const socket = MockWebSocket.instances[0];
    socket.emitOpen();
    socket.emitMessage("{invalid-json");

    const payload: AppServerEvent = {
      workspace_id: "ws-parse",
      message: {
        method: "thread/status/changed",
        thread_id: "thread-3",
      },
    };
    socket.emitMessage(
      JSON.stringify({
        method: "app-server-event",
        params: payload,
      }),
    );

    expect(errorSpy).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(payload);

    cleanup();
    errorSpy.mockRestore();
  });
});
