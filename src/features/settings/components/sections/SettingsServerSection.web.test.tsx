// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsServerSection } from "./SettingsServerSection";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function createProps(
  overrides: Partial<ComponentProps<typeof SettingsServerSection>> = {},
): ComponentProps<typeof SettingsServerSection> {
  return {
    appSettings: {
      codexBin: null,
      codexArgs: null,
      backendMode: "local",
      remoteBackendProvider: "tcp",
      remoteBackendHost: "127.0.0.1:4732",
      remoteBackendToken: "token-1",
      webAccessEnabled: true,
      webAccessListenAddr: "127.0.0.1",
      webAccessPort: 4733,
      webAccessPublicBaseUrl: null,
      remoteBackends: [
        {
          id: "remote-default",
          name: "主远程配置",
          provider: "tcp",
          host: "127.0.0.1:4732",
          token: "token-1",
          lastConnectedAtMs: null,
        },
      ],
      activeRemoteBackendId: "remote-default",
      keepDaemonRunningAfterAppClose: false,
      defaultAccessMode: "current",
      reviewDeliveryMode: "inline",
      composerModelShortcut: null,
      composerAccessShortcut: null,
      composerReasoningShortcut: null,
      composerCollaborationShortcut: null,
      interruptShortcut: null,
      newAgentShortcut: null,
      newWorktreeAgentShortcut: null,
      newCloneAgentShortcut: null,
      archiveThreadShortcut: null,
      toggleProjectsSidebarShortcut: null,
      toggleGitSidebarShortcut: null,
      branchSwitcherShortcut: null,
      toggleDebugPanelShortcut: null,
      toggleTerminalShortcut: null,
      cycleAgentNextShortcut: null,
      cycleAgentPrevShortcut: null,
      cycleWorkspaceNextShortcut: null,
      cycleWorkspacePrevShortcut: null,
      lastComposerModelId: null,
      lastComposerReasoningEffort: null,
      uiScale: 1,
      theme: "system",
      usageShowRemaining: false,
      showMessageFilePath: true,
      chatHistoryScrollbackItems: 200,
      threadTitleAutogenerationEnabled: false,
      automaticAppUpdateChecksEnabled: false,
      uiFontFamily: "system-ui",
      codeFontFamily: "monospace",
      codeFontSize: 12,
      notificationSoundsEnabled: true,
      systemNotificationsEnabled: true,
      subagentSystemNotificationsEnabled: true,
      splitChatDiffView: false,
      preloadGitDiffs: true,
      gitDiffIgnoreWhitespaceChanges: false,
      commitMessagePrompt: "",
      commitMessageModelId: null,
      collaborationModesEnabled: true,
      steerEnabled: true,
      followUpMessageBehavior: "queue",
      composerFollowUpHintEnabled: true,
      pauseQueuedMessagesWhenResponseRequired: true,
      unifiedExecEnabled: true,
      experimentalAppsEnabled: false,
      personality: "friendly",
      dictationEnabled: false,
      dictationModelId: "base",
      dictationPreferredLanguage: null,
      dictationHoldKey: null,
      composerEditorPreset: "default",
      composerFenceExpandOnSpace: false,
      composerFenceExpandOnEnter: false,
      composerFenceLanguageTags: false,
      composerFenceWrapSelection: false,
      composerFenceAutoWrapPasteMultiline: false,
      composerFenceAutoWrapPasteCodeLike: false,
      composerListContinuation: false,
      composerCodeBlockCopyUseModifier: false,
      workspaceGroups: [],
      globalWorktreesFolder: null,
      openAppTargets: [],
      selectedOpenAppId: "",
    },
    onUpdateAppSettings: vi.fn().mockResolvedValue(undefined),
    isMobilePlatform: false,
    mobileConnectBusy: false,
    mobileConnectStatusText: null,
    mobileConnectStatusError: false,
    remoteBackends: [
      {
        id: "remote-default",
        name: "主远程配置",
        provider: "tcp",
        host: "127.0.0.1:4732",
        token: "token-1",
        lastConnectedAtMs: null,
      },
    ],
    activeRemoteBackendId: "remote-default",
    remoteStatusText: null,
    remoteStatusError: false,
    remoteNameError: null,
    remoteHostError: null,
    remoteNameDraft: "主远程配置",
    remoteHostDraft: "127.0.0.1:4732",
    remoteTokenDraft: "token-1",
    remoteTokenGenerationBlockedReason: "请先关闭网页服务，再生成新的远程令牌。",
    nextRemoteNameSuggestion: "远程配置 2",
    tailscaleStatus: {
      installed: true,
      running: true,
      version: "1.80.0",
      dnsName: "desktop.demo.ts.net",
      hostName: "desktop",
      tailnetName: "demo.ts.net",
      ipv4: ["100.88.1.2"],
      ipv6: [],
      suggestedRemoteHost: "desktop.demo.ts.net:4732",
      message: "Tailscale is connected.",
    },
    tailscaleStatusBusy: false,
    tailscaleStatusError: null,
    tailscaleCommandPreview: null,
    tailscaleCommandBusy: false,
    tailscaleCommandError: null,
    tcpDaemonStatus: {
      state: "running",
      pid: 3210,
      startedAtMs: 1710000000000,
      lastError: null,
      listenAddr: "0.0.0.0:4732",
    },
    tcpDaemonBusyAction: null,
    webAccessStatus: {
      enabled: true,
      state: "running",
      pid: 3210,
      startedAtMs: 1710000000000,
      lastError: null,
      listenAddr: "127.0.0.1:4733",
      localUrl: "http://127.0.0.1:4733",
    },
    webAccessBusy: false,
    webAccessStatusText: null,
    webAccessStatusError: false,
    webAccessListenAddrError: null,
    webAccessPortError: null,
    webAccessPublicBaseUrlError: null,
    webAccessListenAddrDraft: "127.0.0.1",
    webAccessPortDraft: "4733",
    webAccessPublicBaseUrlDraft: "",
    webAccessLocalUrl: "http://127.0.0.1:4733",
    webAccessRemoteUrl: "http://desktop.demo.ts.net:4733",
    onSetRemoteNameDraft: vi.fn(),
    onSetRemoteHostDraft: vi.fn(),
    onSetRemoteTokenDraft: vi.fn(),
    onSetWebAccessListenAddrDraft: vi.fn(),
    onSetWebAccessPortDraft: vi.fn(),
    onSetWebAccessPublicBaseUrlDraft: vi.fn(),
    onCommitRemoteName: vi.fn().mockResolvedValue(undefined),
    onCommitRemoteHost: vi.fn().mockResolvedValue(undefined),
    onCommitRemoteToken: vi.fn().mockResolvedValue(undefined),
    onGenerateRemoteToken: vi.fn().mockResolvedValue(undefined),
    onToggleWebAccessEnabled: vi.fn().mockResolvedValue(undefined),
    onCommitWebAccessListenAddr: vi.fn().mockResolvedValue(undefined),
    onCommitWebAccessPort: vi.fn().mockResolvedValue(undefined),
    onCommitWebAccessPublicBaseUrl: vi.fn().mockResolvedValue(undefined),
    onSelectRemoteBackend: vi.fn().mockResolvedValue(undefined),
    onAddRemoteBackend: vi.fn().mockResolvedValue(undefined),
    onMoveRemoteBackend: vi.fn().mockResolvedValue(undefined),
    onDeleteRemoteBackend: vi.fn().mockResolvedValue(undefined),
    onRefreshWebAccessStatus: vi.fn(),
    onRefreshTailscaleStatus: vi.fn(),
    onRefreshTailscaleCommandPreview: vi.fn(),
    onUseSuggestedTailscaleHost: vi.fn().mockResolvedValue(undefined),
    onTcpDaemonStart: vi.fn().mockResolvedValue(undefined),
    onTcpDaemonStop: vi.fn().mockResolvedValue(undefined),
    onTcpDaemonStatus: vi.fn().mockResolvedValue(undefined),
    onMobileConnectTest: vi.fn(),
    ...overrides,
  };
}

