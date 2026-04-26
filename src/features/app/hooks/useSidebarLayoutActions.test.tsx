// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceInfo } from "../../../types";
import { useSidebarLayoutActions } from "./useSidebarLayoutActions";

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Workspace One",
  path: "/tmp/workspace-one",
  connected: true,
  settings: { sidebarCollapsed: false },
};

const claudeWorkspace: WorkspaceInfo = {
  id: "ws-claude",
  name: "Claude Workspace",
  path: "/tmp/claude-workspace",
  connected: true,
  provider: "claude",
  settings: { sidebarCollapsed: false },
};

describe("useSidebarLayoutActions", () => {
  it("keeps handlers referentially stable across unrelated rerenders", () => {
    const options = {
      openSettings: vi.fn(),
      resetPullRequestSelection: vi.fn(),
      clearDraftState: vi.fn(),
      clearDraftStateIfDifferentWorkspace: vi.fn(),
      selectHome: vi.fn(),
      exitDiffView: vi.fn(),
      selectWorkspace: vi.fn(),
      setActiveThreadId: vi.fn(),
      connectWorkspace: vi.fn(async () => {}),
      disconnectWorkspace: vi.fn(async () => {}),
      reloadWorkspaceSession: vi.fn(async () => {}),
      isCompact: false,
      setActiveTab: vi.fn(),
      workspacesById: new Map([[workspace.id, workspace]]),
      activeWorkspaceId: null,
      activeThreadId: null,
      updateWorkspaceSettings: vi.fn(async () => workspace),
      resetWorkspaceThreads: vi.fn(),
      removeThread: vi.fn(),
      clearDraftForThread: vi.fn(),
      removeImagesForThread: vi.fn(),
      refreshThread: vi.fn(async () => {}),
      handleRenameThread: vi.fn(),
      removeWorkspace: vi.fn(async () => {}),
      removeWorktree: vi.fn(async () => {}),
      loadOlderThreadsForWorkspace: vi.fn(async () => {}),
      listThreadsForWorkspace: vi.fn(async () => {}),
    } as const;

    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => {
        void tick;
        return useSidebarLayoutActions(options);
      },
      {
        initialProps: { tick: 0 },
      },
    );

    const firstRefs = {
      onSelectWorkspace: result.current.onSelectWorkspace,
      onSelectThread: result.current.onSelectThread,
      onDeleteThread: result.current.onDeleteThread,
      onLoadOlderThreads: result.current.onLoadOlderThreads,
    };

    rerender({ tick: 1 });

    expect(result.current.onSelectWorkspace).toBe(firstRefs.onSelectWorkspace);
    expect(result.current.onSelectThread).toBe(firstRefs.onSelectThread);
    expect(result.current.onDeleteThread).toBe(firstRefs.onDeleteThread);
    expect(result.current.onLoadOlderThreads).toBe(firstRefs.onLoadOlderThreads);
  });

  it("selects a workspace through the standard sidebar flow", () => {
    const exitDiffView = vi.fn();
    const resetPullRequestSelection = vi.fn();
    const clearDraftStateIfDifferentWorkspace = vi.fn();
    const selectWorkspace = vi.fn();
    const setActiveThreadId = vi.fn();
    const { result } = renderHook(() =>
      useSidebarLayoutActions({
        openSettings: vi.fn(),
        resetPullRequestSelection,
        clearDraftState: vi.fn(),
        clearDraftStateIfDifferentWorkspace,
        selectHome: vi.fn(),
        exitDiffView,
        selectWorkspace,
        setActiveThreadId,
        connectWorkspace: vi.fn(async () => {}),
        disconnectWorkspace: vi.fn(async () => {}),
        reloadWorkspaceSession: vi.fn(async () => {}),
        isCompact: false,
        setActiveTab: vi.fn(),
        workspacesById: new Map([[workspace.id, workspace]]),
        activeWorkspaceId: null,
        activeThreadId: null,
        updateWorkspaceSettings: vi.fn(async () => workspace),
        resetWorkspaceThreads: vi.fn(),
        removeThread: vi.fn(),
        clearDraftForThread: vi.fn(),
        removeImagesForThread: vi.fn(),
        refreshThread: vi.fn(async () => {}),
        handleRenameThread: vi.fn(),
        removeWorkspace: vi.fn(async () => {}),
        removeWorktree: vi.fn(async () => {}),
        loadOlderThreadsForWorkspace: vi.fn(async () => {}),
        listThreadsForWorkspace: vi.fn(async () => {}),
      }),
    );

    act(() => {
      result.current.onSelectWorkspace("ws-1");
    });

    expect(exitDiffView).toHaveBeenCalledTimes(1);
    expect(resetPullRequestSelection).toHaveBeenCalledTimes(1);
    expect(clearDraftStateIfDifferentWorkspace).toHaveBeenCalledWith("ws-1");
    expect(selectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(setActiveThreadId).toHaveBeenCalledWith(null, "ws-1");
  });

  it("connects and fully loads history when selecting an unconnected workspace", async () => {
    const unconnectedWorkspace: WorkspaceInfo = {
      ...workspace,
      connected: false,
    };
    const connectWorkspace = vi.fn(async () => {});
    const listThreadsForWorkspace = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useSidebarLayoutActions({
        openSettings: vi.fn(),
        resetPullRequestSelection: vi.fn(),
        clearDraftState: vi.fn(),
        clearDraftStateIfDifferentWorkspace: vi.fn(),
        selectHome: vi.fn(),
        exitDiffView: vi.fn(),
        selectWorkspace: vi.fn(),
        setActiveThreadId: vi.fn(),
        connectWorkspace,
        disconnectWorkspace: vi.fn(async () => {}),
        reloadWorkspaceSession: vi.fn(async () => {}),
        isCompact: false,
        setActiveTab: vi.fn(),
        workspacesById: new Map([[unconnectedWorkspace.id, unconnectedWorkspace]]),
        activeWorkspaceId: null,
        activeThreadId: null,
        updateWorkspaceSettings: vi.fn(async () => unconnectedWorkspace),
        resetWorkspaceThreads: vi.fn(),
        removeThread: vi.fn(),
        clearDraftForThread: vi.fn(),
        removeImagesForThread: vi.fn(),
        refreshThread: vi.fn(async () => {}),
        handleRenameThread: vi.fn(),
        removeWorkspace: vi.fn(async () => {}),
        removeWorktree: vi.fn(async () => {}),
        loadOlderThreadsForWorkspace: vi.fn(async () => {}),
        listThreadsForWorkspace,
      }),
    );

    await act(async () => {
      result.current.onSelectWorkspace("ws-1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(connectWorkspace).toHaveBeenCalledWith(unconnectedWorkspace);
    expect(listThreadsForWorkspace).toHaveBeenCalledWith({
      ...unconnectedWorkspace,
      connected: true,
    });
  });

  it("loads full history only once for repeated workspace selections", async () => {
    const listThreadsForWorkspace = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useSidebarLayoutActions({
        openSettings: vi.fn(),
        resetPullRequestSelection: vi.fn(),
        clearDraftState: vi.fn(),
        clearDraftStateIfDifferentWorkspace: vi.fn(),
        selectHome: vi.fn(),
        exitDiffView: vi.fn(),
        selectWorkspace: vi.fn(),
        setActiveThreadId: vi.fn(),
        connectWorkspace: vi.fn(async () => {}),
        disconnectWorkspace: vi.fn(async () => {}),
        reloadWorkspaceSession: vi.fn(async () => {}),
        isCompact: false,
        setActiveTab: vi.fn(),
        workspacesById: new Map([[workspace.id, workspace]]),
        activeWorkspaceId: null,
        activeThreadId: null,
        updateWorkspaceSettings: vi.fn(async () => workspace),
        resetWorkspaceThreads: vi.fn(),
        removeThread: vi.fn(),
        clearDraftForThread: vi.fn(),
        removeImagesForThread: vi.fn(),
        refreshThread: vi.fn(async () => {}),
        handleRenameThread: vi.fn(),
        removeWorkspace: vi.fn(async () => {}),
        removeWorktree: vi.fn(async () => {}),
        loadOlderThreadsForWorkspace: vi.fn(async () => {}),
        listThreadsForWorkspace,
      }),
    );

    await act(async () => {
      result.current.onSelectWorkspace("ws-1");
      result.current.onSelectWorkspace("ws-1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listThreadsForWorkspace).toHaveBeenCalledTimes(1);
    expect(listThreadsForWorkspace).toHaveBeenCalledWith({
      ...workspace,
      connected: true,
    });
  });

  it("switches to codex tab after connecting in compact mode", async () => {
    const connectWorkspace = vi.fn(async () => {});
    const setActiveTab = vi.fn();
    const { result } = renderHook(() =>
      useSidebarLayoutActions({
        openSettings: vi.fn(),
        resetPullRequestSelection: vi.fn(),
        clearDraftState: vi.fn(),
        clearDraftStateIfDifferentWorkspace: vi.fn(),
        selectHome: vi.fn(),
        exitDiffView: vi.fn(),
        selectWorkspace: vi.fn(),
        setActiveThreadId: vi.fn(),
        connectWorkspace,
        disconnectWorkspace: vi.fn(async () => {}),
        reloadWorkspaceSession: vi.fn(async () => {}),
        isCompact: true,
        setActiveTab,
        workspacesById: new Map([[workspace.id, workspace]]),
        activeWorkspaceId: null,
        activeThreadId: null,
        updateWorkspaceSettings: vi.fn(async () => workspace),
        resetWorkspaceThreads: vi.fn(),
        removeThread: vi.fn(),
        clearDraftForThread: vi.fn(),
        removeImagesForThread: vi.fn(),
        refreshThread: vi.fn(async () => {}),
        handleRenameThread: vi.fn(),
        removeWorkspace: vi.fn(async () => {}),
        removeWorktree: vi.fn(async () => {}),
        loadOlderThreadsForWorkspace: vi.fn(async () => {}),
        listThreadsForWorkspace: vi.fn(async () => {}),
      }),
    );

    await act(async () => {
      await result.current.onConnectWorkspace(workspace);
    });

    expect(connectWorkspace).toHaveBeenCalledWith(workspace);
    expect(setActiveTab).toHaveBeenCalledWith("codex");
  });

  it("disconnects workspace and clears active thread state", async () => {
    const disconnectWorkspace = vi.fn(async () => {});
    const resetWorkspaceThreads = vi.fn();
    const setActiveThreadId = vi.fn();

    const { result } = renderHook(() =>
      useSidebarLayoutActions({
        openSettings: vi.fn(),
        resetPullRequestSelection: vi.fn(),
        clearDraftState: vi.fn(),
        clearDraftStateIfDifferentWorkspace: vi.fn(),
        selectHome: vi.fn(),
        exitDiffView: vi.fn(),
        selectWorkspace: vi.fn(),
        setActiveThreadId,
        connectWorkspace: vi.fn(async () => {}),
        disconnectWorkspace,
        reloadWorkspaceSession: vi.fn(async () => {}),
        isCompact: false,
        setActiveTab: vi.fn(),
        workspacesById: new Map([[workspace.id, workspace]]),
        activeWorkspaceId: workspace.id,
        activeThreadId: "thread-1",
        updateWorkspaceSettings: vi.fn(async () => workspace),
        resetWorkspaceThreads,
        removeThread: vi.fn(),
        clearDraftForThread: vi.fn(),
        removeImagesForThread: vi.fn(),
        refreshThread: vi.fn(async () => {}),
        handleRenameThread: vi.fn(),
        removeWorkspace: vi.fn(async () => {}),
        removeWorktree: vi.fn(async () => {}),
        loadOlderThreadsForWorkspace: vi.fn(async () => {}),
        listThreadsForWorkspace: vi.fn(async () => {}),
      }),
    );

    await act(async () => {
      await result.current.onDisconnectWorkspace(workspace);
    });

    expect(disconnectWorkspace).toHaveBeenCalledWith(workspace);
    expect(resetWorkspaceThreads).toHaveBeenCalledWith(workspace.id);
    expect(setActiveThreadId).toHaveBeenCalledWith(null, workspace.id);
  });

  it("runs claude history reload actions", async () => {
    const listThreadsForWorkspace = vi.fn(async () => {});
    const loadOlderThreadsForWorkspace = vi.fn(async () => {});
    const reloadWorkspaceSession = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useSidebarLayoutActions({
        openSettings: vi.fn(),
        resetPullRequestSelection: vi.fn(),
        clearDraftState: vi.fn(),
        clearDraftStateIfDifferentWorkspace: vi.fn(),
        selectHome: vi.fn(),
        exitDiffView: vi.fn(),
        selectWorkspace: vi.fn(),
        setActiveThreadId: vi.fn(),
        connectWorkspace: vi.fn(async () => {}),
        disconnectWorkspace: vi.fn(async () => {}),
        reloadWorkspaceSession,
        isCompact: false,
        setActiveTab: vi.fn(),
        workspacesById: new Map([[claudeWorkspace.id, claudeWorkspace]]),
        activeWorkspaceId: null,
        activeThreadId: null,
        updateWorkspaceSettings: vi.fn(async () => claudeWorkspace),
        resetWorkspaceThreads: vi.fn(),
        removeThread: vi.fn(),
        clearDraftForThread: vi.fn(),
        removeImagesForThread: vi.fn(),
        refreshThread: vi.fn(async () => {}),
        handleRenameThread: vi.fn(),
        removeWorkspace: vi.fn(async () => {}),
        removeWorktree: vi.fn(async () => {}),
        loadOlderThreadsForWorkspace,
        listThreadsForWorkspace,
      }),
    );

    await act(async () => {
      await result.current.onReloadWorkspaceThreads("ws-claude");
      result.current.onLoadOlderThreads("ws-claude");
    });

    expect(reloadWorkspaceSession).toHaveBeenCalledTimes(1);
    expect(reloadWorkspaceSession).toHaveBeenCalledWith("ws-claude");
    expect(listThreadsForWorkspace).toHaveBeenCalledTimes(1);
    expect(listThreadsForWorkspace).toHaveBeenCalledWith({
      ...claudeWorkspace,
      connected: true,
    });
    expect(loadOlderThreadsForWorkspace).toHaveBeenCalledTimes(1);
    expect(loadOlderThreadsForWorkspace).toHaveBeenCalledWith(claudeWorkspace);
  });

  it("refreshes the active thread after reloading its workspace session", async () => {
    const reloadWorkspaceSession = vi.fn(async () => {});
    const listThreadsForWorkspace = vi.fn(async () => {});
    const refreshThread = vi.fn(async () => {});

    const { result } = renderHook(() =>
      useSidebarLayoutActions({
        openSettings: vi.fn(),
        resetPullRequestSelection: vi.fn(),
        clearDraftState: vi.fn(),
        clearDraftStateIfDifferentWorkspace: vi.fn(),
        selectHome: vi.fn(),
        exitDiffView: vi.fn(),
        selectWorkspace: vi.fn(),
        setActiveThreadId: vi.fn(),
        connectWorkspace: vi.fn(async () => {}),
        disconnectWorkspace: vi.fn(async () => {}),
        reloadWorkspaceSession,
        isCompact: false,
        setActiveTab: vi.fn(),
        workspacesById: new Map([[workspace.id, workspace]]),
        activeWorkspaceId: workspace.id,
        activeThreadId: "thread-1",
        updateWorkspaceSettings: vi.fn(async () => workspace),
        resetWorkspaceThreads: vi.fn(),
        removeThread: vi.fn(),
        clearDraftForThread: vi.fn(),
        removeImagesForThread: vi.fn(),
        refreshThread,
        handleRenameThread: vi.fn(),
        removeWorkspace: vi.fn(async () => {}),
        removeWorktree: vi.fn(async () => {}),
        loadOlderThreadsForWorkspace: vi.fn(async () => {}),
        listThreadsForWorkspace,
      }),
    );

    await act(async () => {
      await result.current.onReloadWorkspaceThreads(workspace.id);
    });

    expect(reloadWorkspaceSession).toHaveBeenCalledWith(workspace.id);
    expect(listThreadsForWorkspace).toHaveBeenCalledWith({
      ...workspace,
      connected: true,
    });
    expect(refreshThread).toHaveBeenCalledWith(workspace.id, "thread-1");
  });

  it("reloads workspace history after provider changes", async () => {
    const updatedWorkspace: WorkspaceInfo = {
      ...workspace,
      provider: "claude",
    };
    const updateWorkspaceSettings = vi.fn(async () => updatedWorkspace);
    const resetWorkspaceThreads = vi.fn();
    const listThreadsForWorkspace = vi.fn(async () => ({}));

    const { result } = renderHook(() =>
      useSidebarLayoutActions({
        openSettings: vi.fn(),
        resetPullRequestSelection: vi.fn(),
        clearDraftState: vi.fn(),
        clearDraftStateIfDifferentWorkspace: vi.fn(),
        selectHome: vi.fn(),
        exitDiffView: vi.fn(),
        selectWorkspace: vi.fn(),
        setActiveThreadId: vi.fn(),
        connectWorkspace: vi.fn(async () => {}),
        disconnectWorkspace: vi.fn(async () => {}),
        reloadWorkspaceSession: vi.fn(async () => {}),
        isCompact: false,
        setActiveTab: vi.fn(),
        workspacesById: new Map([[workspace.id, workspace]]),
        activeWorkspaceId: null,
        activeThreadId: null,
        updateWorkspaceSettings,
        resetWorkspaceThreads,
        removeThread: vi.fn(),
        clearDraftForThread: vi.fn(),
        removeImagesForThread: vi.fn(),
        refreshThread: vi.fn(async () => {}),
        handleRenameThread: vi.fn(),
        removeWorkspace: vi.fn(async () => {}),
        removeWorktree: vi.fn(async () => {}),
        loadOlderThreadsForWorkspace: vi.fn(async () => {}),
        listThreadsForWorkspace,
      }),
    );

    await act(async () => {
      result.current.onUpdateWorkspaceProvider("ws-1", "claude");
      await Promise.resolve();
    });

    expect(updateWorkspaceSettings).toHaveBeenCalledWith(
      "ws-1",
      workspace.settings,
      "claude",
    );
    expect(resetWorkspaceThreads).toHaveBeenCalledTimes(1);
    expect(resetWorkspaceThreads).toHaveBeenCalledWith("ws-1");
    expect(listThreadsForWorkspace).toHaveBeenCalledTimes(1);
    expect(listThreadsForWorkspace).toHaveBeenCalledWith(updatedWorkspace);
  });
});
