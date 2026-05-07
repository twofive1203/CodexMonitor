import { describe, expect, it } from "vitest";
import type { ThreadSummary, WorkspaceInfo } from "../../../types";
import {
  buildFilteredSidebarWorkspaceGroups,
  buildProjectOptionsForNewThread,
  buildSidebarFlatThreadRootGroups,
  buildSidebarSearchViewModel,
  buildSidebarWorkspaceActivityById,
  buildSidebarWorkspaceRelationViewModel,
  buildSortedSidebarWorkspaceGroups,
  groupFlatThreadRowsByTimeBucket,
} from "./sidebarViewModel";
import type { ThreadRowsResult, WorkspaceGroupSection } from "./sidebarTypes";

function workspace(input: Partial<WorkspaceInfo> & { id: string; name: string }): WorkspaceInfo {
  return {
    path: `/tmp/${input.id}`,
    connected: true,
    settings: { sidebarCollapsed: false, ...input.settings },
    ...input,
  };
}

function thread(input: Partial<ThreadSummary> & { id: string; name: string }): ThreadSummary {
  return {
    updatedAt: 0,
    ...input,
  };
}

/**
 * 构建测试用线程行生成器。
 *
 * @param pinnedIds 需要标记为置顶的线程 ID 集合。
 */
function makeGetThreadRows(pinnedIds = new Set<string>()) {
  return (
    threads: ThreadSummary[],
    _isExpanded: boolean,
    workspaceId: string,
    getPinTimestamp: (workspaceId: string, threadId: string) => number | null,
  ): ThreadRowsResult => {
    const pinnedRows = threads
      .filter((item) => pinnedIds.has(item.id) || getPinTimestamp(workspaceId, item.id) !== null)
      .map((item) => ({ thread: item, depth: 0 }));
    const unpinnedRows = threads
      .filter((item) => !pinnedIds.has(item.id) && getPinTimestamp(workspaceId, item.id) === null)
      .map((item) => ({ thread: item, depth: 0 }));
    return {
      pinnedRows,
      unpinnedRows,
      totalRoots: unpinnedRows.length,
      hasMoreRoots: false,
    };
  };
}

