import type {
  CollaborationModeListResponse,
  CollaborationModeOption,
} from "@/types";

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
 * 读取非空字符串字段。
 *
 * @param value 需要转换的未知字段值。
 */
function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 从 collaboration_mode/list 响应中提取模式数组。
 *
 * @param response 后端返回的协作模式响应，兼容 result/data/modes 多层包裹。
 */
function extractModeItems(response: CollaborationModeListResponse | unknown): unknown[] {
  const candidates: unknown[] = [];
  const root = Array.isArray(response) ? null : asRecord(response);
  if (Array.isArray(response)) {
    return response;
  }
  if (root) {
    const result = asRecord(root.result);
    candidates.push(result?.data, result?.modes, root.data, root.modes, root.result);
    for (const candidate of [...candidates]) {
      const record = asRecord(candidate);
      if (record) {
        candidates.push(record.data, record.modes);
      }
    }
  }
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

/**
 * 归一化 collaboration_mode/list 响应，忽略缺少 mode/name 的条目。
 *
 * @param response 后端返回的协作模式响应。
 */
export function parseCollaborationModeListResponse(
  response: CollaborationModeListResponse | unknown,
): CollaborationModeOption[] {
  return extractModeItems(response)
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }
      const modeId = nonEmptyString(record.mode ?? record.name);
      if (!modeId) {
        return null;
      }
      const settings =
        asRecord(record.settings) ?? {
          model: record.model ?? null,
          reasoning_effort: record.reasoning_effort ?? record.reasoningEffort ?? null,
          developer_instructions:
            record.developer_instructions ?? record.developerInstructions ?? null,
        };
      const label =
        nonEmptyString(record.label) ?? nonEmptyString(record.name) ?? modeId;
      return {
        id: modeId,
        label,
        mode: modeId,
        model: String(settings.model ?? ""),
        reasoningEffort: settings.reasoning_effort
          ? String(settings.reasoning_effort)
          : null,
        developerInstructions: settings.developer_instructions
          ? String(settings.developer_instructions)
          : null,
        value: record,
      } satisfies CollaborationModeOption;
    })
    .filter((item): item is CollaborationModeOption => item !== null);
}
