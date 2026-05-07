import {
  getAppServerRequestId,
  isApprovalRequestMethod,
  isSupportedAppServerMethod,
} from "../../../../utils/appServerEvents";
import type { SupportedAppServerMethod } from "../../../../utils/appServerEvents";
import {
  asRecord,
  getStringParam,
  getTrimmedStringParam,
  parseDeltaEvent,
  parseHookEvent,
  parseRequestUserInputQuestions,
  parseThreadItemIds,
  parseTurnRef,
} from "./parsers";
import type {
  AppServerEventHandler,
  AppServerEventHandlers,
  AppServerRouteContext,
} from "./types";

type RoutedAppServerMethod = Exclude<
  SupportedAppServerMethod,
  "app/list/updated" | "codex/event/skills_update_available"
>;

/**
 * 方法说明：分发 CodexMonitor 连接类桥接事件。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeConnectedEvent({ workspaceId, handlers }: AppServerRouteContext) {
  handlers.onWorkspaceConnected?.(workspaceId);
}

/**
 * 方法说明：分发 approval 请求，保留 requestApproval 后缀兼容。
 * 入参说明：workspaceId、method、params 和 requestId 来自原始 app-server 消息。
 */
export function routeApprovalRequest(
  workspaceId: string,
  method: string,
  params: Record<string, unknown>,
  requestId: string | number,
  handlers: AppServerEventHandlers,
) {
  handlers.onApprovalRequest?.({
    workspace_id: workspaceId,
    request_id: requestId,
    method,
    params,
  });
}

/**
 * 方法说明：分发 request user input 请求。
 * 入参说明：context 为已解析的路由上下文，requestId 为空时忽略。
 */
function routeRequestUserInput({ workspaceId, params, requestId, handlers }: AppServerRouteContext) {
  if (requestId === null) {
    return;
  }
  handlers.onRequestUserInput?.({
    workspace_id: workspaceId,
    request_id: requestId,
    params: {
      thread_id: getStringParam(params, "threadId", "thread_id"),
      turn_id: getStringParam(params, "turnId", "turn_id"),
      item_id: getStringParam(params, "itemId", "item_id"),
      questions: parseRequestUserInputQuestions(params.questions),
    },
  });
}

/**
 * 方法说明：分发 agent message delta。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeAgentMessageDelta({ workspaceId, params, handlers }: AppServerRouteContext) {
  const event = parseDeltaEvent(params);
  if (!event) {
    return;
  }
  handlers.onAgentMessageDelta?.({
    workspaceId,
    threadId: event.threadId,
    itemId: event.itemId,
    delta: event.delta,
  });
}

/**
 * 方法说明：分发 turn started/completed。
 * 入参说明：handlerName 指定目标回调，context 为已解析的路由上下文。
 */
function routeTurnLifecycle(
  handlerName: "onTurnStarted" | "onTurnCompleted",
  { workspaceId, params, handlers }: AppServerRouteContext,
) {
  const ref = parseTurnRef(params);
  if (!ref) {
    return;
  }
  handlers[handlerName]?.(workspaceId, ref.threadId, ref.turnId);
}

/**
 * 方法说明：分发 hook started/completed。
 * 入参说明：handlerName 指定目标回调，context 为已解析的路由上下文。
 */
function routeHookLifecycle(
  handlerName: "onHookStarted" | "onHookCompleted",
  { workspaceId, params, handlers }: AppServerRouteContext,
) {
  const event = parseHookEvent(workspaceId, params);
  if (!event) {
    return;
  }
  handlers[handlerName]?.(event);
}

