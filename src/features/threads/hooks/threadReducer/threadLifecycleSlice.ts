import type { ThreadSummary } from "@/types";
import type { ThreadAction, ThreadState } from "../useThreadsReducer";
import { prefersUpdatedSort } from "./common";

type ThreadStatus = ThreadState["threadStatusById"][string];

function statusEquals(previous: ThreadStatus, nextStatus: ThreadStatus) {
  return (
    previous.isProcessing === nextStatus.isProcessing &&
    previous.hasUnread === nextStatus.hasUnread &&
    previous.isReviewing === nextStatus.isReviewing &&
    previous.processingStartedAt === nextStatus.processingStartedAt &&
    previous.lastDurationMs === nextStatus.lastDurationMs
  );
}

/**
 * 移除指定线程的本地状态键，避免线程删除后轻量缓存长期累积。
 *
 * @param state 当前线程状态快照。
 * @param threadId 需要清理的线程 ID。
 * @returns 已清理指定线程本地状态键的新状态片段。
 */
function removeThreadLocalState(state: ThreadState, threadId: string) {
  const { [threadId]: _items, ...itemsByThread } = state.itemsByThread;
  const { [threadId]: _status, ...threadStatusById } = state.threadStatusById;
  const { [threadId]: _resumeLoading, ...threadResumeLoadingById } =
    state.threadResumeLoadingById;
  const { [threadId]: _turn, ...activeTurnIdByThread } =
    state.activeTurnIdByThread;
  const { [threadId]: _diff, ...turnDiffByThread } = state.turnDiffByThread;
  const { [threadId]: _plan, ...planByThread } = state.planByThread;
  const { [threadId]: _parent, ...threadParentById } = state.threadParentById;
  const { [threadId]: _maxItems, ...maxItemsPerThreadByThread } =
    state.maxItemsPerThreadByThread;
  const { [threadId]: _tokenUsage, ...tokenUsageByThread } =
    state.tokenUsageByThread;
  const { [threadId]: _lastAgentMessage, ...lastAgentMessageByThread } =
    state.lastAgentMessageByThread;

  return {
    itemsByThread,
    maxItemsPerThreadByThread,
    threadStatusById,
    threadResumeLoadingById,
    activeTurnIdByThread,
    turnDiffByThread,
    planByThread,
    threadParentById,
    tokenUsageByThread,
    lastAgentMessageByThread,
  };
}

