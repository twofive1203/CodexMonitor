import { useCallback } from "react";
import type { DebugEntry, LaunchScriptEntry, WorkspaceInfo, WorkspaceSettings } from "@/types";
import { useTerminalController } from "@/features/terminal/hooks/useTerminalController";
import { useWorkspaceLaunchScript } from "@app/hooks/useWorkspaceLaunchScript";
import { useWorkspaceLaunchScripts } from "@app/hooks/useWorkspaceLaunchScripts";
import { useWorktreeSetupScript } from "@app/hooks/useWorktreeSetupScript";

type UseTerminalOrchestrationParams = {
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceInfo | null;
  terminalOpen: boolean;
  openTerminal: () => void;
  closeTerminalPanel: () => void;
  handleToggleTerminal: () => void;
  updateWorkspaceSettings: (
    id: string,
    settings: WorkspaceSettings,
  ) => Promise<WorkspaceInfo>;
  addDebugEntry: (entry: DebugEntry) => void;
};

/**
 * 方法说明：装配 Terminal 运行时，并连接启动脚本和 worktree setup 脚本。
 * 入参说明：params 提供当前工作区、Terminal 面板控制函数、工作区设置更新函数和调试日志函数。
 */
export function useTerminalOrchestration({
  activeWorkspaceId,
  activeWorkspace,
  terminalOpen,
  openTerminal,
  closeTerminalPanel,
  handleToggleTerminal,
  updateWorkspaceSettings,
  addDebugEntry,
}: UseTerminalOrchestrationParams) {
  const {
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    terminalState,
    ensureTerminalWithTitle,
    restartTerminalSession,
    requestTerminalFocus,
  } = useTerminalController({
    activeWorkspaceId,
    activeWorkspace,
    terminalOpen,
    onCloseTerminalPanel: closeTerminalPanel,
    onDebug: addDebugEntry,
  });

  const ensureLaunchTerminal = useCallback(
    (workspaceId: string) => ensureTerminalWithTitle(workspaceId, "launch", "启动"),
    [ensureTerminalWithTitle],
  );

  const openTerminalWithFocus = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    requestTerminalFocus();
    openTerminal();
  }, [activeWorkspaceId, openTerminal, requestTerminalFocus]);

  const handleToggleTerminalWithFocus = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    if (!terminalOpen) {
      requestTerminalFocus();
    }
    handleToggleTerminal();
  }, [
    activeWorkspaceId,
    handleToggleTerminal,
    requestTerminalFocus,
    terminalOpen,
  ]);

  const launchScriptState = useWorkspaceLaunchScript({
    activeWorkspace,
    updateWorkspaceSettings,
    openTerminal: openTerminalWithFocus,
    ensureLaunchTerminal,
    restartLaunchSession: restartTerminalSession,
    terminalState,
    activeTerminalId,
  });

  const launchScriptsState = useWorkspaceLaunchScripts({
    activeWorkspace,
    updateWorkspaceSettings,
    openTerminal: openTerminalWithFocus,
    ensureLaunchTerminal: (
      workspaceId: string,
      entry: LaunchScriptEntry,
      title: string,
    ) => {
      const label = entry.label?.trim() || entry.icon;
      return ensureTerminalWithTitle(
        workspaceId,
        `launch:${entry.id}`,
        title || `启动：${label}`,
      );
    },
    restartLaunchSession: restartTerminalSession,
    terminalState,
    activeTerminalId,
  });

  const worktreeSetupScriptState = useWorktreeSetupScript({
    ensureTerminalWithTitle,
    restartTerminalSession,
    openTerminal,
    onDebug: addDebugEntry,
  });

  const handleWorktreeCreated = useCallback(
    async (worktree: WorkspaceInfo, _parentWorkspace?: WorkspaceInfo) => {
      await worktreeSetupScriptState.maybeRunWorktreeSetupScript(worktree);
    },
    [worktreeSetupScriptState],
  );

  return {
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    terminalState,
    launchScriptState,
    launchScriptsState,
    handleWorktreeCreated,
    handleToggleTerminalWithFocus,
    openTerminalWithFocus,
  };
}
