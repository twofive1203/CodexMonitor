import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeCommandOption, DebugEntry, WorkspaceInfo } from "@/types";
import { getClaudeCommandsList } from "@services/tauri";

type UseClaudeCommandsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onDebug?: (entry: DebugEntry) => void;
};

/**
 * 读取当前 Claude 工作区下的自定义 slash 命令。
 *
 * `activeWorkspace`：当前激活的工作区。
 * `onDebug`：可选调试日志回调。
 */
export function useClaudeCommands({
  activeWorkspace,
  onDebug,
}: UseClaudeCommandsOptions) {
  const [commands, setCommands] = useState<ClaudeCommandOption[]>([]);
  const lastFetchedWorkspaceId = useRef<string | null>(null);
  const inFlight = useRef(false);

  const workspaceId = activeWorkspace?.id ?? null;
  const isConnected = Boolean(activeWorkspace?.connected);
  const isClaudeWorkspace = activeWorkspace?.provider === "claude";

  /**
   * 拉取 Claude 自定义命令列表。
   *
   * 无入参，内部直接读取当前激活工作区。
   */
  const refreshCommands = useCallback(async () => {
    if (!workspaceId || !isConnected || !isClaudeWorkspace) {
      setCommands([]);
      return;
    }
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    onDebug?.({
      id: `${Date.now()}-client-claude-commands-list`,
      timestamp: Date.now(),
      source: "client",
      label: "claude_commands/list",
      payload: { workspaceId },
    });
    try {
      const response = await getClaudeCommandsList(workspaceId);
      onDebug?.({
        id: `${Date.now()}-server-claude-commands-list`,
        timestamp: Date.now(),
        source: "server",
        label: "claude_commands/list response",
        payload: response,
      });
      const responsePayload =
        response && typeof response === "object" && !Array.isArray(response)
          ? (response as Record<string, unknown>)
          : null;
      const rawCommands = Array.isArray(response)
        ? response
        : Array.isArray(responsePayload?.commands)
          ? responsePayload.commands
          : responsePayload?.result &&
              typeof responsePayload.result === "object" &&
              !Array.isArray(responsePayload.result) &&
              Array.isArray((responsePayload.result as Record<string, unknown>).commands)
            ? ((responsePayload.result as Record<string, unknown>).commands as unknown[])
            : Array.isArray(responsePayload?.result)
              ? responsePayload.result
              : [];
      const parsed: ClaudeCommandOption[] = rawCommands
        .map((item) => {
          const record =
            item && typeof item === "object" && !Array.isArray(item)
              ? (item as Record<string, unknown>)
              : {};
          return {
            name: String(record.name ?? "").trim(),
            path: String(record.path ?? "").trim(),
            description: record.description ? String(record.description).trim() : undefined,
            argumentHint:
              record.argumentHint ?? record.argument_hint
                ? String(record.argumentHint ?? record.argument_hint).trim()
                : undefined,
          };
        })
        .filter((item: ClaudeCommandOption) => item.name);
      setCommands(parsed);
      lastFetchedWorkspaceId.current = workspaceId;
    } catch (error) {
      onDebug?.({
        id: `${Date.now()}-client-claude-commands-list-error`,
        timestamp: Date.now(),
        source: "error",
        label: "claude_commands/list error",
        payload: error instanceof Error ? error.message : String(error),
      });
      setCommands([]);
    } finally {
      inFlight.current = false;
    }
  }, [isClaudeWorkspace, isConnected, onDebug, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !isConnected || !isClaudeWorkspace) {
      lastFetchedWorkspaceId.current = null;
      setCommands([]);
      return;
    }
    if (lastFetchedWorkspaceId.current === workspaceId && commands.length > 0) {
      return;
    }
    void refreshCommands();
  }, [commands.length, isClaudeWorkspace, isConnected, refreshCommands, workspaceId]);

  const commandOptions = useMemo(
    () => commands.filter((command) => command.name),
    [commands],
  );

  return {
    commands: commandOptions,
    refreshCommands,
  };
}
