export const COMPOSER_DRAFTS_STORAGE_KEY = "codexmonitor.composerDrafts";
export const WORKSPACE_HOME_DRAFTS_STORAGE_KEY = "codexmonitor.workspaceHomeDrafts";

/**
 * 读取指定存储键下的草稿映射。
 * @param storageKey 本地存储键。
 */
export function readStoredDraftMap(storageKey: string): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/**
 * 读取指定作用域的草稿内容。
 * @param storageKey 本地存储键。
 * @param scopeKey 草稿作用域键。
 */
export function readStoredDraft(storageKey: string, scopeKey: string): string {
  return readStoredDraftMap(storageKey)[scopeKey] ?? "";
}

/**
 * 写入指定作用域的草稿内容。
 * @param storageKey 本地存储键。
 * @param scopeKey 草稿作用域键。
 * @param value 草稿文本，空串会删除对应草稿。
 */
export function writeStoredDraft(
  storageKey: string,
  scopeKey: string,
  value: string,
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const next = readStoredDraftMap(storageKey);
    if (value.length === 0) {
      delete next[scopeKey];
    } else {
      next[scopeKey] = value;
    }
    if (Object.keys(next).length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // 忽略本地存储异常，避免影响正常输入。
  }
}
