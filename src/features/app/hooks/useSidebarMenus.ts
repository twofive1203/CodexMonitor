import { useCallback, type MouseEvent } from "react";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { AgentProvider, WorkspaceInfo } from "../../../types";
import { pushErrorToast } from "../../../services/toasts";
import { fileManagerName } from "../../../utils/platformPaths";
import {
  canEditWorkspaceProvider,
  getAgentProviderLabel,
  getWorkspaceProvider,
} from "@utils/agentProvider";

type SidebarMenuHandlers = {
  claudeEnabled: boolean;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  onPinThread: (workspaceId: string, threadId: string) => void;
  onUnpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onUpdateWorkspaceProvider: (
    workspaceId: string,
    provider: AgentProvider,
  ) => void | Promise<unknown>;
};

/**
 * 构建工作区运行时相关菜单项。
 *
 * `workspace`：当前右键命中的工作区。
 * `claudeEnabled`：Claude 实验能力是否已开启。
 * `onUpdateWorkspaceProvider`：更新工作区运行时的回调。
 */
async function buildWorkspaceProviderMenuItems({
  workspace,
  claudeEnabled,
  onUpdateWorkspaceProvider,
}: {
  workspace: WorkspaceInfo;
  claudeEnabled: boolean;
  onUpdateWorkspaceProvider: (
    workspaceId: string,
    provider: AgentProvider,
  ) => void | Promise<unknown>;
}) {
  const currentProvider = getWorkspaceProvider(workspace);
  if (!claudeEnabled && currentProvider !== "claude") {
    return [] as MenuItem[];
  }

  const providerEditable = canEditWorkspaceProvider(workspace, {
    experimentalClaudeEnabled: claudeEnabled,
  });
  const currentProviderLabel = getAgentProviderLabel(currentProvider);
  const items = [
    await MenuItem.new({
      text: providerEditable
        ? `当前运行时：${currentProviderLabel}`
        : `当前运行时：${currentProviderLabel}（开启 Claude 实验功能后可切换）`,
      enabled: false,
    }),
  ];

  if (!providerEditable) {
    return items;
  }

  const targetProviders: AgentProvider[] =
    currentProvider === "claude"
      ? ["codex"]
      : claudeEnabled
        ? ["claude"]
        : [];

  for (const provider of targetProviders) {
    items.push(
      await MenuItem.new({
        text: `切换到 ${getAgentProviderLabel(provider)}`,
        action: () => {
          void onUpdateWorkspaceProvider(workspace.id, provider);
        },
      }),
    );
  }

  return items;
}