/**
 * 方法说明：分发 thread started。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeThreadStarted({ workspaceId, params, handlers }: AppServerRouteContext) {
  const thread = asRecord(params.thread);
  const threadId = String(thread?.id ?? "");
  if (thread && threadId) {
    handlers.onThreadStarted?.(workspaceId, thread);
  }
}

/**
 * 方法说明：分发 thread name updated。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeThreadNameUpdated({ workspaceId, params, handlers }: AppServerRouteContext) {
  const threadId = getTrimmedStringParam(params, "threadId", "thread_id");
  const threadNameRaw = params.threadName ?? params.thread_name ?? null;
  const threadName =
    typeof threadNameRaw === "string" && threadNameRaw.trim().length > 0
      ? threadNameRaw.trim()
      : null;
  if (threadId) {
    handlers.onThreadNameUpdated?.(workspaceId, { threadId, threadName });
  }
}

/**
 * 方法说明：分发 thread status changed，兼容字符串状态。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeThreadStatusChanged({ workspaceId, params, handlers }: AppServerRouteContext) {
  const threadId = getTrimmedStringParam(params, "threadId", "thread_id");
  if (!threadId) {
    return;
  }
  const statusRaw = params.status;
  const status = asRecord(statusRaw);
  if (status) {
    handlers.onThreadStatusChanged?.(workspaceId, threadId, status);
    return;
  }
  if (typeof statusRaw === "string" && statusRaw.trim().length > 0) {
    handlers.onThreadStatusChanged?.(workspaceId, threadId, {
      type: statusRaw.trim(),
    });
  }
}

/**
 * 方法说明：分发只有 threadId 的线程生命周期事件。
 * 入参说明：handlerName 指定目标回调，context 为已解析的路由上下文。
 */
function routeThreadIdOnly(
  handlerName: "onThreadClosed" | "onThreadArchived" | "onThreadUnarchived",
  { workspaceId, params, handlers }: AppServerRouteContext,
) {
  const threadId = getTrimmedStringParam(params, "threadId", "thread_id");
  if (threadId) {
    handlers[handlerName]?.(workspaceId, threadId);
  }
}

