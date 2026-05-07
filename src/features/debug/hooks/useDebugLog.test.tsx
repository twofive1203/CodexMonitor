// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DebugEntry } from "../../../types";
import { useDebugLog } from "./useDebugLog";

/**
 * 构造调试日志 hook 测试用条目。
 *
 * @param overrides 需要覆盖的条目字段。
 */
function createDebugEntry(overrides: Partial<DebugEntry> = {}): DebugEntry {
  return {
    id: `${Date.now()}-test-debug-entry`,
    timestamp: Date.now(),
    source: "client",
    label: "test/debug",
    payload: "payload",
    ...overrides,
  };
}

describe("useDebugLog", () => {
  it("ignores debug entries and alerts when disabled", () => {
    const { result } = renderHook(() => useDebugLog(false));

    act(() => {
      result.current.addDebugEntry(
        createDebugEntry({
          source: "error",
          label: "test/warning",
        }),
      );
    });

    expect(result.current.debugEntries).toEqual([]);
    expect(result.current.hasDebugAlerts).toBe(false);
    expect(result.current.showDebugButton).toBe(false);
  });

  it("clears entries and closes the panel when disabled", () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useDebugLog(enabled),
      {
        initialProps: { enabled: true },
      },
    );

    act(() => {
      result.current.setDebugOpen(true);
    });

    act(() => {
      result.current.addDebugEntry(createDebugEntry());
      result.current.addDebugEntry(
        createDebugEntry({
          id: "alert-entry",
          source: "error",
          label: "test/error",
        }),
      );
    });

    expect(result.current.debugOpen).toBe(true);
    expect(result.current.debugEntries).toHaveLength(2);
    expect(result.current.hasDebugAlerts).toBe(true);

    rerender({ enabled: false });

    expect(result.current.debugOpen).toBe(false);
    expect(result.current.debugEntries).toEqual([]);
    expect(result.current.hasDebugAlerts).toBe(false);
    expect(result.current.showDebugButton).toBe(false);
  });

  it("keeps existing debug behavior when enabled", () => {
    const { result } = renderHook(() => useDebugLog(true));

    act(() => {
      result.current.addDebugEntry(createDebugEntry());
    });

    expect(result.current.debugEntries).toEqual([]);

    act(() => {
      result.current.addDebugEntry(
        createDebugEntry({
          source: "error",
          label: "test/error",
        }),
      );
    });

    expect(result.current.debugEntries).toHaveLength(1);
    expect(result.current.hasDebugAlerts).toBe(true);
    expect(result.current.showDebugButton).toBe(true);
  });
});