export function useSidebarMenus({
  claudeEnabled,
  onDeleteThread,
  onSyncThread,
  onPinThread,
  onUnpinThread,
  isThreadPinned,
  onRenameThread,
  onReloadWorkspaceThreads,
  onDeleteWorkspace,
  onDeleteWorktree,
  onUpdateWorkspaceProvider,
}: SidebarMenuHandlers) {
  const showThreadMenu = useCallback(
    async (
      event: MouseEvent,
      workspaceId: string,
      threadId: string,
      canPin: boolean,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const renameItem = await MenuItem.new({
        text: "重命名",
        action: () => onRenameThread(workspaceId, threadId),
      });
      const syncItem = await MenuItem.new({
        text: "从服务器同步",
        action: () => onSyncThread(workspaceId, threadId),
      });
      const archiveItem = await MenuItem.new({
        text: "归档",
        action: () => onDeleteThread(workspaceId, threadId),
      });
      const copyItem = await MenuItem.new({
        text: "复制 ID",
        action: async () => {
          try {
            await navigator.clipboard.writeText(threadId);
          } catch {
            // Clipboard failures are non-fatal here.
          }
        },
      });
      const items = [renameItem, syncItem];
      if (canPin) {
        const isPinned = isThreadPinned(workspaceId, threadId);
        items.push(
          await MenuItem.new({
            text: isPinned ? "取消置顶" : "置顶",
            action: () => {
              if (isPinned) {
                onUnpinThread(workspaceId, threadId);
              } else {
                onPinThread(workspaceId, threadId);
              }
            },
          }),
        );
      }
      items.push(copyItem, archiveItem);
      const menu = await Menu.new({ items });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [
      isThreadPinned,
      onDeleteThread,
      onPinThread,
      onRenameThread,
      onSyncThread,
      onUnpinThread,
    ],
  );

  const showWorkspaceMenu = useCallback(
    async (event: MouseEvent, workspace: WorkspaceInfo) => {
      event.preventDefault();
      event.stopPropagation();
      const providerItems = await buildWorkspaceProviderMenuItems({
        workspace,
        claudeEnabled,
        onUpdateWorkspaceProvider,
      });
      const reloadItem = await MenuItem.new({
        text: "重新加载会话",
        action: () => onReloadWorkspaceThreads(workspace.id),
      });
      const deleteItem = await MenuItem.new({
        text: "删除",
        action: () => onDeleteWorkspace(workspace.id),
      });
      const menu = await Menu.new({
        items: [...providerItems, reloadItem, deleteItem],
      });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [
      claudeEnabled,
      onDeleteWorkspace,
      onReloadWorkspaceThreads,
      onUpdateWorkspaceProvider,
    ],
  );

  const showWorktreeMenu = useCallback(
    async (event: MouseEvent, worktree: WorkspaceInfo) => {
      event.preventDefault();
      event.stopPropagation();
      const providerItems = await buildWorkspaceProviderMenuItems({
        workspace: worktree,
        claudeEnabled,
        onUpdateWorkspaceProvider,
      });
      const fileManagerLabel = fileManagerName();
      const reloadItem = await MenuItem.new({
        text: "重新加载会话",
        action: () => onReloadWorkspaceThreads(worktree.id),
      });
      const revealItem = await MenuItem.new({
        text: `在 ${fileManagerLabel} 中显示`,
        action: async () => {
          if (!worktree.path) {
            return;
          }
          try {
            const { revealItemInDir } = await import(
              "@tauri-apps/plugin-opener"
            );
            await revealItemInDir(worktree.path);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            pushErrorToast({
              title: `无法在 ${fileManagerLabel} 中显示工作树`,
              message,
            });
            console.warn("Failed to reveal worktree", {
              message,
              workspaceId: worktree.id,
              path: worktree.path,
            });
          }
        },
      });
      const deleteItem = await MenuItem.new({
        text: "删除工作树",
        action: () => onDeleteWorktree(worktree.id),
      });
      const menu = await Menu.new({
        items: [...providerItems, reloadItem, revealItem, deleteItem],
      });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [
      claudeEnabled,
      onDeleteWorktree,
      onReloadWorkspaceThreads,
      onUpdateWorkspaceProvider,
    ],
  );

  const showCloneMenu = useCallback(
    async (event: MouseEvent, clone: WorkspaceInfo) => {
      event.preventDefault();
      event.stopPropagation();
      const providerItems = await buildWorkspaceProviderMenuItems({
        workspace: clone,
        claudeEnabled,
        onUpdateWorkspaceProvider,
      });
      const fileManagerLabel = fileManagerName();
      const reloadItem = await MenuItem.new({
        text: "重新加载会话",
        action: () => onReloadWorkspaceThreads(clone.id),
      });
      const revealItem = await MenuItem.new({
        text: `在 ${fileManagerLabel} 中显示`,
        action: async () => {
          if (!clone.path) {
            return;
          }
          try {
            const { revealItemInDir } = await import(
              "@tauri-apps/plugin-opener"
            );
            await revealItemInDir(clone.path);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            pushErrorToast({
              title: `无法在 ${fileManagerLabel} 中显示克隆副本`,
              message,
            });
            console.warn("Failed to reveal clone", {
              message,
              workspaceId: clone.id,
              path: clone.path,
            });
          }
        },
      });
      const deleteItem = await MenuItem.new({
        text: "删除克隆副本",
        action: () => onDeleteWorkspace(clone.id),
      });
      const menu = await Menu.new({
        items: [...providerItems, reloadItem, revealItem, deleteItem],
      });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [
      claudeEnabled,
      onDeleteWorkspace,
      onReloadWorkspaceThreads,
      onUpdateWorkspaceProvider,
    ],
  );

  return { showThreadMenu, showWorkspaceMenu, showWorktreeMenu, showCloneMenu };
}
