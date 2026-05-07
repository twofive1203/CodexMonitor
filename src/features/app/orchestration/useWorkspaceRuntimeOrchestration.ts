import { useCallback, useMemo } from "react";
import type { AppSettings, DebugEntry, WorkspaceInfo } from "@/types";
import { useMobileServerSetup } from "@/features/mobile/hooks/useMobileServerSetup";
import { getRuntimeCapabilities } from "@services/runtime/client";
import { useWorkspaceController } from "@app/hooks/useWorkspaceController";

type UseWorkspaceRuntimeOrchestrationParams = {
  appSettings: AppSettings;
  appSettingsLoading: boolean;
  addDebugEntry: (entry: DebugEntry) => void;
  queueSaveSettings: (next: AppSettings) => Promise<AppSettings>;
};

/**
 * 方法说明：装配主应用工作区运行时，包括工作区控制器、移动端引导和运行能力。
 * 入参说明：params 提供应用设置、设置保存函数和调试日志写入函数。
 */
export function useWorkspaceRuntimeOrchestration({
  appSettings,
  appSettingsLoading,
  addDebugEntry,
  queueSaveSettings,
}: UseWorkspaceRuntimeOrchestrationParams) {
  const workspaceController = useWorkspaceController({
    appSettings,
    addDebugEntry,
    queueSaveSettings,
  });

  const mobileServerSetup = useMobileServerSetup({
    appSettings,
    appSettingsLoading,
    queueSaveSettings,
    refreshWorkspaces: workspaceController.refreshWorkspaces,
  });

  const runtimeCapabilities = getRuntimeCapabilities();
  const updaterEnabled =
    runtimeCapabilities.updater && !mobileServerSetup.isMobileRuntime;

  const workspacesById = useMemo(
    () =>
      new Map(
        workspaceController.workspaces.map((workspace) => [
          workspace.id,
          workspace,
        ]),
      ),
    [workspaceController.workspaces],
  );

  const getWorkspaceName = useCallback(
    (workspaceId: string) => workspacesById.get(workspaceId)?.name,
    [workspacesById],
  );

  return {
    ...workspaceController,
    ...mobileServerSetup,
    runtimeCapabilities,
    updaterEnabled,
    workspacesById: workspacesById as Map<string, WorkspaceInfo>,
    getWorkspaceName,
  };
}