describe("SettingsServerSection Web Access", () => {
  it("shows desktop web status and recommended urls", () => {
    render(<SettingsServerSection {...createProps()} />);

    expect(screen.getByText("网页服务状态")).toBeTruthy();
    expect(screen.getByText("运行中")).toBeTruthy();
    expect(screen.getByText("本机访问")).toBeTruthy();
    expect(screen.getByText("远程访问")).toBeTruthy();
    expect(screen.getByText("http://127.0.0.1:4733")).toBeTruthy();
    expect(screen.getByText("http://desktop.demo.ts.net:4733")).toBeTruthy();
  });

  it("wires the web toggle and refresh actions", () => {
    const onToggleWebAccessEnabled = vi.fn().mockResolvedValue(undefined);
    const onRefreshWebAccessStatus = vi.fn();

    render(
      <SettingsServerSection
        {...createProps({
          onToggleWebAccessEnabled,
          onRefreshWebAccessStatus,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "切换网页访问" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新网页服务状态" }));

    expect(onToggleWebAccessEnabled).toHaveBeenCalledTimes(1);
    expect(onRefreshWebAccessStatus).toHaveBeenCalledTimes(1);
  });

  it("toggles remote token visibility with the eye button", () => {
    render(
      <SettingsServerSection
        {...createProps({
          remoteTokenGenerationBlockedReason: null,
        })}
      />,
    );

    const tokenInput = screen.getByLabelText("远程后端令牌") as HTMLInputElement;
    expect(tokenInput.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "显示远程后端令牌" }));
    expect(tokenInput.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "隐藏远程后端令牌" }));
    expect(tokenInput.type).toBe("password");
  });

  it("copies the remote token with the copy button", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    try {
      render(
        <SettingsServerSection
          {...createProps({
            remoteTokenGenerationBlockedReason: null,
          })}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "复制远程后端令牌" }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("token-1");
      });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, "clipboard", originalDescriptor);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (navigator as any).clipboard;
      }
    }
  });

  it("only allows random token generation after web access is closed", () => {
    const onGenerateRemoteToken = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <SettingsServerSection
        {...createProps({
          onGenerateRemoteToken,
        })}
      />,
    );

    const generateButton = screen.getByRole("button", { name: "生成随机远程令牌" });
    expect((generateButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(generateButton);
    expect(onGenerateRemoteToken).not.toHaveBeenCalled();

    rerender(
      <SettingsServerSection
        {...createProps({
          onGenerateRemoteToken,
          appSettings: {
            ...createProps().appSettings,
            webAccessEnabled: false,
          },
          webAccessStatus: {
            enabled: false,
            state: "stopped",
            pid: null,
            startedAtMs: null,
            lastError: null,
            listenAddr: "127.0.0.1:4733",
            localUrl: "http://127.0.0.1:4733",
          },
          remoteTokenGenerationBlockedReason: null,
        })}
      />,
    );

    const enabledGenerateButton = screen.getByRole("button", { name: "生成随机远程令牌" });
    expect((enabledGenerateButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enabledGenerateButton);
    expect(onGenerateRemoteToken).toHaveBeenCalledTimes(1);
  });
});
