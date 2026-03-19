export function formatRelativeTime(timestamp: number) {
  const now = Date.now();
  const diffSeconds = Math.round((timestamp - now) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 5) {
    return "刚刚";
  }
  if (absSeconds < 60) {
    const value = Math.max(1, Math.round(absSeconds));
    return diffSeconds < 0 ? `${value}秒前` : `${value}秒后`;
  }
  if (absSeconds < 60 * 60) {
    const value = Math.max(1, Math.round(absSeconds / 60));
    return diffSeconds < 0 ? `${value}分钟前` : `${value}分钟后`;
  }
  const ranges: { label: string; seconds: number }[] = [
    { label: "年", seconds: 60 * 60 * 24 * 365 },
    { label: "个月", seconds: 60 * 60 * 24 * 30 },
    { label: "周", seconds: 60 * 60 * 24 * 7 },
    { label: "天", seconds: 60 * 60 * 24 },
    { label: "小时", seconds: 60 * 60 },
    { label: "分钟", seconds: 60 },
    { label: "秒", seconds: 1 },
  ];
  const range =
    ranges.find((entry) => absSeconds >= entry.seconds) ||
    ranges[ranges.length - 1];
  if (!range) {
    return "刚刚";
  }
  const value = Math.max(1, Math.round(absSeconds / range.seconds));
  return diffSeconds < 0 ? `${value}${range.label}前` : `${value}${range.label}后`;
}

export function formatRelativeTimeShort(timestamp: number) {
  const now = Date.now();
  const absSeconds = Math.abs(Math.round((timestamp - now) / 1000));
  if (absSeconds < 60) {
    return "刚刚";
  }
  if (absSeconds < 60 * 60) {
    return `${Math.max(1, Math.round(absSeconds / 60))}分`;
  }
  if (absSeconds < 60 * 60 * 24) {
    return `${Math.max(1, Math.round(absSeconds / (60 * 60)))}时`;
  }
  if (absSeconds < 60 * 60 * 24 * 7) {
    return `${Math.max(1, Math.round(absSeconds / (60 * 60 * 24)))}天`;
  }
  if (absSeconds < 60 * 60 * 24 * 30) {
    return `${Math.max(1, Math.round(absSeconds / (60 * 60 * 24 * 7)))}周`;
  }
  if (absSeconds < 60 * 60 * 24 * 365) {
    return `${Math.max(1, Math.round(absSeconds / (60 * 60 * 24 * 30)))}月`;
  }
  return `${Math.max(1, Math.round(absSeconds / (60 * 60 * 24 * 365)))}年`;
}
