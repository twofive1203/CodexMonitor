import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type {
  ConversationItem,
  DebugEntry,
  ThreadListSortKey,
  ThreadSummary,
  WorkspaceInfo,
} from "@/types";
import {
  archiveThread as archiveThreadService,
  forkThread as forkThreadService,
  listThreads as listThreadsService,
  listWorkspaces as listWorkspacesService,
  resumeThread as resumeThreadService,
  startThread as startThreadService,
} from "@services/tauri";
import {
  getWorkspaceProvider,
  providerSupportsHistoryThreads,
} from "@utils/agentProvider";
import {
  buildItemsFromThread,
  getThreadCreatedTimestamp,
  getThreadTimestamp,
  isReviewingFromThread,
  mergeThreadItems,
  previewThreadName,
} from "@utils/threadItems";
import { extractThreadCodexMetadata } from "@threads/utils/threadCodexMetadata";
import {
  asString,
  normalizeRootPath,
} from "@threads/utils/threadNormalize";
import {
  getParentThreadIdFromThread,
  getResumedTurnState,
  isSubagentThreadSource,
  shouldHideSubagentThreadFromSidebar,
} from "@threads/utils/threadRpc";
import { saveThreadActivity } from "@threads/utils/threadStorage";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

const THREAD_LIST_TARGET_COUNT = 20;
const THREAD_LIST_PAGE_SIZE = 100;
const THREAD_LIST_MAX_PAGES_OLDER = 6;
const THREAD_LIST_MAX_PAGES_DEFAULT = 6;
const THREAD_LIST_CURSOR_PAGE_START = "__codex_monitor_page_start__";

type ThreadListRefreshResult = {
  failedWorkspaceIds: string[];
};

type ThreadListGroupFetchResult = {
  workspaceIds: string[];
  matchingThreadsByWorkspace: Record<string, Record<string, unknown>[]>;
  resumeCursorByWorkspace: Record<string, string | null>;
  finalCursorByWorkspace: Record<string, string | null>;
};

function isWithinWorkspaceRoot(path: string, workspaceRoot: string) {
  if (!path || !workspaceRoot) {
    return false;
  }
  return (
    path === workspaceRoot ||
    (path.length > workspaceRoot.length &&
      path.startsWith(workspaceRoot) &&
      path.charCodeAt(workspaceRoot.length) === 47)
  );
}

type WorkspacePathLookup = {
  workspaceIdsByPath: Record<string, string[]>;
  workspacePathsSorted: string[];
};

function buildWorkspacePathLookup(workspaces: WorkspaceInfo[]): WorkspacePathLookup {
  const workspaceIdsByPath: Record<string, string[]> = {};
  const workspacePathsSorted: string[] = [];
  workspaces.forEach((workspace) => {
    const workspacePath = normalizeRootPath(workspace.path);
    if (!workspacePath) {
      return;
    }
    if (!workspaceIdsByPath[workspacePath]) {
      workspaceIdsByPath[workspacePath] = [];
      workspacePathsSorted.push(workspacePath);
    }
    workspaceIdsByPath[workspacePath].push(workspace.id);
  });
  workspacePathsSorted.sort((a, b) => b.length - a.length);
  return { workspaceIdsByPath, workspacePathsSorted };
}

/**
 * 标准化 `thread/list` 返回的线程记录。
 *
 * `entry`：`thread/list` 返回的单条原始记录，可能将线程详情包在 `thread` 字段中。
 */
function normalizeThreadListEntry(entry: Record<string, unknown>) {
  const nestedThread = entry.thread;
  if (!nestedThread || typeof nestedThread !== "object") {
    return entry;
  }
  return {
    ...(nestedThread as Record<string, unknown>),
    ...entry,
  };
}

/**
 * 从线程负载中读取显式工作区标识。
 *
 * `thread`：`thread/list` 返回的单条线程记录。
 */
function getExplicitWorkspaceIdFromThread(thread: Record<string, unknown>) {
  const directWorkspaceId = asString(thread.workspaceId ?? thread.workspace_id).trim();
  if (directWorkspaceId) {
    return directWorkspaceId;
  }
  const nestedWorkspace = thread.workspace;
  if (nestedWorkspace && typeof nestedWorkspace === "object") {
    const nestedWorkspaceId = asString(
      (nestedWorkspace as Record<string, unknown>).id,
    ).trim();
    if (nestedWorkspaceId) {
      return nestedWorkspaceId;
    }
  }
  return null;
}

function resolveWorkspaceIdForThreadPath(
  path: string,
  lookup: WorkspacePathLookup,
  allowedWorkspaceIds?: Set<string>,
) {
  const normalizedPath = normalizeRootPath(path);
  if (!normalizedPath) {
    return null;
  }
  const matchedWorkspacePath = lookup.workspacePathsSorted.find((workspacePath) =>
    isWithinWorkspaceRoot(normalizedPath, workspacePath),
  );
  if (!matchedWorkspacePath) {
    return null;
  }
  const workspaceIds = lookup.workspaceIdsByPath[matchedWorkspacePath] ?? [];
  if (!allowedWorkspaceIds) {
    return workspaceIds[0] ?? null;
  }
  return (
    workspaceIds.find((workspaceId) => allowedWorkspaceIds.has(workspaceId)) ??
    null
  );
}

