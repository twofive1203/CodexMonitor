// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerMetaBar } from "./ComposerMetaBar";

afterEach(() => {
  cleanup();
});

/**
 * 渲染输入栏元信息测试实例。
 * @param overrides 需要覆盖的组件属性。
 */
function renderMetaBar(
  overrides: Partial<Parameters<typeof ComposerMetaBar>[0]> = {},
) {
  return render(
    <ComposerMetaBar
      disabled={false}
      collaborationModes={[]}
      selectedCollaborationModeId={null}
      onSelectCollaborationMode={vi.fn()}
      models={[
        { id: "gpt-5.5", displayName: "GPT-5.5", model: "gpt-5.5" },
        { id: "gpt-5.4", displayName: "GPT-5.4", model: "gpt-5.4" },
      ]}
      selectedModelId="gpt-5.5"
      onSelectModel={vi.fn()}
      reasoningOptions={["low", "high"]}
      selectedEffort="high"
      onSelectEffort={vi.fn()}
      selectedServiceTier={null}
      reasoningSupported={true}
      accessMode="current"
      onSelectAccessMode={vi.fn()}
      contextUsage={null}
      {...overrides}
    />,
  );
}

describe("ComposerMetaBar", () => {
  it("renders legacy inline run controls without the collapsed runtime panel", () => {
    renderMetaBar();

    expect(screen.queryByRole("button", { name: "运行配置" })).toBeNull();
    expect(screen.getByLabelText("模型")).toBeTruthy();
    expect(screen.getByLabelText("思考模式")).toBeTruthy();
    expect(screen.getByLabelText("智能体权限")).toBeTruthy();
  });

  it("forwards legacy run control changes", () => {
    const onSelectModel = vi.fn();
    const onSelectEffort = vi.fn();
    const onSelectAccessMode = vi.fn();

    renderMetaBar({
      onSelectModel,
      onSelectEffort,
      onSelectAccessMode,
    });

    fireEvent.change(screen.getByLabelText("模型"), {
      target: { value: "gpt-5.4" },
    });
    fireEvent.change(screen.getByLabelText("思考模式"), {
      target: { value: "low" },
    });
    fireEvent.change(screen.getByLabelText("智能体权限"), {
      target: { value: "full-access" },
    });

    expect(onSelectModel).toHaveBeenCalledWith("gpt-5.4");
    expect(onSelectEffort).toHaveBeenCalledWith("low");
    expect(onSelectAccessMode).toHaveBeenCalledWith("full-access");
  });

  it("shows context remaining status", () => {
    renderMetaBar({
      contextUsage: {
        last: {
          totalTokens: 15,
          inputTokens: 10,
          cachedInputTokens: 0,
          outputTokens: 5,
          reasoningOutputTokens: 0,
        },
        total: {
          totalTokens: 150,
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 50,
          reasoningOutputTokens: 0,
        },
        modelContextWindow: 300,
      },
    });

    expect(screen.getByLabelText("剩余上下文 95%")).toBeTruthy();
  });

  it("shows the legacy fast-mode indicator beside the model control", () => {
    renderMetaBar({ selectedServiceTier: "fast" });

    expect(screen.getByLabelText("快速模式已开启")).toBeTruthy();
  });
});
