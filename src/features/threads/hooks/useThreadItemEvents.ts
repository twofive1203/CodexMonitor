import { useCallback, useEffect, useRef } from "react";
import type { Dispatch } from "react";
import { buildConversationItem } from "@utils/threadItems";
import type { CollabAgentRef } from "@/types";
import {
  buildItemForDisplay,
  handleConvertedItemEffects,
} from "./threadItemEventHelpers";
import type { ThreadAction } from "./useThreadsReducer";

type UseThreadItemEventsOptions = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  safeMessageActivity: () => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  applyCollabThreadLinks: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  hydrateSubagentThreads?: (
    workspaceId: string,
    receivers: CollabAgentRef[],
  ) => void | Promise<void>;
  onUserMessageCreated?: (
    workspaceId: string,
    threadId: string,
    text: string,
  ) => void | Promise<void>;
  onReviewExited?: (workspaceId: string, threadId: string) => void;
};

const STREAM_DELTA_FLUSH_DELAY_MS = 80;
const STREAM_DELTA_EAGER_FLUSH_CHARS = 12_000;

type StreamDeltaAction =
  | Extract<ThreadAction, { type: "appendAgentDelta" }>
  | Extract<ThreadAction, { type: "appendReasoningSummary" }>
  | Extract<ThreadAction, { type: "appendReasoningContent" }>
  | Extract<ThreadAction, { type: "appendPlanDelta" }>
  | Extract<ThreadAction, { type: "appendToolOutput" }>;

/**
 * 方法说明：生成流式增量缓存键，确保同一条目同一类增量按顺序合并。
 * 入参说明：action 为待缓存的线程流式增量动作。
 */
function getStreamDeltaBatchKey(action: StreamDeltaAction) {
  return `${action.type}\u0000${action.threadId}\u0000${action.itemId}`;
}

/**
 * 方法说明：合并同一条目的流式增量，保留最新元数据并拼接文本。
 * 入参说明：previous 为已有缓存动作，next 为新到达动作。
 */
function mergeStreamDeltaAction(
  previous: StreamDeltaAction,
  next: StreamDeltaAction,
): StreamDeltaAction {
  return {
    ...next,
    delta: `${previous.delta}${next.delta}`,
  } as StreamDeltaAction;
}

