import { describe, expect, it } from "vitest";
import { parseCollaborationModeListResponse } from "./collaborationModeListResponse";

describe("parseCollaborationModeListResponse", () => {
  it("normalizes nested collaboration modes", () => {
    expect(
      parseCollaborationModeListResponse({
        result: {
          data: {
            modes: [
              {
                mode: "plan",
                label: "Plan",
                settings: {
                  model: "gpt-5",
                  reasoning_effort: "medium",
                  developer_instructions: "Think first",
                },
              },
            ],
          },
        },
      }),
    ).toEqual([
      {
        id: "plan",
        label: "Plan",
        mode: "plan",
        model: "gpt-5",
        reasoningEffort: "medium",
        developerInstructions: "Think first",
        value: expect.objectContaining({ mode: "plan" }),
      },
    ]);
  });

  it("returns an empty list for invalid collaboration mode responses", () => {
    expect(parseCollaborationModeListResponse({ result: { modes: [{ id: "" }] } })).toEqual([]);
    expect(parseCollaborationModeListResponse(null)).toEqual([]);
  });
});
