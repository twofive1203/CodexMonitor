import type { MouseEvent } from "react";

import type { WorkspaceInfo } from "../../../types";
import {
  getAgentProviderLabel,
  getWorkspaceProvider,
} from "@utils/agentProvider";

type WorkspaceCardProps = {
  workspace: WorkspaceInfo;
  workspaceName?: React.ReactNode;
  summary?: string | null;
  isActive: boolean;
  isCollapsed: boolean;
  addMenuOpen: boolean;
  addMenuWidth: number;
  onSelectWorkspace: (id: string) => void;
  onShowWorkspaceMenu: (event: MouseEvent, workspaceId: string) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  onToggleAddMenu: (anchor: {
    workspaceId: string;
    top: number;
    left: number;
    width: number;
  } | null) => void;
  children?: React.ReactNode;
};

export function WorkspaceCard({
  workspace,
  workspaceName,
  summary = null,
  isActive,
  isCollapsed,
  addMenuOpen,
  addMenuWidth,
  onSelectWorkspace,
  onShowWorkspaceMenu,
  onToggleWorkspaceCollapse,
  onConnectWorkspace,
  onToggleAddMenu,
  children,
}: WorkspaceCardProps) {
  const contentCollapsedClass = isCollapsed ? " collapsed" : "";
  const provider = getWorkspaceProvider(workspace);
  const providerLabel = getAgentProviderLabel(provider);

  return (
    <div className="workspace-card">
      <div
        className={`workspace-row ${isActive ? "active" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => onSelectWorkspace(workspace.id)}
        onContextMenu={(event) => onShowWorkspaceMenu(event, workspace.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectWorkspace(workspace.id);
          }
        }}
      >
        <div className="workspace-copy">
          <div className="workspace-name-row">
            <div className="workspace-title">
              <span className="workspace-name">{workspaceName ?? workspace.name}</span>
              <span
                className={`workspace-provider-badge is-${provider}`}
                title={`${providerLabel} 运行时`}
              >
                {providerLabel}
              </span>
              <button
                className={`workspace-toggle ${isCollapsed ? "" : "expanded"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleWorkspaceCollapse(workspace.id, !isCollapsed);
                }}
                data-tauri-drag-region="false"
                aria-label={isCollapsed ? "显示智能体" : "隐藏智能体"}
                aria-expanded={!isCollapsed}
              >
                <span className="workspace-toggle-icon">›</span>
              </button>
            </div>
          </div>
          {summary && <div className="workspace-summary">{summary}</div>}
        </div>
        <div className="workspace-actions">
          <button
            className="ghost workspace-add"
            onClick={(event) => {
              event.stopPropagation();
              const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
              const left = Math.min(
                Math.max(rect.left, 12),
                window.innerWidth - addMenuWidth - 12,
              );
              const top = rect.bottom + 8;
              onToggleAddMenu(
                addMenuOpen
                  ? null
                  : {
                      workspaceId: workspace.id,
                      top,
                      left,
                      width: addMenuWidth,
                    },
                );
            }}
            data-tauri-drag-region="false"
            aria-label="添加智能体选项"
            aria-expanded={addMenuOpen}
          >
            +
          </button>
          {!workspace.connected && (
            <span
              className="connect"
              title={`连接项目上下文到共享 ${providerLabel} 运行时`}
              onClick={(event) => {
                event.stopPropagation();
                onConnectWorkspace(workspace);
              }}
            >
              连接
            </span>
          )}
        </div>
      </div>
      <div
        className={`workspace-card-content${contentCollapsedClass}`}
        aria-hidden={isCollapsed}
        inert={isCollapsed ? true : undefined}
      >
        <div className="workspace-card-content-inner">{children}</div>
      </div>
    </div>
  );
}
