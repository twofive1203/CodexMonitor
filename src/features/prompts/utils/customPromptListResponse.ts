import type { CustomPromptOption, PromptsListResponse } from "@/types";

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
function optionalString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * 从 prompts/list 响应中提取提示词数组。
 *
 * @param response 后端返回的提示词列表响应，兼容数组、prompts、result.prompts、result.data。
 */
function extractPromptItems(response: PromptsListResponse | unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }
  const root = asRecord(response);
  if (!root) {
    return [];
  }
  const result = asRecord(root.result);
  const candidates = [
    root.prompts,
    result?.prompts,
    result?.data,
    root.data,
    root.result,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

/**
 * 归一化 prompts/list 响应，兼容 snake_case 与 camelCase 字段。
 *
 * @param response 后端返回的提示词列表响应。
 */
export function parseCustomPromptListResponse(
  response: PromptsListResponse | unknown,
): CustomPromptOption[] {
  return extractPromptItems(response)
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }
      const scope =
        record.scope === "workspace" || record.scope === "global"
          ? record.scope
          : undefined;
      const option: CustomPromptOption = {
        name: String(record.name ?? ""),
        path: String(record.path ?? ""),
        content: String(record.content ?? ""),
      };
      const description = optionalString(record.description);
      const argumentHint = optionalString(record.argumentHint, record.argument_hint);
      if (description) {
        option.description = description;
      }
      if (argumentHint) {
        option.argumentHint = argumentHint;
      }
      if (scope) {
        option.scope = scope;
      }
      return option;
    })
    .filter((item): item is CustomPromptOption => item !== null);
}
