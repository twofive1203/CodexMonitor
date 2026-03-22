/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { MainHeader } from "./MainHeader";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));

const baseProps: ComponentProps<typeof MainHeader> = {
  workspace: {
    id: "workspace-1",
    name: "示例项目",
    path: "/tmp/example",
    connected: true,
    settings: {
      sidebarCollapsed: false,
    },
  },
  openTargets: [],
  openAppIconById: {},
  selectedOpenAppId: "",
  onSelectOpenAppId: vi.fn(),
  branchName: "main",
  branches: [],
  onCheckoutBranch: vi.fn(),
  onCreateBranch: vi.fn(),
  onToggleTerminal: vi.fn(),
  isTerminalOpen: false,
  showTerminalButton: false,
  showWorkspaceTools: false,
};

describe("MainHeader", () => {
  it("renders a claude provider badge for claude workspaces", () => {
    render(
      <MainHeader
        {...baseProps}
        workspace={{
          ...baseProps.workspace,
          provider: "claude",
        }}
      />,
    );

    const badge = screen.getByText("Claude");
    expect(badge.className).toContain("workspace-provider-badge-header");
    expect(badge.className).toContain("is-claude");
  });

  it("falls back to the codex provider badge when provider is missing", () => {
    render(<MainHeader {...baseProps} />);

    const badge = screen.getByText("Codex");
    expect(badge.className).toContain("is-codex");
  });
});
