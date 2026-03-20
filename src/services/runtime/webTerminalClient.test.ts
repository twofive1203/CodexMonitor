// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  /**
   * 模拟浏览器 WebSocket 发送文本消息。
   *
   * `data`：待发送的原始文本消息。
   */
  send(data: string) {
    this.sent.push(data);
  }

  /**
   * 模拟浏览器主动关闭连接。
   *
   * `code`：关闭码；`reason`：关闭原因。
   */
  close(code = 1000, reason = "") {
    this.emitClose(code, reason);
  }

  /**
   * 触发连接建立成功事件。
   *
   * 无入参，模拟底层 `onopen` 回调。
   */
  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  /**
   * 触发服务端下发消息事件。
   *
   * `data`：服务端返回的原始消息文本。
   */
  emitMessage(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  /**
   * 触发连接错误事件。
   *
   * 无入参，仅模拟浏览器 `onerror`。
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
   * 清理当前测试中的所有伪造 socket 实例。
   *
   * 无入参，供每个测试用例收尾。
   */
  static reset() {
    MockWebSocket.instances = [];
  }
}

describe("webTerminalClient", () => {
  beforeEach(() => {
    vi.resetModules();
    MockWebSocket.reset();
    Object.defineProperty(globalThis, "WebSocket", {
      value: MockWebSocket,
      writable: true,
      configurable: true,
    });
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/app");
  });

  afterEach(async () => {
    const module = await import("./webTerminalClient");
    module.disconnectWebTerminalClient("test cleanup");
    MockWebSocket.reset();
  });

  it("rejects terminal commands when websocket handshake closes before open", async () => {
    const { invokeWebTerminalCommand } = await import("./webTerminalClient");

    const promise = invokeWebTerminalCommand("terminal_open", {
      workspaceId: "ws-1",
      terminalId: "term-1",
      cols: 80,
      rows: 24,
    });

    const socket = MockWebSocket.instances[0];
    expect(socket?.url).toContain("/api/ws/terminal?clientId=");

    socket.emitError();
    socket.emitClose(1006);

    await expect(promise).rejects.toThrow("terminal websocket connection failed (1006)");
  });

  it("surfaces daemon terminal errors back to the caller", async () => {
    const { invokeWebTerminalCommand } = await import("./webTerminalClient");

    const promise = invokeWebTerminalCommand("terminal_open", {
      workspaceId: "ws-1",
      terminalId: "term-1",
      cols: 80,
      rows: 24,
    });

    const socket = MockWebSocket.instances[0];
    socket.emitOpen();
    await Promise.resolve();

    expect(socket.sent).toHaveLength(1);

    socket.emitMessage('{"id":1,"error":{"message":"未知工作区。"}}');

    await expect(promise).rejects.toThrow("未知工作区。");
  });
});
