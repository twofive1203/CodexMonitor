// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTransparencyPreference } from "./useTransparencyPreference";

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

const navigatorWithUserAgentData = navigator as NavigatorWithUserAgentData;
const originalUserAgentData = navigatorWithUserAgentData.userAgentData;

/**
 * 模拟当前测试使用的平台。
 * @param platform 平台名称。
 */
function mockPlatform(platform: string) {
  Object.defineProperty(navigatorWithUserAgentData, "userAgentData", {
    value: { platform },
    configurable: true,
  });
}

describe("useTransparencyPreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(navigatorWithUserAgentData, "userAgentData", {
      value: originalUserAgentData,
      configurable: true,
    });
  });

  it("defaults to reduced transparency on Windows when unset", () => {
    mockPlatform("Windows");

    const { result } = renderHook(() =>
      useTransparencyPreference("reduceTransparency-test"),
    );

    expect(result.current.reduceTransparency).toBe(true);
  });

  it("keeps stored preferences higher priority than platform defaults", () => {
    mockPlatform("Windows");
    localStorage.setItem("reduceTransparency-test", "false");

    const { result } = renderHook(() =>
      useTransparencyPreference("reduceTransparency-test"),
    );

    expect(result.current.reduceTransparency).toBe(false);
  });
});
