import { useEffect, useRef, useState } from "react";
import type { WorkspaceInfo } from "../../../types";

const INITIAL_THREAD_LIST_MAX_PAGES = 6;
const RESTORE_RETRY_DELAY_MS = 3_000;

type WorkspaceRestoreOptions = {
  workspaces: WorkspaceInfo[];
  hasLoaded: boolean;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  listThreadsForWorkspaces: (
    workspaces: WorkspaceInfo[],
    options?: { preserveState?: boolean; maxPages?: number },
  ) => Promise<void>;
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
      for (const workspace of pending) {
        try {
          if (!workspace.connected) {
            await connectWorkspace(workspace);
          }
          connectedTargets.push({ ...workspace, connected: true });
        } catch {
          shouldRetry = true;
        }
      }
      if (connectedTargets.length > 0) {
        try {
          for (const workspace of connectedTargets) {
            await listThreadsForWorkspaces([workspace], {
              maxPages: INITIAL_THREAD_LIST_MAX_PAGES,
            });
            restoredWorkspaces.current.add(workspace.id);
          }
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
      pending.forEach((workspace) => {
        restoringWorkspaces.current.delete(workspace.id);
      });
    };
  }, [connectWorkspace, hasLoaded, listThreadsForWorkspaces, retryTick, workspaces]);
}
