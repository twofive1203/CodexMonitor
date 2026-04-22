import { memo, useCallback, useEffect } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import type {
  ConversationItem,
  OpenAppTarget,
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../../../types";
import { PlanReadyFollowupMessage } from "../../app/components/PlanReadyFollowupMessage";
import { RequestUserInputMessage } from "../../app/components/RequestUserInputMessage";
import { useFileLinkOpener } from "../hooks/useFileLinkOpener";
import { formatCount, parseReasoning } from "../utils/messageRenderUtils";
import {
  DiffRow,
  ExploreRow,
  MessageRow,
  ReasoningRow,
  ReviewRow,
  ToolRow,
  UserInputRow,
  WorkingIndicator,
} from "./MessageRows";
import { useMessagesViewState } from "./useMessagesViewState";

type MessagesProps = {
  items: ConversationItem[];
  threadId: string | null;
  workspaceId?: string | null;
  canLoadMoreHistory?: boolean;
  historyLimit?: number | null;
  nextHistoryLimit?: number | null;
  isThinking: boolean;
  isLoadingMessages?: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  showPollingFetchStatus?: boolean;
  pollingIntervalMs?: number;
  workspacePath?: string | null;
  openTargets: OpenAppTarget[];
  selectedOpenAppId: string;
  codeBlockCopyUseModifier?: boolean;
  showMessageFilePath?: boolean;
  userInputRequests?: RequestUserInputRequest[];
  onUserInputSubmit?: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
  ) => void;
  onPlanAccept?: () => void;
  onPlanSubmitChanges?: (changes: string) => void;
  onOpenThreadLink?: (threadId: string, workspaceId?: string | null) => void;
  onQuoteMessage?: (text: string) => void;
  onLoadMoreHistory?: () => void;
};

/**
 * 判断当前事件目标是否属于交互控件，避免在点击按钮或链接时误进入选词保护模式。
 *
 * @param target 当前鼠标事件目标。
 * @returns 若目标属于按钮、链接或表单控件则返回 true。
 */
function isInteractiveSelectionTarget(target: EventTarget | null) {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  if (!element) {
    return false;
  }
  return Boolean(
    element.closest(
      [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "option",
        "summary",
        '[role="button"]',
        '[role="link"]',
      ].join(","),
    ),
  );
}

/**
 * 判断当前文档选区是否命中了消息容器内部的文本。
 *
 * @param container 消息滚动容器。
 * @returns 若当前存在未折叠选区且选区位于消息容器内则返回 true。
 */
