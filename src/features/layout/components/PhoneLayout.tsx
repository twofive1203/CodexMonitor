import type { ReactNode } from "react";
import { MainTopbar } from "../../app/components/MainTopbar";
import { ChatPane } from "./ChatPane";

type PhoneLayoutProps = {
  approvalToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  tabBarNode: ReactNode;
  homeNode: ReactNode;
  sidebarNode: ReactNode;
  activeTab: "home" | "projects" | "codex" | "git" | "log";
  activeWorkspace: boolean;
  showGitDetail: boolean;
  compactEmptyCodexNode: ReactNode;
  compactEmptyGitNode: ReactNode;
  compactGitBackNode: ReactNode;
  compactLogNode: ReactNode;
  topbarLeftNode: ReactNode;
  topbarActionsNode?: ReactNode;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  gitDiffViewerNode: ReactNode;
};

/**
 * 手机布局，负责在底部页签间切换首页、项目、会话、Git 与终端/日志面板。
 * @param approvalToastsNode 审批提示节点。
 * @param updateToastNode 更新提示节点。
 * @param errorToastsNode 错误提示节点。
 * @param tabBarNode 底部导航节点。
 * @param homeNode 首页节点。
 * @param sidebarNode 项目侧栏节点。
 * @param activeTab 当前激活页签。
 * @param activeWorkspace 是否已选中工作区。
 * @param showGitDetail Git 是否处于差异详情态。
 * @param compactEmptyCodexNode 未选中工作区时的会话空态。
 * @param compactEmptyGitNode 未选中工作区时的 Git 空态。
 * @param compactGitBackNode 紧凑 Git 视图切换节点。
 * @param compactLogNode 紧凑布局下的终端或日志节点。
 * @param topbarLeftNode 顶栏左侧节点。
 * @param topbarActionsNode 顶栏操作节点。
 * @param messagesNode 消息列表节点。
 * @param composerNode 输入区节点。
 * @param gitDiffPanelNode Git 列表节点。
 * @param gitDiffViewerNode Git 差异详情节点。
 */
export function PhoneLayout({
  approvalToastsNode,
  updateToastNode,
  errorToastsNode,
  tabBarNode,
  homeNode,
  sidebarNode,
  activeTab,
  activeWorkspace,
  showGitDetail,
  compactEmptyCodexNode,
  compactEmptyGitNode,
  compactGitBackNode,
  compactLogNode,
  topbarLeftNode,
  topbarActionsNode,
  messagesNode,
  composerNode,
  gitDiffPanelNode,
  gitDiffViewerNode,
}: PhoneLayoutProps) {
  return (
    <div className="compact-shell">
      {approvalToastsNode}
      {updateToastNode}
      {errorToastsNode}
      {activeTab === "home" && <div className="compact-panel">{homeNode}</div>}
      {activeTab === "projects" && <div className="compact-panel">{sidebarNode}</div>}
      {activeTab === "codex" && (
        <div className="compact-panel">
          {activeWorkspace ? (
            <>
              <MainTopbar
                leftNode={topbarLeftNode}
                actionsNode={topbarActionsNode}
                className="compact-topbar"
              />
              <div className="content compact-content">
                <ChatPane messagesNode={messagesNode} composerNode={composerNode} />
              </div>
            </>
          ) : (
            compactEmptyCodexNode
          )}
        </div>
      )}
      {activeTab === "git" && (
        <div className="compact-panel">
          {!activeWorkspace && compactEmptyGitNode}
          {activeWorkspace && (
            <>
              <MainTopbar
                leftNode={topbarLeftNode}
                actionsNode={topbarActionsNode}
                className="compact-topbar"
              />
              {compactGitBackNode}
              {showGitDetail ? (
                <div className="compact-git-viewer">{gitDiffViewerNode}</div>
              ) : (
                <div className="compact-git">
                  <div className="compact-git-list">{gitDiffPanelNode}</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {activeTab === "log" && (
        <div className="compact-panel">{compactLogNode}</div>
      )}
      {tabBarNode}
    </div>
  );
}
