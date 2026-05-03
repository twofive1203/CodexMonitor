import { useCallback, useEffect, useRef } from "react";
import type { DebugEntry, RateLimitSnapshot } from "@/types";
import { getAccountRateLimits } from "@services/tauri";
import { normalizeRateLimits } from "@threads/utils/threadNormalize";
import type { ThreadAction } from "./useThreadsReducer";

type UseThreadRateLimitsOptions = {
  activeWorkspaceId: string | null;
  activeWorkspaceConnected?: boolean;
  getCurrentRateLimits?: (workspaceId: string) => RateLimitSnapshot | null;
  dispatch: React.Dispatch<ThreadAction>;
  onDebug?: (entry: DebugEntry) => void;
};

/**
 * 判断未知值是否为普通对象。
 *
 * @param value 需要检查的未知值。
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function useThreadRateLimits({
  activeWorkspaceId,
  activeWorkspaceConnected,
  getCurrentRateLimits,
  dispatch,
  onDebug,
}: UseThreadRateLimitsOptions) {
  const getCurrentRateLimitsRef = useRef(getCurrentRateLimits);
  useEffect(() => {
    getCurrentRateLimitsRef.current = getCurrentRateLimits;
  }, [getCurrentRateLimits]);

  const refreshAccountRateLimits = useCallback(
    async (workspaceId?: string) => {
      const targetId = workspaceId ?? activeWorkspaceId;
      if (!targetId) {
        return;
      }
      onDebug?.({
        id: `${Date.now()}-client-account-rate-limits`,
        timestamp: Date.now(),
        source: "client",
        label: "account/rateLimits/read",
        payload: { workspaceId: targetId },
      });
      try {
        const response = await getAccountRateLimits(targetId);
        onDebug?.({
          id: `${Date.now()}-server-account-rate-limits`,
          timestamp: Date.now(),
          source: "server",
          label: "account/rateLimits/read response",
          payload: response,
        });
        const result = asRecord(response?.result);
        const rateLimits = asRecord(
          result?.rateLimits ??
            result?.rate_limits ??
            response?.rateLimits ??
            response?.rate_limits,
        );
        if (rateLimits) {
          const previousRateLimits =
            getCurrentRateLimitsRef.current?.(targetId) ?? null;
          dispatch({
            type: "setRateLimits",
            workspaceId: targetId,
            rateLimits: normalizeRateLimits(rateLimits, previousRateLimits),
          });
        }
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-account-rate-limits-error`,
          timestamp: Date.now(),
          source: "error",
          label: "account/rateLimits/read error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeWorkspaceId, dispatch, onDebug],
  );

  useEffect(() => {
    if (activeWorkspaceConnected && activeWorkspaceId) {
      void refreshAccountRateLimits(activeWorkspaceId);
    }
  }, [activeWorkspaceConnected, activeWorkspaceId, refreshAccountRateLimits]);

  return { refreshAccountRateLimits };
}
