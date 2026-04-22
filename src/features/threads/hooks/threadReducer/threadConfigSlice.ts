import { CHAT_SCROLLBACK_DEFAULT } from "@utils/chatScrollback";
import {
  getThreadMaxItemsPerThread,
  type ThreadAction,
  type ThreadState,
} from "../useThreadsReducer";

export function normalizeMaxItemsPerThread(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return CHAT_SCROLLBACK_DEFAULT;
  }
  return Math.floor(value);
}

/**
 * 按指定条数上限裁剪线程条目列表。
 *
 * @param items 当前线程已保存的条目列表。
 * @param maxItemsPerThread 生效条数上限，`null` 表示不限条数。
 * @returns 裁剪后的条目列表；若无需裁剪则返回原数组引用。
 */
function trimThreadItems(
  items: ThreadState["itemsByThread"][string],
  maxItemsPerThread: number | null,
) {
  if (maxItemsPerThread === null || items.length <= maxItemsPerThread) {
    return items;
  }
  return items.slice(-maxItemsPerThread);
}

export function reduceThreadConfig(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case "setMaxItemsPerThread": {
      const normalized = normalizeMaxItemsPerThread(action.maxItemsPerThread);
      if (state.maxItemsPerThread === normalized) {
        return state;
      }

      let itemsByThread = state.itemsByThread;
      if (normalized !== null) {
        for (const [threadId, items] of Object.entries(state.itemsByThread)) {
          const maxItemsPerThread = getThreadMaxItemsPerThread(
            {
              maxItemsPerThread: normalized,
              maxItemsPerThreadByThread: state.maxItemsPerThreadByThread,
            },
            threadId,
          );
          const trimmed = trimThreadItems(items, maxItemsPerThread);
          if (trimmed === items) {
            continue;
          }
          if (itemsByThread === state.itemsByThread) {
            itemsByThread = { ...state.itemsByThread };
          }
          itemsByThread[threadId] = trimmed;
        }
      }

      return {
        ...state,
        maxItemsPerThread: normalized,
        itemsByThread,
      };
    }
    case "setThreadMaxItemsPerThread": {
      const normalized = normalizeMaxItemsPerThread(action.maxItemsPerThread);
      const hasOverride = Object.prototype.hasOwnProperty.call(
        state.maxItemsPerThreadByThread,
        action.threadId,
      );
      const currentOverride = hasOverride
        ? state.maxItemsPerThreadByThread[action.threadId]
        : undefined;
      const shouldClearOverride = normalized === state.maxItemsPerThread;

      let maxItemsPerThreadByThread = state.maxItemsPerThreadByThread;
      if (shouldClearOverride) {
        if (hasOverride) {
          const { [action.threadId]: _removed, ...restOverrides } =
            state.maxItemsPerThreadByThread;
          maxItemsPerThreadByThread = restOverrides;
        }
      } else if (!hasOverride || currentOverride !== normalized) {
        maxItemsPerThreadByThread = {
          ...state.maxItemsPerThreadByThread,
          [action.threadId]: normalized,
        };
      }

      const currentItems = state.itemsByThread[action.threadId];
      const effectiveMaxItemsPerThread = shouldClearOverride
        ? state.maxItemsPerThread
        : normalized;
      const trimmedItems = currentItems
        ? trimThreadItems(currentItems, effectiveMaxItemsPerThread)
        : undefined;

      if (
        maxItemsPerThreadByThread === state.maxItemsPerThreadByThread &&
        (!currentItems || trimmedItems === currentItems)
      ) {
        return state;
      }

      let nextItemsByThread = state.itemsByThread;
      if (currentItems && trimmedItems && trimmedItems !== currentItems) {
        nextItemsByThread = {
          ...state.itemsByThread,
          [action.threadId]: trimmedItems,
        };
      }

      return {
        ...state,
        maxItemsPerThreadByThread,
        itemsByThread: nextItemsByThread,
      };
    }
    default:
      return state;
  }
}