/**
 * 方法说明：分发后台线程动作。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeBackgroundThread({ workspaceId, params, handlers }: AppServerRouteContext) {
  const threadId = getStringParam(params, "threadId", "thread_id");
  const action = String(params.action ?? "hide");
  if (threadId) {
    handlers.onBackgroundThreadAction?.(workspaceId, threadId, action);
  }
}

/**
 * 方法说明：分发 turn error 事件。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeTurnError({ workspaceId, params, handlers }: AppServerRouteContext) {
  const threadId = getStringParam(params, "threadId", "thread_id");
  const turnId = getStringParam(params, "turnId", "turn_id");
  const error = asRecord(params.error) ?? {};
  const messageText = String(error.message ?? "");
  const willRetry = Boolean(params.willRetry ?? params.will_retry);
  if (threadId) {
    handlers.onTurnError?.(workspaceId, threadId, turnId, {
      message: messageText,
      willRetry,
    });
  }
}

/**
 * 方法说明：分发 turn plan updated。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeTurnPlanUpdated({ workspaceId, params, handlers }: AppServerRouteContext) {
  const threadId = getStringParam(params, "threadId", "thread_id");
  const turnId = getStringParam(params, "turnId", "turn_id");
  if (threadId) {
    handlers.onTurnPlanUpdated?.(workspaceId, threadId, turnId, {
      explanation: params.explanation,
      plan: params.plan,
    });
  }
}

/**
 * 方法说明：分发 turn diff updated。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeTurnDiffUpdated({ workspaceId, params, handlers }: AppServerRouteContext) {
  const threadId = getStringParam(params, "threadId", "thread_id");
  const diff = String(params.diff ?? "");
  if (threadId && diff) {
    handlers.onTurnDiffUpdated?.(workspaceId, threadId, diff);
  }
}

/**
 * 方法说明：分发线程 token usage 更新。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeThreadTokenUsageUpdated({ workspaceId, params, handlers }: AppServerRouteContext) {
  const threadId = getStringParam(params, "threadId", "thread_id");
  const tokenUsage =
    (params.tokenUsage as Record<string, unknown> | null | undefined) ??
    (params.token_usage as Record<string, unknown> | null | undefined);
  if (threadId && tokenUsage !== undefined) {
    handlers.onThreadTokenUsageUpdated?.(workspaceId, threadId, tokenUsage);
  }
}

/**
 * 方法说明：分发账号限流信息更新。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeAccountRateLimitsUpdated({ workspaceId, params, handlers }: AppServerRouteContext) {
  const rateLimits =
    (params.rateLimits as Record<string, unknown> | undefined) ??
    (params.rate_limits as Record<string, unknown> | undefined);
  if (rateLimits) {
    handlers.onAccountRateLimitsUpdated?.(workspaceId, rateLimits);
  }
}

/**
 * 方法说明：分发账号状态更新。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeAccountUpdated({ workspaceId, params, handlers }: AppServerRouteContext) {
  const authModeRaw = params.authMode ?? params.auth_mode ?? null;
  const authMode =
    typeof authModeRaw === "string" && authModeRaw.trim().length > 0
      ? authModeRaw
      : null;
  handlers.onAccountUpdated?.(workspaceId, authMode);
}

/**
 * 方法说明：分发账号登录完成事件。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeAccountLoginCompleted({ workspaceId, params, handlers }: AppServerRouteContext) {
  const loginIdRaw = params.loginId ?? params.login_id ?? null;
  const loginId =
    typeof loginIdRaw === "string" && loginIdRaw.trim().length > 0
      ? loginIdRaw
      : null;
  const success = Boolean(params.success);
  const errorRaw = params.error ?? null;
  const error =
    typeof errorRaw === "string" && errorRaw.trim().length > 0 ? errorRaw : null;
  handlers.onAccountLoginCompleted?.(workspaceId, {
    loginId,
    success,
    error,
  });
}

/**
 * 方法说明：分发 item completed，并在 agentMessage 完成时派生完成事件。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeItemCompleted({ workspaceId, params, handlers }: AppServerRouteContext) {
  const threadId = getStringParam(params, "threadId", "thread_id");
  const item = asRecord(params.item);
  if (threadId && item) {
    handlers.onItemCompleted?.(workspaceId, threadId, item);
  }
  if (threadId && item?.type === "agentMessage") {
    const itemId = String(item.id ?? "");
    const text = String(item.text ?? "");
    if (itemId) {
      handlers.onAgentMessageCompleted?.({
        workspaceId,
        threadId,
        itemId,
        text,
      });
    }
  }
}

/**
 * 方法说明：分发 item started。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeItemStarted({ workspaceId, params, handlers }: AppServerRouteContext) {
  const threadId = getStringParam(params, "threadId", "thread_id");
  const item = asRecord(params.item);
  if (threadId && item) {
    handlers.onItemStarted?.(workspaceId, threadId, item);
  }
}

/**
 * 方法说明：分发简单文本增量事件。
 * 入参说明：handlerName 指定目标回调，context 为已解析的路由上下文。
 */
function routeTextDelta(
  handlerName:
    | "onReasoningSummaryDelta"
    | "onReasoningTextDelta"
    | "onPlanDelta"
    | "onCommandOutputDelta"
    | "onFileChangeOutputDelta",
  { workspaceId, params, handlers }: AppServerRouteContext,
) {
  const event = parseDeltaEvent(params);
  if (!event) {
    return;
  }
  handlers[handlerName]?.(workspaceId, event.threadId, event.itemId, event.delta);
}

/**
 * 方法说明：分发 reasoning summary 分段边界事件。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeReasoningSummaryBoundary({ workspaceId, params, handlers }: AppServerRouteContext) {
  const ids = parseThreadItemIds(params);
  if (ids) {
    handlers.onReasoningSummaryBoundary?.(workspaceId, ids.threadId, ids.itemId);
  }
}

/**
 * 方法说明：分发终端交互事件。
 * 入参说明：context 为已解析的路由上下文。
 */
