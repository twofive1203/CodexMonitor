import { useCallback, useState } from "react";

type UsePanelVisibilityOptions = {
  debugLogEnabled: boolean;
  isCompact: boolean;
  activeWorkspaceId: string | null;
  setActiveTab: (tab: "home" | "codex" | "git" | "log" | "projects") => void;
  setDebugOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
};

/**
 * 管理桌面和紧凑布局下的调试面板、终端面板可见性。
 *
 * @param options 面板可见性依赖的布局、工作区和状态更新回调。
 */
export function usePanelVisibility({
  debugLogEnabled,
  isCompact,
  activeWorkspaceId,
  setActiveTab,
  setDebugOpen,
}: UsePanelVisibilityOptions) {
  const [terminalOpen, setTerminalOpen] = useState(false);

  const onToggleDebug = useCallback(() => {
    if (!debugLogEnabled) {
      setDebugOpen(false);
      return;
    }
    if (isCompact) {
      setActiveTab("log");
      return;
    }
    setDebugOpen((prev) => !prev);
  }, [debugLogEnabled, isCompact, setActiveTab, setDebugOpen]);

  const onToggleTerminal = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    setTerminalOpen((prev) => !prev);
  }, [activeWorkspaceId]);

  const openTerminal = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    setTerminalOpen(true);
  }, [activeWorkspaceId]);

  const closeTerminal = useCallback(() => {
    setTerminalOpen(false);
  }, []);

  return {
    terminalOpen,
    onToggleDebug,
    onToggleTerminal,
    openTerminal,
    closeTerminal,
  };
}
