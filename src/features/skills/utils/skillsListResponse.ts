import type { SkillOption, SkillsListResponse } from "@/types";

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
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * 从 skills/list 响应中提取技能数组。
 *
 * @param response 后端返回的技能列表响应，兼容 result.skills、skills、data.skills。
 */
function extractSkillItems(response: SkillsListResponse | unknown): unknown[] {
  const root = Array.isArray(response) ? null : asRecord(response);
  if (Array.isArray(response)) {
    return response;
  }
  if (!root) {
    return [];
  }
  const result = asRecord(root.result);
  const direct = result?.skills ?? root.skills;
  if (Array.isArray(direct)) {
    return direct;
  }
  const dataBuckets = result?.data ?? root.data;
  if (!Array.isArray(dataBuckets)) {
    return [];
  }
  const flattened = dataBuckets.flatMap((bucket) => {
    const bucketRecord = asRecord(bucket);
    if (!bucketRecord) {
      return [];
    }
    return Array.isArray(bucketRecord.skills) ? bucketRecord.skills : [bucket];
  });
  return flattened;
}

/**
 * 归一化 skills/list 响应，忽略无效条目。
 *
 * @param response 后端返回的技能列表响应。
 */
export function parseSkillsListResponse(
  response: SkillsListResponse | unknown,
): SkillOption[] {
  return extractSkillItems(response)
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }
      const option: SkillOption = {
        name: String(record.name ?? ""),
        path: String(record.path ?? ""),
      };
      const description = optionalString(record.description);
      if (description) {
        option.description = description;
      }
      return option;
    })
    .filter((item): item is SkillOption => item !== null);
}
