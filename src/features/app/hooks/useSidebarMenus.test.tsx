/** @vitest-environment jsdom */
import type { MouseEvent as ReactMouseEvent } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceInfo } from "../../../types";
import { useSidebarMenus } from "./useSidebarMenus";
import { fileManagerName } from "../../../utils/platformPaths";

const menuNew = vi.hoisted(() =>
  vi.fn(async ({ items }) => ({ popup: vi.fn(), items })),
);
const menuItemNew = vi.hoisted(() => vi.fn(async (options) => options));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: menuNew },
  MenuItem: { new: menuItemNew },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ scaleFactor: () => 1 }),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {
    x: number;
    y: number;
    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  },
}));

const revealItemInDir = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: (...args: unknown[]) => revealItemInDir(...args),
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSidebarMenus", () => {
  it("adds provider switch actions for workspace context menus", async () => {
    const onUpdateWorkspaceProvider = vi.fn();
    const { result } = renderHook(() =>
      useSidebarMenus({
        claudeEnabled: true,
        onDeleteThread: vi.fn(),
        onSyncThread: vi.fn(),
        onPinThread: vi.fn(),
        onUnpinThread: vi.fn(),
        isThreadPinned: vi.fn(() => false),
        onRenameThread: vi.fn(),
        onReloadWorkspaceThreads: vi.fn(),
        onDeleteWorkspace: vi.fn(),
        onDeleteWorktree: vi.fn(),
        onUpdateWorkspaceProvider,
      }),
    );

    const workspace: WorkspaceInfo = {
      id: "workspace-1",
      name: "Main Project",
      path: "/tmp/main-project",
      connected: true,
      provider: "codex",
      settings: {
        sidebarCollapsed: false,
      },
    };

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 20,
      clientY: 30,
    } as unknown as ReactMouseEvent;

    await result.current.showWorkspaceMenu(event, workspace);

    const menuArgs = menuNew.mock.calls[menuNew.mock.calls.length - 1]?.[0];
    const currentProviderItem = menuArgs.items.find(
      (item: { text: string }) => item.text === "当前运行时：Codex",
    );
    const switchToClaudeItem = menuArgs.items.find(
      (item: { text: string }) => item.text === "切换到 Claude",
    );

    expect(currentProviderItem).toBeDefined();
    expect(currentProviderItem.enabled).toBe(false);
    expect(switchToClaudeItem).toBeDefined();

    switchToClaudeItem.action();
    expect(onUpdateWorkspaceProvider).toHaveBeenCalledWith("workspace-1", "claude");
  });

  it("adds a show in file manager option for worktrees", async () => {
    const onDeleteThread = vi.fn();
    const onSyncThread = vi.fn();
    const onPinThread = vi.fn();
    const onUnpinThread = vi.fn();
    const isThreadPinned = vi.fn(() => false);
    const onRenameThread = vi.fn();
    const onReloadWorkspaceThreads = vi.fn();
    const onDeleteWorkspace = vi.fn();
    const onDeleteWorktree = vi.fn();
    const onUpdateWorkspaceProvider = vi.fn();

    const { result } = renderHook(() =>
      useSidebarMenus({
        claudeEnabled: false,
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
      }),
    );

    const worktree: WorkspaceInfo = {
      id: "worktree-1",
      name: "feature/test",
      path: "/tmp/worktree-1",
      kind: "worktree",
      connected: true,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: "",
      },
      worktree: { branch: "feature/test" },
    };

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 12,
      clientY: 34,
    } as unknown as ReactMouseEvent;

    await result.current.showWorktreeMenu(event, worktree);

    const menuArgs = menuNew.mock.calls[0]?.[0];
    const revealItem = menuArgs.items.find(
      (item: { text: string }) => item.text === `在 ${fileManagerName()} 中显示`,
    );

    expect(revealItem).toBeDefined();
    await revealItem.action();
    expect(revealItemInDir).toHaveBeenCalledWith("/tmp/worktree-1");
  });
});
