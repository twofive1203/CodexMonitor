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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
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
      .fn<
        (
          workspaces: WorkspaceInfo[],
        ) => Promise<{ failedWorkspaceIds: string[] } | void>
      >()
      .mockResolvedValue({ failedWorkspaceIds: [] });

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

  it("loads history for multiple restored workspaces in one batch", async () => {
    const workspaceOne = buildWorkspace({ id: "ws-1", name: "workspace-1" });
    const workspaceTwo = buildWorkspace({
      id: "ws-2",
      name: "workspace-2",
      path: "D:/workspace/project-two",
      provider: "claude",
    });
    const connectWorkspace = vi
      .fn<(workspace: WorkspaceInfo) => Promise<void>>()
      .mockResolvedValue(undefined);
    const listThreadsForWorkspaces = vi
      .fn<
        (
          workspaces: WorkspaceInfo[],
        ) => Promise<{ failedWorkspaceIds: string[] } | void>
      >()
      .mockResolvedValue({ failedWorkspaceIds: [] });

    renderHook(() =>
      useWorkspaceRestore({
        workspaces: [workspaceOne, workspaceTwo],
        hasLoaded: true,
        connectWorkspace,
        listThreadsForWorkspaces,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(connectWorkspace).toHaveBeenCalledTimes(2);
    expect(listThreadsForWorkspaces).toHaveBeenCalledTimes(1);
    expect(listThreadsForWorkspaces).toHaveBeenCalledWith(
      [
        { ...workspaceOne, connected: true },
        { ...workspaceTwo, connected: true },
      ],
      { maxPages: 6 },
    );
  });

  it("retries only workspaces whose history refresh failed", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });
    const workspaceOne = buildWorkspace({ id: "ws-1", name: "workspace-1" });
    const workspaceTwo = buildWorkspace({
      id: "ws-2",
      name: "workspace-2",
      path: "D:/workspace/project-two",
      provider: "codex",
    });
    const connectWorkspace = vi
      .fn<(workspace: WorkspaceInfo) => Promise<void>>()
      .mockResolvedValue(undefined);
    const listThreadsForWorkspaces = vi
      .fn<
        (
          workspaces: WorkspaceInfo[],
        ) => Promise<{ failedWorkspaceIds: string[] } | void>
      >()
      .mockResolvedValueOnce({ failedWorkspaceIds: ["ws-2"] })
      .mockResolvedValueOnce({ failedWorkspaceIds: [] });

    renderHook(() =>
      useWorkspaceRestore({
        workspaces: [workspaceOne, workspaceTwo],
        hasLoaded: true,
        connectWorkspace,
        listThreadsForWorkspaces,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(connectWorkspace).toHaveBeenCalledTimes(2);
    expect(listThreadsForWorkspaces).toHaveBeenNthCalledWith(
      1,
      [
        { ...workspaceOne, connected: true },
        { ...workspaceTwo, connected: true },
      ],
      { maxPages: 6 },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(connectWorkspace).toHaveBeenCalledTimes(3);
    expect(connectWorkspace).toHaveBeenLastCalledWith(workspaceTwo);
    expect(listThreadsForWorkspaces).toHaveBeenNthCalledWith(
      2,
      [{ ...workspaceTwo, connected: true }],
      { maxPages: 6 },
    );
  });

  it("does not start a duplicate restore run while a workspace is already restoring", async () => {
    const workspace = buildWorkspace();
    const deferredConnect = createDeferred<void>();
    const connectWorkspace = vi
      .fn<(workspace: WorkspaceInfo) => Promise<void>>()
      .mockImplementation(() => deferredConnect.promise);
    const listThreadsForWorkspaces = vi
      .fn<
        (
          workspaces: WorkspaceInfo[],
        ) => Promise<{ failedWorkspaceIds: string[] } | void>
      >()
      .mockResolvedValue({ failedWorkspaceIds: [] });

    const { rerender } = renderHook(
      (props: { workspaces: WorkspaceInfo[] }) =>
        useWorkspaceRestore({
          workspaces: props.workspaces,
          hasLoaded: true,
          connectWorkspace,
          listThreadsForWorkspaces,
        }),
      {
        initialProps: { workspaces: [workspace] },
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(connectWorkspace).toHaveBeenCalledTimes(1);

    rerender({
      workspaces: [{ ...workspace, connected: true }],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(connectWorkspace).toHaveBeenCalledTimes(1);
    expect(listThreadsForWorkspaces).not.toHaveBeenCalled();

    await act(async () => {
      deferredConnect.resolve();
      await deferredConnect.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listThreadsForWorkspaces).toHaveBeenCalledTimes(1);
    expect(listThreadsForWorkspaces).toHaveBeenCalledWith(
      [{ ...workspace, connected: true }],
      { maxPages: 6 },
    );
  });
});
