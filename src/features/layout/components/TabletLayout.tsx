import type { MouseEvent, ReactNode } from "react";
import { MainTopbar } from "../../app/components/MainTopbar";
import { ChatPane } from "./ChatPane";

type TabletLayoutProps = {
  tabletNavNode: ReactNode;
  approvalToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  homeNode: ReactNode;
  showHome: boolean;
  showWorkspace: boolean;
  sidebarNode: ReactNode;
  tabletTab: "projects" | "codex" | "git" | "log";
  onSidebarResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  topbarLeftNode: ReactNode;
  topbarActionsNode?: ReactNode;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  gitDiffViewerNode: ReactNode;
  compactLogNode: ReactNode;
};

/**
 * 平板布局，负责在项目列表、会话、Git 与终端/日志之间切换。
 * @param tabletNavNode 平板导航节点。
 * @param approvalToastsNode 审批提示节点。
 * @param updateToastNode 更新提示节点。
 * @param errorToastsNode 错误提示节点。
 * @param homeNode 首页节点。
 * @param showHome 是否显示首页。
 * @param showWorkspace 是否显示工作区主体。
 * @param sidebarNode 项目侧栏节点。
 * @param tabletTab 当前激活页签。
 * @param onSidebarResizeStart 开始调整项目栏宽度时的回调。
 * @param topbarLeftNode 顶栏左侧节点。
 * @param topbarActionsNode 顶栏操作节点。
 * @param messagesNode 消息列表节点。
 * @param composerNode 输入区节点。
 * @param gitDiffPanelNode Git 列表节点。
 * @param gitDiffViewerNode Git 差异详情节点。
 * @param compactLogNode 紧凑布局下的终端或日志节点。
 */
export function TabletLayout({
  tabletNavNode,
  approvalToastsNode,
  updateToastNode,
  errorToastsNode,
  homeNode,
  showHome,
  showWorkspace,
  sidebarNode,
  tabletTab,
  onSidebarResizeStart,
  topbarLeftNode,
  topbarActionsNode,
  messagesNode,
  composerNode,
  gitDiffPanelNode,
  gitDiffViewerNode,
  compactLogNode,
}: TabletLayoutProps) {
  return (
    <>
      {tabletNavNode}
      <div className="tablet-projects">{sidebarNode}</div>
      <div
        className="projects-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整项目栏大小"
        onMouseDown={onSidebarResizeStart}
      />
      <section className="tablet-main">
        {approvalToastsNode}
        {updateToastNode}
        {errorToastsNode}
        {showHome && homeNode}
        {showWorkspace && (
          <>
            <MainTopbar
              leftNode={topbarLeftNode}
              actionsNode={topbarActionsNode}
              className="tablet-topbar"
            />
            {tabletTab === "codex" && (
              <div className="content tablet-content">
                <ChatPane messagesNode={messagesNode} composerNode={composerNode} />
              </div>
            )}
            {tabletTab === "git" && (
              <div className="tablet-git">
                {gitDiffPanelNode}
                <div className="tablet-git-viewer">{gitDiffViewerNode}</div>
              </div>
            )}
            {tabletTab === "log" && compactLogNode}
          </>
        )}
      </section>
    </>
  );
}
