export type LatestAgentRun = {
  message: string;
  timestamp: number;
  projectName: string;
  groupName?: string | null;
  workspaceId: string;
  threadId: string;
  isProcessing: boolean;
};

export type UsageMetric = "tokens" | "time";
export type UsageRange = "30d" | "90d" | "365d" | "all";

export type UsageWorkspaceOption = {
  id: string;
  label: string;
};

export type HomeStatCard = {
  label: string;
  value: string;
  suffix?: string | null;
  caption: string;
  compact?: boolean;
};
