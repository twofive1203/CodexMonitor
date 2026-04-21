// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { TerminalPanel } from "../components/TerminalPanel";
import { useTerminalSession } from "./useTerminalSession";

const terminalOpenMock = vi.hoisted(() => vi.fn());
const terminalDisposeMock = vi.hoisted(() => vi.fn());
const terminalLoadAddonMock = vi.hoisted(() => vi.fn());
const terminalOnDataMock = vi.hoisted(() => vi.fn(() => ({ dispose: vi.fn() })));
const terminalWriteMock = vi.hoisted(() => vi.fn());
const terminalFocusMock = vi.hoisted(() => vi.fn());
const terminalResetMock = vi.hoisted(() => vi.fn());
const terminalRefreshMock = vi.hoisted(() => vi.fn());
const terminalCtorMock = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    cols: 80,
    rows: 24,
    open: terminalOpenMock,
    dispose: terminalDisposeMock,
    loadAddon: terminalLoadAddonMock,
    onData: terminalOnDataMock,
    write: terminalWriteMock,
    focus: terminalFocusMock,
    reset: terminalResetMock,
    refresh: terminalRefreshMock,
  })),
);
const fitAddonFitMock = vi.hoisted(() => vi.fn());
const fitAddonCtorMock = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    fit: fitAddonFitMock,
  })),
);
const openTerminalSessionMock = vi.hoisted(() => vi.fn());
const resizeTerminalSessionMock = vi.hoisted(() => vi.fn());
const writeTerminalSessionMock = vi.hoisted(() => vi.fn());
const subscribeTerminalOutputMock = vi.hoisted(() => vi.fn(() => vi.fn()));
const subscribeTerminalExitMock = vi.hoisted(() => vi.fn(() => vi.fn()));
const onDebugMock = vi.hoisted(() => vi.fn());

vi.mock("@xterm/xterm", () => ({
  Terminal: terminalCtorMock,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: fitAddonCtorMock,
}));

vi.mock("../../../services/tauri", () => ({
  openTerminalSession: openTerminalSessionMock,
  resizeTerminalSession: resizeTerminalSessionMock,
  writeTerminalSession: writeTerminalSessionMock,
}));

vi.mock("../../../services/events", () => ({
  subscribeTerminalOutput: subscribeTerminalOutputMock,
  subscribeTerminalExit: subscribeTerminalExitMock,
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "Workspace",
  path: "/tmp/workspace",
  connected: true,
  settings: { sidebarCollapsed: false },
};

type HarnessProps = {
  mounted: boolean;
};

/**
 * 测试壳组件，用于模拟终端页在移动端页签切换时的卸载与重新挂载。
 * @param mounted 是否渲染终端面板容器。
 */
function Harness({ mounted }: HarnessProps) {
  const terminalState = useTerminalSession({
    activeWorkspace: workspace,
    activeTerminalId: "terminal-1",
    isVisible: true,
    focusRequestVersion: 0,
    onDebug: onDebugMock,
  });

  if (!mounted) {
    return null;
  }

  return (
    <TerminalPanel
      containerRef={terminalState.containerRef}
      status={terminalState.status}
      message={terminalState.message}
    />
  );
}

describe("useTerminalSession", () => {
  beforeEach(() => {
    terminalOpenMock.mockClear();
    terminalDisposeMock.mockClear();
    terminalLoadAddonMock.mockClear();
    terminalOnDataMock.mockClear();
    terminalWriteMock.mockClear();
    terminalFocusMock.mockClear();
    terminalResetMock.mockClear();
    terminalRefreshMock.mockClear();
    terminalCtorMock.mockClear();
    fitAddonFitMock.mockClear();
    fitAddonCtorMock.mockClear();
    openTerminalSessionMock.mockReset();
    openTerminalSessionMock.mockResolvedValue({ id: "terminal-1" });
    resizeTerminalSessionMock.mockReset();
    resizeTerminalSessionMock.mockResolvedValue(undefined);
    writeTerminalSessionMock.mockReset();
    writeTerminalSessionMock.mockResolvedValue(undefined);
    subscribeTerminalOutputMock.mockClear();
    subscribeTerminalExitMock.mockClear();
    onDebugMock.mockClear();
  });

  it("recreates the xterm instance after the terminal panel is remounted", async () => {
    const view = render(<Harness mounted />);

    await waitFor(() => {
      expect(openTerminalSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(terminalCtorMock).toHaveBeenCalledTimes(1);

    view.rerender(<Harness mounted={false} />);

    await waitFor(() => {
      expect(terminalDisposeMock).toHaveBeenCalledTimes(1);
    });

    view.rerender(<Harness mounted />);

    await waitFor(() => {
      expect(terminalCtorMock).toHaveBeenCalledTimes(2);
    });
    expect(openTerminalSessionMock).toHaveBeenCalledTimes(1);
  });
});
