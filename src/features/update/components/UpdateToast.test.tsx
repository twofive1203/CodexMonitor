// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateState } from "../hooks/useUpdater";
import { UpdateToast } from "./UpdateToast";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const openUrlMock = vi.mocked(openUrl);

describe("UpdateToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders available state and handles actions", () => {
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    const state: UpdateState = { stage: "available", version: "1.2.3" };

    render(
      <UpdateToast state={state} onUpdate={onUpdate} onDismiss={onDismiss} />,
    );

    const region = screen.getByRole("region");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getAllByText("更新")).toHaveLength(2);
    expect(screen.getByText("v1.2.3")).toBeTruthy();
    expect(screen.getByText("发现新版本。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "稍后" }));
    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("renders downloading state with progress", () => {
    const state: UpdateState = {
      stage: "downloading",
      progress: { totalBytes: 1000, downloadedBytes: 500 },
    };

    const { container } = render(
      <UpdateToast state={state} onUpdate={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(screen.getByText("正在下载更新...")).toBeTruthy();
    expect(screen.getByText("500 B / 1000 B")).toBeTruthy();
    const fill = container.querySelector(".update-toast-progress-fill");
    expect(fill).toBeTruthy();
    if (!fill) {
      throw new Error("Expected progress fill element");
    }
    expect(fill.getAttribute("style")).toContain("width: 50%");
  });

  it("renders error state and lets you dismiss or retry", () => {
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    const state: UpdateState = {
      stage: "error",
      error: "Network error",
    };

    render(
      <UpdateToast state={state} onUpdate={onUpdate} onDismiss={onDismiss} />,
    );

    expect(screen.getByText("更新失败。")).toBeTruthy();
    expect(screen.getByText("Network error")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("renders latest state and allows dismiss", () => {
    const onDismiss = vi.fn();
    const state: UpdateState = { stage: "latest" };

    const { container } = render(
      <UpdateToast state={state} onUpdate={vi.fn()} onDismiss={onDismiss} />,
    );
    const scoped = within(container);

    expect(scoped.getByText("当前已是最新版本。")).toBeTruthy();
    fireEvent.click(scoped.getByRole("button", { name: "关闭" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders post-update loading notice and dismisses", () => {
    const onDismissPostUpdateNotice = vi.fn();
    const state: UpdateState = { stage: "idle" };

    const { container } = render(
      <UpdateToast
        state={state}
        onUpdate={vi.fn()}
        onDismiss={vi.fn()}
        postUpdateNotice={{
          stage: "loading",
          version: "1.2.3",
          htmlUrl: "https://github.com/Dimillian/CodexMonitor/releases/tag/v1.2.3",
        }}
        onDismissPostUpdateNotice={onDismissPostUpdateNotice}
      />,
    );
    const scoped = within(container);

    expect(scoped.getByText("更新内容")).toBeTruthy();
    expect(scoped.getByText("更新成功，正在加载发布说明...")).toBeTruthy();
    fireEvent.click(scoped.getByRole("button", { name: "关闭" }));
    expect(onDismissPostUpdateNotice).toHaveBeenCalledTimes(1);
  });

  it("renders post-update release notes and opens GitHub link", () => {
    const onDismissPostUpdateNotice = vi.fn();
    const htmlUrl =
      "https://github.com/Dimillian/CodexMonitor/releases/tag/v1.2.3";
    const state: UpdateState = { stage: "idle" };

    const { container } = render(
      <UpdateToast
        state={state}
        onUpdate={vi.fn()}
        onDismiss={vi.fn()}
        postUpdateNotice={{
          stage: "ready",
          version: "1.2.3",
          body: "## Highlights\n- Added release notes toast",
          htmlUrl,
        }}
        onDismissPostUpdateNotice={onDismissPostUpdateNotice}
      />,
    );
    const scoped = within(container);

    expect(scoped.getByText("Highlights")).toBeTruthy();
    expect(scoped.getByText("Added release notes toast")).toBeTruthy();

    fireEvent.click(scoped.getByRole("button", { name: "在 GitHub 查看" }));
    expect(openUrlMock).toHaveBeenCalledWith(htmlUrl);

    fireEvent.click(scoped.getByRole("button", { name: "关闭" }));
    expect(onDismissPostUpdateNotice).toHaveBeenCalledTimes(1);
  });

  it("renders post-update fallback notice", () => {
    const htmlUrl =
      "https://github.com/Dimillian/CodexMonitor/releases/tag/v1.2.3";
    const state: UpdateState = { stage: "available", version: "9.9.9" };

    const { container } = render(
      <UpdateToast
        state={state}
        onUpdate={vi.fn()}
        onDismiss={vi.fn()}
        postUpdateNotice={{
          stage: "fallback",
          version: "1.2.3",
          htmlUrl,
        }}
      />,
    );
    const scoped = within(container);

    expect(
      scoped.getByText("已更新到 v1.2.3，暂时无法加载发布说明。"),
    ).toBeTruthy();
    fireEvent.click(scoped.getByRole("button", { name: "在 GitHub 查看" }));
    expect(openUrlMock).toHaveBeenCalledWith(htmlUrl);
    expect(scoped.queryByText("发现新版本。")).toBeNull();
  });
});
