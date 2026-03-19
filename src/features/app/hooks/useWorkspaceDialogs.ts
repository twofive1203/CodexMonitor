import { useCallback, useEffect, useRef, useState } from "react";
import { ask, message } from "@tauri-apps/plugin-dialog";
import type { WorkspaceInfo } from "../../../types";
import { isMobilePlatform } from "../../../utils/platformPaths";
import { pickWorkspacePaths } from "../../../services/tauri";
import type { AddWorkspacesFromPathsResult } from "../../workspaces/hooks/useWorkspaceCrud";

const RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY = "mobile-remote-workspace-recent-paths";
const RECENT_REMOTE_WORKSPACE_PATHS_LIMIT = 5;

function parseWorkspacePathInput(value: string) {
  const stripWrappingQuotes = (entry: string) => {
    const trimmed = entry.trim();
    if (trimmed.length < 2) {
      return trimmed;
    }
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" || first === '"') && first === last) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  };

  return value
    .split(/\r?\n|,|;/)
    .map((entry) => stripWrappingQuotes(entry))
    .filter(Boolean);
}

function appendPathIfMissing(value: string, path: string) {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return value;
  }
  const entries = parseWorkspacePathInput(value);
  if (entries.includes(trimmedPath)) {
    return value;
  }
  return [...entries, trimmedPath].join("\n");
}

function loadRecentRemoteWorkspacePaths(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, RECENT_REMOTE_WORKSPACE_PATHS_LIMIT);
  } catch {
    return [];
  }
}

function persistRecentRemoteWorkspacePaths(paths: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY,
    JSON.stringify(paths),
  );
}

function mergeRecentRemoteWorkspacePaths(current: string[], nextPaths: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  const push = (entry: string) => {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    merged.push(trimmed);
  };
  nextPaths.forEach(push);
  current.forEach(push);
  return merged.slice(0, RECENT_REMOTE_WORKSPACE_PATHS_LIMIT);
}

type MobileRemoteWorkspacePathPromptState = {
  value: string;
  error: string | null;
  recentPaths: string[];
} | null;

