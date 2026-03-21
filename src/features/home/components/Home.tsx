import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { useEffect, useState } from "react";
import type {
  AccountSnapshot,
  LocalUsageDay,
  LocalUsageSnapshot,
  RateLimitSnapshot,
} from "../../../types";
import { formatRelativeTime } from "../../../utils/time";
import { getUsageLabels } from "../../app/utils/usageLabels";

type LatestAgentRun = {
  message: string;
  timestamp: number;
  projectName: string;
  groupName?: string | null;
  workspaceId: string;
  threadId: string;
  isProcessing: boolean;
};

type UsageMetric = "tokens" | "time";

type UsageWorkspaceOption = {
  id: string;
  label: string;
};

type HomeStatCard = {
  label: string;
  value: string;
  suffix?: string | null;
  caption: string;
  compact?: boolean;
};

type HomeProps = {
  onAddWorkspace: () => void;
  onAddWorkspaceFromUrl: () => void;
  latestAgentRuns: LatestAgentRun[];
  isLoadingLatestAgents: boolean;
  localUsageSnapshot: LocalUsageSnapshot | null;
  isLoadingLocalUsage: boolean;
  localUsageError: string | null;
  onRefreshLocalUsage: () => void;
  usageMetric: UsageMetric;
  onUsageMetricChange: (metric: UsageMetric) => void;
  usageWorkspaceId: string | null;
  usageWorkspaceOptions: UsageWorkspaceOption[];
  onUsageWorkspaceChange: (workspaceId: string | null) => void;
  accountRateLimits: RateLimitSnapshot | null;
  usageShowRemaining: boolean;
  accountInfo: AccountSnapshot | null;
  accountSectionHint?: string | null;
  onSelectThread: (workspaceId: string, threadId: string) => void;
};

function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "--";
  }
  if (value >= 100_000_000) {
    const scaled = value / 100_000_000;
    return `${scaled.toFixed(scaled >= 10 ? 0 : 1)}亿`;
  }
  if (value >= 10_000) {
    const scaled = value / 10_000;
    return `${scaled.toFixed(scaled >= 10 ? 0 : 1)}万`;
  }
  if (value >= 1_000) {
    const scaled = value / 1_000;
    return `${scaled.toFixed(scaled >= 10 ? 0 : 1)}千`;
  }
  return String(value);
}

function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "--";
  }
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDuration(valueMs: number | null | undefined) {
  if (valueMs === null || valueMs === undefined) {
    return "--";
  }
  const totalSeconds = Math.max(0, Math.round(valueMs / 1000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}小时 ${minutes}分钟`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}分钟`;
  }
  return `${totalSeconds}秒`;
}

