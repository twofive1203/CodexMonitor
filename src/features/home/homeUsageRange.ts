import type { UsageRange } from "./homeTypes";

type UsageRangeOption = {
  value: UsageRange;
  label: string;
  summaryLabel: string;
  days: number;
};

const DEFAULT_RANGE_OPTION: UsageRangeOption = {
  value: "30d",
  label: "30天",
  summaryLabel: "近30天",
  days: 30,
};

export const USAGE_RANGE_OPTIONS = [
  DEFAULT_RANGE_OPTION,
  {
    value: "90d",
    label: "3个月",
    summaryLabel: "近3个月",
    days: 90,
  },
  {
    value: "365d",
    label: "1年",
    summaryLabel: "近1年",
    days: 365,
  },
  {
    value: "all",
    label: "全部时间",
    summaryLabel: "全部时间",
    days: 0,
  },
] satisfies UsageRangeOption[];

/**
 * 获取首页用量范围对应的查询天数。
 *
 * `range`：首页选择的范围标识。
 */
export function getUsageRangeDays(range: UsageRange) {
  return USAGE_RANGE_OPTIONS.find((option) => option.value === range)?.days ?? DEFAULT_RANGE_OPTION.days;
}

/**
 * 获取首页用量范围对应的展示文案。
 *
 * `range`：首页选择的范围标识。
 */
export function getUsageRangeSummaryLabel(range: UsageRange) {
  return USAGE_RANGE_OPTIONS.find((option) => option.value === range)?.summaryLabel ?? DEFAULT_RANGE_OPTION.summaryLabel;
}
