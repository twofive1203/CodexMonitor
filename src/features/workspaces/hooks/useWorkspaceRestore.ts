import { useEffect, useRef, useState } from "react";
import type { WorkspaceInfo } from "../../../types";
import {
  getWorkspaceProvider,
  providerSupportsHistoryThreads,
} from "@utils/agentProvider";
import { loadThreadActivity } from "@threads/utils/threadStorage";

const INITIAL_THREAD_LIST_MAX_PAGES = 1;
const INITIAL_THREAD_LIST_PAGE_SIZE = 30;
const RESTORE_RETRY_DELAY_MS = 3_000;

type WorkspaceRestoreOptions = {
  workspaces: WorkspaceInfo[];
  hasLoaded: boolean;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  listThreadsForWorkspaces: (
    workspaces: WorkspaceInfo[],
    options?: { preserveState?: boolean; maxPages?: number; pageSize?: number },
  ) => Promise<{ failedWorkspaceIds: string[] } | void>;
};

/**
 * 读取工作区最近一次线程活动时间。
 *
 * `workspaceId`：目标工作区 ID；`activity`：本地持久化的线程活动索引。
 */
function getLatestWorkspaceActivity(
  workspaceId: string,
  activity: ReturnType<typeof loadThreadActivity>,
) {
  const timestamps = Object.values(activity[workspaceId] ?? {});
  return timestamps.reduce((latest, timestamp) => Math.max(latest, timestamp), 0);
}

/**
 * 选择启动阶段优先恢复的工作区。
 *
 * `workspaces`：当前待恢复工作区列表，保持原有侧边栏顺序作为兜底。
 */
function selectInitialRestoreWorkspace(workspaces: WorkspaceInfo[]) {
  if (workspaces.length <= 1) {
    return workspaces[0] ?? null;
  }
  const activity = loadThreadActivity();
  return workspaces.reduce<WorkspaceInfo | null>((selected, workspace) => {
    if (!selected) {
      return workspace;
    }
    const currentActivity = getLatestWorkspaceActivity(workspace.id, activity);
    const selectedActivity = getLatestWorkspaceActivity(selected.id, activity);
    return currentActivity > selectedActivity ? workspace : selected;
  }, null);
}

export function useWorkspaceRestore({
  workspaces,
  hasLoaded,
  connectWorkspace,
  listThreadsForWorkspaces,
}: WorkspaceRestoreOptions) {
  const initialRestoreStarted = useRef(false);
  const retryWorkspaceIds = useRef(new Set<string>());
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
    const restoreTargets = initialRestoreStarted.current
      ? pending.filter((workspace) => retryWorkspaceIds.current.has(workspace.id))
      : [selectInitialRestoreWorkspace(pending)].filter(
          (workspace): workspace is WorkspaceInfo => Boolean(workspace),
        );
    initialRestoreStarted.current = true;
    if (restoreTargets.length === 0) {
      return;
    }
    restoreTargets.forEach((workspace) => {
      restoringWorkspaces.current.add(workspace.id);
    });
    let cancelled = false;
    void (async () => {
      const connectedTargets: WorkspaceInfo[] = [];
      let shouldRetry = false;
      const connectionResults = await Promise.allSettled(
        restoreTargets.map(async (workspace) => {
          if (!workspace.connected) {
            await connectWorkspace(workspace);
          }
          return { ...workspace, connected: true };
        }),
      );

      connectionResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          retryWorkspaceIds.current.delete(result.value.id);
          connectedTargets.push(result.value);
          return;
        }
        shouldRetry = true;
        const workspace = restoreTargets[index];
        if (workspace) {
          retryWorkspaceIds.current.add(workspace.id);
        }
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
            pageSize: INITIAL_THREAD_LIST_PAGE_SIZE,
          });
          const failedWorkspaceIds = new Set(
            refreshResult?.failedWorkspaceIds ?? [],
          );
          historyTargets.forEach((workspace) => {
            if (failedWorkspaceIds.has(workspace.id)) {
              shouldRetry = true;
              retryWorkspaceIds.current.add(workspace.id);
              return;
            }
            retryWorkspaceIds.current.delete(workspace.id);
            restoredWorkspaces.current.add(workspace.id);
          });
        } catch {
          shouldRetry = true;
          historyTargets.forEach((workspace) => {
            retryWorkspaceIds.current.add(workspace.id);
          });
        }
      }
      restoreTargets.forEach((workspace) => {
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
