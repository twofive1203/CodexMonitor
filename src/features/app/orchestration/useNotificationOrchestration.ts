import { useCallback, useEffect, useRef } from "react";
import successSoundUrl from "@/assets/success-notification.mp3";
import errorSoundUrl from "@/assets/error-notification.mp3";
import type {
  AppSettings,
  ApprovalRequest,
  DebugEntry,
  RequestUserInputRequest,
  WorkspaceInfo,
} from "@/types";
import { useErrorToasts } from "@/features/notifications/hooks/useErrorToasts";
import { useUpdaterController } from "@app/hooks/useUpdaterController";
import { useResponseRequiredNotificationsController } from "@app/hooks/useResponseRequiredNotificationsController";
import { useSystemNotificationThreadLinks } from "@app/hooks/useSystemNotificationThreadLinks";
import { useTauriEvent } from "@app/hooks/useTauriEvent";
import { subscribeTrayOpenThread } from "@services/events";

type MainTab = "home" | "projects" | "codex" | "git" | "log";

type UseNotificationOrchestrationParams = {
  updaterEnabled: boolean;
  appSettings: Pick<
    AppSettings,
    | "automaticAppUpdateChecksEnabled"
    | "notificationSoundsEnabled"
    | "systemNotificationsEnabled"
    | "subagentSystemNotificationsEnabled"
  >;
  appSettingsLoading: boolean;
  isSubagentThread: (workspaceId: string, threadId: string) => boolean;
  getWorkspaceName: (workspaceId: string) => string | undefined;
  approvals: ApprovalRequest[];
  userInputRequests: RequestUserInputRequest[];
  hasLoadedWorkspaces: boolean;
  workspacesById: Map<string, WorkspaceInfo>;
  refreshWorkspaces: () => Promise<WorkspaceInfo[] | undefined>;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  handleOpenThreadLink: (threadId: string, workspaceId?: string | null) => void;
  setActiveTab: (tab: MainTab) => void;
  addDebugEntry: (entry: DebugEntry) => void;
};

/**
 * 方法说明：装配主应用通知运行时，包括更新通知、响应必需通知、toast 和系统通知跳转。
 * 入参说明：params 提供通知开关、线程/工作区状态、跳转动作和调试日志函数。
 */
export function useNotificationOrchestration({
  updaterEnabled,
  appSettings,
  appSettingsLoading,
  isSubagentThread,
  getWorkspaceName,
  approvals,
  userInputRequests,
  hasLoadedWorkspaces,
  workspacesById,
  refreshWorkspaces,
  connectWorkspace,
  handleOpenThreadLink,
  setActiveTab,
  addDebugEntry,
}: UseNotificationOrchestrationParams) {
  const recordPendingThreadLinkRef = useRef<
    (workspaceId: string, threadId: string) => void
  >(() => {});
  const { errorToasts, dismissErrorToast } = useErrorToasts();

  const {
    updaterState,
    startUpdate,
    dismissUpdate,
    postUpdateNotice,
    dismissPostUpdateNotice,
    handleTestNotificationSound,
    handleTestSystemNotification,
  } = useUpdaterController({
    enabled: updaterEnabled,
    autoCheckOnMount:
      !appSettingsLoading && appSettings.automaticAppUpdateChecksEnabled,
    notificationSoundsEnabled: appSettings.notificationSoundsEnabled,
    systemNotificationsEnabled: appSettings.systemNotificationsEnabled,
    subagentSystemNotificationsEnabled:
      appSettings.subagentSystemNotificationsEnabled,
    isSubagentThread,
    getWorkspaceName,
    onThreadNotificationSent: (workspaceId, threadId) =>
      recordPendingThreadLinkRef.current(workspaceId, threadId),
    onDebug: addDebugEntry,
    successSoundUrl,
    errorSoundUrl,
  });

  useResponseRequiredNotificationsController({
    systemNotificationsEnabled: appSettings.systemNotificationsEnabled,
    subagentSystemNotificationsEnabled:
      appSettings.subagentSystemNotificationsEnabled,
    isSubagentThread,
    approvals,
    userInputRequests,
    getWorkspaceName,
    onDebug: addDebugEntry,
  });

  const handleOpenThreadLinkFromExternal = useCallback(
    (workspaceId: string, threadId: string) => {
      setActiveTab("codex");
      handleOpenThreadLink(threadId, workspaceId);
    },
    [handleOpenThreadLink, setActiveTab],
  );

  const { recordPendingThreadLink, openThreadLinkOrQueue } =
    useSystemNotificationThreadLinks({
      hasLoadedWorkspaces,
      workspacesById,
      refreshWorkspaces,
      connectWorkspace,
      openThreadLink: handleOpenThreadLinkFromExternal,
    });

  useTauriEvent(
    subscribeTrayOpenThread,
    ({ workspaceId, threadId }: { workspaceId: string; threadId: string }) => {
      openThreadLinkOrQueue(workspaceId, threadId);
    },
  );

  useEffect(() => {
    recordPendingThreadLinkRef.current = recordPendingThreadLink;
    return () => {
      recordPendingThreadLinkRef.current = () => {};
    };
  }, [recordPendingThreadLink]);

  return {
    updaterState,
    startUpdate,
    dismissUpdate,
    postUpdateNotice,
    dismissPostUpdateNotice,
    handleTestNotificationSound,
    handleTestSystemNotification,
    errorToasts,
    dismissErrorToast,
  };
}
