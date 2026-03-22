import { describe, expect, it } from "vitest";
import {
  canEditWorkspaceProvider,
  getWorkspaceProvider,
  getWorkspaceProviderSelectValue,
  providerSupportsRuntimeCodexArgs,
  resolveProviderCapabilities,
} from "./agentProvider";

describe("providerSupportsRuntimeCodexArgs", () => {
  it("returns true for codex", () => {
    expect(providerSupportsRuntimeCodexArgs("codex")).toBe(true);
  });

  it("returns false for claude", () => {
    expect(providerSupportsRuntimeCodexArgs("claude")).toBe(false);
  });
});

describe("workspace provider helpers", () => {
  it("falls back to codex when workspace provider is missing", () => {
    expect(getWorkspaceProvider({ provider: undefined })).toBe("codex");
  });

  it("keeps stored claude provider in project settings when feature is disabled", () => {
    expect(
      getWorkspaceProviderSelectValue(
        { provider: "claude" },
        { experimentalClaudeEnabled: false },
      ),
    ).toBe("claude");
    expect(
      canEditWorkspaceProvider(
        { provider: "claude" },
        { experimentalClaudeEnabled: false },
      ),
    ).toBe(false);
  });

  it("allows editing claude provider when experimental feature is enabled", () => {
    expect(
      canEditWorkspaceProvider(
        { provider: "claude" },
        { experimentalClaudeEnabled: true },
      ),
    ).toBe(true);
  });
});

describe("resolveProviderCapabilities", () => {
  it("uses fallback capability snapshot when backend capability is missing", () => {
    expect(resolveProviderCapabilities("claude", null)).toEqual({
      supportsLogin: false,
      supportsRateLimits: false,
      supportsSkills: false,
      supportsApps: false,
      supportsSteer: false,
      supportsReview: false,
      supportsCollaborationModes: false,
    });
  });
});
