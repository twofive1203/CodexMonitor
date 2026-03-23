import type { AgentProvider } from "@/types";

export type BuiltInSlashCommandId =
  | "apps"
  | "compact"
  | "fast"
  | "fork"
  | "mcp"
  | "new"
  | "resume"
  | "review"
  | "status";

export type BuiltInSlashCommandDefinition = {
  id: BuiltInSlashCommandId;
  label: BuiltInSlashCommandId;
  description: string;
  insertText: BuiltInSlashCommandId;
};

type BuiltInSlashCommandOptions = {
  provider: AgentProvider;
  appsEnabled: boolean;
  reviewEnabled?: boolean;
};

const BUILT_IN_SLASH_COMMANDS: Record<
  BuiltInSlashCommandId,
  BuiltInSlashCommandDefinition
> = {
  apps: {
    id: "apps",
    label: "apps",
    description: "查看可用应用",
    insertText: "apps",
  },
  compact: {
    id: "compact",
    label: "compact",
    description: "压缩当前会话上下文",
    insertText: "compact",
  },
  fast: {
    id: "fast",
    label: "fast",
    description: "切换后续回合的快速模式",
    insertText: "fast",
  },
  fork: {
    id: "fork",
    label: "fork",
    description: "分叉为一个新会话",
    insertText: "fork",
  },
  mcp: {
    id: "mcp",
    label: "mcp",
    description: "查看已配置的 MCP 工具",
    insertText: "mcp",
  },
  new: {
    id: "new",
    label: "new",
    description: "开始新会话",
    insertText: "new",
  },
  resume: {
    id: "resume",
    label: "resume",
    description: "刷新当前会话",
    insertText: "resume",
  },
  review: {
    id: "review",
    label: "review",
    description: "开始代码审查",
    insertText: "review",
  },
  status: {
    id: "status",
    label: "status",
    description: "查看会话状态",
    insertText: "status",
  },
};

const CODEX_COMMAND_ORDER: BuiltInSlashCommandId[] = [
  "apps",
  "compact",
  "fast",
  "fork",
  "mcp",
  "new",
  "resume",
  "review",
  "status",
];

const CLAUDE_COMMAND_ORDER: BuiltInSlashCommandId[] = [
  "fast",
  "fork",
  "new",
  "resume",
  "status",
];

/**
 * 返回当前 provider 允许暴露的内置 slash 命令。
 *
 * `options.provider`：当前工作区 provider。
 * `options.appsEnabled`：是否允许暴露 `/apps`。
 * `options.reviewEnabled`：是否允许暴露 `/review`。
 */
export function getSupportedBuiltInSlashCommands({
  provider,
  appsEnabled,
  reviewEnabled = true,
}: BuiltInSlashCommandOptions): BuiltInSlashCommandDefinition[] {
  const commandOrder = provider === "claude" ? CLAUDE_COMMAND_ORDER : CODEX_COMMAND_ORDER;
  return commandOrder
    .filter((commandId) => {
      if (commandId === "apps") {
        return appsEnabled;
      }
      if (commandId === "review") {
        return reviewEnabled;
      }
      return true;
    })
    .map((commandId) => BUILT_IN_SLASH_COMMANDS[commandId]);
}

/**
 * 解析当前输入中的内置 slash 命令。
 *
 * `text`：待识别的输入文本。
 * `options`：当前 provider 的命令裁剪配置。
 */
export function parseBuiltInSlashCommand(
  text: string,
  options: BuiltInSlashCommandOptions,
): BuiltInSlashCommandId | null {
  const trimmed = text.trim();
  const matched = getSupportedBuiltInSlashCommands(options).find((command) =>
    new RegExp(`^/${command.id}\\b`, "i").test(trimmed),
  );
  return matched?.id ?? null;
}
