/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceCard } from "./WorkspaceCard";

const baseProps: ComponentProps<typeof WorkspaceCard> = {
  workspace: {
    id: "workspace-1",
    name: "Claude 项目",
    path: "/tmp/example",
    connected: false,
    provider: "claude",
    settings: {
      sidebarCollapsed: false,
    },
  },
  isActive: false,
  isCollapsed: false,
  addMenuOpen: false,
  addMenuWidth: 240,
  onSelectWorkspace: vi.fn(),
  onShowWorkspaceMenu: vi.fn(),
  onToggleWorkspaceCollapse: vi.fn(),
  onConnectWorkspace: vi.fn(),
  onToggleAddMenu: vi.fn(),
};

afterEach(() => {
  cleanup();
});

describe("WorkspaceCard", () => {
  it("renders the workspace provider badge", () => {
    render(<WorkspaceCard {...baseProps} />);

    const badge = screen.getByText("Claude");
    expect(badge.className).toContain("workspace-provider-badge");
    expect(badge.className).toContain("is-claude");
  });

  it("uses the provider label in the connect hint", () => {
    render(<WorkspaceCard {...baseProps} />);

    const connectButton = screen.getByTitle("连接项目上下文到共享 Claude 运行时");
    expect(connectButton.getAttribute("title")).toContain("Claude");

    fireEvent.click(connectButton);
    expect(baseProps.onConnectWorkspace).toHaveBeenCalledWith(baseProps.workspace);
  });
});
