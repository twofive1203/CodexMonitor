import { describe, expect, it } from "vitest";
import { providerSupportsRuntimeCodexArgs } from "./agentProvider";

describe("providerSupportsRuntimeCodexArgs", () => {
  it("returns true for codex", () => {
    expect(providerSupportsRuntimeCodexArgs("codex")).toBe(true);
  });

  it("returns false for claude", () => {
    expect(providerSupportsRuntimeCodexArgs("claude")).toBe(false);
  });
});
