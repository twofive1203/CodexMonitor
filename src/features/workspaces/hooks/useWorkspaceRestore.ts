import { useEffect, useRef, useState } from "react";
import type { WorkspaceInfo } from "../../../types";
import {
  getWorkspaceProvider,
  providerSupportsHistoryThreads,
} from "@utils/agentProvider";

const INITIAL_THREAD_LIST_MAX_PAGES = 6;
const RESTORE_RETRY_DELAY_MS = 3_000;

type WorkspaceRestoreOptions = {
  workspaces: WorkspaceInfo[];
  hasLoaded: boolean;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  listThreadsForWorkspaces: (
    workspaces: WorkspaceInfo[],
    options?: { preserveState?: boolean; maxPages?: number },
  ) => Promise<{ failedWorkspaceIds: string[] } | void>;
};

export function useWorkspaceRestore({
  workspaces,
  hasLoaded,
  connectWorkspace,
  listThreadsForWorkspaces,
}: WorkspaceRestoreOptions) {
  const restoredWorkspaces = useRef(new Set<string>());
  const restoringWorkspaces = useRef(new Set<string>());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  /**
   * 安排下一次恢复重试。
   *
   * 无入参；仅在当前没有待执行重试定时器时创建一次延迟重试。
   */
  const scheduleRetry = () => {
    if (retryTimerRef.current) {
      return;
    }
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      setRetryTick((current) => current + 1);
    }, RESTORE_RETRY_DELAY_MS);
  };

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }
    const pending = workspaces.filter(
      (workspace) =>
        !restoredWorkspaces.current.has(workspace.id) &&
        !restoringWorkspaces.current.has(workspace.id),
    );
    if (pending.length === 0) {
      return;
    }
    pending.forEach((workspace) => {
      restoringWorkspaces.current.add(workspace.id);
    });
    let cancelled = false;
    void (async () => {
      const connectedTargets: WorkspaceInfo[] = [];
      let shouldRetry = false;
      const connectionResults = await Promise.allSettled(
        pending.map(async (workspace) => {
          if (!workspace.connected) {
            await connectWorkspace(workspace);
          }
          return { ...workspace, connected: true };
        }),
      );

      connectionResults.forEach((result) => {
        if (result.status === "fulfilled") {
          connectedTargets.push(result.value);
          return;
        }
        shouldRetry = true;
      });

      const historyTargets = connectedTargets.filter((workspace) =>
        providerSupportsHistoryThreads(getWorkspaceProvider(workspace)),
      );
      if (connectedTargets.length > 0) {
        connectedTargets.forEach((workspace) => {
          if (!providerSupportsHistoryThreads(getWorkspaceProvider(workspace))) {
            restoredWorkspaces.current.add(workspace.id);
          }
        });
      }

      if (historyTargets.length > 0) {
        try {
          const refreshResult = await listThreadsForWorkspaces(historyTargets, {
            maxPages: INITIAL_THREAD_LIST_MAX_PAGES,
          });
          const failedWorkspaceIds = new Set(
            refreshResult?.failedWorkspaceIds ?? [],
          );
          historyTargets.forEach((workspace) => {
            if (failedWorkspaceIds.has(workspace.id)) {
              shouldRetry = true;
              return;
            }
            restoredWorkspaces.current.add(workspace.id);
          });
        } catch {
          shouldRetry = true;
        }
      }
      pending.forEach((workspace) => {
        restoringWorkspaces.current.delete(workspace.id);
      });
      if (!cancelled && shouldRetry) {
        scheduleRetry();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectWorkspace, hasLoaded, listThreadsForWorkspaces, retryTick, workspaces]);
}
