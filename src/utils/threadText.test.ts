import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../types";
import { buildThreadTranscript } from "./threadText";

describe("threadText", () => {
  it("uses structured file change diffs when duplicated output is empty", () => {
    const items: ConversationItem[] = [
      {
        id: "file-change-1",
        kind: "tool",
        toolType: "fileChange",
        title: "文件变更",
        detail: "M src/foo.ts",
        status: "completed",
        output: "",
        changes: [
          {
            path: "src/foo.ts",
            kind: "modify",
            diff: "diff --git a/src/foo.ts b/src/foo.ts",
          },
        ],
      },
    ];

    const transcript = buildThreadTranscript(items);
    expect(transcript).toContain("diff --git a/src/foo.ts b/src/foo.ts");
    expect(transcript).toContain("变更：");
  });
});
