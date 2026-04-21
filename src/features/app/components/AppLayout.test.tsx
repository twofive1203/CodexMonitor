/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import { TabBar } from "./TabBar";
import { TabletNav } from "./TabletNav";

afterEach(() => {
  cleanup();
});

function createBaseProps(): ComponentProps<typeof AppLayout> {
  return {
    isPhone: false,
    isTablet: false,
    showHome: false,
    showGitDetail: false,
    activeTab: "codex",
    tabletTab: "codex",
    centerMode: "chat",
    preloadGitDiffs: false,
    splitChatDiffView: false,
    hasActivePlan: false,
    activeWorkspace: true,
    sidebarNode: <div>sidebar</div>,
    messagesNode: <div>messages</div>,
    composerNode: <div>composer</div>,
    approvalToastsNode: <div>approval</div>,
    updateToastNode: <div>update</div>,
    errorToastsNode: <div>error</div>,
    homeNode: <div>home</div>,
    mainHeaderNode: <div>header</div>,
    desktopTopbarLeftNode: <div>desktop-topbar</div>,
    topbarActionsNode: <div>topbar-actions</div>,
    tabletNavNode: <div>tablet-nav</div>,
    tabBarNode: <div>tabbar</div>,
    gitDiffPanelNode: <div>git-panel</div>,
    gitDiffViewerNode: <div>git-viewer</div>,
    planPanelNode: <div>plan</div>,
    debugPanelNode: <div>debug</div>,
    terminalDockNode: <div>terminal-dock</div>,
    compactLogNode: <div>compact-terminal</div>,
    compactEmptyCodexNode: <div>empty-codex</div>,
    compactEmptyGitNode: <div>empty-git</div>,
    compactGitBackNode: <div>git-back</div>,
    onSidebarResizeStart: vi.fn(),
    onChatDiffSplitPositionResizeStart: vi.fn(),
    onRightPanelResizeStart: vi.fn(),
    onPlanPanelResizeStart: vi.fn(),
  };
}

describe("AppLayout", () => {
  it("renders the compact log node for phone log tab", () => {
    const props = createBaseProps();
    const view = render(<AppLayout {...props} isPhone activeTab="log" activeWorkspace />);

    expect(view.container.textContent).toContain("compact-terminal");
  });

  it("renders the compact log node for tablet log tab", () => {
    const props = createBaseProps();
    const view = render(<AppLayout {...props} isTablet tabletTab="log" activeWorkspace />);

    expect(view.container.textContent).toContain("compact-terminal");
  });
});

describe("compact terminal labels", () => {
  it("shows the terminal label in the phone tab bar when provided", () => {
    const view = render(
      <TabBar activeTab="log" onSelect={vi.fn()} terminalTabLabel="终端" />,
    );

    expect(view.container.textContent).toContain("终端");
  });

  it("shows the terminal label in the tablet nav when provided", () => {
    const view = render(
      <TabletNav activeTab="log" onSelect={vi.fn()} terminalTabLabel="终端" />,
    );

    expect(view.container.textContent).toContain("终端");
  });
});
