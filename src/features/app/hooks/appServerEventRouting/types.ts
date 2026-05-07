import type {
  AppServerEvent,
  ApprovalRequest,
  RequestUserInputRequest,
} from "../../../../types";
import type { SupportedAppServerMethod } from "../../../../utils/appServerEvents";

export type AgentDelta = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  delta: string;
};

export type AgentCompleted = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  text: string;
};

export type HookEvent = {
  workspaceId: string;
  threadId: string;
  turnId: string | null;
  run: Record<string, unknown>;
};

export type AppServerEventHandlers = {
  onWorkspaceConnected?: (workspaceId: string) => void;
  onThreadStarted?: (workspaceId: string, thread: Record<string, unknown>) => void;
  onThreadNameUpdated?: (
    workspaceId: string,
    payload: { threadId: string; threadName: string | null },
  ) => void;
  onThreadStatusChanged?: (
    workspaceId: string,
    threadId: string,
    status: Record<string, unknown>,
  ) => void;
  onThreadClosed?: (workspaceId: string, threadId: string) => void;
  onThreadArchived?: (workspaceId: string, threadId: string) => void;
  onThreadUnarchived?: (workspaceId: string, threadId: string) => void;
  onBackgroundThreadAction?: (
    workspaceId: string,
    threadId: string,
    action: string,
  ) => void;
  onApprovalRequest?: (request: ApprovalRequest) => void;
  onRequestUserInput?: (request: RequestUserInputRequest) => void;
  onAgentMessageDelta?: (event: AgentDelta) => void;
  onAgentMessageCompleted?: (event: AgentCompleted) => void;
  onAppServerEvent?: (event: AppServerEvent) => void;
  onTurnStarted?: (workspaceId: string, threadId: string, turnId: string) => void;
  onTurnCompleted?: (workspaceId: string, threadId: string, turnId: string) => void;
  onTurnError?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: { message: string; willRetry: boolean },
  ) => void;
  onTurnPlanUpdated?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: { explanation: unknown; plan: unknown },
  ) => void;
  onHookStarted?: (event: HookEvent) => void;
  onHookCompleted?: (event: HookEvent) => void;
  onItemStarted?: (workspaceId: string, threadId: string, item: Record<string, unknown>) => void;
  onItemCompleted?: (workspaceId: string, threadId: string, item: Record<string, unknown>) => void;
  onReasoningSummaryDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onReasoningSummaryBoundary?: (workspaceId: string, threadId: string, itemId: string) => void;
  onReasoningTextDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onPlanDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onCommandOutputDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onTerminalInteraction?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    stdin: string,
  ) => void;
  onFileChangeOutputDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onTurnDiffUpdated?: (workspaceId: string, threadId: string, diff: string) => void;
  onThreadTokenUsageUpdated?: (
    workspaceId: string,
    threadId: string,
    tokenUsage: Record<string, unknown> | null,
  ) => void;
  onAccountRateLimitsUpdated?: (
    workspaceId: string,
    rateLimits: Record<string, unknown>,
  ) => void;
  onAccountUpdated?: (workspaceId: string, authMode: string | null) => void;
  onAccountLoginCompleted?: (
    workspaceId: string,
    payload: { loginId: string | null; success: boolean; error: string | null },
  ) => void;
};

export type AppServerRouteContext = {
  workspaceId: string;
  method: SupportedAppServerMethod;
  params: Record<string, unknown>;
  requestId: string | number | null;
  handlers: AppServerEventHandlers;
};

export type AppServerEventHandler = (context: AppServerRouteContext) => void;