describe("sidebarViewModel", () => {
  it("keeps parent projects visible when matching worktree or clone children are visible", () => {
    const root = workspace({ id: "root", name: "Main Project" });
    const worktree = workspace({
      id: "worktree",
      name: "Feature Worktree",
      kind: "worktree",
      parentId: "root",
    });
    const clone = workspace({
      id: "clone",
      name: "Clone Agent",
      settings: { sidebarCollapsed: false, cloneSourceWorkspaceId: "root" },
    });
    const workspaces = [root, worktree, clone];
    const search = buildSidebarSearchViewModel({
      isSearchActive: true,
      normalizedQuery: "routing",
      workspaces,
      threadsByWorkspace: {
        worktree: [thread({ id: "t-worktree", name: "Routing fix" })],
        clone: [thread({ id: "t-clone", name: "Clone routing check" })],
      },
      threadListCursorByWorkspace: {},
    });
    const relations = buildSidebarWorkspaceRelationViewModel({
      isSearchActive: true,
      workspaces,
      workspaceVisibleDuringSearchById: search.workspaceVisibleDuringSearchById,
    });
    const filtered = buildFilteredSidebarWorkspaceGroups({
      groupedWorkspaces: [{ id: null, name: "Workspaces", workspaces: [root] }],
      isSearchActive: true,
      workspaceVisibleDuringSearchById: search.workspaceVisibleDuringSearchById,
      cloneSourceIdsMatchingQuery: relations.cloneSourceIdsMatchingQuery,
      worktreeParentIdsMatchingQuery: relations.worktreeParentIdsMatchingQuery,
    });

    expect(filtered[0]?.workspaces.map((item) => item.id)).toEqual(["root"]);
    expect(relations.worktreesByParent.get("root")?.map((item) => item.id)).toEqual([
      "worktree",
    ]);
    expect(relations.clonesBySource.get("root")?.map((item) => item.id)).toEqual([
      "clone",
    ]);
  });

  it("sorts projects by clone thread activity in project activity mode", () => {
    const alpha = workspace({ id: "alpha", name: "Alpha" });
    const alphaClone = workspace({
      id: "alpha-clone",
      name: "Alpha Clone",
      settings: { sidebarCollapsed: false, cloneSourceWorkspaceId: "alpha" },
    });
    const beta = workspace({ id: "beta", name: "Beta" });
    const relations = buildSidebarWorkspaceRelationViewModel({
      isSearchActive: false,
      workspaces: [alpha, alphaClone, beta],
      workspaceVisibleDuringSearchById: new Map(),
    });
    const groups: WorkspaceGroupSection[] = [
      { id: null, name: "Workspaces", workspaces: [beta, alpha] },
    ];
    const activity = buildSidebarWorkspaceActivityById({
      filteredGroupedWorkspaces: groups,
      threadsByWorkspace: {
        alpha: [thread({ id: "alpha-root", name: "Root", updatedAt: 10 })],
        "alpha-clone": [thread({ id: "alpha-clone-thread", name: "Clone", updatedAt: 50 })],
        beta: [thread({ id: "beta-root", name: "Beta", updatedAt: 30 })],
      },
      clonesBySource: relations.clonesBySource,
      workspaceVisibleDuringSearchById: new Map(),
      normalizedQuery: "",
      sortKey: "updated_at",
    });
    const sorted = buildSortedSidebarWorkspaceGroups({
      filteredGroupedWorkspaces: groups,
      organizeMode: "by_project_activity",
      workspaceActivityById: activity,
    });

    expect(sorted[0]?.workspaces.map((item) => item.id)).toEqual(["alpha", "beta"]);
  });

  it("builds a global thread list sorted by thread time then workspace name", () => {
    const alpha = workspace({ id: "alpha", name: "Alpha" });
    const beta = workspace({ id: "beta", name: "Beta" });
    const groups = buildSidebarFlatThreadRootGroups({
      organizeMode: "threads_only",
      filteredGroupedWorkspaces: [{ id: null, name: "Workspaces", workspaces: [alpha, beta] }],
      threadsByWorkspace: {
        alpha: [thread({ id: "a-old", name: "Old", updatedAt: 10 })],
        beta: [thread({ id: "b-new", name: "New", updatedAt: 20 })],
      },
      getThreadRows: makeGetThreadRows(),
      getPinTimestamp: () => null,
      pinnedThreadsVersion: 0,
      normalizedQuery: "",
      sortKey: "updated_at",
    });

    expect(groups.map((group) => group.workspaceId)).toEqual(["beta", "alpha"]);
  });

  it("groups flat threads into stable time buckets", () => {
    const now = new Date("2026-05-03T12:00:00Z").getTime();
    const buckets = groupFlatThreadRowsByTimeBucket(
      [
        {
          rootTimestamp: now - 30 * 60 * 1000,
          workspaceId: "ws-1",
          workspaceName: "Now",
          rootIndex: 0,
          rows: [{ workspaceId: "ws-1", workspaceName: "Now", thread: thread({ id: "now", name: "Now" }), depth: 0 }],
        },
        {
          rootTimestamp: now - 8 * 24 * 60 * 60 * 1000,
          workspaceId: "ws-2",
          workspaceName: "Older",
          rootIndex: 0,
          rows: [{ workspaceId: "ws-2", workspaceName: "Older", thread: thread({ id: "old", name: "Old" }), depth: 0 }],
        },
      ],
      now,
    );

    expect(buckets.map((bucket) => bucket.id)).toEqual(["now", "older"]);
  });

  it("excludes clone children from new thread project options", () => {
    const root = workspace({ id: "root", name: "Root" });
    const clone = workspace({
      id: "clone",
      name: "Clone",
      settings: { sidebarCollapsed: false, cloneSourceWorkspaceId: "root" },
    });
    const options = buildProjectOptionsForNewThread(
      [{ id: null, name: "Workspaces", workspaces: [root, clone] }],
      new Set(["clone"]),
    );

    expect(options.map((item) => item.id)).toEqual(["root"]);
  });
});
