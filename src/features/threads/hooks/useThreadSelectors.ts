import { useMemo } from "react";
import type { ConversationItem } from "@/types";
import { enrichConversationItemsWithThreads } from "@utils/threadItems";
import type { ThreadState } from "./useThreadsReducer";

type UseThreadSelectorsOptions = {
  activeWorkspaceId: string | null;
  activeThreadIdByWorkspace: ThreadState["activeThreadIdByWorkspace"];
  itemsByThread: ThreadState["itemsByThread"];
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
};

export function useThreadSelectors({
  activeWorkspaceId,
  activeThreadIdByWorkspace,
  itemsByThread,
  threadsByWorkspace,
}: UseThreadSelectorsOptions) {
  const activeThreadId = useMemo(() => {
    if (!activeWorkspaceId) {
      return null;
    }
    return activeThreadIdByWorkspace[activeWorkspaceId] ?? null;
  }, [activeThreadIdByWorkspace, activeWorkspaceId]);

  const activeItems = useMemo<ConversationItem[]>(
    () => {
      if (!activeThreadId) {
        return [];
      }
      const items = itemsByThread[activeThreadId] ?? [];
      const threads = activeWorkspaceId ? threadsByWorkspace[activeWorkspaceId] ?? [] : [];
      return enrichConversationItemsWithThreads(items, threads);
    },
    [activeThreadId, activeWorkspaceId, itemsByThread, threadsByWorkspace],
  );

  return { activeThreadId, activeItems };
}