export function reduceThreadLifecycle(
  state: ThreadState,
  action: ThreadAction,
): ThreadState {
  switch (action.type) {
    case "setActiveThreadId":
      return {
        ...state,
        activeThreadIdByWorkspace: {
          ...state.activeThreadIdByWorkspace,
          [action.workspaceId]: action.threadId,
        },
        threadStatusById: action.threadId
          ? {
              ...state.threadStatusById,
              [action.threadId]: {
                isProcessing:
                  state.threadStatusById[action.threadId]?.isProcessing ?? false,
                hasUnread: false,
                isReviewing:
                  state.threadStatusById[action.threadId]?.isReviewing ?? false,
                processingStartedAt:
                  state.threadStatusById[action.threadId]?.processingStartedAt ??
                  null,
                lastDurationMs:
                  state.threadStatusById[action.threadId]?.lastDurationMs ?? null,
              },
            }
          : state.threadStatusById,
      };
    case "ensureThread": {
      const hidden =
        state.hiddenThreadIdsByWorkspace[action.workspaceId]?.[action.threadId] ??
        false;
      if (hidden) {
        return state;
      }
      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      if (list.some((thread) => thread.id === action.threadId)) {
        return state;
      }
      const thread: ThreadSummary = {
        id: action.threadId,
        name: "New Agent",
        updatedAt: 0,
      };
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: [thread, ...list],
        },
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
            processingStartedAt: null,
            lastDurationMs: null,
          },
        },
        activeThreadIdByWorkspace: {
          ...state.activeThreadIdByWorkspace,
          [action.workspaceId]:
            state.activeThreadIdByWorkspace[action.workspaceId] ?? action.threadId,
        },
      };
    }
    case "hideThread": {
      const hiddenForWorkspace =
        state.hiddenThreadIdsByWorkspace[action.workspaceId] ?? {};
      if (hiddenForWorkspace[action.threadId]) {
        return state;
      }

      const nextHiddenForWorkspace = {
        ...hiddenForWorkspace,
        [action.threadId]: true as const,
      };

      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      const filtered = list.filter((thread) => thread.id !== action.threadId);
      const nextActive =
        state.activeThreadIdByWorkspace[action.workspaceId] === action.threadId
          ? filtered[0]?.id ?? null
          : state.activeThreadIdByWorkspace[action.workspaceId] ?? null;

      return {
        ...state,
        hiddenThreadIdsByWorkspace: {
          ...state.hiddenThreadIdsByWorkspace,
          [action.workspaceId]: nextHiddenForWorkspace,
        },
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: filtered,
        },
        activeThreadIdByWorkspace: {
          ...state.activeThreadIdByWorkspace,
          [action.workspaceId]: nextActive,
        },
      };
    }
    case "removeThread": {
      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      const filtered = list.filter((thread) => thread.id !== action.threadId);
      const nextActive =
        state.activeThreadIdByWorkspace[action.workspaceId] === action.threadId
          ? filtered[0]?.id ?? null
          : state.activeThreadIdByWorkspace[action.workspaceId] ?? null;
      const localState = removeThreadLocalState(state, action.threadId);
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: filtered,
        },
        ...localState,
        activeThreadIdByWorkspace: {
          ...state.activeThreadIdByWorkspace,
          [action.workspaceId]: nextActive,
        },
      };
    }
    case "unloadThreadSnapshot": {
      const hasItems = Object.prototype.hasOwnProperty.call(
        state.itemsByThread,
        action.threadId,
      );
      const hasTurn = Object.prototype.hasOwnProperty.call(
        state.activeTurnIdByThread,
        action.threadId,
      );
      const hasDiff = Object.prototype.hasOwnProperty.call(
        state.turnDiffByThread,
        action.threadId,
      );
      const hasPlan = Object.prototype.hasOwnProperty.call(
        state.planByThread,
        action.threadId,
      );
      const hasTokenUsage = Object.prototype.hasOwnProperty.call(
        state.tokenUsageByThread,
        action.threadId,
      );
      const hasLastAgentMessage = Object.prototype.hasOwnProperty.call(
        state.lastAgentMessageByThread,
        action.threadId,
      );
      const hasThreadMaxItems = Object.prototype.hasOwnProperty.call(
        state.maxItemsPerThreadByThread,
        action.threadId,
      );
      if (
        !hasItems &&
        !hasTurn &&
        !hasDiff &&
        !hasPlan &&
        !hasTokenUsage &&
        !hasLastAgentMessage &&
        !hasThreadMaxItems
      ) {
        return state;
      }

      const { [action.threadId]: _items, ...restItems } = state.itemsByThread;
      const { [action.threadId]: _turn, ...restTurns } = state.activeTurnIdByThread;
      const { [action.threadId]: _diff, ...restDiffs } = state.turnDiffByThread;
      const { [action.threadId]: _plan, ...restPlans } = state.planByThread;
      const { [action.threadId]: _tokenUsage, ...restTokenUsage } =
        state.tokenUsageByThread;
      const { [action.threadId]: _lastAgentMessage, ...restLastAgentMessage } =
        state.lastAgentMessageByThread;
      const { [action.threadId]: _maxItems, ...restThreadMaxItems } =
        state.maxItemsPerThreadByThread;

      return {
        ...state,
        itemsByThread: restItems,
        maxItemsPerThreadByThread: restThreadMaxItems,
        activeTurnIdByThread: restTurns,
        turnDiffByThread: restDiffs,
        planByThread: restPlans,
        tokenUsageByThread: restTokenUsage,
        lastAgentMessageByThread: restLastAgentMessage,
      };
    }
    case "setThreadParent": {
      if (!action.parentId || action.parentId === action.threadId) {
        return state;
      }
      if (state.threadParentById[action.threadId] === action.parentId) {
        return state;
      }
      return {
        ...state,
        threadParentById: {
          ...state.threadParentById,
          [action.threadId]: action.parentId,
        },
      };
    }
    case "markProcessing": {
      const previous = state.threadStatusById[action.threadId];
      const wasProcessing = previous?.isProcessing ?? false;
      const startedAt = previous?.processingStartedAt ?? null;
      const lastDurationMs = previous?.lastDurationMs ?? null;
      const hasUnread = previous?.hasUnread ?? false;
      const isReviewing = previous?.isReviewing ?? false;
      if (action.isProcessing) {
        const nextStartedAt =
          wasProcessing && startedAt ? startedAt : action.timestamp;
        const nextStatus: ThreadStatus = {
          isProcessing: true,
          hasUnread,
          isReviewing,
          processingStartedAt: nextStartedAt,
          lastDurationMs,
        };
        if (previous && statusEquals(previous, nextStatus)) {
          return state;
        }
        return {
          ...state,
          threadStatusById: {
            ...state.threadStatusById,
            [action.threadId]: nextStatus,
          },
        };
      }
      const nextDuration =
        wasProcessing && startedAt
          ? Math.max(0, action.timestamp - startedAt)
          : lastDurationMs ?? null;
      const nextStatus: ThreadStatus = {
        isProcessing: false,
        hasUnread,
        isReviewing,
        processingStartedAt: null,
        lastDurationMs: nextDuration,
      };
      if (previous && statusEquals(previous, nextStatus)) {
        return state;
      }
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: nextStatus,
        },
      };
    }
    case "setActiveTurnId": {
      if (action.turnId === null) {
        if (!Object.prototype.hasOwnProperty.call(state.activeTurnIdByThread, action.threadId)) {
          return state;
        }
        const { [action.threadId]: _turn, ...restTurns } =
          state.activeTurnIdByThread;
        return {
          ...state,
          activeTurnIdByThread: restTurns,
        };
      }
      return {
        ...state,
        activeTurnIdByThread: {
          ...state.activeTurnIdByThread,
          [action.threadId]: action.turnId,
        },
      };
    }
    case "markReviewing": {
      const previous = state.threadStatusById[action.threadId];
      const nextStatus: ThreadStatus = {
        isProcessing: previous?.isProcessing ?? false,
        hasUnread: previous?.hasUnread ?? false,
        isReviewing: action.isReviewing,
        processingStartedAt: previous?.processingStartedAt ?? null,
        lastDurationMs: previous?.lastDurationMs ?? null,
      };
      if (previous && statusEquals(previous, nextStatus)) {
        return state;
      }
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: nextStatus,
        },
      };
    }
    case "markUnread": {
      const previous = state.threadStatusById[action.threadId];
      const nextStatus: ThreadStatus = {
        isProcessing: previous?.isProcessing ?? false,
        hasUnread: action.hasUnread,
        isReviewing: previous?.isReviewing ?? false,
        processingStartedAt: previous?.processingStartedAt ?? null,
        lastDurationMs: previous?.lastDurationMs ?? null,
      };
      if (previous && statusEquals(previous, nextStatus)) {
        return state;
      }
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: nextStatus,
        },
      };
    }
    case "setThreadName": {
      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      if (!list.length) {
        return state;
      }
      let didChange = false;
      const next = list.map((thread) => {
        if (thread.id !== action.threadId || thread.name === action.name) {
          return thread;
        }
        didChange = true;
        return { ...thread, name: action.name };
      });
      if (!didChange) {
        return state;
      }
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: next,
        },
      };
    }
    case "mergeThreadSummary": {
      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      if (!list.length) {
        return state;
      }
      let didChange = false;
      const next = list.map((thread) => {
        if (thread.id !== action.threadId) {
          return thread;
        }
        const patchEntries = Object.entries(action.patch).filter(
          ([, value]) => value !== undefined,
        ) as Array<[keyof typeof action.patch, NonNullable<(typeof action.patch)[keyof typeof action.patch]>]>;
        if (!patchEntries.length) {
          return thread;
        }
        let nextThread = thread;
        patchEntries.forEach(([key, value]) => {
          if (nextThread[key as keyof ThreadSummary] === value) {
            return;
          }
          nextThread = {
            ...nextThread,
            [key]: value,
          };
          didChange = true;
        });
        return nextThread;
      });
      if (!didChange) {
        return state;
      }
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: next,
        },
      };
    }
    case "setThreadTimestamp": {
      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      if (!list.length) {
        return state;
      }
      let didChange = false;
      const next = list.map((thread) => {
        if (thread.id !== action.threadId) {
          return thread;
        }
        const current = thread.updatedAt ?? 0;
        if (current >= action.timestamp) {
          return thread;
        }
        didChange = true;
        return { ...thread, updatedAt: action.timestamp };
      });
      if (!didChange) {
        return state;
      }
      const sorted = prefersUpdatedSort(state, action.workspaceId)
        ? [
            ...next.filter((thread) => thread.id === action.threadId),
            ...next.filter((thread) => thread.id !== action.threadId),
          ]
        : next;
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: sorted,
        },
      };
    }
    case "setThreads": {
      const hidden = state.hiddenThreadIdsByWorkspace[action.workspaceId] ?? {};
      const visibleThreads = action.threads.filter((thread) => !hidden[thread.id]);
      const preserveAnchors = action.preserveAnchors === true;
      if (!preserveAnchors) {
        const currentActiveThreadId =
          state.activeThreadIdByWorkspace[action.workspaceId] ?? null;
        const activeThreadStillVisible = currentActiveThreadId
          ? visibleThreads.some((thread) => thread.id === currentActiveThreadId)
          : false;
        return {
          ...state,
          threadsByWorkspace: {
            ...state.threadsByWorkspace,
            [action.workspaceId]: visibleThreads,
          },
          activeThreadIdByWorkspace: {
            ...state.activeThreadIdByWorkspace,
            [action.workspaceId]: activeThreadStillVisible
              ? currentActiveThreadId
              : (visibleThreads[0]?.id ?? null),
          },
          threadSortKeyByWorkspace: {
            ...state.threadSortKeyByWorkspace,
            [action.workspaceId]: action.sortKey,
          },
        };
      }
      const existingThreads = state.threadsByWorkspace[action.workspaceId] ?? [];
      const existingById = new Map(
        existingThreads.map((thread) => [thread.id, thread] as const),
      );
      const reconciled = [...visibleThreads];
      const includedIds = new Set(reconciled.map((thread) => thread.id));
      const freshenAnchorSummary = (summary: ThreadSummary) => {
        const lastMessageTimestamp =
          state.lastAgentMessageByThread[summary.id]?.timestamp ?? 0;
        const processingStartedAt =
          state.threadStatusById[summary.id]?.processingStartedAt ?? 0;
        const nextUpdatedAt = Math.max(
          summary.updatedAt ?? 0,
          lastMessageTimestamp,
          processingStartedAt,
        );
        if (nextUpdatedAt <= (summary.updatedAt ?? 0)) {
          return summary;
        }
        return {
          ...summary,
          updatedAt: nextUpdatedAt,
        };
      };
      const appendExistingAnchor = (threadId: string | null | undefined) => {
        if (!threadId || hidden[threadId] || includedIds.has(threadId)) {
          return;
        }
        const summary = existingById.get(threadId);
        if (!summary) {
          return;
        }
        reconciled.push(freshenAnchorSummary(summary));
        includedIds.add(threadId);
      };

      const activeThreadId = state.activeThreadIdByWorkspace[action.workspaceId];
      appendExistingAnchor(activeThreadId);
      existingThreads.forEach((thread) => {
        if (state.threadStatusById[thread.id]?.isProcessing) {
          appendExistingAnchor(thread.id);
        }
      });

      const seedThreadIds = [...includedIds];
      seedThreadIds.forEach((threadId) => {
        const visited = new Set<string>([threadId]);
        let parentId = state.threadParentById[threadId];
        while (parentId && !visited.has(parentId)) {
          visited.add(parentId);
          appendExistingAnchor(parentId);
          parentId = state.threadParentById[parentId];
        }
      });

      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: reconciled,
        },
        threadSortKeyByWorkspace: {
          ...state.threadSortKeyByWorkspace,
          [action.workspaceId]: action.sortKey,
        },
      };
    }
    case "setThreadListLoading":
      return {
        ...state,
        threadListLoadingByWorkspace: {
          ...state.threadListLoadingByWorkspace,
          [action.workspaceId]: action.isLoading,
        },
      };
    case "setThreadResumeLoading": {
      if (!action.isLoading) {
        if (
          !Object.prototype.hasOwnProperty.call(
            state.threadResumeLoadingById,
            action.threadId,
          )
        ) {
          return state;
        }
        const { [action.threadId]: _resumeLoading, ...restResumeLoading } =
          state.threadResumeLoadingById;
        return {
          ...state,
          threadResumeLoadingById: restResumeLoading,
        };
      }
      return {
        ...state,
        threadResumeLoadingById: {
          ...state.threadResumeLoadingById,
          [action.threadId]: action.isLoading,
        },
      };
    }
    case "setThreadListPaging":
      return {
        ...state,
        threadListPagingByWorkspace: {
          ...state.threadListPagingByWorkspace,
          [action.workspaceId]: action.isLoading,
        },
      };
    case "setThreadListCursor":
      return {
        ...state,
        threadListCursorByWorkspace: {
          ...state.threadListCursorByWorkspace,
          [action.workspaceId]: action.cursor,
        },
      };
    default:
      return state;
  }
}
