// @vitest-environment jsdom

import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceRestore } from "./useWorkspaceRestore";
import type { WorkspaceInfo } from "../../../types";

function buildWorkspace(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    id: "ws-1",
    name: "workspace-1",
    path: "D:/workspace/project",
    connected: false,
    provider: "codex",
    kind: "main",
    parentId: null,
    worktree: null,
    settings: {
      sidebarCollapsed: false,
      sortOrder: null,
      groupId: null,
      cloneSourceWorkspaceId: null,
      gitRoot: null,
      launchScript: null,
      launchScripts: null,
      worktreeSetupScript: null,
      worktreesFolder: null,
    },
    ...overrides,
  };
}

describe("useWorkspaceRestore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries failed workspace restoration and loads thread history after recovery", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });
    const workspace = buildWorkspace();
    const connectWorkspace = vi
      .fn<(workspace: WorkspaceInfo) => Promise<void>>()
      .mockRejectedValueOnce(new Error("connect failed"))
      .mockResolvedValue(undefined);
    const listThreadsForWorkspaces = vi
      .fn<(workspaces: WorkspaceInfo[]) => Promise<void>>()
      .mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspaceRestore({
        workspaces: [workspace],
        hasLoaded: true,
        connectWorkspace,
        listThreadsForWorkspaces,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(connectWorkspace).toHaveBeenCalledTimes(1);
    expect(listThreadsForWorkspaces).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.resolve();
    });

    expect(connectWorkspace).toHaveBeenCalledTimes(2);
    expect(listThreadsForWorkspaces).toHaveBeenCalledWith(
      [{ ...workspace, connected: true }],
      { maxPages: 6 },
    );
  });
});
