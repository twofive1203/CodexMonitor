import { describe, expect, it } from "vitest";
import { parseSkillsListResponse } from "./skillsListResponse";

describe("parseSkillsListResponse", () => {
  it("normalizes direct and bucketed skills responses", () => {
    expect(
      parseSkillsListResponse({
        result: {
          data: [
            {
              skills: [
                { name: "planner", path: "/skills/planner", description: "Plan" },
              ],
            },
            { name: "reviewer", path: "/skills/reviewer" },
          ],
        },
      }),
    ).toEqual([
      { name: "planner", path: "/skills/planner", description: "Plan" },
      { name: "reviewer", path: "/skills/reviewer" },
    ]);
  });

  it("returns an empty list for invalid skills responses", () => {
    expect(parseSkillsListResponse({ result: { skills: "bad" } })).toEqual([]);
    expect(parseSkillsListResponse(undefined)).toEqual([]);
  });
});
