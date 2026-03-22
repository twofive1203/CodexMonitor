import type {
  AgentProvider,
  AppSettings,
  ProviderCapabilities,
  WorkspaceInfo,
} from "@/types";

/**
 * 工作区 provider 的默认值。
 */
export const DEFAULT_AGENT_PROVIDER: AgentProvider = "codex";

/**
 * 前端在能力接口尚未返回前使用的一期默认能力表。
 */
export const PROVIDER_CAPABILITY_FALLBACKS: Record<
  AgentProvider,
  ProviderCapabilities
> = {
  codex: {
    supportsLogin: true,
    supportsRateLimits: true,
    supportsSkills: true,
    supportsApps: true,
    supportsSteer: true,
    supportsReview: true,
    supportsCollaborationModes: true,
  },
  claude: {
    supportsLogin: false,
    supportsRateLimits: false,
    supportsSkills: false,
    supportsApps: false,
    supportsSteer: false,
    supportsReview: false,
    supportsCollaborationModes: false,
  },
};

/**
 * 归一化 provider 字段。
 *
 * `value`：待归一化的原始值。
 * `fallback`：无法识别时使用的默认 provider。
 */
export function normalizeAgentProvider(
  value: unknown,
  fallback: AgentProvider = DEFAULT_AGENT_PROVIDER,
): AgentProvider {
  return value === "claude" || value === "codex" ? value : fallback;
}

/**
 * 判断 Claude provider 是否已开启实验开关。
 *
 * `settings`：当前应用设置，可为空。
 */
export function isClaudeProviderEnabled(
  settings: Pick<AppSettings, "experimentalClaudeEnabled"> | null | undefined,
): boolean {
  return Boolean(settings?.experimentalClaudeEnabled);
}

/**
 * 根据当前设置裁剪 provider，避免未开启实验开关时继续暴露 Claude。
 *
 * `value`：待裁剪的 provider 原始值。
 * `settings`：当前应用设置，可为空。
 * `fallback`：裁剪失败后的兜底 provider。
 */
export function resolveAgentProviderForSettings(
  value: unknown,
  settings: Pick<AppSettings, "experimentalClaudeEnabled"> | null | undefined,
  fallback: AgentProvider = DEFAULT_AGENT_PROVIDER,
): AgentProvider {
  const provider = normalizeAgentProvider(value, fallback);
  if (provider === "claude" && !isClaudeProviderEnabled(settings)) {
    return fallback;
  }
  return provider;
}

/**
 * 返回当前设置允许选择的 provider 列表。
 *
 * `settings`：当前应用设置，可为空。
 */
export function getEnabledAgentProviders(
  settings: Pick<AppSettings, "experimentalClaudeEnabled"> | null | undefined,
): AgentProvider[] {
  return isClaudeProviderEnabled(settings) ? ["codex", "claude"] : ["codex"];
}

/**
 * 读取工作区 provider，并处理旧数据缺省场景。
 *
 * `workspace`：工作区数据，可为空。
 * `fallback`：provider 缺失时的兜底值。
 */
export function getWorkspaceProvider(
  workspace: Pick<WorkspaceInfo, "provider"> | null | undefined,
  fallback: AgentProvider = DEFAULT_AGENT_PROVIDER,
): AgentProvider {
  return normalizeAgentProvider(workspace?.provider, fallback);
}

/**
 * 返回项目设置页中可编辑的 provider 值。
 *
 * `workspace`：当前工作区，可为空。
 * `settings`：当前应用设置，可为空。
 */
export function getWorkspaceProviderSelectValue(
  workspace: Pick<WorkspaceInfo, "provider"> | null | undefined,
  settings: Pick<AppSettings, "experimentalClaudeEnabled"> | null | undefined,
): AgentProvider {
  const provider = getWorkspaceProvider(workspace);
  return isClaudeProviderEnabled(settings) || provider !== "claude"
    ? provider
    : "claude";
}

/**
 * 判断当前工作区 provider 是否允许在设置页直接修改。
 *
 * `workspace`：当前工作区，可为空。
 * `settings`：当前应用设置，可为空。
 */
export function canEditWorkspaceProvider(
  workspace: Pick<WorkspaceInfo, "provider"> | null | undefined,
  settings: Pick<AppSettings, "experimentalClaudeEnabled"> | null | undefined,
): boolean {
  const provider = getWorkspaceProvider(workspace);
  return provider !== "claude" || isClaudeProviderEnabled(settings);
}

/**
 * 返回 provider 的界面展示名称。
 *
 * `provider`：目标 provider。
 */
export function getAgentProviderLabel(provider: AgentProvider): string {
  return provider === "claude" ? "Claude" : "Codex";
}

/**
 * 判断 provider 是否支持运行时 Codex 参数覆盖。
 *
 * `provider`：目标 provider。
 */
export function providerSupportsRuntimeCodexArgs(provider: AgentProvider): boolean {
  return provider === "codex";
}

/**
 * 合并后端能力和前端兜底能力。
 *
 * `provider`：目标 provider。
 * `capabilities`：后端返回的能力，可为空。
 */
export function resolveProviderCapabilities(
  provider: AgentProvider,
  capabilities: ProviderCapabilities | null | undefined,
): ProviderCapabilities {
  return capabilities ?? PROVIDER_CAPABILITY_FALLBACKS[provider];
}

/**
 * 判断 provider 是否支持账号或额度展示。
 *
 * `provider`：目标 provider。
 */
export function providerSupportsAccountUi(provider: AgentProvider): boolean {
  const capabilities = resolveProviderCapabilities(provider, null);
  return capabilities.supportsLogin || capabilities.supportsRateLimits;
}
