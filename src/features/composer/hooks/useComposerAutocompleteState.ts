import { useCallback, useMemo, useState } from "react";
import type { AutocompleteItem } from "./useComposerAutocomplete";
import { useComposerAutocomplete } from "./useComposerAutocomplete";
import type {
  AgentProvider,
  AppOption,
  ClaudeCommandOption,
  CustomPromptOption,
} from "../../../types";
import { connectorMentionSlug } from "../../apps/utils/appMentions";
import {
  buildPromptInsertText,
  findNextPromptArgCursor,
  findPromptArgRangeAtCursor,
  getPromptArgumentHint,
} from "../../../utils/customPrompts";
import { isComposingEvent } from "../../../utils/keys";
import { getSupportedBuiltInSlashCommands } from "../../../utils/slashCommands";

type Skill = { name: string; description?: string };
type UseComposerAutocompleteStateArgs = {
  text: string;
  selectionStart: number | null;
  disabled: boolean;
  provider?: AgentProvider;
  reviewEnabled?: boolean;
  appsEnabled: boolean;
  skills: Skill[];
  apps: AppOption[];
  claudeCommands?: ClaudeCommandOption[];
  prompts: CustomPromptOption[];
  files: string[];
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setText: (next: string) => void;
  setSelectionStart: (next: number | null) => void;
  onItemApplied?: (
    item: AutocompleteItem,
    context: { triggerChar: string; insertedText: string },
  ) => void;
};

const MAX_FILE_SUGGESTIONS = 500;
const FILE_TRIGGER_PREFIX = new RegExp("^(?:\\s|[\"'`]|\\(|\\[|\\{)$");
const RECENT_AUTOCOMPLETE_STORAGE_KEY = "codexmonitor.composer.recentAutocomplete";
const MAX_RECENT_AUTOCOMPLETE_ITEMS = 40;

/**
 * 读取最近使用的自动补全项 ID。
 *
 * 无入参；浏览器存储不可用时返回空列表。
 */
function readRecentAutocompleteIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(RECENT_AUTOCOMPLETE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * 写入最近使用的自动补全项 ID。
 * @param ids 最近使用 ID 列表，顺序越靠前优先级越高。
 */
function writeRecentAutocompleteIds(ids: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      RECENT_AUTOCOMPLETE_STORAGE_KEY,
      JSON.stringify(ids.slice(0, MAX_RECENT_AUTOCOMPLETE_ITEMS)),
    );
  } catch {
    // Storage failures should not block composer input.
  }
}

/**
 * 按最近使用顺序提升 prompts、skills、apps 的候选项。
 * @param items 原始候选项。
 * @param recentIds 最近使用 ID 列表。
 */