/**
 * 解析线程应归属的工作区。
 *
 * `thread`：`thread/list` 返回的单条线程记录。
 * `lookup`：工作区路径索引。
 * `allowedWorkspaceIds`：当前允许命中的工作区集合。
 * `fallbackWorkspaceId`：当历史线程缺失 `cwd` 时使用的兜底工作区。
 */
function resolveWorkspaceIdForThread(
  thread: Record<string, unknown>,
  lookup: WorkspacePathLookup,
  allowedWorkspaceIds?: Set<string>,
  fallbackWorkspaceId?: string | null,
) {
  const explicitWorkspaceId = getExplicitWorkspaceIdFromThread(thread);
  if (
    explicitWorkspaceId &&
    (!allowedWorkspaceIds || allowedWorkspaceIds.has(explicitWorkspaceId))
  ) {
    return explicitWorkspaceId;
  }

  const mappedWorkspaceId = resolveWorkspaceIdForThreadPath(
    asString(thread.cwd),
    lookup,
    allowedWorkspaceIds,
  );
  if (mappedWorkspaceId) {
    return mappedWorkspaceId;
  }

  if (
    fallbackWorkspaceId &&
    (!allowedWorkspaceIds || allowedWorkspaceIds.has(fallbackWorkspaceId)) &&
    !asString(thread.cwd).trim()
  ) {
    return fallbackWorkspaceId;
  }

  return null;
}

function getThreadListNextCursor(result: Record<string, unknown>): string | null {
  if (typeof result.nextCursor === "string") {
    return result.nextCursor;
  }
  if (typeof result.next_cursor === "string") {
    return result.next_cursor;
  }
  return null;
}

type UseThreadActionsOptions = {
  dispatch: Dispatch<ThreadAction>;
  itemsByThread: ThreadState["itemsByThread"];
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
  activeThreadIdByWorkspace: ThreadState["activeThreadIdByWorkspace"];
  activeTurnIdByThread: ThreadState["activeTurnIdByThread"];
  threadParentById: ThreadState["threadParentById"];
  threadListCursorByWorkspace: ThreadState["threadListCursorByWorkspace"];
  threadStatusById: ThreadState["threadStatusById"];
  threadSortKey: ThreadListSortKey;
  onDebug?: (entry: DebugEntry) => void;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  threadActivityRef: MutableRefObject<Record<string, Record<string, number>>>;
  loadedThreadsRef: MutableRefObject<Record<string, boolean>>;
  replaceOnResumeRef: MutableRefObject<Record<string, boolean>>;
  applyCollabThreadLinksFromThread: (
    workspaceId: string,
    threadId: string,
    thread: Record<string, unknown>,
  ) => void;
  updateThreadParent: (parentId: string, childIds: string[]) => void;
  onSubagentThreadDetected: (workspaceId: string, threadId: string) => void;
  onThreadCodexMetadataDetected?: (
    workspaceId: string,
    threadId: string,
    metadata: { modelId: string | null; effort: string | null },
  ) => void;
};

