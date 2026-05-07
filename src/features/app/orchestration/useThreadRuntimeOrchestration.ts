import type { AppSettings, ThreadListSortKey, WorkspaceInfo } from "@/types";
import { useThreads } from "@threads/hooks/useThreads";
import { useMainAppMobileThreadRefresh } from "@app/hooks/useMainAppMobileThreadRefresh";
import { useRemoteThreadLiveConnection } from "@app/hooks/useRemoteThreadLiveConnection";
import { useThreadListActions } from "@app/hooks/useThreadListActions";
import { useTrayRecentThreads } from "@app/hooks/useTrayRecentThreads";

type UseThreadsOptions = Parameters<typeof useThreads>[0];

type UseThreadRuntimeOrchestrationParams = UseThreadsOptions & {
  activeWorkspace: WorkspaceInfo | null;
  backendMode: AppSettings["backendMode"];
  workspaces: WorkspaceInfo[];
  refreshWorkspaces: () => Promise<WorkspaceInfo[] | undefined>;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  threadListSortKey: ThreadListSortKey;
  setThreadListSortKey: (sortKey: ThreadListSortKey) => void;
};

/**
 * 方法说明：装配主应用线程运行时，并集中处理远程 live 连接、移动端刷新和线程列表动作。
 * 入参说明：params 包含 useThreads 原始入参，以及工作区、远程连接和线程列表排序依赖。
 */
export function useThreadRuntimeOrchestration({
  activeWorkspace,
  backendMode,
  workspaces,
  refreshWorkspaces,
  connectWorkspace,
  threadListSortKey,
  setThreadListSortKey,
  ...threadOptions
}: UseThreadRuntimeOrchestrationParams) {
  const threads = useThreads({
    ...threadOptions,
    activeWorkspace,
    threadSortKey: threadListSortKey,
  });

  const { connectionState: remoteThreadConnectionState, reconnectLive } =
    useRemoteThreadLiveConnection({
      backendMode,
      activeWorkspace,
      activeThreadId: threads.activeThreadId,
      activeThreadHasLocalSnapshot: threads.hasLocalThreadSnapshot(
        threads.activeThreadId,
      ),
      activeThreadIsProcessing: Boolean(
        threads.activeThreadId &&
          threads.threadStatusById[threads.activeThreadId]?.isProcessing,
      ),
      refreshThread: threads.refreshThread,
      reconnectWorkspace: connectWorkspace,
    });

  const { mobileThreadRefreshLoading, handleMobileThreadRefresh } =
    useMainAppMobileThreadRefresh({
      activeWorkspace,
      activeThreadId: threads.activeThreadId,
      startThreadForWorkspace: threads.startThreadForWorkspace,
      refreshThread: threads.refreshThread,
      reconnectLive,
    });

  const { handleSetThreadListSortKey, handleRefreshAllWorkspaceThreads } =
    useThreadListActions({
      threadListSortKey,
      setThreadListSortKey,
      workspaces,
      refreshWorkspaces,
      listThreadsForWorkspaces: threads.listThreadsForWorkspaces,
      resetWorkspaceThreads: threads.resetWorkspaceThreads,
    });

  useTrayRecentThreads({
    workspaces,
    threadsByWorkspace: threads.threadsByWorkspace,
    isSubagentThread: threads.isSubagentThread,
  });

  return {
    ...threads,
    remoteThreadConnectionState,
    reconnectLive,
    mobileThreadRefreshLoading,
    handleMobileThreadRefresh,
    handleSetThreadListSortKey,
    handleRefreshAllWorkspaceThreads,
  };
}
