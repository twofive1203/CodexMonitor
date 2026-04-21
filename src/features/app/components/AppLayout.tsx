import { memo } from "react";
import type { MouseEvent, ReactNode } from "react";
import { DesktopLayout } from "../../layout/components/DesktopLayout";
import { TabletLayout } from "../../layout/components/TabletLayout";
import { PhoneLayout } from "../../layout/components/PhoneLayout";
type AppLayoutProps = {
  isPhone: boolean;
  isTablet: boolean;
  showHome: boolean;
  showGitDetail: boolean;
  activeTab: "home" | "projects" | "codex" | "git" | "log";
  tabletTab: "codex" | "git" | "log";
  centerMode: "chat" | "diff";
  preloadGitDiffs: boolean;
  splitChatDiffView: boolean;
  hasActivePlan: boolean;
  activeWorkspace: boolean;
  sidebarNode: ReactNode;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  approvalToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  homeNode: ReactNode;
  mainHeaderNode: ReactNode;
  desktopTopbarLeftNode: ReactNode;
  topbarActionsNode?: ReactNode;
  tabletNavNode: ReactNode;
  tabBarNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  gitDiffViewerNode: ReactNode;
  planPanelNode: ReactNode;
  debugPanelNode: ReactNode;
  terminalDockNode: ReactNode;
  compactLogNode: ReactNode;
  compactEmptyCodexNode: ReactNode;
  compactEmptyGitNode: ReactNode;
  compactGitBackNode: ReactNode;
  onSidebarResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onChatDiffSplitPositionResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onRightPanelResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onPlanPanelResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
};

/**
 * 应用主布局，根据桌面、平板、手机三种模式分发到对应布局组件。
 * @param isPhone 是否为手机布局。
 * @param isTablet 是否为平板布局。
 * @param showHome 是否显示首页。
 * @param showGitDetail 是否显示 Git 差异详情。
 * @param activeTab 当前激活主页签。
 * @param tabletTab 平板布局当前激活页签。
 * @param centerMode 桌面中间区域模式。
 * @param preloadGitDiffs 是否预加载 Git 差异。
 * @param splitChatDiffView 是否启用聊天与差异分栏。
 * @param hasActivePlan 是否存在激活计划。
 * @param activeWorkspace 当前是否已选中工作区。
 * @param sidebarNode 侧栏节点。
 * @param messagesNode 消息列表节点。
 * @param composerNode 输入区节点。
 * @param approvalToastsNode 审批提示节点。
 * @param updateToastNode 更新提示节点。
 * @param errorToastsNode 错误提示节点。
 * @param homeNode 首页节点。
 * @param mainHeaderNode 工作区头部节点。
 * @param desktopTopbarLeftNode 桌面顶栏左侧节点。
 * @param topbarActionsNode 顶栏操作节点。
 * @param tabletNavNode 平板导航节点。
 * @param tabBarNode 手机底部导航节点。
 * @param gitDiffPanelNode Git 列表节点。
 * @param gitDiffViewerNode Git 差异详情节点。
 * @param planPanelNode 计划面板节点。
 * @param debugPanelNode 桌面调试面板节点。
 * @param terminalDockNode 桌面终端停靠节点。
 * @param compactLogNode 紧凑布局下的终端或日志节点。
 * @param compactEmptyCodexNode 会话空态节点。
 * @param compactEmptyGitNode Git 空态节点。
 * @param compactGitBackNode 紧凑 Git 切换节点。
 * @param onSidebarResizeStart 开始调整侧栏宽度时的回调。
 * @param onChatDiffSplitPositionResizeStart 开始调整会话/Git 分栏位置时的回调。
 * @param onRightPanelResizeStart 开始调整右侧面板宽度时的回调。
 * @param onPlanPanelResizeStart 开始调整计划面板高度时的回调。
 */