function routeTerminalInteraction({ workspaceId, params, handlers }: AppServerRouteContext) {
  const ids = parseThreadItemIds(params);
  const stdin = String(params.stdin ?? "");
  if (ids) {
    handlers.onTerminalInteraction?.(workspaceId, ids.threadId, ids.itemId, stdin);
  }
}

export const APP_SERVER_EVENT_ROUTE_TABLE = {
  "account/login/completed": routeAccountLoginCompleted,
  "account/rateLimits/updated": routeAccountRateLimitsUpdated,
  "account/updated": routeAccountUpdated,
  "codex/backgroundThread": routeBackgroundThread,
  "codex/connected": routeConnectedEvent,
  error: routeTurnError,
  "hook/completed": (context) => routeHookLifecycle("onHookCompleted", context),
  "hook/started": (context) => routeHookLifecycle("onHookStarted", context),
  "item/agentMessage/delta": routeAgentMessageDelta,
  "item/commandExecution/outputDelta": (context) =>
    routeTextDelta("onCommandOutputDelta", context),
  "item/commandExecution/terminalInteraction": routeTerminalInteraction,
  "item/completed": routeItemCompleted,
  "item/fileChange/outputDelta": (context) =>
    routeTextDelta("onFileChangeOutputDelta", context),
  "item/plan/delta": (context) => routeTextDelta("onPlanDelta", context),
  "item/reasoning/summaryPartAdded": routeReasoningSummaryBoundary,
  "item/reasoning/summaryTextDelta": (context) =>
    routeTextDelta("onReasoningSummaryDelta", context),
  "item/reasoning/textDelta": (context) => routeTextDelta("onReasoningTextDelta", context),
  "item/started": routeItemStarted,
  "item/tool/requestUserInput": routeRequestUserInput,
  "thread/archived": (context) => routeThreadIdOnly("onThreadArchived", context),
  "thread/closed": (context) => routeThreadIdOnly("onThreadClosed", context),
  "thread/name/updated": routeThreadNameUpdated,
  "thread/status/changed": routeThreadStatusChanged,
  "thread/started": routeThreadStarted,
  "thread/tokenUsage/updated": routeThreadTokenUsageUpdated,
  "thread/unarchived": (context) => routeThreadIdOnly("onThreadUnarchived", context),
  "turn/completed": (context) => routeTurnLifecycle("onTurnCompleted", context),
  "turn/diff/updated": routeTurnDiffUpdated,
  "turn/plan/updated": routeTurnPlanUpdated,
  "turn/started": (context) => routeTurnLifecycle("onTurnStarted", context),
} as const satisfies Record<RoutedAppServerMethod, AppServerEventHandler>;

export const METHODS_ROUTED_IN_USE_APP_SERVER_EVENTS = Object.keys(
  APP_SERVER_EVENT_ROUTE_TABLE,
) as RoutedAppServerMethod[];

/**
 * 方法说明：按方法名路由单条 app-server 事件。
 * 入参说明：workspaceId 为工作区标识，method 为原始方法名，params 为事件参数，handlers 为回调集合，event 为原始事件。
 */
export function routeAppServerEvent(
  workspaceId: string,
  method: string,
  params: Record<string, unknown>,
  handlers: AppServerEventHandlers,
  event: Parameters<typeof getAppServerRequestId>[0],
) {
  const requestId = getAppServerRequestId(event);
  if (isApprovalRequestMethod(method) && requestId !== null) {
    routeApprovalRequest(workspaceId, method, params, requestId, handlers);
    return;
  }
  if (!isSupportedAppServerMethod(method)) {
    return;
  }
  if (!(method in APP_SERVER_EVENT_ROUTE_TABLE)) {
    return;
  }
  APP_SERVER_EVENT_ROUTE_TABLE[method as keyof typeof APP_SERVER_EVENT_ROUTE_TABLE]({
    workspaceId,
    method: method as keyof typeof APP_SERVER_EVENT_ROUTE_TABLE,
    params,
    requestId,
    handlers,
  });
}
