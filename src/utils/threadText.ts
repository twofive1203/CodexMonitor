import type { ConversationItem } from "../types";

function formatMessage(item: Extract<ConversationItem, { kind: "message" }>) {
  const roleLabel = item.role === "user" ? "用户" : "助手";
  return `${roleLabel}: ${item.text}`;
}

function formatReasoning(item: Extract<ConversationItem, { kind: "reasoning" }>) {
  const parts = ["推理："];
  if (item.summary) {
    parts.push(item.summary);
  }
  if (item.content) {
    parts.push(item.content);
  }
  return parts.join("\n");
}

function formatUserInput(item: Extract<ConversationItem, { kind: "userInput" }>) {
  const lines = item.questions.map((entry, index) => {
    const title = entry.question || entry.header || `问题 ${index + 1}`;
    const answers =
      entry.answers.length > 0 ? entry.answers.join(" | ") : "未提供答案";
    return `- ${title}: ${answers}`;
  });
  return ["输入已回答：", ...lines].join("\n");
}

/**
 * 解析工具项在转录文本中应输出的正文，避免依赖运行时重复缓存的 diff 字段。
 *
 * @param item 工具消息项。
 * @returns 适合写入转录文本的输出内容。
 */
function resolveToolTranscriptOutput(item: Extract<ConversationItem, { kind: "tool" }>) {
  if (item.toolType !== "fileChange") {
    return item.output ?? "";
  }
  const structuredDiff = (item.changes ?? [])
    .map((change) => change.diff ?? "")
    .filter(Boolean)
    .join("\n\n");
  return structuredDiff || item.output || "";
}

function formatTool(item: Extract<ConversationItem, { kind: "tool" }>) {
  const parts = [`工具：${item.title}`];
  if (item.detail) {
    parts.push(item.detail);
  }
  if (item.status) {
    parts.push(`状态：${item.status}`);
  }
  const transcriptOutput = resolveToolTranscriptOutput(item);
  if (transcriptOutput) {
    parts.push(transcriptOutput);
  }
  if (item.changes && item.changes.length > 0) {
    parts.push(
      "变更：\n" +
        item.changes
          .map((change) => `- ${change.path}${change.kind ? ` (${change.kind})` : ""}`)
          .join("\n"),
    );
  }
  return parts.join("\n");
}

function formatDiff(item: Extract<ConversationItem, { kind: "diff" }>) {
  const header = `差异：${item.title}`;
  const status = item.status ? `状态：${item.status}` : null;
  return [header, status, item.diff].filter(Boolean).join("\n");
}

function formatReview(item: Extract<ConversationItem, { kind: "review" }>) {
  return `审查（${item.state}）：${item.text}`;
}

function formatExplore(item: Extract<ConversationItem, { kind: "explore" }>) {
  const title = item.status === "exploring" ? "探索中" : "已探索";
  const lines = item.entries.map((entry) => {
    const prefix = entry.kind[0].toUpperCase() + entry.kind.slice(1);
    return `- ${prefix} ${entry.label}${entry.detail ? ` (${entry.detail})` : ""}`;
  });
  return [title, ...lines].join("\n");
}

export function buildThreadTranscript(items: ConversationItem[]) {
  return items
    .map((item) => {
      switch (item.kind) {
        case "message":
          return formatMessage(item);
        case "userInput":
          return formatUserInput(item);
        case "reasoning":
          return formatReasoning(item);
        case "explore":
          return formatExplore(item);
        case "tool":
          return formatTool(item);
        case "diff":
          return formatDiff(item);
        case "review":
          return formatReview(item);
      }
      return "";
    })
    .filter((value) => value.trim().length > 0)
    .join("\n\n");
}
