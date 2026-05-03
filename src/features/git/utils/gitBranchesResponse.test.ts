import { describe, expect, it } from "vitest";
import { parseGitBranchesResponse } from "./gitBranchesResponse";

describe("parseGitBranchesResponse", () => {
  it("normalizes nested branch responses", () => {
    expect(
      parseGitBranchesResponse({
        result: {
          branches: [
            { name: "main", last_commit: "12" },
            { name: "feature/ipc", lastCommit: 9 },
          ],
        },
      }),
    ).toEqual([
      { name: "main", lastCommit: 12 },
      { name: "feature/ipc", lastCommit: 9 },
    ]);
  });

  it("returns an empty list for invalid branch responses", () => {
    expect(parseGitBranchesResponse({ result: { branches: "bad" } })).toEqual([]);
    expect(parseGitBranchesResponse(undefined)).toEqual([]);
  });
});
