import { getWorkspaceProvider } from "@utils/agentProvider";

import type {
  AgentProvider,
  WorkspaceInfo,
  WorkspaceSettings,
} from "@/types";

type UpdateWorkspaceSettingsWithHistoryRefreshArgs = {
  workspace: WorkspaceInfo;
  patch: Partial<WorkspaceSettings>;
  provider?: AgentProvider | null;
  updateWorkspaceSettings: (
    workspaceId: string,
    patch: Partial<WorkspaceSettings>,
    provider?: AgentProvider | null,
  ) => Promise<WorkspaceInfo>;
  resetWorkspaceThreads: (workspaceId: string) => void;
  listThreadsForWorkspace: (workspace: WorkspaceInfo) => Promise<unknown>;
};

/**
 * 更新工作区设置，并在 provider 发生变化后刷新历史会话列表。
 *
 * `workspace`：更新前的工作区快照。
 * `patch`：需要持久化的工作区设置补丁。
 * `provider`：目标 provider，可为空。
 * `updateWorkspaceSettings`：工作区设置持久化方法。
 * `resetWorkspaceThreads`：重置工作区线程加载状态的方法。
 * `listThreadsForWorkspace`：重新拉取工作区历史会话的方法。
 */
export async function updateWorkspaceSettingsWithHistoryRefresh({
  workspace,
  patch,
  provider,
  updateWorkspaceSettings,
  resetWorkspaceThreads,
  listThreadsForWorkspace,
}: UpdateWorkspaceSettingsWithHistoryRefreshArgs): Promise<WorkspaceInfo> {
  const previousProvider = getWorkspaceProvider(workspace);
  const updatedWorkspace = await updateWorkspaceSettings(workspace.id, patch, provider);
  const nextProvider = getWorkspaceProvider(updatedWorkspace);

  if (
    provider !== undefined &&
    provider !== null &&
    previousProvider !== nextProvider
  ) {
    resetWorkspaceThreads(updatedWorkspace.id);
    await listThreadsForWorkspace(updatedWorkspace);
  }

  return updatedWorkspace;
}
