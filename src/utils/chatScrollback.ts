export const CHAT_SCROLLBACK_DEFAULT = 50;
export const CHAT_SCROLLBACK_MIN = 50;
export const CHAT_SCROLLBACK_MAX = 5000;
export const CHAT_SCROLLBACK_PRESETS = [50, 200, 500, 1000, 2000, 5000] as const;

export function clampChatScrollbackItems(value: number) {
  return Math.min(
    CHAT_SCROLLBACK_MAX,
    Math.max(CHAT_SCROLLBACK_MIN, Math.round(value)),
  );
}

export function isChatScrollbackPreset(
  value: number,
): value is (typeof CHAT_SCROLLBACK_PRESETS)[number] {
  return CHAT_SCROLLBACK_PRESETS.some((preset) => preset === value);
}

export function normalizeChatHistoryScrollbackItems(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return CHAT_SCROLLBACK_DEFAULT;
  }
  return clampChatScrollbackItems(parsed);
}

/**
 * 计算下一档聊天历史回溯条数。
 *
 * @param value 当前生效的历史回溯条数，`null` 表示已不限条数。
 * @returns 下一档可用条数；若已达到最大预设则返回 `null` 表示不限条数。
 */
export function getNextChatHistoryScrollbackItems(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  const normalized = clampChatScrollbackItems(value);
  return CHAT_SCROLLBACK_PRESETS.find((preset) => preset > normalized) ?? null;
}
