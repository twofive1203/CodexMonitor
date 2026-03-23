import { describe, expect, it } from "vitest";
import { expandCustomPromptText } from "./customPrompts";

describe("customPrompts", () => {
  it("preserves raw trailing args for prompts without placeholders", () => {
    const result = expandCustomPromptText("/prompts:git-commit --emoji", [
      {
        name: "git-commit",
        path: "/tmp/git-commit.md",
        content: "请根据当前改动生成提交信息。",
      },
    ]);

    expect(result).toEqual({
      expanded: "请根据当前改动生成提交信息。 --emoji",
    });
  });

  it("does not append raw trailing args when numeric placeholders are present", () => {
    const result = expandCustomPromptText('/prompts:git-commit --style "emoji first"', [
      {
        name: "git-commit",
        path: "/tmp/git-commit.md",
        content: "请生成提交信息，风格要求：$ARGUMENTS",
      },
    ]);

    expect(result).toEqual({
      expanded: "请生成提交信息，风格要求：--style emoji first",
    });
  });

  it("preserves raw trailing args on a new paragraph for multi-line prompts", () => {
    const result = expandCustomPromptText("/prompts:git-commit --emoji", [
      {
        name: "git-commit",
        path: "/tmp/git-commit.md",
        content: "请分析当前变更。\n输出一条提交信息。",
      },
    ]);

    expect(result).toEqual({
      expanded: "请分析当前变更。\n输出一条提交信息。\n\n--emoji",
    });
  });
});
