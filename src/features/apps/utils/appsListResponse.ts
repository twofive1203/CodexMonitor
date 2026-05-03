import type { AppOption, AppsListResponse } from "@/types";

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
 * 从候选值中读取第一个非空字符串。
 *
 * @param values 需要按顺序检查的候选值。
 */
function optionalString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

/**
 * 从 apps/list 响应中提取原始应用数组。
 *
 * @param response 后端返回的应用列表响应，兼容 result.data 与 data 两类包裹。
 */
function extractAppItems(response: AppsListResponse | unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }
  const root = asRecord(response);
  if (!root) {
    return [];
  }
  const result = asRecord(root.result);
  const candidates = [result?.data, root.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

/**
 * 归一化 apps/list 响应，过滤无效节点并保持可访问应用优先。
 *
 * @param response 后端返回的应用列表响应。
 */
export function parseAppsListResponse(response: AppsListResponse | unknown): AppOption[] {
  return extractAppItems(response)
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }
      const option: AppOption = {
        id: String(record.id ?? ""),
        name: String(record.name ?? ""),
        isAccessible: Boolean(record.isAccessible ?? record.is_accessible ?? false),
        installUrl: optionalString(record.installUrl, record.install_url),
        distributionChannel: optionalString(
          record.distributionChannel,
          record.distribution_channel,
        ),
      };
      const description = optionalString(record.description);
      if (description) {
        option.description = description;
      }
      return option;
    })
    .filter((item): item is AppOption => item !== null)
    .sort((left, right) => {
      if (left.isAccessible !== right.isAccessible) {
        return left.isAccessible ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}