export function useThreadActions({
  dispatch,
  itemsByThread,
  threadsByWorkspace,
  activeThreadIdByWorkspace,
  activeTurnIdByThread,
  threadParentById,
  threadListCursorByWorkspace,
  threadStatusById,
  threadSortKey,
  onDebug,
  getCustomName,
  threadActivityRef,
  loadedThreadsRef,
  replaceOnResumeRef,
  applyCollabThreadLinksFromThread,
  updateThreadParent,
  onSubagentThreadDetected,
  onThreadCodexMetadataDetected,
}: UseThreadActionsOptions) {
  const resumeInFlightByThreadRef = useRef<Record<string, number>>({});
  const threadStatusByIdRef = useRef(threadStatusById);
  const activeTurnIdByThreadRef = useRef(activeTurnIdByThread);
  threadStatusByIdRef.current = threadStatusById;
  activeTurnIdByThreadRef.current = activeTurnIdByThread;

  const extractThreadId = useCallback((response: Record<string, any>) => {
    const thread = response.result?.thread ?? response.thread ?? null;
    return String(thread?.id ?? "");
  }, []);

  const startThreadForWorkspace = useCallback(
    async (workspaceId: string, options?: { activate?: boolean }) => {
      const shouldActivate = options?.activate !== false;
      onDebug?.({
        id: `${Date.now()}-client-thread-start`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/start",
        payload: { workspaceId },
      });
      try {
        const response = await startThreadService(workspaceId);
        onDebug?.({
          id: `${Date.now()}-server-thread-start`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/start response",
          payload: response,
        });
        const threadId = extractThreadId(response);
        if (threadId) {
          dispatch({ type: "ensureThread", workspaceId, threadId });
          if (shouldActivate) {
            dispatch({ type: "setActiveThreadId", workspaceId, threadId });
          }
          loadedThreadsRef.current[threadId] = true;
          return threadId;
        }
        return null;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-start-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/start error",
          payload: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [dispatch, extractThreadId, loadedThreadsRef, onDebug],
  );

  const resumeThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      force = false,
      replaceLocal = false,
    ) => {
      if (!threadId) {
        return null;
      }
      if (!force && loadedThreadsRef.current[threadId]) {
        return threadId;
      }
      const status = threadStatusByIdRef.current[threadId];
      if (status?.isProcessing && loadedThreadsRef.current[threadId] && !force) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: { workspaceId, threadId, reason: "active-turn" },
        });
        return threadId;
      }
      onDebug?.({
        id: `${Date.now()}-client-thread-resume`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/resume",
        payload: { workspaceId, threadId },
      });
      const inFlightCount =
        (resumeInFlightByThreadRef.current[threadId] ?? 0) + 1;
      resumeInFlightByThreadRef.current[threadId] = inFlightCount;
      if (inFlightCount === 1) {
        dispatch({ type: "setThreadResumeLoading", threadId, isLoading: true });
      }
      try {
        const response =
          (await resumeThreadService(workspaceId, threadId)) as
            | Record<string, unknown>
            | null;
        onDebug?.({
          id: `${Date.now()}-server-thread-resume`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/resume response",
          payload: response,
        });
        const result = (response?.result ?? response) as
          | Record<string, unknown>
          | null;
        const thread = (result?.thread ?? response?.thread ?? null) as
          | Record<string, unknown>
          | null;
        if (thread) {
          const codexMetadata = extractThreadCodexMetadata(thread);
          if (codexMetadata.modelId || codexMetadata.effort) {
            onThreadCodexMetadataDetected?.(workspaceId, threadId, codexMetadata);
          }
          dispatch({ type: "ensureThread", workspaceId, threadId });
          applyCollabThreadLinksFromThread(workspaceId, threadId, thread);
          const sourceParentId = getParentThreadIdFromThread(thread);
          if (sourceParentId) {
            updateThreadParent(sourceParentId, [threadId]);
            onSubagentThreadDetected(workspaceId, threadId);
          }
          const items = buildItemsFromThread(thread);
          const localItems = itemsByThread[threadId] ?? [];
          const shouldReplace =
            replaceLocal || replaceOnResumeRef.current[threadId] === true;
          if (shouldReplace) {
            replaceOnResumeRef.current[threadId] = false;
          }
          if (localItems.length > 0 && !shouldReplace) {
            loadedThreadsRef.current[threadId] = true;
            return threadId;
          }
          const resumedTurnState = getResumedTurnState(thread);
          const localStatus = threadStatusByIdRef.current[threadId];
          const localActiveTurnId =
            activeTurnIdByThreadRef.current[threadId] ?? null;
          const keepLocalProcessing =
            (localStatus?.isProcessing ?? false) &&
            !resumedTurnState.activeTurnId &&
            !resumedTurnState.confidentNoActiveTurn;
          const resumedActiveTurnId = keepLocalProcessing
            ? localActiveTurnId
            : resumedTurnState.activeTurnId;
          const shouldMarkProcessing = keepLocalProcessing || Boolean(resumedActiveTurnId);
          const processingTimestamp =
            resumedTurnState.activeTurnStartedAtMs ?? Date.now();
          if (keepLocalProcessing) {
            onDebug?.({
              id: `${Date.now()}-client-thread-resume-keep-processing`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/resume keep-processing",
              payload: { workspaceId, threadId },
            });
          }
          dispatch({
            type: "markProcessing",
            threadId,
            isProcessing: shouldMarkProcessing,
            timestamp: processingTimestamp,
          });
          dispatch({
            type: "setActiveTurnId",
            threadId,
            turnId: resumedActiveTurnId,
          });
          dispatch({
            type: "markReviewing",
            threadId,
            isReviewing: isReviewingFromThread(thread),
          });
          const hasOverlap =
            items.length > 0 &&
            localItems.length > 0 &&
            items.some((item) => localItems.some((local) => local.id === item.id));
          const mergedItems =
            items.length > 0
              ? shouldReplace
                ? items
                : localItems.length > 0 && !hasOverlap
                  ? localItems
                  : mergeThreadItems(items, localItems)
              : localItems;
          if (mergedItems.length > 0) {
            dispatch({ type: "setThreadItems", threadId, items: mergedItems });
          }
          const preview = asString(thread?.preview ?? "");
          const customName = getCustomName(workspaceId, threadId);
          if (!customName && preview) {
            dispatch({
              type: "setThreadName",
              workspaceId,
              threadId,
              name: previewThreadName(preview, "New Agent"),
            });
          }
          const lastAgentMessage = [...mergedItems]
            .reverse()
            .find(
              (item) => item.kind === "message" && item.role === "assistant",
            ) as ConversationItem | undefined;
          const lastText =
            lastAgentMessage && lastAgentMessage.kind === "message"
              ? lastAgentMessage.text
              : preview;
          if (lastText) {
            dispatch({
              type: "setLastAgentMessage",
              threadId,
              text: lastText,
              timestamp: getThreadTimestamp(thread),
            });
          }
        }
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/resume error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        const nextCount = Math.max(
          0,
          (resumeInFlightByThreadRef.current[threadId] ?? 1) - 1,
        );
        if (nextCount === 0) {
          delete resumeInFlightByThreadRef.current[threadId];
          dispatch({ type: "setThreadResumeLoading", threadId, isLoading: false });
        } else {
          resumeInFlightByThreadRef.current[threadId] = nextCount;
        }
      }
    },
    [
      applyCollabThreadLinksFromThread,
      dispatch,
      getCustomName,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      onSubagentThreadDetected,
      onThreadCodexMetadataDetected,
      replaceOnResumeRef,
      updateThreadParent,
    ],
  );

  const forkThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      options?: { activate?: boolean },
    ) => {
      if (!threadId) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      onDebug?.({
        id: `${Date.now()}-client-thread-fork`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/fork",
        payload: { workspaceId, threadId },
      });
      try {
        const response = await forkThreadService(workspaceId, threadId);
        onDebug?.({
          id: `${Date.now()}-server-thread-fork`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/fork response",
          payload: response,
        });
        const forkedThreadId = extractThreadId(response);
        if (!forkedThreadId) {
          return null;
        }
        dispatch({ type: "ensureThread", workspaceId, threadId: forkedThreadId });
        if (shouldActivate) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        return forkedThreadId;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/fork error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [
      dispatch,
      extractThreadId,
      loadedThreadsRef,
      onDebug,
      resumeThreadForWorkspace,
    ],
  );

  const refreshThread = useCallback(
    async (workspaceId: string, threadId: string) => {
      if (!threadId) {
        return null;
      }
      replaceOnResumeRef.current[threadId] = true;
      return resumeThreadForWorkspace(workspaceId, threadId, true, true);
    },
    [replaceOnResumeRef, resumeThreadForWorkspace],
  );

  const resetWorkspaceThreads = useCallback(
    (workspaceId: string) => {
      const threadIds = new Set<string>();
      const list = threadsByWorkspace[workspaceId] ?? [];
      list.forEach((thread) => threadIds.add(thread.id));
      const activeThread = activeThreadIdByWorkspace[workspaceId];
      if (activeThread) {
        threadIds.add(activeThread);
      }
      threadIds.forEach((threadId) => {
        loadedThreadsRef.current[threadId] = false;
      });
    },
    [activeThreadIdByWorkspace, loadedThreadsRef, threadsByWorkspace],
  );

  const buildThreadSummary = useCallback(
    (
      workspaceId: string,
      thread: Record<string, unknown>,
      fallbackIndex: number,
    ): ThreadSummary | null => {
      const id = String(thread?.id ?? "");
      if (!id) {
        return null;
      }
      const preview = asString(thread?.preview ?? "").trim();
      const customName = getCustomName(workspaceId, id);
      const fallbackName = `Agent ${fallbackIndex + 1}`;
      const name = customName
        ? customName
        : preview.length > 0
          ? preview.length > 38
            ? `${preview.slice(0, 38)}…`
            : preview
          : fallbackName;
      const metadata = extractThreadCodexMetadata(thread);
      if (shouldHideSubagentThreadFromSidebar(thread.source)) {
        return null;
      }
      const isSubagent = isSubagentThreadSource(thread.source);
      return {
        id,
        name,
        updatedAt: getThreadTimestamp(thread),
        createdAt: getThreadCreatedTimestamp(thread),
        ...(metadata.modelId ? { modelId: metadata.modelId } : {}),
        ...(metadata.effort ? { effort: metadata.effort } : {}),
        ...(isSubagent ? { isSubagent: true } : {}),
      };
    },
    [getCustomName],
  );

  const listThreadsForWorkspaces = useCallback(
    async (
      workspaces: WorkspaceInfo[],
      options?: {
        preserveState?: boolean;
        sortKey?: ThreadListSortKey;
        maxPages?: number;
      },
    ): Promise<ThreadListRefreshResult> => {
      const targets = workspaces.filter((workspace) => workspace.id);
      const historyTargets = targets.filter((workspace) =>
        providerSupportsHistoryThreads(getWorkspaceProvider(workspace)),
      );
      if (historyTargets.length === 0) {
        return { failedWorkspaceIds: [] };
      }
      const preserveState = options?.preserveState ?? false;
      const requestedSortKey = options?.sortKey ?? threadSortKey;
      const maxPages = Math.max(1, options?.maxPages ?? THREAD_LIST_MAX_PAGES_DEFAULT);
      if (!preserveState) {
        historyTargets.forEach((workspace) => {
          dispatch({
            type: "setThreadListLoading",
            workspaceId: workspace.id,
            isLoading: true,
          });
          dispatch({
            type: "setThreadListCursor",
            workspaceId: workspace.id,
            cursor: null,
          });
        });
      }
      onDebug?.({
        id: `${Date.now()}-client-thread-list`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/list",
        payload: {
          workspaceIds: historyTargets.map((workspace) => workspace.id),
          preserveState,
          maxPages,
        },
      });

      /**
       * 为同一批工作区拉取一次 `thread/list` 数据。
       *
       * `targetGroup`：本次共享请求的工作区集合。
       */
      const loadTargetGroup = async (
        targetGroup: WorkspaceInfo[],
      ): Promise<ThreadListGroupFetchResult> => {
        const requester =
          targetGroup.find((workspace) => workspace.connected) ?? targetGroup[0];
        const targetWorkspaceIds = new Set(
          targetGroup.map((workspace) => workspace.id),
        );
        const fallbackWorkspaceId =
          targetGroup.length === 1 ? requester.id : null;
        let workspacePathLookup = buildWorkspacePathLookup(targetGroup);
        const matchingThreadsByWorkspace: Record<string, Record<string, unknown>[]> = {};
        const uniqueThreadIdsByWorkspace: Record<string, Set<string>> = {};
        const resumeCursorByWorkspace: Record<string, string | null> = {};
        const finalCursorByWorkspace: Record<string, string | null> = {};

        targetGroup.forEach((workspace) => {
          matchingThreadsByWorkspace[workspace.id] = [];
          uniqueThreadIdsByWorkspace[workspace.id] = new Set<string>();
          resumeCursorByWorkspace[workspace.id] = null;
          finalCursorByWorkspace[workspace.id] = null;
        });

        const shouldLoadWorkspaceLookup =
          targetGroup.length > 1 || getWorkspaceProvider(requester) !== "claude";
        if (shouldLoadWorkspaceLookup) {
          try {
            const knownWorkspaces = await listWorkspacesService();
            if (knownWorkspaces.length > 0) {
              workspacePathLookup = buildWorkspacePathLookup([
                ...targetGroup,
                ...knownWorkspaces,
              ]);
            }
          } catch {
            workspacePathLookup = buildWorkspacePathLookup(targetGroup);
          }
        }

        let pagesFetched = 0;
        let cursor: string | null = null;
        do {
          const pageCursor = cursor;
          pagesFetched += 1;
          const response =
            (await listThreadsService(
              requester.id,
              cursor,
              THREAD_LIST_PAGE_SIZE,
              requestedSortKey,
            )) as Record<string, unknown>;
          onDebug?.({
            id: `${Date.now()}-server-thread-list`,
            timestamp: Date.now(),
            source: "server",
            label: "thread/list response",
            payload: response,
          });
          const result = (response.result ?? response) as Record<string, unknown>;
          const data = Array.isArray(result?.data)
            ? (result.data as Record<string, unknown>[]).map(normalizeThreadListEntry)
            : [];
          const nextCursor = getThreadListNextCursor(result);
          data.forEach((thread) => {
            const workspaceId = resolveWorkspaceIdForThread(
              thread,
              workspacePathLookup,
              targetWorkspaceIds,
              fallbackWorkspaceId,
            );
            if (!workspaceId) {
              return;
            }
            const threadId = String(thread?.id ?? "");
            if (threadId && shouldHideSubagentThreadFromSidebar(thread.source)) {
              dispatch({ type: "hideThread", workspaceId, threadId });
              return;
            }
            matchingThreadsByWorkspace[workspaceId]?.push(thread);
            if (!threadId) {
              return;
            }
            const uniqueThreadIds = uniqueThreadIdsByWorkspace[workspaceId];
            if (!uniqueThreadIds || uniqueThreadIds.has(threadId)) {
              return;
            }
            uniqueThreadIds.add(threadId);
            if (
              uniqueThreadIds.size > THREAD_LIST_TARGET_COUNT &&
              resumeCursorByWorkspace[workspaceId] === null
            ) {
              resumeCursorByWorkspace[workspaceId] =
                pageCursor ?? THREAD_LIST_CURSOR_PAGE_START;
            }
          });
          cursor = nextCursor;
          if (pagesFetched >= maxPages) {
            break;
          }
        } while (cursor);

        targetGroup.forEach((workspace) => {
          finalCursorByWorkspace[workspace.id] = cursor;
        });

        return {
          workspaceIds: targetGroup.map((workspace) => workspace.id),
          matchingThreadsByWorkspace,
          resumeCursorByWorkspace,
          finalCursorByWorkspace,
        };
      };

      try {
        const matchingThreadsByWorkspace: Record<string, Record<string, unknown>[]> = {};
        const resumeCursorByWorkspace: Record<string, string | null> = {};
        const finalCursorByWorkspace: Record<string, string | null> = {};
        historyTargets.forEach((workspace) => {
          matchingThreadsByWorkspace[workspace.id] = [];
          resumeCursorByWorkspace[workspace.id] = null;
          finalCursorByWorkspace[workspace.id] = null;
        });
        // `thread/list` 在真实运行中会按当前 workspace 的 cwd 返回历史，
        // 因此这里改为每个 workspace 单独拉取，再并发聚合结果，
        // 避免只拿到第一个项目的历史列表。
        const groupedTargets = historyTargets.map((workspace) => [workspace]);
        const successfulWorkspaceIds = new Set<string>();
        const failedWorkspaceIds = new Set<string>();
        const groupResults = await Promise.allSettled(
          groupedTargets.map((targetGroup) => loadTargetGroup(targetGroup)),
        );

        groupResults.forEach((groupResult, index) => {
          const targetGroup = groupedTargets[index] ?? [];
          if (groupResult.status === "rejected") {
            const detail =
              groupResult.reason instanceof Error
                ? groupResult.reason.message
                : String(groupResult.reason);
            targetGroup.forEach((workspace) => {
              failedWorkspaceIds.add(workspace.id);
            });
            onDebug?.({
              id: `${Date.now()}-client-thread-list-group-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/list group error",
              payload: {
                workspaceIds: targetGroup.map((workspace) => workspace.id),
                message: detail,
              },
            });
            return;
          }

          groupResult.value.workspaceIds.forEach((workspaceId) => {
            successfulWorkspaceIds.add(workspaceId);
          });
          Object.entries(groupResult.value.matchingThreadsByWorkspace).forEach(
            ([workspaceId, threads]) => {
              matchingThreadsByWorkspace[workspaceId] = threads;
            },
          );
          Object.entries(groupResult.value.resumeCursorByWorkspace).forEach(
            ([workspaceId, cursor]) => {
              resumeCursorByWorkspace[workspaceId] = cursor;
            },
          );
          Object.entries(groupResult.value.finalCursorByWorkspace).forEach(
            ([workspaceId, cursor]) => {
              finalCursorByWorkspace[workspaceId] = cursor;
            },
          );
        });

        const nextThreadActivity = { ...threadActivityRef.current };
        let didChangeAnyActivity = false;
        historyTargets.forEach((workspace) => {
          if (!successfulWorkspaceIds.has(workspace.id)) {
            return;
          }
          const matchingThreads = matchingThreadsByWorkspace[workspace.id] ?? [];
          const existingThreads = threadsByWorkspace[workspace.id] ?? [];
          const uniqueById = new Map<string, Record<string, unknown>>();
          matchingThreads.forEach((thread) => {
            const id = String(thread?.id ?? "");
            if (id && !uniqueById.has(id)) {
              uniqueById.set(id, thread);
            }
          });
          const uniqueThreads = Array.from(uniqueById.values());
          const activityByThread = nextThreadActivity[workspace.id] ?? {};
          const nextActivityByThread = { ...activityByThread };
          let didChangeActivity = false;
          uniqueThreads.forEach((thread) => {
            const threadId = String(thread?.id ?? "");
            if (!threadId) {
              return;
            }
            const codexMetadata = extractThreadCodexMetadata(thread);
            if (codexMetadata.modelId || codexMetadata.effort) {
              onThreadCodexMetadataDetected?.(workspace.id, threadId, codexMetadata);
            }
            const sourceParentId = getParentThreadIdFromThread(thread);
            if (sourceParentId) {
              updateThreadParent(sourceParentId, [threadId]);
              onSubagentThreadDetected(workspace.id, threadId);
            }
            const timestamp = getThreadTimestamp(thread);
            if (timestamp > (nextActivityByThread[threadId] ?? 0)) {
              nextActivityByThread[threadId] = timestamp;
              didChangeActivity = true;
            }
          });
          if (didChangeActivity) {
            nextThreadActivity[workspace.id] = nextActivityByThread;
            didChangeAnyActivity = true;
          }
          if (requestedSortKey === "updated_at") {
            uniqueThreads.sort((a, b) => {
              const aId = String(a?.id ?? "");
              const bId = String(b?.id ?? "");
              const aCreated = getThreadTimestamp(a);
              const bCreated = getThreadTimestamp(b);
              const aActivity = Math.max(nextActivityByThread[aId] ?? 0, aCreated);
              const bActivity = Math.max(nextActivityByThread[bId] ?? 0, bCreated);
              return bActivity - aActivity;
            });
          } else {
            uniqueThreads.sort((a, b) => {
              const delta =
                getThreadCreatedTimestamp(b) - getThreadCreatedTimestamp(a);
              if (delta !== 0) {
                return delta;
              }
              const aId = String(a?.id ?? "");
              const bId = String(b?.id ?? "");
              return aId.localeCompare(bId);
            });
          }
          const summaryById = new Map<string, ThreadSummary>();
          uniqueThreads.forEach((thread, index) => {
            const summary = buildThreadSummary(workspace.id, thread, index);
            if (!summary) {
              return;
            }
            summaryById.set(summary.id, summary);
          });
          const summaries = uniqueThreads
            .slice(0, THREAD_LIST_TARGET_COUNT)
            .map((thread) => summaryById.get(String(thread?.id ?? "")) ?? null)
            .filter((entry): entry is ThreadSummary => Boolean(entry));
          if (
            preserveState &&
            summaries.length === 0 &&
            existingThreads.length > 0
          ) {
            onDebug?.({
              id: `${Date.now()}-client-thread-list-empty-preserved`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list empty preserved",
              payload: { workspaceId: workspace.id },
            });
            return;
          }
          const includedIds = new Set(summaries.map((thread) => thread.id));
          const appendFreshAnchor = (threadId: string | null | undefined) => {
            if (!threadId || includedIds.has(threadId)) {
              return;
            }
            const summary = summaryById.get(threadId);
            if (!summary) {
              return;
            }
            summaries.push(summary);
            includedIds.add(threadId);
          };
          appendFreshAnchor(activeThreadIdByWorkspace[workspace.id]);
          const workspaceThreadIds = new Set<string>([
            ...Array.from(summaryById.keys()),
            ...existingThreads.map((thread) => thread.id),
          ]);
          const activeThreadId = activeThreadIdByWorkspace[workspace.id];
          if (activeThreadId) {
            workspaceThreadIds.add(activeThreadId);
          }
          workspaceThreadIds.forEach((threadId) => {
            if (threadStatusById[threadId]?.isProcessing) {
              appendFreshAnchor(threadId);
            }
          });
          const seedThreadIds = [...includedIds];
          seedThreadIds.forEach((threadId) => {
            const visited = new Set<string>([threadId]);
            let parentId = threadParentById[threadId];
            while (parentId && !visited.has(parentId)) {
              visited.add(parentId);
              appendFreshAnchor(parentId);
              parentId = threadParentById[parentId];
            }
          });
          dispatch({
            type: "setThreads",
            workspaceId: workspace.id,
            threads: summaries,
            sortKey: requestedSortKey,
            preserveAnchors: true,
          });
          dispatch({
            type: "setThreadListCursor",
            workspaceId: workspace.id,
            cursor:
              resumeCursorByWorkspace[workspace.id] ??
              finalCursorByWorkspace[workspace.id] ??
              null,
          });
          uniqueThreads.forEach((thread) => {
            const threadId = String(thread?.id ?? "");
            const preview = asString(thread?.preview ?? "").trim();
            if (!threadId || !preview) {
              return;
            }
            dispatch({
              type: "setLastAgentMessage",
              threadId,
              text: preview,
              timestamp: getThreadTimestamp(thread),
            });
          });
        });
        if (didChangeAnyActivity) {
          threadActivityRef.current = nextThreadActivity;
          saveThreadActivity(nextThreadActivity);
        }
        return {
          failedWorkspaceIds: Array.from(failedWorkspaceIds),
        };
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-list-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/list error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return {
          failedWorkspaceIds: historyTargets.map((workspace) => workspace.id),
        };
      } finally {
        if (!preserveState) {
          historyTargets.forEach((workspace) => {
            dispatch({
              type: "setThreadListLoading",
              workspaceId: workspace.id,
              isLoading: false,
            });
          });
        }
      }
    },
    [
      buildThreadSummary,
      dispatch,
      onDebug,
      onSubagentThreadDetected,
      onThreadCodexMetadataDetected,
      activeThreadIdByWorkspace,
      threadParentById,
      threadActivityRef,
      threadStatusById,
      threadSortKey,
      threadsByWorkspace,
      updateThreadParent,
    ],
  );

  const listThreadsForWorkspace = useCallback(
    async (
      workspace: WorkspaceInfo,
      options?: {
        preserveState?: boolean;
        sortKey?: ThreadListSortKey;
        maxPages?: number;
      },
    ): Promise<ThreadListRefreshResult> => {
      return listThreadsForWorkspaces([workspace], options);
    },
    [listThreadsForWorkspaces],
  );

  const loadOlderThreadsForWorkspace = useCallback(
    async (workspace: WorkspaceInfo) => {
      if (!providerSupportsHistoryThreads(getWorkspaceProvider(workspace))) {
        return;
      }
      const requestedSortKey = threadSortKey;
      const cursorValue = threadListCursorByWorkspace[workspace.id] ?? null;
      if (!cursorValue) {
        return;
      }
      const nextCursor =
        cursorValue === THREAD_LIST_CURSOR_PAGE_START ? null : cursorValue;
      let workspacePathLookup = buildWorkspacePathLookup([workspace]);
      const allowedWorkspaceIds = new Set([workspace.id]);
      const existing = threadsByWorkspace[workspace.id] ?? [];
      dispatch({
        type: "setThreadListPaging",
        workspaceId: workspace.id,
        isLoading: true,
      });
      onDebug?.({
        id: `${Date.now()}-client-thread-list-older`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/list older",
        payload: { workspaceId: workspace.id, cursor: cursorValue },
      });
      try {
        try {
          const knownWorkspaces = await listWorkspacesService();
          if (knownWorkspaces.length > 0) {
            workspacePathLookup = buildWorkspacePathLookup([
              workspace,
              ...knownWorkspaces,
            ]);
          }
        } catch {
          workspacePathLookup = buildWorkspacePathLookup([workspace]);
        }
        const matchingThreads: Record<string, unknown>[] = [];
        const maxPagesWithoutMatch = THREAD_LIST_MAX_PAGES_OLDER;
        let pagesFetched = 0;
        let cursor: string | null = nextCursor;
        do {
          pagesFetched += 1;
          const response =
            (await listThreadsService(
              workspace.id,
              cursor,
              THREAD_LIST_PAGE_SIZE,
              requestedSortKey,
            )) as Record<string, unknown>;
          onDebug?.({
            id: `${Date.now()}-server-thread-list-older`,
            timestamp: Date.now(),
            source: "server",
            label: "thread/list older response",
            payload: response,
          });
          const result = (response.result ?? response) as Record<string, unknown>;
          const data = Array.isArray(result?.data)
            ? (result.data as Record<string, unknown>[]).map(normalizeThreadListEntry)
            : [];
          const next = getThreadListNextCursor(result);
          matchingThreads.push(
            ...data.filter(
              (thread) => {
                const workspaceId = resolveWorkspaceIdForThread(
                  thread,
                  workspacePathLookup,
                  allowedWorkspaceIds,
                  workspace.id,
                );
                if (workspaceId !== workspace.id) {
                  return false;
                }
                const threadId = String(thread?.id ?? "");
                if (threadId && shouldHideSubagentThreadFromSidebar(thread.source)) {
                  dispatch({ type: "hideThread", workspaceId, threadId });
                  return false;
                }
                return true;
              },
            ),
          );
          cursor = next;
          if (matchingThreads.length === 0 && pagesFetched >= maxPagesWithoutMatch) {
            break;
          }
          if (pagesFetched >= THREAD_LIST_MAX_PAGES_OLDER) {
            break;
          }
        } while (cursor && matchingThreads.length < THREAD_LIST_TARGET_COUNT);

        const existingIds = new Set(existing.map((thread) => thread.id));
        const additions: ThreadSummary[] = [];
        matchingThreads.forEach((thread) => {
          const id = String(thread?.id ?? "");
          if (!id || existingIds.has(id)) {
            return;
          }
          const codexMetadata = extractThreadCodexMetadata(thread);
          if (codexMetadata.modelId || codexMetadata.effort) {
            onThreadCodexMetadataDetected?.(workspace.id, id, codexMetadata);
          }
          const sourceParentId = getParentThreadIdFromThread(thread);
          if (sourceParentId) {
            updateThreadParent(sourceParentId, [id]);
          }
          const summary = buildThreadSummary(
            workspace.id,
            thread,
            existing.length + additions.length,
          );
          if (!summary) {
            return;
          }
          additions.push(summary);
          existingIds.add(id);
        });

        if (additions.length > 0) {
          dispatch({
            type: "setThreads",
            workspaceId: workspace.id,
            threads: [...existing, ...additions],
            sortKey: requestedSortKey,
          });
        }
        dispatch({
          type: "setThreadListCursor",
          workspaceId: workspace.id,
          cursor,
        });
        matchingThreads.forEach((thread) => {
          const threadId = String(thread?.id ?? "");
          const preview = asString(thread?.preview ?? "").trim();
          if (!threadId || !preview) {
            return;
          }
          dispatch({
            type: "setLastAgentMessage",
            threadId,
            text: preview,
            timestamp: getThreadTimestamp(thread),
          });
        });
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-list-older-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/list older error",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        dispatch({
          type: "setThreadListPaging",
          workspaceId: workspace.id,
          isLoading: false,
        });
      }
    },
    [
      buildThreadSummary,
      dispatch,
      onDebug,
      threadListCursorByWorkspace,
      threadsByWorkspace,
      threadSortKey,
      updateThreadParent,
      onThreadCodexMetadataDetected,
    ],
  );

  const archiveThread = useCallback(
    async (workspaceId: string, threadId: string) => {
      try {
        await archiveThreadService(workspaceId, threadId);
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-archive-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/archive error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [onDebug],
  );

  return {
    startThreadForWorkspace,
    forkThreadForWorkspace,
    resumeThreadForWorkspace,
    refreshThread,
    resetWorkspaceThreads,
    listThreadsForWorkspaces,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    archiveThread,
  };
}