function formatDurationCompact(valueMs: number | null | undefined) {
  if (valueMs === null || valueMs === undefined) {
    return "--";
  }
  const totalMinutes = Math.max(0, Math.round(valueMs / 60000));
  if (totalMinutes >= 60) {
    const hours = totalMinutes / 60;
    return `${hours.toFixed(hours >= 10 ? 0 : 1)}小时`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}分钟`;
  }
  const seconds = Math.max(0, Math.round(valueMs / 1000));
  return `${seconds}秒`;
}

function formatDayLabel(value: string | null | undefined) {
  if (!value) {
    return "--";
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function formatWeekRange(days: LocalUsageDay[]) {
  if (days.length === 0) {
    return "暂无用量数据";
  }
  const first = days[0];
  const last = days[days.length - 1];
  const firstLabel = formatDayLabel(first?.day);
  const lastLabel = formatDayLabel(last?.day);
  return first?.day === last?.day ? firstLabel : `${firstLabel} 至 ${lastLabel}`;
}

function isUsageDayActive(day: LocalUsageDay) {
  return day.totalTokens > 0 || day.agentTimeMs > 0 || day.agentRuns > 0;
}

function formatPlanType(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAccountTypeLabel(value: AccountSnapshot["type"] | null | undefined) {
  if (value === "chatgpt") {
    return "ChatGPT 账号";
  }
  if (value === "apikey") {
    return "API 密钥";
  }
  return "已连接账号";
}

function formatWindowDuration(valueMins: number | null | undefined) {
  if (typeof valueMins !== "number" || !Number.isFinite(valueMins) || valueMins <= 0) {
    return null;
  }
  if (valueMins >= 60 * 24) {
    const days = Math.round(valueMins / (60 * 24));
    return `${days}天窗口`;
  }
  if (valueMins >= 60) {
    const hours = Math.round(valueMins / 60);
    return `${hours}小时窗口`;
  }
  return `${Math.round(valueMins)}分钟窗口`;
}

function buildWindowCaption(
  resetLabel: string | null,
  windowDurationMins: number | null | undefined,
  fallback: string,
) {
  const parts = [resetLabel, formatWindowDuration(windowDurationMins)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : fallback;
}

function formatCreditsBalance(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return trimmed;
  }
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(numeric);
}

export function Home({
  onAddWorkspace,
  onAddWorkspaceFromUrl,
  latestAgentRuns,
  isLoadingLatestAgents,
  localUsageSnapshot,
  isLoadingLocalUsage,
  localUsageError,
  onRefreshLocalUsage,
  usageMetric,
  onUsageMetricChange,
  usageWorkspaceId,
  usageWorkspaceOptions,
  onUsageWorkspaceChange,
  accountRateLimits,
  usageShowRemaining,
  accountInfo,
  accountSectionHint = null,
  onSelectThread,
}: HomeProps) {
  const [chartWeekOffset, setChartWeekOffset] = useState(0);

  const usageTotals = localUsageSnapshot?.totals ?? null;
  const usageDays = localUsageSnapshot?.days ?? [];
  const latestUsageDay = usageDays[usageDays.length - 1] ?? null;
  const last7Days = usageDays.slice(-7);
  const last7Tokens = last7Days.reduce((total, day) => total + day.totalTokens, 0);
  const last7Input = last7Days.reduce((total, day) => total + day.inputTokens, 0);
  const last7Cached = last7Days.reduce(
    (total, day) => total + day.cachedInputTokens,
    0,
  );
  const last7AgentMs = last7Days.reduce(
    (total, day) => total + (day.agentTimeMs ?? 0),
    0,
  );
  const last30AgentMs = usageDays.reduce(
    (total, day) => total + (day.agentTimeMs ?? 0),
    0,
  );
  const averageDailyAgentMs =
    last7Days.length > 0 ? Math.round(last7AgentMs / last7Days.length) : 0;
  const last7AgentRuns = last7Days.reduce(
    (total, day) => total + (day.agentRuns ?? 0),
    0,
  );
  const last30AgentRuns = usageDays.reduce(
    (total, day) => total + (day.agentRuns ?? 0),
    0,
  );
  const averageTokensPerRun =
    last7AgentRuns > 0 ? Math.round(last7Tokens / last7AgentRuns) : null;
  const averageRunDurationMs =
    last7AgentRuns > 0 ? Math.round(last7AgentMs / last7AgentRuns) : null;
  const last7ActiveDays = last7Days.filter(isUsageDayActive).length;
  const last30ActiveDays = usageDays.filter(isUsageDayActive).length;
  const averageActiveDayAgentMs =
    last7ActiveDays > 0 ? Math.round(last7AgentMs / last7ActiveDays) : null;
  const peakAgentDay = usageDays.reduce<
    | { day: string; agentTimeMs: number }
    | null
  >((best, day) => {
    const value = day.agentTimeMs ?? 0;
    if (value <= 0) {
      return best;
    }
    if (!best || value > best.agentTimeMs) {
      return { day: day.day, agentTimeMs: value };
    }
    return best;
  }, null);
  const peakAgentDayLabel = peakAgentDay?.day ?? null;
  const peakAgentTimeMs = peakAgentDay?.agentTimeMs ?? 0;
  const maxHistoricalWeekOffset = Math.max(0, Math.ceil(usageDays.length / 7) - 1);
  useEffect(() => {
    setChartWeekOffset((previous) => Math.min(previous, maxHistoricalWeekOffset));
  }, [maxHistoricalWeekOffset]);
  const chartWeekEnd = Math.max(0, usageDays.length - chartWeekOffset * 7);
  const chartWeekStart = Math.max(0, chartWeekEnd - 7);
  const chartDays = usageDays.slice(chartWeekStart, chartWeekEnd);
  const maxUsageValue = Math.max(
    1,
    ...chartDays.map((day) =>
      usageMetric === "tokens" ? day.totalTokens : day.agentTimeMs ?? 0,
    ),
  );
  const canShowOlderWeek = chartWeekOffset < maxHistoricalWeekOffset;
  const canShowNewerWeek = chartWeekOffset > 0;
  const chartRangeLabel = formatWeekRange(chartDays);
  const chartRangeAriaLabel =
    chartDays.length > 0
      ? `用量周期 ${chartDays[0]?.day} 至 ${chartDays[chartDays.length - 1]?.day}`
      : "用量周期";
  let longestStreak = 0;
  let runningStreak = 0;
  for (const day of usageDays) {
    if (isUsageDayActive(day)) {
      runningStreak += 1;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 0;
    }
  }

  const longestStreakCard: HomeStatCard = {
    label: "最长连续活跃",
    value: longestStreak > 0 ? formatDayCount(longestStreak) : "--",
    caption:
      longestStreak > 0
        ? "基于当前统计范围"
        : "暂无连续活跃记录",
    compact: true,
  };
  const activeDaysCard: HomeStatCard = {
    label: "活跃天数",
    value: last7Days.length > 0 ? `${last7ActiveDays} / ${last7Days.length}` : "--",
    caption:
      usageDays.length > 0
        ? `${last30ActiveDays} / ${usageDays.length}（当前范围）`
        : "暂无活动",
    compact: true,
  };
  const usageCards: HomeStatCard[] =
    usageMetric === "tokens"
      ? [
          {
            label: "今日",
            value: formatCompactNumber(latestUsageDay?.totalTokens ?? 0),
            suffix: "令牌",
            caption: latestUsageDay
              ? `${formatDayLabel(latestUsageDay.day)} · 输入 ${formatCount(
                  latestUsageDay.inputTokens,
                )} / 输出 ${formatCount(latestUsageDay.outputTokens)}`
              : "最近可用日期",
          },
          {
            label: "最近 7 天",
            value: formatCompactNumber(usageTotals?.last7DaysTokens ?? last7Tokens),
            suffix: "令牌",
            caption: `日均 ${formatCompactNumber(usageTotals?.averageDailyTokens)}`,
          },
          {
            label: "最近 30 天",
            value: formatCompactNumber(usageTotals?.last30DaysTokens ?? last7Tokens),
            suffix: "令牌",
            caption: `总计 ${formatCount(usageTotals?.last30DaysTokens ?? last7Tokens)}`,
          },
          {
            label: "缓存命中率",
            value: usageTotals
              ? `${usageTotals.cacheHitRatePercent.toFixed(1)}%`
              : "--",
            caption: "最近 7 天",
          },
          {
            label: "缓存节省令牌",
            value: formatCompactNumber(last7Cached),
            suffix: "已节省",
            caption:
              last7Input > 0
                ? `占提示词令牌的 ${((last7Cached / last7Input) * 100).toFixed(1)}%`
                : "最近 7 天",
          },
          {
            label: "平均每次",
            value:
              averageTokensPerRun === null
                ? "--"
                : formatCompactNumber(averageTokensPerRun),
            suffix: "令牌",
            caption:
              last7AgentRuns > 0
                ? `最近 7 天共 ${formatCount(last7AgentRuns)} 次运行`
                : "暂无运行",
          },
          {
            label: "峰值日",
            value: formatDayLabel(usageTotals?.peakDay),
            caption: `${formatCompactNumber(usageTotals?.peakDayTokens)} 令牌`,
          },
        ]
      : [
          {
            label: "最近 7 天",
            value: formatDurationCompact(last7AgentMs),
            suffix: "运行时长",
            caption: `日均 ${formatDurationCompact(averageDailyAgentMs)}`,
          },
          {
            label: "最近 30 天",
            value: formatDurationCompact(last30AgentMs),
            suffix: "运行时长",
            caption: `总计 ${formatDuration(last30AgentMs)}`,
          },
          {
            label: "运行次数",
            value: formatCount(last7AgentRuns),
            suffix: "次",
            caption: `最近 30 天共 ${formatCount(last30AgentRuns)} 次`,
          },
          {
            label: "平均每次",
            value: formatDurationCompact(averageRunDurationMs),
            caption:
              last7AgentRuns > 0
                ? `基于 ${formatCount(last7AgentRuns)} 次运行`
                : "暂无运行",
          },
          {
            label: "平均每个活跃日",
            value: formatDurationCompact(averageActiveDayAgentMs),
            caption:
              last7ActiveDays > 0
                ? `最近 7 天活跃 ${formatCount(last7ActiveDays)} 天`
                : "暂无活跃日",
          },
          {
            label: "峰值日",
            value: formatDayLabel(peakAgentDayLabel),
            caption: `${formatDurationCompact(peakAgentTimeMs)} 运行时长`,
          },
        ];
  const usageInsights = [longestStreakCard, activeDaysCard];
  const usagePercentLabels = getUsageLabels(accountRateLimits, usageShowRemaining);
  const planLabel = formatPlanType(accountRateLimits?.planType ?? accountInfo?.planType);
  const creditsBalance = formatCreditsBalance(accountRateLimits?.credits?.balance);
  const accountCards: HomeStatCard[] = [];

  if (usagePercentLabels.sessionPercent !== null) {
    accountCards.push({
      label: usageShowRemaining ? "会话剩余" : "会话使用",
      value: `${usagePercentLabels.sessionPercent}%`,
      caption: buildWindowCaption(
        usagePercentLabels.sessionResetLabel,
        accountRateLimits?.primary?.windowDurationMins,
        "当前窗口",
      ),
    });
  }

  if (usagePercentLabels.showWeekly && usagePercentLabels.weeklyPercent !== null) {
    accountCards.push({
      label: usageShowRemaining ? "每周剩余" : "每周使用",
      value: `${usagePercentLabels.weeklyPercent}%`,
      caption: buildWindowCaption(
        usagePercentLabels.weeklyResetLabel,
        accountRateLimits?.secondary?.windowDurationMins,
        "更长周期",
      ),
    });
  }

  if (accountRateLimits?.credits?.hasCredits) {
    accountCards.push(
      accountRateLimits.credits.unlimited
        ? {
            label: "点数",
            value: "不限",
            caption: "可用余额",
          }
        : {
            label: "点数",
            value: creditsBalance ?? "--",
            suffix: creditsBalance ? "点" : null,
            caption: "可用余额",
          },
    );
  }

  if (planLabel) {
    accountCards.push({
      label: "套餐",
      value: planLabel,
      caption: formatAccountTypeLabel(accountInfo?.type),
    });
  }

  const accountMeta = accountInfo?.email ?? null;
  const updatedLabel = localUsageSnapshot
    ? `更新于 ${formatRelativeTime(localUsageSnapshot.updatedAt)}`
    : null;
  const showUsageSkeleton = isLoadingLocalUsage && !localUsageSnapshot;
  const showUsageEmpty = !isLoadingLocalUsage && !localUsageSnapshot;

  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-title">Codex Monitor</div>
        <div className="home-subtitle">
          跨本地项目统一调度智能体。
        </div>
      </div>
      <div className="home-latest">
        <div className="home-latest-header">
          <div className="home-latest-label">最新智能体</div>
        </div>
        {latestAgentRuns.length > 0 ? (
          <div className="home-latest-grid">
            {latestAgentRuns.map((run) => (
              <button
                className="home-latest-card home-latest-card-button"
                key={run.threadId}
                onClick={() => onSelectThread(run.workspaceId, run.threadId)}
                type="button"
              >
                <div className="home-latest-card-header">
                  <div className="home-latest-project">
                    <span className="home-latest-project-name">{run.projectName}</span>
                    {run.groupName && (
                      <span className="home-latest-group">{run.groupName}</span>
                    )}
                  </div>
                  <div className="home-latest-time">
                    {formatRelativeTime(run.timestamp)}
                  </div>
                </div>
                <div className="home-latest-message">
                  {run.message.trim() || "智能体已回复。"}
                </div>
                {run.isProcessing && (
                  <div className="home-latest-status">运行中</div>
                )}
              </button>
            ))}
          </div>
        ) : isLoadingLatestAgents ? (
          <div className="home-latest-grid home-latest-grid-loading" aria-label="正在加载智能体">
            {Array.from({ length: 3 }).map((_, index) => (
              <div className="home-latest-card home-latest-card-skeleton" key={index}>
                <div className="home-latest-card-header">
                  <span className="home-latest-skeleton home-latest-skeleton-title" />
                  <span className="home-latest-skeleton home-latest-skeleton-time" />
                </div>
                <span className="home-latest-skeleton home-latest-skeleton-line" />
                <span className="home-latest-skeleton home-latest-skeleton-line short" />
              </div>
            ))}
          </div>
        ) : (
          <div className="home-latest-empty">
            <div className="home-latest-empty-title">暂无智能体活动</div>
            <div className="home-latest-empty-subtitle">
              开始一个会话后，最新回复会显示在这里。
            </div>
          </div>
        )}
      </div>
      <div className="home-actions">
        <button
          className="home-button primary home-add-workspaces-button"
          onClick={onAddWorkspace}
          data-tauri-drag-region="false"
        >
          <span className="home-icon" aria-hidden>
            +
          </span>
          添加项目
        </button>
        <button
          className="home-button secondary home-add-workspace-from-url-button"
          onClick={onAddWorkspaceFromUrl}
          data-tauri-drag-region="false"
        >
          <span className="home-icon" aria-hidden>
            ⤓
          </span>
          通过仓库地址添加项目
        </button>
      </div>
      <div className="home-usage">
        <div className="home-section-header">
          <div className="home-section-title">用量概览</div>
          <div className="home-section-meta-row">
            {updatedLabel && <div className="home-section-meta">{updatedLabel}</div>}
            <button
              type="button"
              className={
                isLoadingLocalUsage
                  ? "home-usage-refresh is-loading"
                  : "home-usage-refresh"
              }
              onClick={onRefreshLocalUsage}
              disabled={isLoadingLocalUsage}
              aria-label="刷新用量"
              title="刷新用量"
            >
              <RefreshCw
                className={
                  isLoadingLocalUsage
                    ? "home-usage-refresh-icon spinning"
                    : "home-usage-refresh-icon"
                }
                aria-hidden
              />
            </button>
          </div>
        </div>
        <div className="home-usage-controls">
          <div className="home-usage-control-group">
            <span className="home-usage-control-label">项目</span>
            <div className="home-usage-select-wrap">
              <select
                className="home-usage-select"
                value={usageWorkspaceId ?? ""}
                onChange={(event) =>
                  onUsageWorkspaceChange(event.target.value || null)
                }
                disabled={usageWorkspaceOptions.length === 0}
              >
                <option value="">全部项目</option>
                {usageWorkspaceOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="home-usage-control-group">
            <span className="home-usage-control-label">视图</span>
            <div className="home-usage-toggle" role="group" aria-label="用量视图">
              <button
                type="button"
                className={
                  usageMetric === "tokens"
                    ? "home-usage-toggle-button is-active"
                    : "home-usage-toggle-button"
                }
                onClick={() => onUsageMetricChange("tokens")}
                aria-pressed={usageMetric === "tokens"}
              >
                令牌
              </button>
              <button
                type="button"
                className={
                  usageMetric === "time"
                    ? "home-usage-toggle-button is-active"
                    : "home-usage-toggle-button"
                }
                onClick={() => onUsageMetricChange("time")}
                aria-pressed={usageMetric === "time"}
              >
                时长
              </button>
            </div>
          </div>
        </div>
        {showUsageSkeleton ? (
          <div className="home-usage-skeleton">
            <div className="home-usage-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="home-usage-card" key={index}>
                  <span className="home-latest-skeleton home-usage-skeleton-label" />
                  <span className="home-latest-skeleton home-usage-skeleton-value" />
                </div>
              ))}
            </div>
            <div className="home-usage-chart-card">
              <span className="home-latest-skeleton home-usage-skeleton-chart" />
            </div>
          </div>
        ) : showUsageEmpty ? (
          <div className="home-usage-empty">
            <div className="home-usage-empty-title">暂无用量数据</div>
            <div className="home-usage-empty-subtitle">
              运行一次 Codex 会话后，这里会开始统计本地用量。
            </div>
            {localUsageError && (
              <div className="home-usage-error">{localUsageError}</div>
            )}
          </div>
        ) : (
          <>
            <div className="home-usage-grid">
              {usageCards.map((card) => (
                <div className="home-usage-card" key={card.label}>
                  <div className="home-usage-label">{card.label}</div>
                  <div className="home-usage-value">
                    <span className="home-usage-number">{card.value}</span>
                    {card.suffix && <span className="home-usage-suffix">{card.suffix}</span>}
                  </div>
                  <div className="home-usage-caption">{card.caption}</div>
                </div>
              ))}
            </div>
            <div className="home-usage-chart-card">
              <div className="home-usage-chart-nav">
                <div
                  className="home-usage-chart-range"
                  aria-label={chartRangeAriaLabel}
                  aria-live="polite"
                >
                  {chartRangeLabel}
                </div>
                <div className="home-usage-chart-actions">
                  {canShowOlderWeek && (
                    <button
                      type="button"
                      className="home-usage-chart-button"
                      onClick={() => setChartWeekOffset((current) => current + 1)}
                      aria-label="查看上一周"
                      title="查看上一周"
                    >
                      <ChevronLeft aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    className="home-usage-chart-button"
                    onClick={() => setChartWeekOffset((current) => Math.max(0, current - 1))}
                    aria-label="查看下一周"
                    title="查看下一周"
                    disabled={!canShowNewerWeek}
                  >
                    <ChevronRight aria-hidden />
                  </button>
                </div>
              </div>
              <div className="home-usage-chart">
                {chartDays.map((day) => {
                  const value =
                    usageMetric === "tokens" ? day.totalTokens : day.agentTimeMs ?? 0;
                  const height = Math.max(
                    6,
                    Math.round((value / maxUsageValue) * 100),
                  );
                  const tooltip =
                    usageMetric === "tokens"
                      ? `${formatDayLabel(day.day)} · ${formatCount(day.totalTokens)} 令牌`
                      : `${formatDayLabel(day.day)} · ${formatDuration(day.agentTimeMs ?? 0)} 运行时长`;
                  return (
                    <div
                      className="home-usage-bar"
                      key={day.day}
                      data-value={tooltip}
                    >
                      <span
                        className="home-usage-bar-fill"
                        style={{ height: `${height}%` }}
                      />
                      <span className="home-usage-bar-label">
                        {formatDayLabel(day.day)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="home-usage-insights">
              {usageInsights.map((card) => (
                <div
                  className="home-usage-card is-compact"
                  key={card.label}
                >
                  <div className="home-usage-label">{card.label}</div>
                  <div className="home-usage-value">
                    <span className="home-usage-number">{card.value}</span>
                    {card.suffix && <span className="home-usage-suffix">{card.suffix}</span>}
                  </div>
                  <div className="home-usage-caption">{card.caption}</div>
                </div>
              ))}
            </div>
            <div className="home-usage-models">
              <div className="home-usage-models-label">
                热门模型
                {usageMetric === "time" && (
                  <span className="home-usage-models-hint">令牌</span>
                )}
              </div>
              <div className="home-usage-models-list">
                {localUsageSnapshot?.topModels?.length ? (
                  localUsageSnapshot.topModels.map((model) => (
                    <span
                      className="home-usage-model-chip"
                      key={model.model}
                      title={`${model.model}：${formatCount(model.tokens)} 令牌`}
                    >
                      {model.model}
                      <span className="home-usage-model-share">
                        {model.sharePercent.toFixed(1)}%
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="home-usage-model-empty">暂无模型数据</span>
                )}
              </div>
              {localUsageError && (
                <div className="home-usage-error">{localUsageError}</div>
              )}
            </div>
          </>
        )}
        {accountCards.length > 0 && (
          <div className="home-account">
            <div className="home-section-header">
              <div className="home-section-title">账号限额</div>
              {accountMeta && (
                <div className="home-section-meta-row">
                  <div className="home-section-meta">{accountMeta}</div>
                </div>
              )}
            </div>
            <div className="home-usage-grid home-account-grid">
              {accountCards.map((card) => (
                <div className="home-usage-card" key={card.label}>
                  <div className="home-usage-label">{card.label}</div>
                  <div className="home-usage-value">
                    <span className="home-usage-number">{card.value}</span>
                    {card.suffix && (
                      <span className="home-usage-suffix">{card.suffix}</span>
                    )}
                  </div>
                  <div className="home-usage-caption">{card.caption}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {accountCards.length === 0 && accountSectionHint && (
          <div className="home-account">
            <div className="home-section-header">
              <div className="home-section-title">账号与额度</div>
            </div>
            <div className="home-usage-empty-subtitle">{accountSectionHint}</div>
          </div>
        )}
      </div>
    </div>
  );
}
function formatDayCount(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "--";
  }
  return `${value}天`;
}
