import type { BranchInfo, GitBranchesResponse } from "@/types";

/**
 * 判断未知值是否为普通对象。
 *
 * @param value 需要检查的未知值。
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 将未知值转换为有限数字。
 *
 * @param value 需要转换的未知字段值。
 */
function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * 从 list_git_branches 响应中提取分支数组。
 *
 * @param response 后端返回的分支列表响应，兼容 branches、result.branches 与裸数组。
 */
function extractBranchItems(response: GitBranchesResponse | unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }
  const root = asRecord(response);
  if (!root) {
    return [];
  }
  const result = asRecord(root.result);
  const candidates = [root.branches, result?.branches, root.data, result?.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

/**
 * 归一化 list_git_branches 响应，过滤空分支名。
 *
 * @param response 后端返回的分支列表响应。
 */
export function parseGitBranchesResponse(
  response: GitBranchesResponse | unknown,
): BranchInfo[] {
  return extractBranchItems(response)
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }
      return {
        name: String(record.name ?? ""),
        lastCommit: asNumber(record.lastCommit ?? record.last_commit),
      } satisfies BranchInfo;
    })
    .filter((item): item is BranchInfo => item !== null && item.name.trim().length > 0);
}
