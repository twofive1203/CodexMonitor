// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingCenter } from "./PendingCenter";
import type { ApprovalRequest, RequestUserInputRequest, WorkspaceInfo } from "../../../types";

afterEach(() => {
  cleanup();
});

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Demo",
  path: "D:/demo",
  connected: true,
  settings: { sidebarCollapsed: false },
};

/**
 * 创建待处理中心测试用审批请求。
 * @param threadId 审批请求关联的线程 ID。
 */
function createApproval(threadId: string): ApprovalRequest {
  return {
    workspace_id: "ws-1",
    request_id: "approval-1",
    method: "codex/requestApproval/exec",
    params: { thread_id: threadId },
  };
}

/**
 * 创建待处理中心测试用用户输入请求。
 * @param threadId 用户输入请求关联的线程 ID。
 */
function createUserInputRequest(threadId: string): RequestUserInputRequest {
  return {
    workspace_id: "ws-1",
    request_id: "input-1",
    params: {
      thread_id: threadId,
      turn_id: "turn-1",
      item_id: "item-1",
      questions: [
        {
          id: "q-1",
          header: "Mode",
          question: "Pick one",
          options: [{ label: "A", description: "Option A" }],
        },
      ],
    },
  };
}

describe("PendingCenter", () => {
  it("opens the related thread from pending approvals and user input", () => {
    const onSelectThread = vi.fn();

    render(
      <PendingCenter
        approvals={[createApproval("thread-1")]}
        userInputRequests={[createUserInputRequest("thread-2")]}
        workspaces={[workspace]}
        activeWorkspaceId="ws-1"
        accountInfo={{
          type: "chatgpt",
          email: "demo@example.com",
          planType: null,
          requiresOpenaiAuth: null,
        }}
        accountDisabled={false}
        onSelectThread={onSelectThread}
        onSwitchAccount={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /需要审批/ }));
    fireEvent.click(screen.getByRole("button", { name: /需要补充信息/ }));

    expect(onSelectThread).toHaveBeenNthCalledWith(1, "ws-1", "thread-1");
    expect(onSelectThread).toHaveBeenNthCalledWith(2, "ws-1", "thread-2");
  });

  it("shows account login as a pending item when no account is loaded", () => {
    const onSwitchAccount = vi.fn();

    render(
      <PendingCenter
        approvals={[]}
        userInputRequests={[]}
        workspaces={[workspace]}
        activeWorkspaceId="ws-1"
        accountInfo={null}
        accountDisabled={false}
        onSelectThread={vi.fn()}
        onSwitchAccount={onSwitchAccount}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /需要登录账号/ }));

    expect(onSwitchAccount).toHaveBeenCalledTimes(1);
  });
});
