// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePanelVisibility } from "./usePanelVisibility";

describe("usePanelVisibility", () => {
  it("keeps debug panel closed when debug logs are disabled", () => {
    const setActiveTab = vi.fn();
    const setDebugOpen = vi.fn();
    const { result } = renderHook(() =>
      usePanelVisibility({
        debugLogEnabled: false,
        isCompact: false,
        activeWorkspaceId: "workspace-1",
        setActiveTab,
        setDebugOpen,
      }),
    );

    act(() => {
      result.current.onToggleDebug();
    });

    expect(setDebugOpen).toHaveBeenCalledWith(false);
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it("keeps compact log tab inaccessible when debug logs are disabled", () => {
    const setActiveTab = vi.fn();
    const setDebugOpen = vi.fn();
    const { result } = renderHook(() =>
      usePanelVisibility({
        debugLogEnabled: false,
        isCompact: true,
        activeWorkspaceId: "workspace-1",
        setActiveTab,
        setDebugOpen,
      }),
    );

    act(() => {
      result.current.onToggleDebug();
    });

    expect(setDebugOpen).toHaveBeenCalledWith(false);
    expect(setActiveTab).not.toHaveBeenCalled();
  });
});
