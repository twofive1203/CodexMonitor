import { describe, expect, it } from "vitest";
import {
  getSupportedBuiltInSlashCommands,
  parseBuiltInSlashCommand,
} from "./slashCommands";

describe("slashCommands", () => {
  it("returns Codex built-in commands in stable order", () => {
    const commands = getSupportedBuiltInSlashCommands({
      provider: "codex",
      appsEnabled: true,
      reviewEnabled: true,
    });

    expect(commands.map((command) => command.id)).toEqual([
      "apps",
      "compact",
      "fast",
      "fork",
      "mcp",
      "new",
      "resume",
      "review",
      "status",
    ]);
  });

  it("returns Claude P0 command subset", () => {
    const commands = getSupportedBuiltInSlashCommands({
      provider: "claude",
      appsEnabled: true,
      reviewEnabled: true,
    });

    expect(commands.map((command) => command.id)).toEqual([
      "fast",
      "fork",
      "new",
      "resume",
      "status",
    ]);
  });

  it("parses only commands supported by the current provider", () => {
    expect(
      parseBuiltInSlashCommand("/review api", {
        provider: "claude",
        appsEnabled: true,
      }),
    ).toBeNull();

    expect(
      parseBuiltInSlashCommand("/resume now", {
        provider: "claude",
        appsEnabled: true,
      }),
    ).toBe("resume");
  });
});
