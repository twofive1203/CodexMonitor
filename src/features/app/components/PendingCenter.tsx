import type {
  AccountSnapshot,
  ApprovalRequest,
  RequestUserInputRequest,
  WorkspaceInfo,
} from "../../../types";

type PendingCenterProps = {
  approvals: ApprovalRequest[];
  userInputRequests: RequestUserInputRequest[];
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
  accountInfo: AccountSnapshot | null;
  accountDisabled: boolean;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onSwitchAccount: () => void;
};

type PendingCenterItem = {
  id: string;
  title: string;
  detail: string;
  workspaceId: string;
  threadId: string | null;
};

/**
 * 从审批请求参数中提取线程 ID。
 * @param params 审批请求参数，兼容 threadId 与 thread_id 两种命名。
 */
function getApprovalThreadId(params: Record<string, unknown>): string | null {
  const candidate = params.threadId ?? params.thread_id;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

/**
 * 将 app-server 方法名整理为适合展示的短标签。
 * @param method 原始审批方法名。
 */
function formatApprovalMethod(method: string): string {
  const trimmed = method.replace(/^codex\/requestApproval\/?/, "").trim();
  return trimmed || method;
}

/**
 * 构建侧栏待处理中心的展示项。
 * @param approvals 审批请求列表。
 * @param userInputRequests 用户输入请求列表。
 * @param workspaceNameById 工作区名称索引。
 */
function buildPendingItems(
  approvals: ApprovalRequest[],
  userInputRequests: RequestUserInputRequest[],
  workspaceNameById: Map<string, string>,
): PendingCenterItem[] {
  const approvalItems = approvals.map((approval) => {
    const workspaceName = workspaceNameById.get(approval.workspace_id) ?? "未知工作区";
    return {
      id: `approval:${approval.workspace_id}:${approval.request_id}`,
      title: "需要审批",
      detail: `${workspaceName} · ${formatApprovalMethod(approval.method)}`,
      workspaceId: approval.workspace_id,
      threadId: getApprovalThreadId(approval.params),
    };
  });
  const inputItems = userInputRequests.map((request) => {
    const workspaceName = workspaceNameById.get(request.workspace_id) ?? "未知工作区";
    const questionCount = request.params.questions.length;
    return {
      id: `input:${request.workspace_id}:${request.request_id}`,
      title: "需要补充信息",
      detail: `${workspaceName} · ${questionCount} 个问题`,
      workspaceId: request.workspace_id,
      threadId: request.params.thread_id.trim() || null,
    };
  });
  return [...approvalItems, ...inputItems];
}

/**
 * 渲染审批、用户输入和登录状态的统一待处理入口。
 * @param props 待处理请求、账号状态和定位回调。
 */
export function PendingCenter({
  approvals,
  userInputRequests,
  workspaces,
  activeWorkspaceId,
  accountInfo,
  accountDisabled,
  onSelectThread,
  onSwitchAccount,
}: PendingCenterProps) {
  const workspaceNameById = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  const pendingItems = buildPendingItems(approvals, userInputRequests, workspaceNameById);
  const accountEmail = accountInfo?.email?.trim() ?? "";
  const showLoginItem = Boolean(activeWorkspaceId) && !accountEmail;
  const totalCount = pendingItems.length + (showLoginItem ? 1 : 0);

  if (totalCount === 0) {
    return null;
  }

  return (
    <div className="pending-center" aria-label="待处理中心">
      <div className="sidebar-section-header">
        <div className="sidebar-section-title">待处理</div>
        <div className="sidebar-section-count">{totalCount}</div>
      </div>
      <div className="pending-center-list">
        {pendingItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className="pending-center-item"
            onClick={() => {
              if (item.threadId) {
                onSelectThread(item.workspaceId, item.threadId);
              }
            }}
            disabled={!item.threadId}
          >
            <span className="pending-center-title">{item.title}</span>
            <span className="pending-center-detail">{item.detail}</span>
          </button>
        ))}
        {showLoginItem && (
          <button
            type="button"
            className="pending-center-item"
            onClick={onSwitchAccount}
            disabled={accountDisabled}
          >
            <span className="pending-center-title">需要登录账号</span>
            <span className="pending-center-detail">点击完成当前工作区登录</span>
          </button>
        )}
      </div>
    </div>
  );
}
