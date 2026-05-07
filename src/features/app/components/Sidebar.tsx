import type {
  AgentProvider,
  AccountSnapshot,
  ApprovalRequest,
  RequestUserInputRequest,
  RateLimitSnapshot,
  ThreadListOrganizeMode,
  ThreadListSortKey,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent, RefObject } from "react";
import { FolderOpen } from "lucide-react";
import { SidebarBottomRail } from "./SidebarBottomRail";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarSearchBar } from "./SidebarSearchBar";
import { SidebarThreadsOnlySection } from "./SidebarThreadsOnlySection";
import { SidebarWorkspaceGroups } from "./SidebarWorkspaceGroups";
import { PinnedThreadList } from "./PinnedThreadList";
import { PendingCenter } from "./PendingCenter";
import { workspaceMatchesQuery } from "./threadSearchUtils";
import {
  buildFilteredSidebarWorkspaceGroups,
  buildProjectOptionsForNewThread,
  buildSidebarFlatThreadRootGroups,
  buildSidebarPinnedThreadRows,
  buildSidebarSearchViewModel,
  buildSidebarWorkspaceActivityById,
  buildSidebarWorkspaceRelationViewModel,
  buildSortedSidebarWorkspaceGroups,
  buildWorkspaceNameById,
  countPinnedThreadRoots,
  groupFlatThreadRowsByTimeBucket,
} from "./sidebarViewModel";
import type {
  SidebarOverlayMenuAnchor,
  SidebarWorkspaceAddMenuAnchor,
  WorkspaceGroupSection,
} from "./sidebarTypes";
import { useCollapsedGroups } from "../hooks/useCollapsedGroups";
import { useMenuController } from "../hooks/useMenuController";
import { useSidebarMenus } from "../hooks/useSidebarMenus";
import { useSidebarScrollFade } from "../hooks/useSidebarScrollFade";
import { useThreadRows } from "../hooks/useThreadRows";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { getUsageLabels } from "../utils/usageLabels";
import { formatRelativeTimeShort } from "../../../utils/time";
import type { ThreadStatusById } from "../../../utils/threadStatus";

const COLLAPSED_GROUPS_STORAGE_KEY = "codexmonitor.collapsedGroups";
const UNGROUPED_COLLAPSE_ID = "__ungrouped__";
const ADD_MENU_WIDTH = 200;
const ALL_THREADS_ADD_MENU_WIDTH = 220;

type SidebarProps = {
  nativeContextMenuEnabled?: boolean;
  claudeEnabled: boolean;
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: WorkspaceGroupSection[];
  hasWorkspaceGroups: boolean;
  deletingWorktreeIds: Set<string>;
  newAgentDraftWorkspaceId?: string | null;
  startingDraftThreadWorkspaceId?: string | null;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadParentById: Record<string, string>;
  threadStatusById: ThreadStatusById;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadListPagingByWorkspace: Record<string, boolean>;
  threadListCursorByWorkspace: Record<string, string | null>;
  pinnedThreadsVersion: number;
  threadListSortKey: ThreadListSortKey;
  onSetThreadListSortKey: (sortKey: ThreadListSortKey) => void;
  threadListOrganizeMode: ThreadListOrganizeMode;
  onSetThreadListOrganizeMode: (organizeMode: ThreadListOrganizeMode) => void;
  onRefreshAllThreads: () => void;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  approvals?: ApprovalRequest[];
  userInputRequests?: RequestUserInputRequest[];
  accountRateLimits: RateLimitSnapshot | null;
  usageShowRemaining: boolean;
  accountInfo: AccountSnapshot | null;
  onSwitchAccount: () => void;
  onCancelSwitchAccount: () => void;
  accountSwitching: boolean;
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  showDebugButton: boolean;
  onAddWorkspace: () => void;
  onSelectHome: () => void;
  onSelectWorkspace: (id: string) => void;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  onDisconnectWorkspace: (workspace: WorkspaceInfo) => void;
  onAddAgent: (workspace: WorkspaceInfo) => void;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void;
  onAddCloneAgent: (workspace: WorkspaceInfo) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  pinThread: (workspaceId: string, threadId: string) => boolean;
  unpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  getThreadArgsBadge?: (workspaceId: string, threadId: string) => string | null;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onMoveWorkspace: (workspaceId: string, direction: "up" | "down") => void;
  onUpdateWorkspaceProvider: (workspaceId: string, provider: AgentProvider) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
  workspaceDropTargetRef: RefObject<HTMLElement | null>;
  isWorkspaceDropActive: boolean;
  workspaceDropText: string;
  onWorkspaceDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDrop: (event: React.DragEvent<HTMLElement>) => void;
};