export function useWorkspaceDialogs() {
  const [recentMobileRemoteWorkspacePaths, setRecentMobileRemoteWorkspacePaths] = useState<
    string[]
  >(() => loadRecentRemoteWorkspacePaths());
  const [mobileRemoteWorkspacePathPrompt, setMobileRemoteWorkspacePathPrompt] =
    useState<MobileRemoteWorkspacePathPromptState>(null);
  const mobileRemoteWorkspacePathResolveRef = useRef<((paths: string[]) => void) | null>(
    null,
  );

  const resolveMobileRemoteWorkspacePathRequest = useCallback((paths: string[]) => {
    const resolve = mobileRemoteWorkspacePathResolveRef.current;
    mobileRemoteWorkspacePathResolveRef.current = null;
    if (resolve) {
      resolve(paths);
    }
  }, []);

  const requestMobileRemoteWorkspacePaths = useCallback(() => {
    if (mobileRemoteWorkspacePathResolveRef.current) {
      resolveMobileRemoteWorkspacePathRequest([]);
    }

    setMobileRemoteWorkspacePathPrompt({
      value: "",
      error: null,
      recentPaths: recentMobileRemoteWorkspacePaths,
    });

    return new Promise<string[]>((resolve) => {
      mobileRemoteWorkspacePathResolveRef.current = resolve;
    });
  }, [recentMobileRemoteWorkspacePaths, resolveMobileRemoteWorkspacePathRequest]);

  const updateMobileRemoteWorkspacePathInput = useCallback((value: string) => {
    setMobileRemoteWorkspacePathPrompt((prev) =>
      prev
        ? {
            ...prev,
            value,
            error: null,
          }
        : prev,
    );
  }, []);

  const cancelMobileRemoteWorkspacePathPrompt = useCallback(() => {
    setMobileRemoteWorkspacePathPrompt(null);
    resolveMobileRemoteWorkspacePathRequest([]);
  }, [resolveMobileRemoteWorkspacePathRequest]);

  const appendMobileRemoteWorkspacePathFromRecent = useCallback((path: string) => {
    setMobileRemoteWorkspacePathPrompt((prev) =>
      prev
        ? {
            ...prev,
            value: appendPathIfMissing(prev.value, path),
            error: null,
          }
        : prev,
    );
  }, []);

  const rememberRecentMobileRemoteWorkspacePaths = useCallback((paths: string[]) => {
    setRecentMobileRemoteWorkspacePaths((prev) => {
      const next = mergeRecentRemoteWorkspacePaths(prev, paths);
      persistRecentRemoteWorkspacePaths(next);
      return next;
    });
    setMobileRemoteWorkspacePathPrompt((prev) =>
      prev
        ? {
            ...prev,
            recentPaths: mergeRecentRemoteWorkspacePaths(prev.recentPaths, paths),
          }
        : prev,
    );
  }, []);

  const submitMobileRemoteWorkspacePathPrompt = useCallback(() => {
    if (!mobileRemoteWorkspacePathPrompt) {
      return;
    }
    const paths = parseWorkspacePathInput(mobileRemoteWorkspacePathPrompt.value);
    if (paths.length === 0) {
      setMobileRemoteWorkspacePathPrompt((prev) =>
        prev
          ? {
              ...prev,
              error: "请输入至少一个绝对目录路径。",
            }
          : prev,
      );
      return;
    }
    setMobileRemoteWorkspacePathPrompt(null);
    resolveMobileRemoteWorkspacePathRequest(paths);
  }, [mobileRemoteWorkspacePathPrompt, resolveMobileRemoteWorkspacePathRequest]);

  useEffect(() => {
    return () => {
      resolveMobileRemoteWorkspacePathRequest([]);
    };
  }, [resolveMobileRemoteWorkspacePathRequest]);

  const requestWorkspacePaths = useCallback(async (backendMode?: string) => {
    if (isMobilePlatform() && backendMode === "remote") {
      return requestMobileRemoteWorkspacePaths();
    }
    return pickWorkspacePaths();
  }, [requestMobileRemoteWorkspacePaths]);

  const showAddWorkspacesResult = useCallback(
    async (result: AddWorkspacesFromPathsResult) => {
      const hasIssues =
        result.skippedExisting.length > 0 ||
        result.skippedInvalid.length > 0 ||
        result.failures.length > 0;
      if (!hasIssues) {
        return;
      }

      const lines: string[] = [];
      lines.push(
        `已添加 ${result.added.length} 个项目。`,
      );
      if (result.skippedExisting.length > 0) {
        lines.push(
          `已跳过 ${result.skippedExisting.length} 个已添加的项目。`,
        );
      }
      if (result.skippedInvalid.length > 0) {
        lines.push(
          `已跳过 ${result.skippedInvalid.length} 个无效路径（不是文件夹）。`,
        );
      }
      if (result.failures.length > 0) {
        lines.push(
          `有 ${result.failures.length} 个项目添加失败。`,
        );
        const details = result.failures
          .slice(0, 3)
          .map(({ path, message: failureMessage }) => `- ${path}: ${failureMessage}`);
        if (result.failures.length > 3) {
          details.push(`- 以及另外 ${result.failures.length - 3} 个`);
        }
        lines.push("");
        lines.push("失败详情：");
        lines.push(...details);
      }

      const title =
        result.failures.length > 0
          ? "部分项目添加失败"
          : "部分项目已跳过";
      await message(lines.join("\n"), {
        title,
        kind: result.failures.length > 0 ? "error" : "warning",
      });
    },
    [],
  );

  const confirmWorkspaceRemoval = useCallback(
    async (workspaces: WorkspaceInfo[], workspaceId: string) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const workspaceName = workspace?.name || "该项目";
      const worktreeCount = workspaces.filter(
        (entry) => entry.parentId === workspaceId,
      ).length;
      const detail =
        worktreeCount > 0
          ? `\n\n这还会同时删除磁盘上的 ${worktreeCount} 个工作树。`
          : "";

      return ask(
        `确认删除“${workspaceName}”吗？\n\n这会将该项目从 CodexMonitor 中移除。${detail}`,
        {
          title: "删除项目",
          kind: "warning",
          okLabel: "删除",
          cancelLabel: "取消",
        },
      );
    },
    [],
  );

  const confirmWorktreeRemoval = useCallback(
    async (workspaces: WorkspaceInfo[], workspaceId: string) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const workspaceName = workspace?.name || "该工作树";
      return ask(
        `确认删除“${workspaceName}”吗？\n\n这会关闭智能体、移除其工作树，并将其从 CodexMonitor 中删除。`,
        {
          title: "删除工作树",
          kind: "warning",
          okLabel: "删除",
          cancelLabel: "取消",
        },
      );
    },
    [],
  );

  const showWorkspaceRemovalError = useCallback(async (error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await message(errorMessage, {
      title: "删除项目失败",
      kind: "error",
    });
  }, []);

  const showWorktreeRemovalError = useCallback(async (error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await message(errorMessage, {
      title: "删除工作树失败",
      kind: "error",
    });
  }, []);

  return {
    requestWorkspacePaths,
    mobileRemoteWorkspacePathPrompt,
    updateMobileRemoteWorkspacePathInput,
    cancelMobileRemoteWorkspacePathPrompt,
    submitMobileRemoteWorkspacePathPrompt,
    appendMobileRemoteWorkspacePathFromRecent,
    rememberRecentMobileRemoteWorkspacePaths,
    showAddWorkspacesResult,
    confirmWorkspaceRemoval,
    confirmWorktreeRemoval,
    showWorkspaceRemovalError,
    showWorktreeRemovalError,
  };
}