export const AppLayout = memo(function AppLayout({
  isPhone,
  isTablet,
  showHome,
  showGitDetail,
  activeTab,
  tabletTab,
  centerMode,
  preloadGitDiffs,
  splitChatDiffView,
  hasActivePlan,
  activeWorkspace,
  sidebarNode,
  messagesNode,
  composerNode,
  approvalToastsNode,
  updateToastNode,
  errorToastsNode,
  homeNode,
  mainHeaderNode,
  desktopTopbarLeftNode,
  topbarActionsNode,
  tabletNavNode,
  tabBarNode,
  gitDiffPanelNode,
  gitDiffViewerNode,
  planPanelNode,
  debugPanelNode,
  terminalDockNode,
  compactLogNode,
  compactEmptyCodexNode,
  compactEmptyGitNode,
  compactGitBackNode,
  onSidebarResizeStart,
  onChatDiffSplitPositionResizeStart,
  onRightPanelResizeStart,
  onPlanPanelResizeStart,
}: AppLayoutProps) {
  if (isPhone) {
    return (
      <PhoneLayout
        approvalToastsNode={approvalToastsNode}
        updateToastNode={updateToastNode}
        errorToastsNode={errorToastsNode}
        tabBarNode={tabBarNode}
        homeNode={homeNode}
        sidebarNode={sidebarNode}
        activeTab={activeTab}
        activeWorkspace={activeWorkspace}
        showGitDetail={showGitDetail}
        compactEmptyCodexNode={compactEmptyCodexNode}
        compactEmptyGitNode={compactEmptyGitNode}
        compactGitBackNode={compactGitBackNode}
        compactLogNode={compactLogNode}
        topbarLeftNode={mainHeaderNode}
        topbarActionsNode={topbarActionsNode}
        messagesNode={messagesNode}
        composerNode={composerNode}
        gitDiffPanelNode={gitDiffPanelNode}
        gitDiffViewerNode={gitDiffViewerNode}
      />
    );
  }

  if (isTablet) {
    return (
      <TabletLayout
        tabletNavNode={tabletNavNode}
        approvalToastsNode={approvalToastsNode}
        updateToastNode={updateToastNode}
        errorToastsNode={errorToastsNode}
        homeNode={homeNode}
        showHome={showHome}
        showWorkspace={activeWorkspace && !showHome}
        sidebarNode={sidebarNode}
        tabletTab={tabletTab}
        onSidebarResizeStart={onSidebarResizeStart}
        topbarLeftNode={mainHeaderNode}
        topbarActionsNode={topbarActionsNode}
        messagesNode={messagesNode}
        composerNode={composerNode}
        gitDiffPanelNode={gitDiffPanelNode}
        gitDiffViewerNode={gitDiffViewerNode}
        compactLogNode={compactLogNode}
      />
    );
  }

  return (
    <DesktopLayout
      sidebarNode={sidebarNode}
      updateToastNode={updateToastNode}
      approvalToastsNode={approvalToastsNode}
      errorToastsNode={errorToastsNode}
      homeNode={homeNode}
      showHome={showHome}
      showWorkspace={activeWorkspace && !showHome}
      topbarLeftNode={desktopTopbarLeftNode}
      topbarActionsNode={topbarActionsNode}
      centerMode={centerMode}
      preloadGitDiffs={preloadGitDiffs}
      splitChatDiffView={splitChatDiffView}
      messagesNode={messagesNode}
      gitDiffViewerNode={gitDiffViewerNode}
      gitDiffPanelNode={gitDiffPanelNode}
      planPanelNode={planPanelNode}
      composerNode={composerNode}
      terminalDockNode={terminalDockNode}
      debugPanelNode={debugPanelNode}
      hasActivePlan={hasActivePlan}
      onSidebarResizeStart={onSidebarResizeStart}
      onChatDiffSplitPositionResizeStart={onChatDiffSplitPositionResizeStart}
      onRightPanelResizeStart={onRightPanelResizeStart}
      onPlanPanelResizeStart={onPlanPanelResizeStart}
    />
  );
});
