import type { ThreadAction, ThreadState } from "../useThreadsReducer";

const MAX_TURN_DIFF_CHARS = 100_000;

/**
 * 限制线程级 diff 缓存长度，避免单条更新长期占用过多前端内存。
 *
 * @param diff 原始线程级差异文本。
 * @returns 截断后的差异文本。
 */
function trimTurnDiff(diff: string) {
  if (diff.length <= MAX_TURN_DIFF_CHARS) {
    return diff;
  }
  return `${diff.slice(0, MAX_TURN_DIFF_CHARS - 3)}...`;
}

export function reduceThreadSnapshots(
  state: ThreadState,
  action: ThreadAction,
): ThreadState {
  switch (action.type) {
    case "setLastAgentMessage":
      if (
        state.lastAgentMessageByThread[action.threadId]?.timestamp >= action.timestamp
      ) {
        return state;
      }
      return {
        ...state,
        lastAgentMessageByThread: {
          ...state.lastAgentMessageByThread,
          [action.threadId]: { text: action.text, timestamp: action.timestamp },
        },
      };
    case "setThreadTokenUsage":
      return {
        ...state,
        tokenUsageByThread: {
          ...state.tokenUsageByThread,
          [action.threadId]: action.tokenUsage,
        },
      };
    case "setRateLimits":
      return {
        ...state,
        rateLimitsByWorkspace: {
          ...state.rateLimitsByWorkspace,
          [action.workspaceId]: action.rateLimits,
        },
      };
    case "setAccountInfo":
      return {
        ...state,
        accountByWorkspace: {
          ...state.accountByWorkspace,
          [action.workspaceId]: action.account,
        },
      };
    case "setThreadTurnDiff":
      return {
        ...state,
        turnDiffByThread: {
          ...state.turnDiffByThread,
          [action.threadId]: trimTurnDiff(action.diff),
        },
      };
    case "setThreadPlan":
      return {
        ...state,
        planByThread: {
          ...state.planByThread,
          [action.threadId]: action.plan,
        },
      };
    case "clearThreadPlan":
      return {
        ...state,
        planByThread: {
          ...state.planByThread,
          [action.threadId]: null,
        },
      };
    default:
      return state;
  }
}
