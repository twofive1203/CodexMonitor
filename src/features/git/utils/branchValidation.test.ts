import { describe, expect, it } from "vitest";
import { validateBranchName } from "./branchValidation";

describe("validateBranchName", () => {
  it("returns null for valid names", () => {
    expect(validateBranchName("feature/add-login")).toBeNull();
    expect(validateBranchName(" release/v1 ")).toBeNull();
  });

  it("rejects invalid names", () => {
    expect(validateBranchName(".")).toContain("分支名不能是“.”或“..”。");
    expect(validateBranchName("hello world")).toContain("分支名不能包含空格。");
    expect(validateBranchName("feature//oops")).toContain("分支名不能包含“//”。");
    expect(validateBranchName("feature..oops")).toContain("分支名不能包含“..”。");
    expect(validateBranchName("topic@{x")).toContain("分支名不能包含“@{”。");
  });
});