export function useThreadItemEvents({
  activeThreadId,
  dispatch,
  getCustomName,
  markProcessing,
  markReviewing,
  safeMessageActivity,
  recordThreadActivity,
  applyCollabThreadLinks,
  hydrateSubagentThreads,
  onUserMessageCreated,
  onReviewExited,
}: UseThreadItemEventsOptions) {
  const pendingStreamDeltasRef = useRef<Map<string, StreamDeltaAction>>(new Map());
  const streamDeltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushStreamDeltas = useCallback(() => {
    if (streamDeltaTimerRef.current) {
      clearTimeout(streamDeltaTimerRef.current);
      streamDeltaTimerRef.current = null;
    }
    const pending = pendingStreamDeltasRef.current;
    if (pending.size === 0) {
      return;
    }
    pendingStreamDeltasRef.current = new Map();
    pending.forEach((action) => {
      dispatch(action);
    });
  }, [dispatch]);

  const scheduleStreamDeltaFlush = useCallback(() => {
    if (streamDeltaTimerRef.current) {
      return;
    }
    streamDeltaTimerRef.current = setTimeout(() => {
      flushStreamDeltas();
    }, STREAM_DELTA_FLUSH_DELAY_MS);
  }, [flushStreamDeltas]);

  const enqueueStreamDelta = useCallback(
    (action: StreamDeltaAction) => {
      const key = getStreamDeltaBatchKey(action);
      const pending = pendingStreamDeltasRef.current;
      const previous = pending.get(key);
      const nextAction = previous ? mergeStreamDeltaAction(previous, action) : action;
      pending.set(key, nextAction);
      if (nextAction.delta.length >= STREAM_DELTA_EAGER_FLUSH_CHARS) {
        flushStreamDeltas();
        return;
      }
      scheduleStreamDeltaFlush();
    },
    [flushStreamDeltas, scheduleStreamDeltaFlush],
  );

  useEffect(() => flushStreamDeltas, [flushStreamDeltas]);

  const handleItemUpdate = useCallback(
    (
      workspaceId: string,
      threadId: string,
      item: Record<string, unknown>,
      shouldMarkProcessing: boolean,
    ) => {
      dispatch({ type: "ensureThread", workspaceId, threadId });
      if (shouldMarkProcessing) {
        markProcessing(threadId, true);
      }
      flushStreamDeltas();
      applyCollabThreadLinks(workspaceId, threadId, item);
      const itemType = String(item?.type ?? "");
      if (itemType === "enteredReviewMode") {
        markReviewing(threadId, true);
      } else if (itemType === "exitedReviewMode") {
        markReviewing(threadId, false);
        markProcessing(threadId, false);
        if (!shouldMarkProcessing) {
          onReviewExited?.(workspaceId, threadId);
        }
      }
      const itemForDisplay = buildItemForDisplay(item, shouldMarkProcessing);
      const converted = buildConversationItem(itemForDisplay);
      handleConvertedItemEffects({
        converted,
        workspaceId,
        threadId,
        hydrateSubagentThreads,
        onUserMessageCreated,
      });
      if (converted) {
        dispatch({
          type: "upsertItem",
          workspaceId,
          threadId,
          item: converted,
          hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
        });
      }
      safeMessageActivity();
    },
    [
      applyCollabThreadLinks,
      dispatch,
      flushStreamDeltas,
      getCustomName,
      markProcessing,
      markReviewing,
      onReviewExited,
      onUserMessageCreated,
      hydrateSubagentThreads,
      safeMessageActivity,
    ],
  );

  const handleToolOutputDelta = useCallback(
    (threadId: string, itemId: string, delta: string) => {
      markProcessing(threadId, true);
      enqueueStreamDelta({ type: "appendToolOutput", threadId, itemId, delta });
      safeMessageActivity();
    },
    [enqueueStreamDelta, markProcessing, safeMessageActivity],
  );

  const handleTerminalInteraction = useCallback(
    (threadId: string, itemId: string, stdin: string) => {
      if (!stdin) {
        return;
      }
      const normalized = stdin.replace(/\r\n/g, "\n");
      const suffix = normalized.endsWith("\n") ? "" : "\n";
      handleToolOutputDelta(threadId, itemId, `\n[stdin]\n${normalized}${suffix}`);
    },
    [handleToolOutputDelta],
  );

  const onAgentMessageDelta = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      delta,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
    }) => {
      dispatch({ type: "ensureThread", workspaceId, threadId });
      markProcessing(threadId, true);
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      enqueueStreamDelta({
        type: "appendAgentDelta",
        workspaceId,
        threadId,
        itemId,
        delta,
        hasCustomName,
      });
    },
    [dispatch, enqueueStreamDelta, getCustomName, markProcessing],
  );

  const onAgentMessageCompleted = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      text,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      text: string;
    }) => {
      const timestamp = Date.now();
      dispatch({ type: "ensureThread", workspaceId, threadId });
      flushStreamDeltas();
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      dispatch({
        type: "completeAgentMessage",
        workspaceId,
        threadId,
        itemId,
        text,
        hasCustomName,
      });
      dispatch({
        type: "setThreadTimestamp",
        workspaceId,
        threadId,
        timestamp,
      });
      dispatch({
        type: "setLastAgentMessage",
        threadId,
        text,
        timestamp,
      });
      recordThreadActivity(workspaceId, threadId, timestamp);
      safeMessageActivity();
      if (threadId !== activeThreadId) {
        dispatch({ type: "markUnread", threadId, hasUnread: true });
      }
    },
    [
      activeThreadId,
      dispatch,
      flushStreamDeltas,
      getCustomName,
      recordThreadActivity,
      safeMessageActivity,
    ],
  );

  const onItemStarted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, true);
    },
    [handleItemUpdate],
  );

  const onItemCompleted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, false);
    },
    [handleItemUpdate],
  );

  const onReasoningSummaryDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      enqueueStreamDelta({ type: "appendReasoningSummary", threadId, itemId, delta });
    },
    [enqueueStreamDelta],
  );

  const onReasoningSummaryBoundary = useCallback(
    (_workspaceId: string, threadId: string, itemId: string) => {
      flushStreamDeltas();
      dispatch({ type: "appendReasoningSummaryBoundary", threadId, itemId });
    },
    [dispatch, flushStreamDeltas],
  );

  const onReasoningTextDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      enqueueStreamDelta({ type: "appendReasoningContent", threadId, itemId, delta });
    },
    [enqueueStreamDelta],
  );

  const onPlanDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      enqueueStreamDelta({ type: "appendPlanDelta", threadId, itemId, delta });
    },
    [enqueueStreamDelta],
  );

  const onCommandOutputDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      handleToolOutputDelta(threadId, itemId, delta);
    },
    [handleToolOutputDelta],
  );

  const onTerminalInteraction = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, stdin: string) => {
      handleTerminalInteraction(threadId, itemId, stdin);
    },
    [handleTerminalInteraction],
  );

  const onFileChangeOutputDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      handleToolOutputDelta(threadId, itemId, delta);
    },
    [handleToolOutputDelta],
  );

  return {
    onAgentMessageDelta,
    onAgentMessageCompleted,
    onItemStarted,
    onItemCompleted,
    onReasoningSummaryDelta,
    onReasoningSummaryBoundary,
    onReasoningTextDelta,
    onPlanDelta,
    onCommandOutputDelta,
    onTerminalInteraction,
    onFileChangeOutputDelta,
  };
}