function sortAutocompleteItemsByRecent<TItem extends AutocompleteItem>(
  items: TItem[],
  recentIds: string[],
): TItem[] {
  if (recentIds.length === 0) {
    return items;
  }
  const priorityById = new Map(recentIds.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({
      item,
      index,
      priority: priorityById.get(item.id) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

function isFileTriggerActive(text: string, cursor: number | null) {
  if (!text || cursor === null) {
    return false;
  }
  const beforeCursor = text.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) {
    return false;
  }
  const prevChar = atIndex > 0 ? beforeCursor[atIndex - 1] : "";
  if (prevChar && !FILE_TRIGGER_PREFIX.test(prevChar)) {
    return false;
  }
  const afterAt = beforeCursor.slice(atIndex + 1);
  return afterAt.length === 0 || !/\s/.test(afterAt);
}

function getFileTriggerQuery(text: string, cursor: number | null) {
  if (!text || cursor === null) {
    return null;
  }
  const beforeCursor = text.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) {
    return null;
  }
  const prevChar = atIndex > 0 ? beforeCursor[atIndex - 1] : "";
  if (prevChar && !FILE_TRIGGER_PREFIX.test(prevChar)) {
    return null;
  }
  const afterAt = beforeCursor.slice(atIndex + 1);
  if (/\s/.test(afterAt)) {
    return null;
  }
  return afterAt;
}

/**
 * 把 Claude 项目命令转换成 `/` 自动补全项，并按命令名去重。
 *
 * `commands`：工作区扫描出的 Claude 自定义命令列表。
 */
function buildClaudeSlashCommandItems(commands: ClaudeCommandOption[]) {
  const seen = new Set<string>();
  const items: AutocompleteItem[] = [];
  commands.forEach((command) => {
    const normalizedName = command.name.trim().replace(/^\/+/, "");
    if (!normalizedName) {
      return;
    }
    const dedupeKey = normalizedName.toLowerCase();
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    items.push({
      id: `claude-command:${command.path}`,
      label: normalizedName,
      description: command.description,
      hint: command.argumentHint,
      insertText: normalizedName,
      group: "Slash",
    });
  });
  return items;
}

export function useComposerAutocompleteState({
  text,
  selectionStart,
  disabled,
  provider = "codex",
  reviewEnabled = true,
  appsEnabled,
  skills,
  apps,
  claudeCommands = [],
  prompts,
  files,
  textareaRef,
  setText,
  setSelectionStart,
  onItemApplied,
}: UseComposerAutocompleteStateArgs) {
  const [recentAutocompleteIds, setRecentAutocompleteIds] = useState(
    readRecentAutocompleteIds,
  );
  const skillItems = useMemo<AutocompleteItem[]>(
    () =>
      sortAutocompleteItemsByRecent([
        ...skills.map((skill) => ({
        id: `skill:${skill.name}`,
        label: skill.name,
        description: skill.description,
        insertText: skill.name,
        group: "Skills" as const,
      })),
      ...apps
        .filter((app) => app.isAccessible)
        .map((app) => ({
          id: `app:${app.id}`,
          label: app.name,
          description: app.description,
          insertText: connectorMentionSlug(app.name),
          group: "Apps" as const,
          mentionPath: `app://${app.id}`,
        })),
      ], recentAutocompleteIds),
    [apps, recentAutocompleteIds, skills],
  );

  const fileTriggerActive = useMemo(
    () => isFileTriggerActive(text, selectionStart),
    [selectionStart, text],
  );
  const fileItems = useMemo<AutocompleteItem[]>(
    () =>
      fileTriggerActive
        ? (() => {
            const query = getFileTriggerQuery(text, selectionStart) ?? "";
            const limited = query ? files : files.slice(0, MAX_FILE_SUGGESTIONS);
            return limited.map((path) => ({
              id: path,
              label: path,
              insertText: path,
              group: "Files" as const,
            }));
          })()
        : [],
    [fileTriggerActive, files, selectionStart, text],
  );

  const promptItems = useMemo<AutocompleteItem[]>(
    () => {
      if (provider === "claude") {
        return [];
      }
      return sortAutocompleteItemsByRecent(prompts
        .filter((prompt) => prompt.name)
        .map((prompt) => {
          const insert = buildPromptInsertText(prompt);
          return {
            id: `prompt:${prompt.name}`,
            label: `prompts:${prompt.name}`,
            description: prompt.description,
            hint: getPromptArgumentHint(prompt),
            insertText: insert.text,
            cursorOffset: insert.cursorOffset,
            group: "Prompts" as const,
          };
        }), recentAutocompleteIds);
    },
    [prompts, provider, recentAutocompleteIds],
  );

  const slashCommandItems = useMemo<AutocompleteItem[]>(() => {
    return getSupportedBuiltInSlashCommands({
      provider,
      appsEnabled,
      reviewEnabled,
    }).map((command) => ({
      ...command,
      group: "Slash" as const,
    }));
  }, [appsEnabled, provider, reviewEnabled]);

  const claudeSlashCommandItems = useMemo<AutocompleteItem[]>(() => {
    if (provider !== "claude") {
      return [];
    }
    const customItems = buildClaudeSlashCommandItems(claudeCommands);
    if (customItems.length === 0) {
      return [];
    }
    const builtInLabels = new Set(
      slashCommandItems.map((item) => item.label.trim().toLowerCase()),
    );
    return customItems.filter(
      (item) => !builtInLabels.has(item.label.trim().toLowerCase()),
    );
  }, [claudeCommands, provider, slashCommandItems]);

  const slashItems = useMemo<AutocompleteItem[]>(
    () => [...slashCommandItems, ...claudeSlashCommandItems, ...promptItems],
    [claudeSlashCommandItems, promptItems, slashCommandItems],
  );

  const triggers = useMemo(
    () => [
      { trigger: "/", items: slashItems },
      { trigger: "$", items: skillItems },
      { trigger: "@", items: fileItems },
    ],
    [fileItems, skillItems, slashItems],
  );

  const {
    active: isAutocompleteOpen,
    matches: autocompleteMatches,
    highlightIndex,
    setHighlightIndex,
    moveHighlight,
    range: autocompleteRange,
    close: closeAutocomplete,
  } = useComposerAutocomplete({
    text,
    selectionStart,
    triggers,
  });
  const autocompleteAnchorIndex = autocompleteRange
    ? Math.max(0, autocompleteRange.start - 1)
    : null;

  const applyAutocomplete = useCallback(
    (item: AutocompleteItem) => {
      if (!autocompleteRange) {
        return;
      }
      const triggerIndex = Math.max(0, autocompleteRange.start - 1);
      const triggerChar = text[triggerIndex] ?? "";
      const cursor = selectionStart ?? autocompleteRange.end;
      const promptRange =
        triggerChar === "@" ? findPromptArgRangeAtCursor(text, cursor) : null;
      const before =
        triggerChar === "@"
          ? text.slice(0, triggerIndex)
          : text.slice(0, autocompleteRange.start);
      const after = text.slice(autocompleteRange.end);
      const insert = item.insertText ?? item.label;
      const actualInsert = triggerChar === "@"
        ? insert.replace(/^@+/, "")
        : insert;
      if (item.group === "Prompts" || item.group === "Skills" || item.group === "Apps") {
        setRecentAutocompleteIds((previous) => {
          const next = [item.id, ...previous.filter((id) => id !== item.id)].slice(
            0,
            MAX_RECENT_AUTOCOMPLETE_ITEMS,
          );
          writeRecentAutocompleteIds(next);
          return next;
        });
      }
      const needsSpace = promptRange
        ? false
        : after.length === 0
          ? true
          : !/^\s/.test(after);
      const nextText = `${before}${actualInsert}${needsSpace ? " " : ""}${after}`;
      setText(nextText);
      onItemApplied?.(item, { triggerChar, insertedText: actualInsert });
      closeAutocomplete();
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        const insertCursor = Math.min(
          actualInsert.length,
          Math.max(0, item.cursorOffset ?? actualInsert.length),
        );
        const cursor =
          before.length +
          insertCursor +
          (item.cursorOffset === undefined ? (needsSpace ? 1 : 0) : 0);
        textarea.focus();
        textarea.setSelectionRange(cursor, cursor);
        setSelectionStart(cursor);
      });
    },
    [
      autocompleteRange,
      closeAutocomplete,
      selectionStart,
      setSelectionStart,
      setText,
      text,
      textareaRef,
      onItemApplied,
      setRecentAutocompleteIds,
    ],
  );

  const handleTextChange = useCallback(
    (next: string, cursor: number | null) => {
      setText(next);
      setSelectionStart(cursor);
    },
    [setSelectionStart, setText],
  );

  const handleSelectionChange = useCallback(
    (cursor: number | null) => {
      setSelectionStart(cursor);
    },
    [setSelectionStart],
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (disabled) {
        return;
      }
      if (isComposingEvent(event)) {
        return;
      }
      if (isAutocompleteOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveHighlight(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveHighlight(-1);
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const selected =
            autocompleteMatches[highlightIndex] ?? autocompleteMatches[0];
          if (selected) {
            applyAutocomplete(selected);
          }
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          const selected =
            autocompleteMatches[highlightIndex] ?? autocompleteMatches[0];
          if (selected) {
            applyAutocomplete(selected);
          }
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeAutocomplete();
          return;
        }
      }
      if (event.key === "Tab") {
        const cursor = selectionStart ?? text.length;
        const nextCursor = findNextPromptArgCursor(text, cursor);
        if (nextCursor !== null) {
          event.preventDefault();
          requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) {
              return;
            }
            textarea.focus();
            textarea.setSelectionRange(nextCursor, nextCursor);
            setSelectionStart(nextCursor);
          });
        }
      }
    },
    [
      applyAutocomplete,
      autocompleteMatches,
      closeAutocomplete,
      disabled,
      highlightIndex,
      isAutocompleteOpen,
      moveHighlight,
      selectionStart,
      setSelectionStart,
      text,
      textareaRef,
    ],
  );

  return {
    isAutocompleteOpen,
    autocompleteMatches,
    autocompleteAnchorIndex,
    highlightIndex,
    setHighlightIndex,
    applyAutocomplete,
    handleInputKeyDown,
    handleTextChange,
    handleSelectionChange,
    fileTriggerActive,
  };
}
