import { describe, expect, it, vi } from "vitest";
import type { AppServerEvent } from "../../../../types";
import { routeAppServerEvent } from "./routes";
import type { AppServerEventHandlers } from "./types";

/**
 * 方法说明：构造测试用 app-server 事件。
 * 入参说明：message 为事件消息体。
 */
function makeEvent(message: Record<string, unknown>): AppServerEvent {
  return {
    workspace_id: "ws-1",
    message,
  };
}

describe("appServerEventRouting", () => {
  it("ignores unsupported methods safely", () => {
    const handlers: AppServerEventHandlers = {
      onThreadStarted: vi.fn(),
      onApprovalRequest: vi.fn(),
    };
    const event = makeEvent({
      method: "unknown/method",
      params: { thread: { id: "thread-1" } },
    });

    routeAppServerEvent(
      event.workspace_id,
      "unknown/method",
      { thread: { id: "thread-1" } },
      handlers,
      event,
    );

    expect(handlers.onThreadStarted).not.toHaveBeenCalled();
    expect(handlers.onApprovalRequest).not.toHaveBeenCalled();
  });

  it("ignores invalid params without calling handlers", () => {
    const handlers: AppServerEventHandlers = {
      onAgentMessageDelta: vi.fn(),
      onHookStarted: vi.fn(),
      onThreadStatusChanged: vi.fn(),
    };

    routeAppServerEvent(
      "ws-1",
      "item/agentMessage/delta",
      { threadId: "thread-1", itemId: "", delta: "hello" },
      handlers,
      makeEvent({ method: "item/agentMessage/delta" }),
    );
    routeAppServerEvent(
      "ws-1",
      "hook/started",
      { threadId: "thread-1", run: [] },
      handlers,
      makeEvent({ method: "hook/started" }),
    );
    routeAppServerEvent(
      "ws-1",
      "thread/status/changed",
      { threadId: "", status: { type: "active" } },
      handlers,
      makeEvent({ method: "thread/status/changed" }),
    );

    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();
    expect(handlers.onHookStarted).not.toHaveBeenCalled();
    expect(handlers.onThreadStatusChanged).not.toHaveBeenCalled();
  });

  it("routes approval request suffix methods before supported-method checks", () => {
    const handlers: AppServerEventHandlers = {
      onApprovalRequest: vi.fn(),
    };
    const event = makeEvent({
      method: "item/mcp/requestApproval",
      id: "approval-1",
      params: { thread_id: "thread-1", tool_name: "shell" },
    });

    routeAppServerEvent(
      event.workspace_id,
      "item/mcp/requestApproval",
      { thread_id: "thread-1", tool_name: "shell" },
      handlers,
      event,
    );

    expect(handlers.onApprovalRequest).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      request_id: "approval-1",
      method: "item/mcp/requestApproval",
      params: { thread_id: "thread-1", tool_name: "shell" },
    });
  });

  it("normalizes request user input payloads", () => {
    const handlers: AppServerEventHandlers = {
      onRequestUserInput: vi.fn(),
    };
    const event = makeEvent({
      method: "item/tool/requestUserInput",
      id: 5,
      params: {},
    });

    routeAppServerEvent(
      event.workspace_id,
      "item/tool/requestUserInput",
      {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        questions: [
          { id: "", question: "skip me" },
          {
            id: "q-1",
            header: "Confirm",
            question: "Proceed?",
            is_other: true,
            options: [
              { label: "", description: "" },
              { label: "Yes", description: "Continue" },
            ],
          },
        ],
      },
      handlers,
      event,
    );

    expect(handlers.onRequestUserInput).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      request_id: 5,
      params: {
        thread_id: "thread-1",
        turn_id: "turn-1",
        item_id: "item-1",
        questions: [
          {
            id: "q-1",
            header: "Confirm",
            question: "Proceed?",
            isOther: true,
            options: [{ label: "Yes", description: "Continue" }],
          },
        ],
      },
    });
  });
});