function hasExpandedSelectionWithin(container: HTMLDivElement | null) {
  if (!container || typeof window === "undefined") {
    return false;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  const isWithinContainer = (node: Node | null) => Boolean(node && container.contains(node));
  return (
    isWithinContainer(range.commonAncestorContainer) ||
    isWithinContainer(selection.anchorNode) ||
    isWithinContainer(selection.focusNode)
  );
}

const SELECTING_TEXT_CLASS_NAME = "is-selecting-text";

/**
 * 生成历史扩容按钮文案。
 *
 * @param nextHistoryLimit 下一档历史条数上限，`null` 表示下一次将加载全部历史。
 * @returns 按钮展示文案。
 */
function getLoadMoreHistoryLabel(nextHistoryLimit: number | null) {
  return nextHistoryLimit === null ? "加载全部历史" : "加载更多历史";
}

export const Messages = memo(function Messages({
  items,
  threadId,
  workspaceId = null,
  canLoadMoreHistory = false,
  historyLimit = null,
  nextHistoryLimit = null,
  isThinking,
  isLoadingMessages = false,
  processingStartedAt = null,
  lastDurationMs = null,
  showPollingFetchStatus = false,
  pollingIntervalMs = 12000,
  workspacePath = null,
  openTargets,
  selectedOpenAppId,
  codeBlockCopyUseModifier = false,
  showMessageFilePath = true,
  userInputRequests = [],
  onUserInputSubmit,
  onPlanAccept,
  onPlanSubmitChanges,
  onOpenThreadLink,
  onQuoteMessage,
  onLoadMoreHistory,
}: MessagesProps) {
  const activeUserInputRequestId =
    threadId && userInputRequests.length
      ? (userInputRequests.find(
          (request) =>
            request.params.thread_id === threadId &&
            (!workspaceId || request.workspace_id === workspaceId),
        )?.request_id ?? null)
      : null;
  const { openFileLink, showFileLinkMenu } = useFileLinkOpener(
    workspacePath,
    openTargets,
    selectedOpenAppId,
  );
  const handleOpenThreadLink = useCallback(
    (threadId: string) => {
      onOpenThreadLink?.(threadId, workspaceId ?? null);
    },
    [onOpenThreadLink, workspaceId],
  );

  const hasActiveUserInputRequest = activeUserInputRequestId !== null;
  const hasVisibleUserInputRequest = hasActiveUserInputRequest && Boolean(onUserInputSubmit);
  const userInputNode =
    hasActiveUserInputRequest && onUserInputSubmit ? (
      <RequestUserInputMessage
        requests={userInputRequests}
        activeThreadId={threadId}
        activeWorkspaceId={workspaceId}
        onSubmit={onUserInputSubmit}
      />
    ) : null;
  const {
    bottomRef,
    containerRef,
    updateAutoScroll,
    requestAutoScroll,
    expandedItems,
    toggleExpanded,
    collapsedToolGroups,
    toggleToolGroup,
    copiedMessageId,
    handleCopyMessage,
    handleQuoteMessage,
    reasoningMetaById,
    latestReasoningLabel,
    groupedItems,
    planFollowup,
    dismissPlanFollowup,
  } = useMessagesViewState({
    items,
    threadId,
    isThinking,
    activeUserInputRequestId,
    hasVisibleUserInputRequest,
    onPlanAccept,
    onPlanSubmitChanges,
    onQuoteMessage,
  });

  const planFollowupNode =
    planFollowup.shouldShow && onPlanAccept && onPlanSubmitChanges ? (
      <PlanReadyFollowupMessage
        onAccept={() => {
          dismissPlanFollowup();
          onPlanAccept();
        }}
        onSubmitChanges={(changes) => {
          dismissPlanFollowup();
          onPlanSubmitChanges(changes);
        }}
      />
    ) : null;
  const showLoadMoreHistory =
    Boolean(threadId) &&
    canLoadMoreHistory &&
    Boolean(onLoadMoreHistory) &&
    historyLimit !== null;
  const loadMoreHistoryLabel = getLoadMoreHistoryLabel(nextHistoryLimit);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let isPointerSelectingText = false;

    const syncSelectionState = () => {
      const shouldProtectSelection =
        isPointerSelectingText || hasExpandedSelectionWithin(container);
      container.classList.toggle(SELECTING_TEXT_CLASS_NAME, shouldProtectSelection);
    };

    const handlePointerStart = (event: MouseEvent) => {
      if (event.button !== 0 || isInteractiveSelectionTarget(event.target)) {
        return;
      }
      isPointerSelectingText = true;
      syncSelectionState();
    };

    const handlePointerRelease = () => {
      window.requestAnimationFrame(() => {
        isPointerSelectingText = false;
        syncSelectionState();
      });
    };

    container.addEventListener("mousedown", handlePointerStart, true);
    document.addEventListener("selectionchange", syncSelectionState);
    window.addEventListener("mouseup", handlePointerRelease, true);
    window.addEventListener("dragend", handlePointerRelease, true);
    window.addEventListener("blur", handlePointerRelease);
    syncSelectionState();

    return () => {
      container.classList.remove(SELECTING_TEXT_CLASS_NAME);
      container.removeEventListener("mousedown", handlePointerStart, true);
      document.removeEventListener("selectionchange", syncSelectionState);
      window.removeEventListener("mouseup", handlePointerRelease, true);
      window.removeEventListener("dragend", handlePointerRelease, true);
      window.removeEventListener("blur", handlePointerRelease);
    };
  }, [containerRef]);

  const renderItem = (item: ConversationItem) => {
    if (item.kind === "message") {
      const isCopied = copiedMessageId === item.id;
      return (
        <MessageRow
          key={item.id}
          item={item}
          isCopied={isCopied}
          onCopy={handleCopyMessage}
          onQuote={onQuoteMessage ? handleQuoteMessage : undefined}
          codeBlockCopyUseModifier={codeBlockCopyUseModifier}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
        />
      );
    }
    if (item.kind === "reasoning") {
      const isExpanded = expandedItems.has(item.id);
      const parsed = reasoningMetaById.get(item.id) ?? parseReasoning(item);
      return (
        <ReasoningRow
          key={item.id}
          item={item}
          parsed={parsed}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
        />
      );
    }
    if (item.kind === "review") {
      return (
        <ReviewRow
          key={item.id}
          item={item}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
        />
      );
    }
    if (item.kind === "userInput") {
      const isExpanded = expandedItems.has(item.id);
      return (
        <UserInputRow
          key={item.id}
          item={item}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
        />
      );
    }
    if (item.kind === "diff") {
      return <DiffRow key={item.id} item={item} />;
    }
    if (item.kind === "tool") {
      const isExpanded = expandedItems.has(item.id);
      return (
        <ToolRow
          key={item.id}
          item={item}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
          onRequestAutoScroll={requestAutoScroll}
        />
      );
    }
    if (item.kind === "explore") {
      return <ExploreRow key={item.id} item={item} />;
    }
    return null;
  };

  return (
    <div
      className="messages messages-full"
      ref={containerRef}
      onScroll={updateAutoScroll}
    >
      <div className="messages-inner">
        {showLoadMoreHistory && (
          <div className="messages-history-banner" role="note">
            <div className="messages-history-meta">
              {`当前仅显示最近 ${historyLimit} 条记录，可继续同步更早历史。`}
            </div>
            <button
              type="button"
              className="messages-history-button"
              onClick={onLoadMoreHistory}
              disabled={isLoadingMessages}
            >
              {isLoadingMessages ? "正在加载历史..." : loadMoreHistoryLabel}
            </button>
          </div>
        )}
        {groupedItems.map((entry) => {
          if (entry.kind === "toolGroup") {
            const { group } = entry;
            const isCollapsed = collapsedToolGroups.has(group.id);
            const summaryParts = [
              formatCount(group.toolCount, "次工具调用"),
            ];
            if (group.messageCount > 0) {
              summaryParts.push(formatCount(group.messageCount, "条消息"));
            }
            const summaryText = summaryParts.join(", ");
            const groupBodyId = `tool-group-${group.id}`;
            const ChevronIcon = isCollapsed ? ChevronDown : ChevronUp;
            return (
              <div
                key={`tool-group-${group.id}`}
                className={`tool-group ${isCollapsed ? "tool-group-collapsed" : ""}`}
              >
                <div className="tool-group-header">
                  <button
                    type="button"
                    className="tool-group-toggle"
                    onClick={() => toggleToolGroup(group.id)}
                    aria-expanded={!isCollapsed}
                    aria-controls={groupBodyId}
                    aria-label={isCollapsed ? "展开工具调用" : "收起工具调用"}
                  >
                    <span className="tool-group-chevron" aria-hidden>
                      <ChevronIcon size={14} />
                    </span>
                    <span className="tool-group-summary">{summaryText}</span>
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="tool-group-body" id={groupBodyId}>
                    {group.items.map(renderItem)}
                  </div>
                )}
              </div>
            );
          }
          return renderItem(entry.item);
        })}
        {planFollowupNode}
        {userInputNode}
        <WorkingIndicator
          isThinking={isThinking}
          processingStartedAt={processingStartedAt}
          lastDurationMs={lastDurationMs}
          hasItems={items.length > 0}
          reasoningLabel={latestReasoningLabel}
          showPollingFetchStatus={showPollingFetchStatus}
          pollingIntervalMs={pollingIntervalMs}
        />
        {!items.length && !userInputNode && !isThinking && !isLoadingMessages && (
          <div className="empty messages-empty">
            {threadId ? "发送提示词给智能体。" : "发送提示词以启动新智能体。"}
          </div>
        )}
        {!items.length && !userInputNode && !isThinking && isLoadingMessages && (
          <div className="empty messages-empty">
            <div className="messages-loading-indicator" role="status" aria-live="polite">
              <span className="working-spinner" aria-hidden />
              <span className="messages-loading-label">加载中...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});
