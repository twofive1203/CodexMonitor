/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitLogEntry } from "../../../types";
import { GitDiffPanel } from "./GitDiffPanel";
import { fileManagerName } from "../../../utils/platformPaths";

const menuNew = vi.hoisted(() =>
  vi.fn(async ({ items }) => ({ popup: vi.fn(), items })),
);
const menuItemNew = vi.hoisted(() => vi.fn(async (options) => options));
const clipboardWriteText = vi.hoisted(() => vi.fn());

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
  openUrl: vi.fn(),
  revealItemInDir: (...args: unknown[]) => revealItemInDir(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(async () => true),
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

Object.defineProperty(navigator, "clipboard", {
  value: { writeText: (...args: unknown[]) => clipboardWriteText(...args) },
  configurable: true,
});

const logEntries: GitLogEntry[] = [];

const baseProps = {
  mode: "diff" as const,
  onModeChange: vi.fn(),
  filePanelMode: "git" as const,
  onFilePanelModeChange: vi.fn(),
  branchName: "main",
  totalAdditions: 0,
  totalDeletions: 0,
  fileStatus: "1 file changed",
  logEntries,
  stagedFiles: [],
  unstagedFiles: [],
};

afterEach(() => {
  cleanup();
});

describe("GitDiffPanel", () => {
  it("shows an initialize git button when the repo is missing", () => {
    const onInitGitRepo = vi.fn();
    const { container } = render(
      <GitDiffPanel
        {...baseProps}
        error="not a git repository"
        onInitGitRepo={onInitGitRepo}
      />,
    );

    const initButton = within(container).getByRole("button", { name: "Initialize Git" });
    fireEvent.click(initButton);
    expect(onInitGitRepo).toHaveBeenCalledTimes(1);
  });

  it("does not show initialize git when the git root path is invalid", () => {
    const { container } = render(
      <GitDiffPanel
        {...baseProps}
        error="Git root not found: apps"
        onInitGitRepo={vi.fn()}
      />,
    );

    expect(within(container).queryByRole("button", { name: "Initialize Git" })).toBeNull();
  });

  it("enables commit when message exists and only unstaged changes", () => {
    const onCommit = vi.fn();
    render(
      <GitDiffPanel
        {...baseProps}
        commitMessage="feat: add thing"
        onCommit={onCommit}
        onGenerateCommitMessage={vi.fn()}
        unstagedFiles={[
          { path: "file.txt", status: "M", additions: 1, deletions: 0 },
        ]}
      />,
    );

    const commitButton = screen.getByRole("button", { name: "提交" });
    expect((commitButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(commitButton);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("runs uncommitted review from unstaged section actions", () => {
    const onReviewUncommittedChanges = vi.fn();
    render(
      <GitDiffPanel
        {...baseProps}
        workspaceId="ws-2"
        onReviewUncommittedChanges={onReviewUncommittedChanges}
        unstagedFiles={[
          { path: "src/file.ts", status: "M", additions: 4, deletions: 1 },
        ]}
      />,
    );

    const reviewButton = screen.getByRole("button", { name: "审查未提交改动" });
    fireEvent.click(reviewButton);
    expect(onReviewUncommittedChanges).toHaveBeenCalledTimes(1);
    expect(onReviewUncommittedChanges).toHaveBeenCalledWith("ws-2");
  });

  it("adds a show in file manager option for file context menus", async () => {
    clipboardWriteText.mockClear();
    const { container } = render(
      <GitDiffPanel
        {...baseProps}
        workspacePath="/tmp/repo"
        gitRoot="/tmp/repo/"
        unstagedFiles={[
          { path: "src/sample.ts", status: "M", additions: 1, deletions: 0 },
        ]}
      />,
    );

    const row = container.querySelector(".diff-row");
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row as Element);

    await waitFor(() => expect(menuNew).toHaveBeenCalled());
    const menuArgs = menuNew.mock.calls[0]?.[0];
    const revealItem = menuArgs.items.find(
      (item: { text: string }) => item.text === `在 ${fileManagerName()} 中显示`,
    );

    expect(revealItem).toBeDefined();
    await revealItem.action();
    expect(revealItemInDir).toHaveBeenCalledWith("/tmp/repo/src/sample.ts");
  });

  it("copies file name and path from the context menu", async () => {
    clipboardWriteText.mockClear();
    const { container } = render(
      <GitDiffPanel
        {...baseProps}
        workspacePath="/tmp/repo"
        gitRoot="/tmp/repo"
        unstagedFiles={[
          { path: "src/sample.ts", status: "M", additions: 1, deletions: 0 },
        ]}
      />,
    );

    const row = container.querySelector(".diff-row");
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row as Element);

    await waitFor(() => expect(menuNew).toHaveBeenCalled());
    const menuArgs = menuNew.mock.calls[menuNew.mock.calls.length - 1]?.[0];
    const copyNameItem = menuArgs.items.find(
      (item: { text: string }) => item.text === "复制文件名",
    );
    const copyPathItem = menuArgs.items.find(
      (item: { text: string }) => item.text === "复制文件路径",
    );

    expect(copyNameItem).toBeDefined();
    expect(copyPathItem).toBeDefined();

    await copyNameItem.action();
    await copyPathItem.action();

    expect(clipboardWriteText).toHaveBeenCalledWith("sample.ts");
    expect(clipboardWriteText).toHaveBeenCalledWith("src/sample.ts");
  });

  it("resolves relative git roots against the workspace path", async () => {
    revealItemInDir.mockClear();
    menuNew.mockClear();
    const { container } = render(
      <GitDiffPanel
        {...baseProps}
        workspacePath="/tmp/repo"
        gitRoot="apps"
        unstagedFiles={[
          { path: "src/sample.ts", status: "M", additions: 1, deletions: 0 },
        ]}
      />,
    );

    const row = container.querySelector(".diff-row");
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row as Element);

    await waitFor(() => expect(menuNew).toHaveBeenCalled());
    const menuArgs = menuNew.mock.calls[menuNew.mock.calls.length - 1]?.[0];
    const revealItem = menuArgs.items.find(
      (item: { text: string }) => item.text === `在 ${fileManagerName()} 中显示`,
    );

    expect(revealItem).toBeDefined();
    await revealItem.action();
    expect(revealItemInDir).toHaveBeenCalledWith("/tmp/repo/apps/src/sample.ts");
  });

  it("copies file path relative to the workspace root", async () => {
    clipboardWriteText.mockClear();
    const { container } = render(
      <GitDiffPanel
        {...baseProps}
        workspacePath="/tmp/repo"
        gitRoot="apps"
        unstagedFiles={[
          { path: "src/sample.ts", status: "M", additions: 1, deletions: 0 },
        ]}
      />,
    );

    const row = container.querySelector(".diff-row");
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row as Element);

    await waitFor(() => expect(menuNew).toHaveBeenCalled());
    const menuArgs = menuNew.mock.calls[menuNew.mock.calls.length - 1]?.[0];
    const copyPathItem = menuArgs.items.find(
      (item: { text: string }) => item.text === "复制文件路径",
    );

    expect(copyPathItem).toBeDefined();
    await copyPathItem.action();

    expect(clipboardWriteText).toHaveBeenCalledWith("apps/src/sample.ts");
  });

  it("does not trim paths when the git root only shares a prefix", async () => {
    clipboardWriteText.mockClear();
    const { container } = render(
      <GitDiffPanel
        {...baseProps}
        workspacePath="/tmp/repo"
        gitRoot="/tmp/repo-tools"
        unstagedFiles={[
          { path: "src/sample.ts", status: "M", additions: 1, deletions: 0 },
        ]}
      />,
    );

    const row = container.querySelector(".diff-row");
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row as Element);

    await waitFor(() => expect(menuNew).toHaveBeenCalled());
    const menuArgs = menuNew.mock.calls[menuNew.mock.calls.length - 1]?.[0];
    const copyPathItem = menuArgs.items.find(
      (item: { text: string }) => item.text === "复制文件路径",
    );

    expect(copyPathItem).toBeDefined();
    await copyPathItem.action();

    expect(clipboardWriteText).toHaveBeenCalledWith("src/sample.ts");
  });

  it("shows Agent edits option in mode selector", () => {
    render(<GitDiffPanel {...baseProps} />);
    const options = screen.getAllByRole("option", { name: "智能体改动" });
    expect(options.length).toBeGreaterThan(0);
  });

  it("supports web read-only mode by hiding native menus and write actions", () => {
    menuNew.mockClear();
    render(
      <GitDiffPanel
        {...baseProps}
        nativeContextMenuEnabled={false}
        workspacePath="/tmp/repo"
        gitRoot="/tmp/repo"
        commitsAhead={2}
        logBehind={1}
        unstagedFiles={[
          { path: "src/sample.ts", status: "M", additions: 1, deletions: 0 },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: "获取远端" })).toBeNull();
    expect(screen.queryByRole("button", { name: "提交" })).toBeNull();
    expect(screen.queryByText("拉取")).toBeNull();
    expect(screen.queryByText("推送")).toBeNull();
    expect(document.querySelector(".diff-row-action--stage")).toBeNull();
    expect(document.querySelector(".diff-row-action--discard")).toBeNull();

    const row = document.querySelector(".diff-row");
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row as Element);
    expect(menuNew).not.toHaveBeenCalled();
  });

  it("renders per-file groups and edit rows", () => {
    const onSelectFile = vi.fn();
    const { container } = render(
      <GitDiffPanel
        {...baseProps}
        mode="perFile"
        onSelectFile={onSelectFile}
        selectedPath={null}
        perFileDiffGroups={[
          {
            path: "src/main.ts",
            edits: [
              {
                id: "src/main.ts@@item-change-1@@change-0",
                path: "src/main.ts",
                label: "Edit 1",
                status: "M",
                diff: "diff --git a/src/main.ts b/src/main.ts",
                sourceItemId: "change-1",
                additions: 1,
                deletions: 0,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: /main\.ts/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /src\/main\.ts/i })).toBeNull();
    expect(
      (container.querySelector(".per-file-edit-stat-add") as HTMLElement | null)?.textContent,
    ).toBe("+1");
    fireEvent.click(screen.getByRole("button", { name: /Edit 1/i }));
    expect(onSelectFile).toHaveBeenCalledWith(
      "src/main.ts@@item-change-1@@change-0",
    );
  });

});
