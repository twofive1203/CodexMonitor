import { describe, expect, it } from "vitest";
import { parseCustomPromptListResponse } from "./customPromptListResponse";

describe("parseCustomPromptListResponse", () => {
  it("normalizes nested prompt responses", () => {
    expect(
      parseCustomPromptListResponse({
        result: {
          prompts: [
            {
              name: "ship",
              path: "/prompts/ship.md",
              description: "Release",
              argument_hint: "<version>",
              content: "Ship it",
              scope: "workspace",
            },
          ],
        },
      }),
    ).toEqual([
      {
        name: "ship",
        path: "/prompts/ship.md",
        description: "Release",
        argumentHint: "<version>",
        content: "Ship it",
        scope: "workspace",
      },
    ]);
  });

  it("returns an empty list for invalid prompt responses", () => {
    expect(parseCustomPromptListResponse({ result: { prompts: null } })).toEqual([]);
    expect(parseCustomPromptListResponse("bad")).toEqual([]);
  });
});
