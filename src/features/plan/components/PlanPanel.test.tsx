// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanPanel } from "./PlanPanel";

describe("PlanPanel", () => {
  it("shows a waiting label while processing without a plan", () => {
    render(<PlanPanel plan={null} isProcessing />);

    expect(screen.getByText("正在等待计划...")).toBeTruthy();
  });

  it("shows an empty label when idle without a plan", () => {
    render(<PlanPanel plan={null} isProcessing={false} />);

    expect(screen.getByText("暂无进行中的计划。")).toBeTruthy();
  });
});
