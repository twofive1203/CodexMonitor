import { useCallback } from "react";
import type { ThreadListSortKey, WorkspaceInfo } from "../../../types";
import {
  getWorkspaceProvider,
  providerSupportsHistoryThreads,
} from "@utils/agentProvider";

type ListThreadsOptions = {
  sortKey?: ThreadListSortKey;
};

type UseThreadListActionsOptions = {
  threadListSortKey: ThreadListSortKey;
  setThreadListSortKey: (sortKey: ThreadListSortKey) => void;
  workspaces: WorkspaceInfo[];
  refreshWorkspaces: () => Promise<WorkspaceInfo[] | undefined>;
  listThreadsForWorkspaces: (
    workspaces: WorkspaceInfo[],
    options?: ListThreadsOptions,
  ) => void | Promise<{ failedWorkspaceIds: string[] } | void>;
  resetWorkspaceThreads: (workspaceId: string) => void;
};

export function useThreadListActions({
  threadListSortKey,
  setThreadListSortKey,
  workspaces,
  refreshWorkspaces,
  listThreadsForWorkspaces,
  resetWorkspaceThreads,
}: UseThreadListActionsOptions) {
  const handleSetThreadListSortKey = useCallback(
    (nextSortKey: ThreadListSortKey) => {
      if (nextSortKey === threadListSortKey) {
        return;
      }
      setThreadListSortKey(nextSortKey);
      const connectedWorkspaces = workspaces.filter(
        (workspace) =>
          workspace.connected &&
          providerSupportsHistoryThreads(getWorkspaceProvider(workspace)),
      );
      if (connectedWorkspaces.length > 0) {
        void listThreadsForWorkspaces(connectedWorkspaces, { sortKey: nextSortKey });
      }
    },
    [threadListSortKey, setThreadListSortKey, workspaces, listThreadsForWorkspaces],
  );

  const handleRefreshAllWorkspaceThreads = useCallback(async () => {
    const refreshed = await refreshWorkspaces();
    const source = refreshed ?? workspaces;
    const connectedWorkspaces = source.filter(
      (workspace) =>
        workspace.connected &&
        providerSupportsHistoryThreads(getWorkspaceProvider(workspace)),
    );
    connectedWorkspaces.forEach((workspace) => {
      resetWorkspaceThreads(workspace.id);
    });
    if (connectedWorkspaces.length > 0) {
      await listThreadsForWorkspaces(connectedWorkspaces);
    }
  }, [refreshWorkspaces, workspaces, resetWorkspaceThreads, listThreadsForWorkspaces]);

  return {
    handleSetThreadListSortKey,
    handleRefreshAllWorkspaceThreads,
  };
}
