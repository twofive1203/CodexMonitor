import type {
  ThreadListOrganizeMode,
  ThreadListSortKey,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import {
  countRootRows,
  splitRowsByRoot,
  threadMatchesQuery,
  workspaceMatchesQuery,
} from "./threadSearchUtils";
import type {
  FlatThreadRootGroup,
  FlatThreadRow,
  ThreadBucket,
  ThreadRowsResult,
  WorkspaceGroupSection,
} from "./sidebarTypes";

type ThreadRow = { thread: ThreadSummary; depth: number };

export type SidebarPinnedThreadRow = ThreadRow & {
  workspaceId: string;
};

export type SidebarWorkspaceActivity = {
  hasThreads: boolean;
  timestamp: number;
};

export type SidebarWorkspaceRelationViewModel = {
  cloneSourceIdsMatchingQuery: Set<string>;
  worktreeParentIdsMatchingQuery: Set<string>;
  clonesBySource: Map<string, WorkspaceInfo[]>;
  cloneChildIds: Set<string>;
  worktreesByParent: Map<string, WorkspaceInfo[]>;
};

export type SidebarSearchViewModel = {
  workspaceHasMatchingThreadById: Map<string, boolean>;
  workspaceVisibleDuringSearchById: Map<string, boolean>;
};

type GetThreadRows = (
  threads: ThreadSummary[],
  isExpanded: boolean,
  workspaceId: string,
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null,
  pinVersion?: number,
) => ThreadRowsResult;

/**
 * 获取线程排序使用的时间戳。
 *
 * @param thread 需要读取时间的线程摘要。
 * @param sortKey 当前侧栏线程排序字段。
 */
export function getSidebarThreadSortTimestamp(
  thread: ThreadSummary | undefined,
  sortKey: ThreadListSortKey,
): number {
  if (!thread) {
    return 0;
  }
  if (sortKey === "created_at") {
    return thread.createdAt ?? thread.updatedAt ?? 0;
  }
  return thread.updatedAt ?? thread.createdAt ?? 0;
}

/**
 * 构建搜索相关的工作区可见性索引。
 *
 * @param input 搜索查询、工作区、线程与分页游标输入。
 */
export function buildSidebarSearchViewModel(input: {
  isSearchActive: boolean;
  normalizedQuery: string;
  workspaces: WorkspaceInfo[];
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadListCursorByWorkspace: Record<string, string | null>;
}): SidebarSearchViewModel {
  const workspaceHasMatchingThreadById = new Map<string, boolean>();
  const workspaceVisibleDuringSearchById = new Map<string, boolean>();
  if (!input.isSearchActive) {
    return { workspaceHasMatchingThreadById, workspaceVisibleDuringSearchById };
  }

  input.workspaces.forEach((workspace) => {
    const threads = input.threadsByWorkspace[workspace.id] ?? [];
    const hasMatchingThread = threads.some((thread) =>
      threadMatchesQuery(thread, workspace.name, input.normalizedQuery),
    );
    workspaceHasMatchingThreadById.set(workspace.id, hasMatchingThread);
    workspaceVisibleDuringSearchById.set(
      workspace.id,
      workspaceMatchesQuery(workspace.name, input.normalizedQuery) ||
        hasMatchingThread ||
        Boolean(input.threadListCursorByWorkspace[workspace.id]),
    );
  });

  return { workspaceHasMatchingThreadById, workspaceVisibleDuringSearchById };
}

/**
 * 构建 clone、worktree 关系索引，并标记搜索命中的父级项目。
 *
 * @param input 当前工作区列表与搜索可见性索引。
 */
export function buildSidebarWorkspaceRelationViewModel(input: {
  isSearchActive: boolean;
  workspaces: WorkspaceInfo[];
  workspaceVisibleDuringSearchById: Map<string, boolean>;
}): SidebarWorkspaceRelationViewModel {
  const workspaceById = new Map<string, WorkspaceInfo>();
  input.workspaces.forEach((workspace) => {
    workspaceById.set(workspace.id, workspace);
  });

  const clonesBySource = new Map<string, WorkspaceInfo[]>();
  const cloneChildIds = new Set<string>();
  const worktreesByParent = new Map<string, WorkspaceInfo[]>();
  const cloneSourceIdsMatchingQuery = new Set<string>();
  const worktreeParentIdsMatchingQuery = new Set<string>();

  input.workspaces.forEach((workspace) => {
    const kind = workspace.kind ?? "main";
    const sourceId = workspace.settings.cloneSourceWorkspaceId?.trim();
    if (kind === "main" && sourceId && sourceId !== workspace.id && workspaceById.has(sourceId)) {
      const clones = clonesBySource.get(sourceId) ?? [];
      clones.push(workspace);
      clonesBySource.set(sourceId, clones);
      cloneChildIds.add(workspace.id);
      if (input.isSearchActive && input.workspaceVisibleDuringSearchById.get(workspace.id)) {
        cloneSourceIdsMatchingQuery.add(sourceId);
      }
    }

    const parentId = workspace.parentId?.trim();
    if (kind === "worktree" && parentId) {
      const worktrees = worktreesByParent.get(parentId) ?? [];
      worktrees.push(workspace);
      worktreesByParent.set(parentId, worktrees);
      if (input.isSearchActive && input.workspaceVisibleDuringSearchById.get(workspace.id)) {
        worktreeParentIdsMatchingQuery.add(parentId);
      }
    }
  });

  clonesBySource.forEach((entries) => {
    entries.sort((a, b) => a.name.localeCompare(b.name));
  });
  worktreesByParent.forEach((entries) => {
    entries.sort((a, b) => a.name.localeCompare(b.name));
  });

  return {
    cloneSourceIdsMatchingQuery,
    worktreeParentIdsMatchingQuery,
    clonesBySource,
    cloneChildIds,
    worktreesByParent,
  };
}

/**
 * 过滤搜索时需要渲染的工作区分组。
 *
 * @param input 工作区分组、搜索状态和关系索引。
 */
export function buildFilteredSidebarWorkspaceGroups(input: {
  groupedWorkspaces: WorkspaceGroupSection[];
  isSearchActive: boolean;
  workspaceVisibleDuringSearchById: Map<string, boolean>;
  cloneSourceIdsMatchingQuery: Set<string>;
  worktreeParentIdsMatchingQuery: Set<string>;
}): WorkspaceGroupSection[] {
  return input.groupedWorkspaces
    .map((group) => ({
      ...group,
      workspaces: group.workspaces.filter(
        (workspace) =>
          !input.isSearchActive ||
          input.workspaceVisibleDuringSearchById.get(workspace.id) ||
          input.cloneSourceIdsMatchingQuery.has(workspace.id) ||
          input.worktreeParentIdsMatchingQuery.has(workspace.id),
      ),
    }))
    .filter((group) => group.workspaces.length > 0);
}

/**
 * 计算工作区最近活动，用于项目活动排序。
 *
 * @param input 当前可见分组、线程、clone 关系和排序字段。
 */
export function buildSidebarWorkspaceActivityById(input: {
  filteredGroupedWorkspaces: WorkspaceGroupSection[];
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  clonesBySource: Map<string, WorkspaceInfo[]>;
  workspaceVisibleDuringSearchById: Map<string, boolean>;
  normalizedQuery: string;
  sortKey: ThreadListSortKey;
}): Map<string, SidebarWorkspaceActivity> {
  const activityById = new Map<string, SidebarWorkspaceActivity>();

  input.filteredGroupedWorkspaces.forEach((group) => {
    group.workspaces.forEach((workspace) => {
      const rootThreads = input.threadsByWorkspace[workspace.id] ?? [];
      const visibleClones =
        input.normalizedQuery && !workspaceMatchesQuery(workspace.name, input.normalizedQuery)
          ? (input.clonesBySource.get(workspace.id) ?? []).filter((clone) =>
              input.workspaceVisibleDuringSearchById.get(clone.id),
            )
          : (input.clonesBySource.get(workspace.id) ?? []);
      let hasThreads = rootThreads.length > 0;
      let timestamp = getSidebarThreadSortTimestamp(rootThreads[0], input.sortKey);

      visibleClones.forEach((clone) => {
        const cloneThreads = input.threadsByWorkspace[clone.id] ?? [];
        if (!cloneThreads.length) {
          return;
        }
        hasThreads = true;
        timestamp = Math.max(
          timestamp,
          getSidebarThreadSortTimestamp(cloneThreads[0], input.sortKey),
        );
      });

      activityById.set(workspace.id, { hasThreads, timestamp });
    });
  });

  return activityById;
}

/**
 * 根据组织模式和活动时间排序工作区分组。
 *
 * @param input 可见分组、活动索引和组织模式。
 */
export function buildSortedSidebarWorkspaceGroups(input: {
  filteredGroupedWorkspaces: WorkspaceGroupSection[];
  organizeMode: ThreadListOrganizeMode;
  workspaceActivityById: Map<string, SidebarWorkspaceActivity>;
}): WorkspaceGroupSection[] {
  if (input.organizeMode !== "by_project_activity") {
    return input.filteredGroupedWorkspaces;
  }
  return input.filteredGroupedWorkspaces.map((group) => ({
    ...group,
    workspaces: group.workspaces.slice().sort((a, b) => {
      const aActivity = input.workspaceActivityById.get(a.id) ?? {
        hasThreads: false,
        timestamp: 0,
      };
      const bActivity = input.workspaceActivityById.get(b.id) ?? {
        hasThreads: false,
        timestamp: 0,
      };
      if (aActivity.hasThreads !== bActivity.hasThreads) {
        return aActivity.hasThreads ? -1 : 1;
      }
      const timestampDiff = bActivity.timestamp - aActivity.timestamp;
      if (timestampDiff !== 0) {
        return timestampDiff;
      }
      return a.name.localeCompare(b.name);
    }),
  }));
}

/**
 * 构建全局置顶线程行。
 *
 * @param input 工作区、线程和 pin 状态读取函数。
 */
export function buildSidebarPinnedThreadRows(input: {
  workspaces: WorkspaceInfo[];
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  isSearchActive: boolean;
  normalizedQuery: string;
  workspaceHasMatchingThreadById: Map<string, boolean>;
  getThreadRows: GetThreadRows;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  pinnedThreadsVersion: number;
}): SidebarPinnedThreadRow[] {
  const groups: Array<{
    pinTime: number;
    workspaceId: string;
    workspaceName: string;
    rows: ThreadRow[];
  }> = [];

  input.workspaces.forEach((workspace) => {
    if (
      input.isSearchActive &&
      !workspaceMatchesQuery(workspace.name, input.normalizedQuery) &&
      !input.workspaceHasMatchingThreadById.get(workspace.id)
    ) {
      return;
    }
    const threads = input.threadsByWorkspace[workspace.id] ?? [];
    if (!threads.length) {
      return;
    }
    const { pinnedRows } = input.getThreadRows(
      threads,
      true,
      workspace.id,
      input.getPinTimestamp,
      input.pinnedThreadsVersion,
    );
    if (!pinnedRows.length) {
      return;
    }
    splitRowsByRoot(pinnedRows).forEach((group) => {
      const pinTime = input.getPinTimestamp(workspace.id, group.root.thread.id);
      if (pinTime === null) {
        return;
      }
      groups.push({
        pinTime,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        rows: group.rows,
      });
    });
  });

  return groups
    .sort((a, b) => a.pinTime - b.pinTime)
    .filter((group) =>
      input.normalizedQuery
        ? group.rows.some((row) =>
            threadMatchesQuery(row.thread, group.workspaceName, input.normalizedQuery),
          )
        : true,
    )
    .flatMap((group) =>
      group.rows.map((row) => ({
        ...row,
        workspaceId: group.workspaceId,
      })),
    );
}

/**
 * 构建仅会话模式使用的扁平根线程分组。
 *
 * @param input 可见工作区分组、线程和排序输入。
 */
export function buildSidebarFlatThreadRootGroups(input: {
  organizeMode: ThreadListOrganizeMode;
  filteredGroupedWorkspaces: WorkspaceGroupSection[];
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  getThreadRows: GetThreadRows;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  pinnedThreadsVersion: number;
  normalizedQuery: string;
  sortKey: ThreadListSortKey;
}): FlatThreadRootGroup[] {
  if (input.organizeMode !== "threads_only") {
    return [];
  }

  const rootGroups: FlatThreadRootGroup[] = [];
  input.filteredGroupedWorkspaces.forEach((group) => {
    group.workspaces.forEach((workspace) => {
      const threads = input.threadsByWorkspace[workspace.id] ?? [];
      if (!threads.length) {
        return;
      }
      const { unpinnedRows } = input.getThreadRows(
        threads,
        true,
        workspace.id,
        input.getPinTimestamp,
        input.pinnedThreadsVersion,
      );
      splitRowsByRoot(unpinnedRows).forEach((rootGroup) => {
        rootGroups.push({
          rootTimestamp: getSidebarThreadSortTimestamp(rootGroup.root.thread, input.sortKey),
          workspaceName: workspace.name,
          workspaceId: workspace.id,
          rootIndex: rootGroup.rootIndex,
          rows: rootGroup.rows.map((row) => ({
            ...row,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
          })),
        });
      });
    });
  });

  return rootGroups
    .sort((a, b) => {
      const timestampDiff = b.rootTimestamp - a.rootTimestamp;
      if (timestampDiff !== 0) {
        return timestampDiff;
      }
      const workspaceNameDiff = a.workspaceName.localeCompare(b.workspaceName);
      if (workspaceNameDiff !== 0) {
        return workspaceNameDiff;
      }
      return a.rootIndex - b.rootIndex;
    })
    .filter((group) =>
      input.normalizedQuery
        ? group.rows.some((row) =>
            threadMatchesQuery(row.thread, row.workspaceName, input.normalizedQuery),
          )
        : true,
    );
}

/**
 * 读取线程所属时间分桶。
 *
 * @param timestamp 线程排序时间戳。
 * @param nowMs 当前时间戳。
 */
export function getSidebarThreadBucketId(
  timestamp: number,
  nowMs: number,
): ThreadBucket["id"] {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;

  if (timestamp >= nowMs - 60 * 60 * 1000) {
    return "now";
  }
  if (timestamp >= startOfToday) {
    return "today";
  }
  if (timestamp >= startOfYesterday) {
    return "yesterday";
  }
  if (timestamp >= startOfWeek) {
    return "week";
  }
  return "older";
}

/**
 * 将扁平根线程按时间分桶。
 *
 * @param groups 扁平根线程分组。
 * @param nowMs 当前时间戳。
 */
export function groupFlatThreadRowsByTimeBucket(
  groups: FlatThreadRootGroup[],
  nowMs: number,
): ThreadBucket[] {
  const bucketLabels: Record<ThreadBucket["id"], string> = {
    now: "刚刚",
    today: "今天稍早",
    yesterday: "昨天",
    week: "最近一周",
    older: "更早",
  };
  const order: ThreadBucket["id"][] = ["now", "today", "yesterday", "week", "older"];
  const bucketMap = new Map<ThreadBucket["id"], FlatThreadRow[]>();

  groups.forEach((group) => {
    const bucketId = getSidebarThreadBucketId(group.rootTimestamp, nowMs);
    const list = bucketMap.get(bucketId) ?? [];
    list.push(...group.rows);
    bucketMap.set(bucketId, list);
  });

  return order
    .filter((bucketId) => (bucketMap.get(bucketId) ?? []).length > 0)
    .map((bucketId) => ({
      id: bucketId,
      label: bucketLabels[bucketId],
      rows: bucketMap.get(bucketId) ?? [],
    }));
}

/**
 * 构建仅会话模式的新建会话项目选项。
 *
 * @param groupedWorkspacesForRender 当前渲染用分组。
 * @param cloneChildIds clone 子工作区 ID 集合。
 */
export function buildProjectOptionsForNewThread(
  groupedWorkspacesForRender: WorkspaceGroupSection[],
  cloneChildIds: Set<string>,
): WorkspaceInfo[] {
  const seen = new Set<string>();
  const projects: WorkspaceInfo[] = [];
  groupedWorkspacesForRender.forEach((group) => {
    group.workspaces.forEach((entry) => {
      if ((entry.kind ?? "main") !== "main") {
        return;
      }
      if (cloneChildIds.has(entry.id) || seen.has(entry.id)) {
        return;
      }
      seen.add(entry.id);
      projects.push(entry);
    });
  });
  return projects;
}

/**
 * 构建工作区名称索引。
 *
 * @param workspaces 当前工作区列表。
 */
export function buildWorkspaceNameById(workspaces: WorkspaceInfo[]): Map<string, string> {
  const byId = new Map<string, string>();
  workspaces.forEach((workspace) => {
    byId.set(workspace.id, workspace.name);
  });
  return byId;
}

/**
 * 统计置顶根线程数量。
 *
 * @param rows 置顶线程行。
 */
export function countPinnedThreadRoots(rows: SidebarPinnedThreadRow[]): number {
  return countRootRows(rows);
}
