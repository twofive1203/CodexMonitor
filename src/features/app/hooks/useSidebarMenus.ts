import {
  createElement,
  useCallback,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";

import type { AgentProvider, WorkspaceInfo } from "../../../types";
import { pushErrorToast } from "../../../services/toasts";
import { fileManagerName } from "../../../utils/platformPaths";
import {
  PopoverMenuItem,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";
import {
  canEditWorkspaceProvider,
  getAgentProviderLabel,
  getWorkspaceProvider,
} from "@utils/agentProvider";
import { useMenuController } from "./useMenuController";

type SidebarMenuHandlers = {
  nativeContextMenuEnabled?: boolean;
  claudeEnabled: boolean;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  onPinThread: (workspaceId: string, threadId: string) => void;
  onUnpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void | Promise<unknown>;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onMoveWorkspace: (workspaceId: string, direction: "up" | "down") => void;
  canMoveWorkspace: (workspaceId: string, direction: "up" | "down") => boolean;
  onUpdateWorkspaceProvider: (
    workspaceId: string,
    provider: AgentProvider,
  ) => void | Promise<unknown>;
};

type SidebarMenuItemDescriptor = {
  text: string;
  enabled?: boolean;
  action?: () => void | Promise<unknown>;
};

type BrowserContextMenuState = {
  top: number;
  left: number;
  width: number;
  items: SidebarMenuItemDescriptor[];
};

const BROWSER_CONTEXT_MENU_WIDTH = 220;
const BROWSER_CONTEXT_MENU_MARGIN = 8;
const BROWSER_CONTEXT_MENU_ITEM_HEIGHT = 32;

/**
 * 构建浏览器内右键菜单坐标。
 *
 * `event`：触发右键菜单的鼠标事件。
 * `itemCount`：菜单项数量，用于估算菜单高度并避免溢出视口。
 */
function resolveBrowserContextMenuPosition(
  event: MouseEvent,
  itemCount: number,
): Pick<BrowserContextMenuState, "top" | "left" | "width"> {
  if (typeof window === "undefined") {
    return {
      top: event.clientY,
      left: event.clientX,
      width: BROWSER_CONTEXT_MENU_WIDTH,
    };
  }

  const estimatedHeight =
    itemCount * BROWSER_CONTEXT_MENU_ITEM_HEIGHT + BROWSER_CONTEXT_MENU_MARGIN * 2;
  const maxLeft =
    window.innerWidth - BROWSER_CONTEXT_MENU_WIDTH - BROWSER_CONTEXT_MENU_MARGIN;
  const maxTop =
    window.innerHeight - estimatedHeight - BROWSER_CONTEXT_MENU_MARGIN;

  return {
    top: Math.max(
      BROWSER_CONTEXT_MENU_MARGIN,
      Math.min(event.clientY, Math.max(BROWSER_CONTEXT_MENU_MARGIN, maxTop)),
    ),
    left: Math.max(
      BROWSER_CONTEXT_MENU_MARGIN,
      Math.min(event.clientX, Math.max(BROWSER_CONTEXT_MENU_MARGIN, maxLeft)),
    ),
    width: BROWSER_CONTEXT_MENU_WIDTH,
  };
}

/**
 * 构建工作区运行时相关菜单描述。
 *
 * `workspace`：当前右键命中的工作区。
 * `claudeEnabled`：Claude 实验能力是否已开启。
 * `onUpdateWorkspaceProvider`：更新工作区运行时的回调。
 */
function buildWorkspaceProviderMenuDescriptors({
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
}): SidebarMenuItemDescriptor[] {
  const currentProvider = getWorkspaceProvider(workspace);
  if (!claudeEnabled && currentProvider !== "claude") {
    return [];
  }

  const providerEditable = canEditWorkspaceProvider(workspace, {
    experimentalClaudeEnabled: claudeEnabled,
  });
  const currentProviderLabel = getAgentProviderLabel(currentProvider);
  const items: SidebarMenuItemDescriptor[] = [
    {
      text: providerEditable
        ? `当前运行时：${currentProviderLabel}`
        : `当前运行时：${currentProviderLabel}（开启 Claude 实验功能后可切换）`,
      enabled: false,
    },
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
    items.push({
      text: `切换到 ${getAgentProviderLabel(provider)}`,
      action: () => {
        void onUpdateWorkspaceProvider(workspace.id, provider);
      },
    });
  }

  return items;
}

/**
 * 使用 Tauri 原生能力弹出右键菜单。
 *
 * `event`：触发右键菜单的鼠标事件。
 * `items`：待展示的菜单项描述。
 */
async function popupNativeContextMenu(
  event: MouseEvent,
  items: SidebarMenuItemDescriptor[],
) {
  const [{ Menu, MenuItem }, { LogicalPosition }, { getCurrentWindow }] =
    await Promise.all([
      import("@tauri-apps/api/menu"),
      import("@tauri-apps/api/dpi"),
      import("@tauri-apps/api/window"),
    ]);
  const nativeItems = await Promise.all(
    items.map((item) =>
      MenuItem.new({
        text: item.text,
        enabled: item.enabled,
        action: item.action,
      }),
    ),
  );
  const menu = await Menu.new({ items: nativeItems });
  const window = getCurrentWindow();
  const position = new LogicalPosition(event.clientX, event.clientY);
  await menu.popup(position, window);
}

export function useSidebarMenus({
  nativeContextMenuEnabled = true,
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
  onMoveWorkspace,
  canMoveWorkspace,
  onUpdateWorkspaceProvider,
}: SidebarMenuHandlers) {
  const [browserContextMenu, setBrowserContextMenu] =
    useState<BrowserContextMenuState | null>(null);
  const browserMenuController = useMenuController({
    open: Boolean(browserContextMenu),
    onDismiss: () => setBrowserContextMenu(null),
  });

  const showMenu = useCallback(
    async (event: MouseEvent, items: SidebarMenuItemDescriptor[]) => {
      event.preventDefault();
      event.stopPropagation();

      if (nativeContextMenuEnabled) {
        await popupNativeContextMenu(event, items);
        return;
      }

      setBrowserContextMenu({
        ...resolveBrowserContextMenuPosition(event, items.length),
        items,
      });
    },
    [nativeContextMenuEnabled],
  );

  const contextMenuNode = useMemo(() => {
    if (!browserContextMenu || typeof document === "undefined") {
      return null;
    }

    return createPortal(
      createElement(
        PopoverSurface,
        {
          className: "sidebar-context-menu",
          ref: browserMenuController.containerRef,
          role: "menu",
          style: {
            top: browserContextMenu.top,
            left: browserContextMenu.left,
            width: browserContextMenu.width,
          },
          onContextMenu: (event: MouseEvent<HTMLDivElement>) =>
            event.preventDefault(),
          children: browserContextMenu.items.map((item) =>
            createElement(PopoverMenuItem, {
              key: item.text,
              role: "menuitem",
              className: "sidebar-context-menu-item",
              disabled: item.enabled === false,
              onClick: (event: MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                setBrowserContextMenu(null);
                void item.action?.();
              },
              children: item.text,
            }),
          ),
        },
      ),
      document.body,
    );
  }, [browserContextMenu, browserMenuController.containerRef]);

  const showThreadMenu = useCallback(
    async (
      event: MouseEvent,
      workspaceId: string,
      threadId: string,
      canPin: boolean,
    ) => {
      const renameItem: SidebarMenuItemDescriptor = {
        text: "重命名",
        action: () => onRenameThread(workspaceId, threadId),
      };
      const syncItem: SidebarMenuItemDescriptor = {
        text: "从服务器同步",
        action: () => onSyncThread(workspaceId, threadId),
      };
      const archiveItem: SidebarMenuItemDescriptor = {
        text: "归档",
        action: () => onDeleteThread(workspaceId, threadId),
      };
      const copyItem: SidebarMenuItemDescriptor = {
        text: "复制 ID",
        action: async () => {
          try {
            await navigator.clipboard.writeText(threadId);
          } catch {
            // Clipboard failures are non-fatal here.
          }
        },
      };
      const items: SidebarMenuItemDescriptor[] = [renameItem, syncItem];
      if (canPin) {
        const isPinned = isThreadPinned(workspaceId, threadId);
        items.push(
          {
            text: isPinned ? "取消置顶" : "置顶",
            action: () => {
              if (isPinned) {
                onUnpinThread(workspaceId, threadId);
              } else {
                onPinThread(workspaceId, threadId);
              }
            },
          },
        );
      }
      items.push(copyItem, archiveItem);
      await showMenu(event, items);
    },
    [
      isThreadPinned,
      onDeleteThread,
      onPinThread,
      onRenameThread,
      showMenu,
      onSyncThread,
      onUnpinThread,
    ],
  );

  const showWorkspaceMenu = useCallback(
    async (event: MouseEvent, workspace: WorkspaceInfo) => {
      const providerItems = buildWorkspaceProviderMenuDescriptors({
        workspace,
        claudeEnabled,
        onUpdateWorkspaceProvider,
      });
      const reloadItem: SidebarMenuItemDescriptor = {
        text: "重新加载会话",
        action: () => onReloadWorkspaceThreads(workspace.id),
      };
      const moveUpItem: SidebarMenuItemDescriptor = {
        text: "项目上移",
        enabled: canMoveWorkspace(workspace.id, "up"),
        action: () => onMoveWorkspace(workspace.id, "up"),
      };
      const moveDownItem: SidebarMenuItemDescriptor = {
        text: "项目下移",
        enabled: canMoveWorkspace(workspace.id, "down"),
        action: () => onMoveWorkspace(workspace.id, "down"),
      };
      const deleteItem: SidebarMenuItemDescriptor = {
        text: "删除",
        action: () => onDeleteWorkspace(workspace.id),
      };
      await showMenu(event, [
        ...providerItems,
        reloadItem,
        moveUpItem,
        moveDownItem,
        deleteItem,
      ]);
    },
    [
      claudeEnabled,
      canMoveWorkspace,
      onDeleteWorkspace,
      onMoveWorkspace,
      onReloadWorkspaceThreads,
      onUpdateWorkspaceProvider,
      showMenu,
    ],
  );

  const showWorktreeMenu = useCallback(
    async (event: MouseEvent, worktree: WorkspaceInfo) => {
      const providerItems = buildWorkspaceProviderMenuDescriptors({
        workspace: worktree,
        claudeEnabled,
        onUpdateWorkspaceProvider,
      });
      const fileManagerLabel = fileManagerName();
      const reloadItem: SidebarMenuItemDescriptor = {
        text: "重新加载会话",
        action: () => onReloadWorkspaceThreads(worktree.id),
      };
      const revealItem: SidebarMenuItemDescriptor = {
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
      };
      const deleteItem: SidebarMenuItemDescriptor = {
        text: "删除工作树",
        action: () => onDeleteWorktree(worktree.id),
      };
      const fileItems = nativeContextMenuEnabled ? [revealItem] : [];
      await showMenu(event, [...providerItems, reloadItem, ...fileItems, deleteItem]);
    },
    [
      claudeEnabled,
      nativeContextMenuEnabled,
      onDeleteWorktree,
      onReloadWorkspaceThreads,
      onUpdateWorkspaceProvider,
      showMenu,
    ],
  );

  const showCloneMenu = useCallback(
    async (event: MouseEvent, clone: WorkspaceInfo) => {
      const providerItems = buildWorkspaceProviderMenuDescriptors({
        workspace: clone,
        claudeEnabled,
        onUpdateWorkspaceProvider,
      });
      const fileManagerLabel = fileManagerName();
      const reloadItem: SidebarMenuItemDescriptor = {
        text: "重新加载会话",
        action: () => onReloadWorkspaceThreads(clone.id),
      };
      const revealItem: SidebarMenuItemDescriptor = {
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
      };
      const deleteItem: SidebarMenuItemDescriptor = {
        text: "删除克隆副本",
        action: () => onDeleteWorkspace(clone.id),
      };
      const fileItems = nativeContextMenuEnabled ? [revealItem] : [];
      await showMenu(event, [...providerItems, reloadItem, ...fileItems, deleteItem]);
    },
    [
      claudeEnabled,
      nativeContextMenuEnabled,
      onDeleteWorkspace,
      onReloadWorkspaceThreads,
      onUpdateWorkspaceProvider,
      showMenu,
    ],
  );

  return {
    showThreadMenu,
    showWorkspaceMenu,
    showWorktreeMenu,
    showCloneMenu,
    contextMenuNode,
  };
}
