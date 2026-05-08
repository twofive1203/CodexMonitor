import type { RefObject } from "react";
import { useCallback } from "react";
import * as Sentry from "@sentry/react";
import type { AgentProvider, DebugEntry, WorkspaceInfo } from "../../../types";

type Params = {
  isCompact: boolean;
  addWorkspace: () => Promise<WorkspaceInfo | null>;
  addWorkspaceFromPath: (
    path: string,
    options?: { provider?: AgentProvider | null },
  ) => Promise<WorkspaceInfo | null>;
  addWorkspaceFromGitUrl: (
    url: string,
    destinationPath: string,
    targetFolderName?: string | null,
    options?: { provider?: AgentProvider | null },
  ) => Promise<WorkspaceInfo | null>;
  addWorkspacesFromPaths: (paths: string[]) => Promise<WorkspaceInfo | null>;
  setActiveThreadId: (threadId: string | null, workspaceId: string) => void;
  setActiveTab: (tab: "home" | "projects" | "codex" | "git" | "log") => void;
  exitDiffView: () => void;
  selectWorkspace: (workspaceId: string) => void;
  onStartNewAgentDraft: (workspaceId: string) => void;
  openWorktreePrompt: (workspace: WorkspaceInfo) => void;
  openClonePrompt: (workspace: WorkspaceInfo) => void;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  onDebug?: (entry: DebugEntry) => void;
};

export function useWorkspaceActions({
  isCompact,
  addWorkspace,
  addWorkspaceFromPath,
  addWorkspaceFromGitUrl,
  addWorkspacesFromPaths,
  setActiveThreadId,
  setActiveTab,
  exitDiffView,
  selectWorkspace,
  onStartNewAgentDraft,
  openWorktreePrompt,
  openClonePrompt,
  composerInputRef,
  onDebug,
}: Params) {
  const handleWorkspaceAdded = useCallback(
    (workspace: WorkspaceInfo) => {
      setActiveThreadId(null, workspace.id);
      if (isCompact) {
        setActiveTab("codex");
      }
    },
    [isCompact, setActiveTab, setActiveThreadId],
  );

  const handleAddWorkspace = useCallback(async () => {
    try {
      const workspace = await addWorkspace();
      if (workspace) {
        handleWorkspaceAdded(workspace);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onDebug?.({
        id: `${Date.now()}-client-add-workspace-error`,
        timestamp: Date.now(),
        source: "error",
        label: "workspace/add error",
        payload: message,
      });
      alert(`添加工作区失败。\n\n${message}`);
    }
  }, [addWorkspace, handleWorkspaceAdded, onDebug]);

  const handleAddWorkspacesFromPaths = useCallback(
    async (paths: string[]) => {
      try {
        const workspace = await addWorkspacesFromPaths(paths);
        if (workspace) {
          handleWorkspaceAdded(workspace);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onDebug?.({
          id: `${Date.now()}-client-add-workspace-error`,
          timestamp: Date.now(),
          source: "error",
          label: "workspace/add error",
          payload: message,
        });
        alert(`批量添加工作区失败。\n\n${message}`);
      }
    },
    [addWorkspacesFromPaths, handleWorkspaceAdded, onDebug],
  );

  const handleAddWorkspaceFromPath = useCallback(
    async (path: string, provider?: AgentProvider | null) => {
      try {
        const workspace = await addWorkspaceFromPath(path, { provider });
        if (workspace) {
          handleWorkspaceAdded(workspace);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onDebug?.({
          id: `${Date.now()}-client-add-workspace-error`,
          timestamp: Date.now(),
          source: "error",
          label: "workspace/add error",
          payload: message,
        });
        alert(`添加工作区失败。\n\n${message}`);
      }
    },
    [addWorkspaceFromPath, handleWorkspaceAdded, onDebug],
  );


  const handleAddWorkspaceFromGitUrl = useCallback(
    async (
      url: string,
      destinationPath: string,
      targetFolderName?: string | null,
      provider?: AgentProvider | null,
    ) => {
      try {
        const workspace = await addWorkspaceFromGitUrl(
          url,
          destinationPath,
          targetFolderName,
          { provider },
        );
        if (workspace) {
          handleWorkspaceAdded(workspace);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onDebug?.({
          id: `${Date.now()}-client-add-workspace-from-url-error`,
          timestamp: Date.now(),
          source: "error",
          label: "workspace/add-from-url error",
          payload: message,
        });
        alert(`通过仓库地址导入工作区失败。

${message}`);
        throw error;
      }
    },
    [addWorkspaceFromGitUrl, handleWorkspaceAdded, onDebug],
  );

  const handleAddAgent = useCallback(
    async (workspace: WorkspaceInfo) => {
      exitDiffView();
      selectWorkspace(workspace.id);
      setActiveThreadId(null, workspace.id);
      onStartNewAgentDraft(workspace.id);
      Sentry.metrics.count("agent_created", 1, {
        attributes: {
          workspace_id: workspace.id,
          thread_id: "draft",
        },
      });
      if (isCompact) {
        setActiveTab("codex");
      }
      setTimeout(() => composerInputRef.current?.focus(), 0);
    },
    [
      composerInputRef,
      exitDiffView,
      isCompact,
      onStartNewAgentDraft,
      selectWorkspace,
      setActiveThreadId,
      setActiveTab,
    ],
  );

  const handleAddWorktreeAgent = useCallback(
    async (workspace: WorkspaceInfo) => {
      exitDiffView();
      openWorktreePrompt(workspace);
    },
    [exitDiffView, openWorktreePrompt],
  );

  const handleAddCloneAgent = useCallback(
    async (workspace: WorkspaceInfo) => {
      exitDiffView();
      openClonePrompt(workspace);
    },
    [exitDiffView, openClonePrompt],
  );

  return {
    handleAddWorkspace,
    handleAddWorkspacesFromPaths,
    handleAddWorkspaceFromPath,
    handleAddWorkspaceFromGitUrl,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
  };
}
