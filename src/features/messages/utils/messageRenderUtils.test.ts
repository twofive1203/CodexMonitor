import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  buildToolSummary,
  formatToolStatusLabel,
  statusToneFromText,
} from "./messageRenderUtils";

function makeToolItem(
  overrides: Partial<Extract<ConversationItem, { kind: "tool" }>>,
): Extract<ConversationItem, { kind: "tool" }> {
  return {
    id: "tool-1",
    kind: "tool",
    toolType: "webSearch",
    title: "Web search",
    detail: "codex monitor",
    status: "completed",
    output: "",
    ...overrides,
  };
}

describe("messageRenderUtils", () => {
  it("renders web search as searching while in progress", () => {
    const summary = buildToolSummary(makeToolItem({ status: "inProgress" }), "");
    expect(summary.label).toBe("搜索中");
    expect(summary.value).toBe("codex monitor");
  });

  it("renders mcp search calls as searching while in progress", () => {
    const summary = buildToolSummary(
      makeToolItem({
        toolType: "mcpToolCall",
        title: "Tool: web / search_query",
        detail: '{\n  "query": "codex monitor"\n}',
        status: "inProgress",
      }),
      "",
    );
    expect(summary.label).toBe("搜索中");
    expect(summary.value).toBe("codex monitor");
  });

  it("classifies camelCase inProgress as processing", () => {
    expect(statusToneFromText("inProgress")).toBe("processing");
  });

  it("renders collab tool calls with nickname and role", () => {
    const summary = buildToolSummary(
      makeToolItem({
        toolType: "collabToolCall",
        title: "Collab: wait",
        detail: "From thread-parent → thread-child",
        status: "completed",
        output: "Robie [explorer]: completed",
        collabReceivers: [
          {
            threadId: "thread-child",
            nickname: "Robie",
            role: "explorer",
          },
        ],
      }),
      "",
    );
    expect(summary.label).toBe("已等待");
    expect(summary.value).toBe("Robie [explorer]");
    expect(summary.output).toContain("Robie [explorer]: completed");
  });

  it("renders generic tool calls with tool label", () => {
    const summary = buildToolSummary(
      makeToolItem({
        toolType: "toolCall",
        title: "工具：Read",
        detail: '{\n  "file_path": "src/main.ts"\n}',
        output: "读取完成",
      }),
      "",
    );
    expect(summary.label).toBe("工具");
    expect(summary.value).toBe("Read");
    expect(summary.output).toBe("读取完成");
  });

  it("formats command status label for non-hook tools", () => {
    const label = formatToolStatusLabel(
      makeToolItem({
        toolType: "commandExecution",
        status: "running",
        durationMs: 65_000,
      }),
    );
    expect(label).toBe("进行中 • 1:05");
  });

  it("formats compact inprogress status in Chinese", () => {
    const label = formatToolStatusLabel(
      makeToolItem({
        toolType: "commandExecution",
        status: "INPROGRESS",
      }),
    );
    expect(label).toBe("进行中");
  });
});
