import type { RequestUserInputQuestion } from "../../../../types";
import type { HookEvent } from "./types";

type IdPair = {
  threadId: string;
  itemId: string;
};

type DeltaEvent = IdPair & {
  delta: string;
};

type TurnRef = {
  threadId: string;
  turnId: string;
};

/**
 * 方法说明：从 camelCase 或 snake_case 字段中读取字符串值。
 * 入参说明：params 为事件参数对象，camelKey 和 snakeKey 为候选字段名。
 */
export function getStringParam(
  params: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): string {
  return String(params[camelKey] ?? params[snakeKey] ?? "");
}

/**
 * 方法说明：从事件参数中读取并裁剪字符串值。
 * 入参说明：params 为事件参数对象，camelKey 和 snakeKey 为候选字段名。
 */
export function getTrimmedStringParam(
  params: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): string {
  return getStringParam(params, camelKey, snakeKey).trim();
}

/**
 * 方法说明：将未知值安全收窄为普通对象。
 * 入参说明：value 为待解析的事件字段。
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * 方法说明：解析带有 threadId 和 itemId 的事件标识。
 * 入参说明：params 为事件参数对象，要求同时包含线程与条目标识。
 */
export function parseThreadItemIds(params: Record<string, unknown>): IdPair | null {
  const threadId = getStringParam(params, "threadId", "thread_id");
  const itemId = getStringParam(params, "itemId", "item_id");
  if (!threadId || !itemId) {
    return null;
  }
  return { threadId, itemId };
}

/**
 * 方法说明：解析增量事件的线程、条目和 delta 文本。
 * 入参说明：params 为事件参数对象，delta 为空时视为无效事件。
 */
export function parseDeltaEvent(params: Record<string, unknown>): DeltaEvent | null {
  const ids = parseThreadItemIds(params);
  const delta = String(params.delta ?? "");
  if (!ids || !delta) {
    return null;
  }
  return { ...ids, delta };
}

/**
 * 方法说明：解析 turn 事件中的线程和 turn 标识。
 * 入参说明：params 为事件参数对象，可从 params.turn 或顶层字段读取。
 */
export function parseTurnRef(params: Record<string, unknown>): TurnRef | null {
  const turn = asRecord(params.turn);
  const threadId = String(
    params.threadId ?? params.thread_id ?? turn?.threadId ?? turn?.thread_id ?? "",
  );
  const turnId = String(turn?.id ?? params.turnId ?? params.turn_id ?? "");
  if (!threadId) {
    return null;
  }
  return { threadId, turnId };
}

/**
 * 方法说明：解析 hook started/completed 事件。
 * 入参说明：workspaceId 为工作区标识，params 为 hook 事件参数。
 */
export function parseHookEvent(
  workspaceId: string,
  params: Record<string, unknown>,
): HookEvent | null {
  const threadId = getTrimmedStringParam(params, "threadId", "thread_id");
  if (!threadId) {
    return null;
  }
  const run = asRecord(params.run);
  if (!run) {
    return null;
  }
  const turnIdRaw = params.turnId ?? params.turn_id ?? null;
  const turnId =
    typeof turnIdRaw === "string" && turnIdRaw.trim().length > 0
      ? turnIdRaw.trim()
      : null;
  return {
    workspaceId,
    threadId,
    turnId,
    run,
  };
}

/**
 * 方法说明：解析 request user input 的问题列表。
 * 入参说明：questionsRaw 为 app-server 传入的 questions 字段。
 */
export function parseRequestUserInputQuestions(
  questionsRaw: unknown,
): RequestUserInputQuestion[] {
  if (!Array.isArray(questionsRaw)) {
    return [];
  }
  return questionsRaw
    .map((entry): RequestUserInputQuestion | null => {
      const question = asRecord(entry);
      if (!question) {
        return null;
      }
      const optionsRaw = Array.isArray(question.options) ? question.options : [];
      const options = optionsRaw
        .map((option) => {
          const record = asRecord(option);
          const label = String(record?.label ?? "").trim();
          const description = String(record?.description ?? "").trim();
          if (!label && !description) {
            return null;
          }
          return { label, description };
        })
        .filter((option): option is { label: string; description: string } => Boolean(option));
      return {
        id: String(question.id ?? "").trim(),
        header: String(question.header ?? ""),
        question: String(question.question ?? ""),
        isOther: Boolean(question.isOther ?? question.is_other),
        options: options.length ? options : undefined,
      };
    })
    .filter((question): question is RequestUserInputQuestion => Boolean(question?.id));
}