export const Sidebar = memo(function Sidebar({
  nativeContextMenuEnabled = true,
  claudeEnabled,
  workspaces,
  groupedWorkspaces,
  hasWorkspaceGroups,
  deletingWorktreeIds,
  newAgentDraftWorkspaceId = null,
  startingDraftThreadWorkspaceId = null,
  threadsByWorkspace,
  threadParentById,
  threadStatusById,
  threadListLoadingByWorkspace,
  threadListPagingByWorkspace,
  threadListCursorByWorkspace,
  pinnedThreadsVersion,
  threadListSortKey,
  onSetThreadListSortKey,
  threadListOrganizeMode,
  onSetThreadListOrganizeMode,
  onRefreshAllThreads,
  activeWorkspaceId,
  activeThreadId,
  approvals = [],
  userInputRequests = [],
  accountRateLimits,
  usageShowRemaining,
  accountInfo,
  onSwitchAccount,
  onCancelSwitchAccount,
  accountSwitching,
  onOpenSettings,
  onOpenDebug,
  showDebugButton,
  onAddWorkspace,
  onSelectHome,
  onSelectWorkspace,
  onConnectWorkspace,
  onDisconnectWorkspace,
  onAddAgent,
  onAddWorktreeAgent,
  onAddCloneAgent,
  onToggleWorkspaceCollapse,
  onSelectThread,
  onDeleteThread,
  onSyncThread,
  pinThread,
  unpinThread,
  isThreadPinned,
  getPinTimestamp,
  getThreadArgsBadge,
  onRenameThread,
  onDeleteWorkspace,
  onDeleteWorktree,
  onMoveWorkspace,
  onUpdateWorkspaceProvider,
  onLoadOlderThreads,
  onReloadWorkspaceThreads,
  workspaceDropTargetRef,
  isWorkspaceDropActive,
  workspaceDropText,
  onWorkspaceDragOver,
  onWorkspaceDragEnter,
  onWorkspaceDragLeave,
  onWorkspaceDrop,
}: SidebarProps) {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState(
    new Set<string>(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [addMenuAnchor, setAddMenuAnchor] =
    useState<SidebarWorkspaceAddMenuAnchor | null>(null);
  const [allThreadsAddMenuAnchor, setAllThreadsAddMenuAnchor] =
    useState<SidebarOverlayMenuAnchor | null>(null);
  const allThreadsAddMenuOpen = Boolean(allThreadsAddMenuAnchor);
  const addMenuController = useMenuController({
    open: Boolean(addMenuAnchor),
    onDismiss: () => setAddMenuAnchor(null),
  });
  const { containerRef: addMenuRef } = addMenuController;
  const allThreadsAddMenuController = useMenuController({
    open: Boolean(allThreadsAddMenuAnchor),
    onDismiss: () => setAllThreadsAddMenuAnchor(null),
  });
  const { containerRef: allThreadsAddMenuRef } = allThreadsAddMenuController;
  const { collapsedGroups, toggleGroupCollapse } = useCollapsedGroups(
    COLLAPSED_GROUPS_STORAGE_KEY,
  );
  const { getThreadRows } = useThreadRows(threadParentById);
  /**
   * 判断工作区是否能在当前自定义项目顺序中移动。
   *
   * `workspaceId`：待移动工作区 ID。
   * `direction`：移动方向，支持上移或下移。
   */
  const canMoveWorkspace = useCallback(
    (workspaceId: string, direction: "up" | "down") => {
      for (const group of groupedWorkspaces) {
        const index = group.workspaces.findIndex(
          (workspace) => workspace.id === workspaceId,
        );
        if (index === -1) {
          continue;
        }
        return direction === "up"
          ? index > 0
          : index < group.workspaces.length - 1;
      }
      return false;
    },
    [groupedWorkspaces],
  );
  const {
    showThreadMenu,
    showWorkspaceMenu,
    showWorktreeMenu,
    showCloneMenu,
    contextMenuNode,
  } = useSidebarMenus({
    nativeContextMenuEnabled,
    claudeEnabled,
    onDeleteThread,
    onSyncThread,
    onPinThread: pinThread,
    onUnpinThread: unpinThread,
    isThreadPinned,
    onRenameThread,
    onReloadWorkspaceThreads,
    onDeleteWorkspace,
    onDeleteWorktree,
    onMoveWorkspace,
    canMoveWorkspace,
    onUpdateWorkspaceProvider,
  });
  const {
    sessionPercent,
    weeklyPercent,
    sessionResetLabel,
    weeklyResetLabel,
    creditsLabel,
    showWeekly,
  } = getUsageLabels(accountRateLimits, usageShowRemaining);
  const debouncedQuery = useDebouncedValue(searchQuery, 150);
  const normalizedQuery = debouncedQuery.trim().toLowerCase();
  const isSearchActive = Boolean(normalizedQuery);
  const pendingUserInputKeys = useMemo(
    () =>
      new Set(
        userInputRequests
          .map((request) => {
            const workspaceId = request.workspace_id.trim();
            const threadId = request.params.thread_id.trim();
            return workspaceId && threadId ? `${workspaceId}:${threadId}` : "";
          })
          .filter(Boolean),
      ),
    [userInputRequests],
  );

  const isWorkspaceMatch = useCallback(
    (workspace: WorkspaceInfo) => {
      return workspaceMatchesQuery(workspace.name, normalizedQuery);
    },
    [normalizedQuery],
  );
  const { workspaceHasMatchingThreadById, workspaceVisibleDuringSearchById } = useMemo(
    () =>
      buildSidebarSearchViewModel({
        isSearchActive,
        normalizedQuery,
        workspaces,
        threadsByWorkspace,
        threadListCursorByWorkspace,
      }),
    [
      isSearchActive,
      normalizedQuery,
      threadListCursorByWorkspace,
      threadsByWorkspace,
      workspaces,
    ],
  );

  const renderHighlightedName = useCallback(
    (name: string) => {
      if (!normalizedQuery) {
        return name;
      }
      const lower = name.toLowerCase();
      const parts: React.ReactNode[] = [];
      let cursor = 0;
      let matchIndex = lower.indexOf(normalizedQuery, cursor);

      while (matchIndex !== -1) {
        if (matchIndex > cursor) {
          parts.push(name.slice(cursor, matchIndex));
        }
        parts.push(
          <span key={`${matchIndex}-${cursor}`} className="workspace-name-match">
            {name.slice(matchIndex, matchIndex + normalizedQuery.length)}
          </span>,
        );
        cursor = matchIndex + normalizedQuery.length;
        matchIndex = lower.indexOf(normalizedQuery, cursor);
      }

      if (cursor < name.length) {
        parts.push(name.slice(cursor));
      }

      return parts.length ? parts : name;
    },
    [normalizedQuery],
  );

  const accountEmail = accountInfo?.email?.trim() ?? "";
  const accountButtonLabel = accountEmail
    ? accountEmail
    : accountInfo?.type === "apikey"
      ? "API key"
      : "Sign in to Codex";
  const accountActionLabel = accountEmail ? "Switch account" : "Sign in";
  const showAccountSwitcher = Boolean(activeWorkspaceId);
  const accountSwitchDisabled = accountSwitching || !activeWorkspaceId;
  const accountCancelDisabled = !accountSwitching || !activeWorkspaceId;
  const refreshDisabled = workspaces.length === 0 || workspaces.every((workspace) => !workspace.connected);
  const refreshInProgress = workspaces.some(
    (workspace) => threadListLoadingByWorkspace[workspace.id] ?? false,
  );

  const pinnedThreadRows = useMemo(
    () =>
      buildSidebarPinnedThreadRows({
        workspaces,
        threadsByWorkspace,
        isSearchActive,
        normalizedQuery,
        workspaceHasMatchingThreadById,
        getThreadRows,
        getPinTimestamp,
        pinnedThreadsVersion,
      }),
    [
      getPinTimestamp,
      getThreadRows,
      isSearchActive,
      normalizedQuery,
      pinnedThreadsVersion,
      threadsByWorkspace,
      workspaceHasMatchingThreadById,
      workspaces,
    ],
  );

  const {
    cloneSourceIdsMatchingQuery,
    worktreeParentIdsMatchingQuery,
    clonesBySource,
    cloneChildIds,
    worktreesByParent,
  } = useMemo(
    () =>
      buildSidebarWorkspaceRelationViewModel({
        isSearchActive,
        workspaces,
        workspaceVisibleDuringSearchById,
      }),
    [isSearchActive, workspaceVisibleDuringSearchById, workspaces],
  );

  const filteredGroupedWorkspaces = useMemo(
    () =>
      buildFilteredSidebarWorkspaceGroups({
        groupedWorkspaces,
        isSearchActive,
        workspaceVisibleDuringSearchById,
        cloneSourceIdsMatchingQuery,
        worktreeParentIdsMatchingQuery,
      }),
    [
      cloneSourceIdsMatchingQuery,
      groupedWorkspaces,
      isSearchActive,
      worktreeParentIdsMatchingQuery,
      workspaceVisibleDuringSearchById,
    ],
  );

  const workspaceActivityById = useMemo(
    () =>
      buildSidebarWorkspaceActivityById({
        filteredGroupedWorkspaces,
        threadsByWorkspace,
        clonesBySource,
        workspaceVisibleDuringSearchById,
        normalizedQuery,
        sortKey: threadListSortKey,
      }),
    [
      clonesBySource,
      filteredGroupedWorkspaces,
      normalizedQuery,
      threadListSortKey,
      threadsByWorkspace,
      workspaceVisibleDuringSearchById,
    ],
  );

  const sortedGroupedWorkspaces = useMemo(
    () =>
      buildSortedSidebarWorkspaceGroups({
        filteredGroupedWorkspaces,
        organizeMode: threadListOrganizeMode,
        workspaceActivityById,
      }),
    [filteredGroupedWorkspaces, threadListOrganizeMode, workspaceActivityById],
  );

  const flatThreadRootGroups = useMemo(
    () =>
      buildSidebarFlatThreadRootGroups({
        organizeMode: threadListOrganizeMode,
        filteredGroupedWorkspaces,
        threadsByWorkspace,
        getThreadRows,
        getPinTimestamp,
        pinnedThreadsVersion,
        normalizedQuery,
        sortKey: threadListSortKey,
      }),
    [
      filteredGroupedWorkspaces,
      getPinTimestamp,
      getThreadRows,
      normalizedQuery,
      pinnedThreadsVersion,
      threadListOrganizeMode,
      threadListSortKey,
      threadsByWorkspace,
    ],
  );
  const flatThreadRows = useMemo(
    () => flatThreadRootGroups.flatMap((group) => group.rows),
    [flatThreadRootGroups],
  );
  const threadBuckets = useMemo(
    () => groupFlatThreadRowsByTimeBucket(flatThreadRootGroups, Date.now()),
    [flatThreadRootGroups],
  );

  const scrollFadeDeps = useMemo(
    () => [
      sortedGroupedWorkspaces,
      flatThreadRows,
      threadsByWorkspace,
      expandedWorkspaces,
      normalizedQuery,
      threadListOrganizeMode,
    ],
    [
      sortedGroupedWorkspaces,
      flatThreadRows,
      threadsByWorkspace,
      expandedWorkspaces,
      normalizedQuery,
      threadListOrganizeMode,
    ],
  );
  const { sidebarBodyRef, scrollFade, updateScrollFade } =
    useSidebarScrollFade(scrollFadeDeps);

  const workspaceNameById = useMemo(
    () => buildWorkspaceNameById(workspaces),
    [workspaces],
  );
  const getWorkspaceLabel = useCallback(
    (workspaceId: string) => workspaceNameById.get(workspaceId) ?? null,
    [workspaceNameById],
  );

  const groupedWorkspacesForRender =
    threadListOrganizeMode === "by_project_activity"
      ? sortedGroupedWorkspaces
      : filteredGroupedWorkspaces;
  const isThreadsOnlyMode = threadListOrganizeMode === "threads_only";

  const handleAllThreadsAddMenuToggle = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (allThreadsAddMenuOpen) {
        setAllThreadsAddMenuAnchor(null);
        return;
      }
      setAddMenuAnchor(null);
      const rect = event.currentTarget.getBoundingClientRect();
      const left = Math.min(
        Math.max(rect.left, 12),
        window.innerWidth - ALL_THREADS_ADD_MENU_WIDTH - 12,
      );
      const top = rect.bottom + 8;
      setAllThreadsAddMenuAnchor({
        top,
        left,
        width: ALL_THREADS_ADD_MENU_WIDTH,
      });
    },
    [allThreadsAddMenuOpen],
  );

  const handleCreateThreadInProject = useCallback(
    (workspace: WorkspaceInfo) => {
      setAllThreadsAddMenuAnchor(null);
      onAddAgent(workspace);
    },
    [onAddAgent],
  );

  const projectOptionsForNewThread = useMemo(
    () => buildProjectOptionsForNewThread(groupedWorkspacesForRender, cloneChildIds),
    [cloneChildIds, groupedWorkspacesForRender],
  );

  const handleToggleExpanded = useCallback((workspaceId: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  }, []);

  const getThreadTime = useCallback(
    (thread: ThreadSummary) => {
      const timestamp = thread.updatedAt ?? null;
      return timestamp ? formatRelativeTimeShort(timestamp) : null;
    },
    [],
  );
  const pinnedRootCount = useMemo(
    () => countPinnedThreadRoots(pinnedThreadRows),
    [pinnedThreadRows],
  );

  useEffect(() => {
    if (!addMenuAnchor) {
      return;
    }
    function handleScroll() {
      setAddMenuAnchor(null);
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [addMenuAnchor]);

  useEffect(() => {
    if (!allThreadsAddMenuAnchor) {
      return;
    }
    function handleScroll() {
      setAllThreadsAddMenuAnchor(null);
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [allThreadsAddMenuAnchor]);

  useEffect(() => {
    if (!isSearchOpen && searchQuery) {
      setSearchQuery("");
    }
  }, [isSearchOpen, searchQuery]);

  return (
    <aside
      className={`sidebar${isSearchOpen ? " search-open" : ""}`}
      ref={workspaceDropTargetRef}
      onDragOver={onWorkspaceDragOver}
      onDragEnter={onWorkspaceDragEnter}
      onDragLeave={onWorkspaceDragLeave}
      onDrop={onWorkspaceDrop}
    >
      <div className="sidebar-drag-strip" />
      <SidebarHeader
        onSelectHome={onSelectHome}
        onAddWorkspace={onAddWorkspace}
        onToggleSearch={() => setIsSearchOpen((prev) => !prev)}
        isSearchOpen={isSearchOpen}
        threadListSortKey={threadListSortKey}
        onSetThreadListSortKey={onSetThreadListSortKey}
        threadListOrganizeMode={threadListOrganizeMode}
        onSetThreadListOrganizeMode={onSetThreadListOrganizeMode}
        onRefreshAllThreads={onRefreshAllThreads}
        refreshDisabled={refreshDisabled || refreshInProgress}
        refreshInProgress={refreshInProgress}
      />
      <SidebarSearchBar
        isSearchOpen={isSearchOpen}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onClearSearch={() => setSearchQuery("")}
      />
      <div
        className={`workspace-drop-overlay${
          isWorkspaceDropActive ? " is-active" : ""
        }`}
        aria-hidden
      >
        <div
          className={`workspace-drop-overlay-text${
            workspaceDropText === "Adding Project..." ? " is-busy" : ""
          }`}
        >
          {workspaceDropText === "Drop Project Here" && (
            <FolderOpen className="workspace-drop-overlay-icon" aria-hidden />
          )}
          {workspaceDropText}
        </div>
      </div>
      <div
        className={`sidebar-body${scrollFade.top ? " fade-top" : ""}${
          scrollFade.bottom ? " fade-bottom" : ""
        }`}
        onScroll={updateScrollFade}
        ref={sidebarBodyRef}
      >
        <div className="workspace-list">
          <PendingCenter
            approvals={approvals}
            userInputRequests={userInputRequests}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            accountInfo={accountInfo}
            accountDisabled={accountSwitchDisabled}
            onSelectThread={onSelectThread}
            onSwitchAccount={onSwitchAccount}
          />
          {pinnedThreadRows.length > 0 && (
            <div className="pinned-section">
              <div className="sidebar-section-header">
                <div className="sidebar-section-title">已固定会话</div>
                <div className="sidebar-section-count">{pinnedRootCount}</div>
              </div>
              <PinnedThreadList
                rows={pinnedThreadRows}
                activeWorkspaceId={activeWorkspaceId}
                activeThreadId={activeThreadId}
                threadStatusById={threadStatusById}
                pendingUserInputKeys={pendingUserInputKeys}
                getThreadTime={getThreadTime}
                getThreadArgsBadge={getThreadArgsBadge}
                isThreadPinned={isThreadPinned}
                onSelectThread={onSelectThread}
                onShowThreadMenu={showThreadMenu}
                getWorkspaceLabel={getWorkspaceLabel}
              />
            </div>
          )}
          {isThreadsOnlyMode
            ? groupedWorkspacesForRender.length > 0 && (
                <SidebarThreadsOnlySection
                  threadBuckets={threadBuckets}
                  activeWorkspaceId={activeWorkspaceId}
                  activeThreadId={activeThreadId}
                  threadStatusById={threadStatusById}
                  pendingUserInputKeys={pendingUserInputKeys}
                  getThreadTime={getThreadTime}
                  getThreadArgsBadge={getThreadArgsBadge}
                  isThreadPinned={isThreadPinned}
                  onSelectThread={onSelectThread}
                  onShowThreadMenu={showThreadMenu}
                  getWorkspaceLabel={getWorkspaceLabel}
                  addMenuOpen={allThreadsAddMenuOpen}
                  addMenuAnchor={allThreadsAddMenuAnchor}
                  addMenuRef={allThreadsAddMenuRef}
                  projectOptionsForNewThread={projectOptionsForNewThread}
                  onToggleAddMenu={handleAllThreadsAddMenuToggle}
                  onCreateThreadInProject={handleCreateThreadInProject}
                />
              )
            : (
                <SidebarWorkspaceGroups
                  groups={groupedWorkspacesForRender}
                  hasWorkspaceGroups={hasWorkspaceGroups}
                  collapsedGroups={collapsedGroups}
                  ungroupedCollapseId={UNGROUPED_COLLAPSE_ID}
                  toggleGroupCollapse={toggleGroupCollapse}
                  cloneChildIds={cloneChildIds}
                  clonesBySource={clonesBySource}
                  worktreesByParent={worktreesByParent}
                  workspaceVisibleDuringSearchById={workspaceVisibleDuringSearchById}
                  isSearchActive={isSearchActive}
                  normalizedQuery={normalizedQuery}
                  renderHighlightedName={renderHighlightedName}
                  isWorkspaceMatch={isWorkspaceMatch}
                  deletingWorktreeIds={deletingWorktreeIds}
                  threadsByWorkspace={threadsByWorkspace}
                  threadStatusById={threadStatusById}
                  threadListLoadingByWorkspace={threadListLoadingByWorkspace}
                  threadListPagingByWorkspace={threadListPagingByWorkspace}
                  threadListCursorByWorkspace={threadListCursorByWorkspace}
                  expandedWorkspaces={expandedWorkspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  activeThreadId={activeThreadId}
                  pendingUserInputKeys={pendingUserInputKeys}
                  getThreadRows={getThreadRows}
                  getThreadTime={getThreadTime}
                  getThreadArgsBadge={getThreadArgsBadge}
                  isThreadPinned={isThreadPinned}
                  getPinTimestamp={getPinTimestamp}
                  pinnedThreadsVersion={pinnedThreadsVersion}
                  addMenuAnchor={addMenuAnchor}
                  addMenuRef={addMenuRef}
                  addMenuWidth={ADD_MENU_WIDTH}
                  newAgentDraftWorkspaceId={newAgentDraftWorkspaceId}
                  startingDraftThreadWorkspaceId={startingDraftThreadWorkspaceId}
                  onSelectWorkspace={onSelectWorkspace}
                  onConnectWorkspace={onConnectWorkspace}
                  onDisconnectWorkspace={onDisconnectWorkspace}
                  onAddAgent={onAddAgent}
                  onAddWorktreeAgent={onAddWorktreeAgent}
                  onAddCloneAgent={onAddCloneAgent}
                  onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
                  onSelectThread={onSelectThread}
                  onShowThreadMenu={showThreadMenu}
                  onShowWorkspaceMenu={showWorkspaceMenu}
                  onShowWorktreeMenu={showWorktreeMenu}
                  onShowCloneMenu={showCloneMenu}
                  onToggleExpanded={handleToggleExpanded}
                  onLoadOlderThreads={onLoadOlderThreads}
                  onToggleAddMenu={setAddMenuAnchor}
                />
              )}
          {!groupedWorkspacesForRender.length && (
            <div className="empty">
              {isSearchActive
                ? "没有匹配当前搜索的会话。"
                : "添加项目后即可开始使用。"}
            </div>
          )}
          {isThreadsOnlyMode &&
            groupedWorkspacesForRender.length > 0 &&
            flatThreadRows.length === 0 &&
            pinnedThreadRows.length === 0 && (
              <div className="empty">暂无会话。</div>
            )}
        </div>
      </div>
      <SidebarBottomRail
        sessionPercent={sessionPercent}
        weeklyPercent={weeklyPercent}
        sessionResetLabel={sessionResetLabel}
        weeklyResetLabel={weeklyResetLabel}
        creditsLabel={creditsLabel}
        showWeekly={showWeekly}
        onOpenSettings={onOpenSettings}
        onOpenDebug={onOpenDebug}
        showDebugButton={showDebugButton}
        showAccountSwitcher={showAccountSwitcher}
        accountLabel={accountButtonLabel}
        accountActionLabel={accountActionLabel}
        accountDisabled={accountSwitchDisabled}
        accountSwitching={accountSwitching}
        accountCancelDisabled={accountCancelDisabled}
        onSwitchAccount={onSwitchAccount}
        onCancelSwitchAccount={onCancelSwitchAccount}
      />
      {contextMenuNode}
    </aside>
  );
});

Sidebar.displayName = "Sidebar";
