import { SidebarCollapseButton } from "@/features/layout/components/SidebarToggleControls";
import type { ComponentProps } from "react";
import { MainAppShell } from "@app/components/MainAppShell";

type UseMainAppShellPropsArgs = {
  shell: Pick<
    ComponentProps<typeof MainAppShell>,
    | "appClassName"
    | "isResizing"
    | "appStyle"
    | "appRef"
    | "sidebarToggleProps"
    | "shouldLoadGitHubPanelData"
    | "appModalsProps"
    | "showMobileSetupWizard"
    | "mobileSetupWizardProps"
  >;
  gitHubPanelDataProps: ComponentProps<typeof MainAppShell>["gitHubPanelDataProps"];
  appLayout: Omit<ComponentProps<typeof MainAppShell>["appLayoutProps"], "desktopTopbarLeftNode" | "topbarActionsNode">;
  topbar: {
    isCompact: boolean;
    desktopTopbarLeftNode: ComponentProps<typeof MainAppShell>["appLayoutProps"]["desktopTopbarLeftNode"];
    hasActiveWorkspace: boolean;
    backendMode: "local" | "remote";
    remoteThreadConnectionState: "live" | "polling" | "disconnected";
  };
};

export function useMainAppShellProps({
  shell,
  gitHubPanelDataProps,
  appLayout,
  topbar,
}: UseMainAppShellPropsArgs) {
  const showThreadConnectionIndicator =
    topbar.hasActiveWorkspace && topbar.backendMode === "remote";
  const topbarActionsNode = showThreadConnectionIndicator ? (
    <span
      className={`compact-workspace-live-indicator ${
        topbar.remoteThreadConnectionState === "live"
          ? "is-live"
          : topbar.remoteThreadConnectionState === "polling"
            ? "is-polling"
            : "is-disconnected"
      }`}
      title={
        topbar.remoteThreadConnectionState === "live"
          ? "正在接收实时会话事件"
          : topbar.remoteThreadConnectionState === "polling"
            ? "已连接，正在通过轮询同步会话状态"
            : "与后端断开连接"
      }
    >
      {topbar.remoteThreadConnectionState === "live"
        ? "实时"
        : topbar.remoteThreadConnectionState === "polling"
          ? "轮询中"
          : "已断开"}
    </span>
  ) : null;

  const desktopTopbarLeftNodeWithToggle = !topbar.isCompact ? (
    <div className="topbar-leading">
      <SidebarCollapseButton {...shell.sidebarToggleProps} />
      {topbar.desktopTopbarLeftNode}
    </div>
  ) : (
    topbar.desktopTopbarLeftNode
  );

  return {
    ...shell,
    gitHubPanelDataProps,
    appLayoutProps: {
      ...appLayout,
      desktopTopbarLeftNode: desktopTopbarLeftNodeWithToggle,
      topbarActionsNode,
    },
  };
}
