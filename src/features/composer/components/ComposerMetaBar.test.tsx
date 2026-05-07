// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerMetaBar } from "./ComposerMetaBar";

afterEach(() => {
  cleanup();
});

/**
 * 渲染运行配置栏测试实例。
 * @param overrides 需要覆盖的组件属性。
 */
function renderMetaBar(overrides: Partial<Parameters<typeof ComposerMetaBar>[0]> = {}) {
  return render(
    <ComposerMetaBar
      disabled={false}
      collaborationModes={[{ id: "default", label: "默认" }]}
      selectedCollaborationModeId="default"
      onSelectCollaborationMode={vi.fn()}
      models={[{ id: "gpt-5", displayName: "GPT-5", model: "gpt-5" }]}
      selectedModelId="gpt-5"
      onSelectModel={vi.fn()}
      reasoningOptions={["low", "medium", "high"]}
      selectedEffort={null}
      onSelectEffort={vi.fn()}
      selectedServiceTier={null}
      reasoningSupported
      accessMode="current"
      onSelectAccessMode={vi.fn()}
      contextUsage={null}
      {...overrides}
    />,
  );
}

describe("ComposerMetaBar", () => {
  it("keeps runtime controls collapsed until the user opens them", () => {
    renderMetaBar();

    expect(screen.getByRole("button", { name: "运行配置" })).toBeTruthy();
    expect(screen.queryByLabelText("模型")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "运行配置" }));

    expect(screen.getByLabelText("模型")).toBeTruthy();
    expect(screen.getByLabelText("智能体权限")).toBeTruthy();
  });

  it("shows a changed badge when runtime config differs from the default", () => {
    renderMetaBar({ accessMode: "full-access" });

    expect(screen.getByLabelText("运行配置已变更")).toBeTruthy();
  });
});
