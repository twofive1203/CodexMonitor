import { DebugPanel } from "../../../debug/components/DebugPanel";
import { PlanPanel } from "../../../plan/components/PlanPanel";
import { TerminalDock } from "../../../terminal/components/TerminalDock";
import { TerminalPanel } from "../../../terminal/components/TerminalPanel";
import type {
  LayoutNodesResult,
  LayoutSecondarySurface,
} from "./types";

export type SecondaryLayoutNodesOptions = LayoutSecondarySurface;

type SecondaryLayoutNodes = Pick<
  LayoutNodesResult,
  | "planPanelNode"
  | "debugPanelNode"
  | "debugPanelFullNode"
  | "terminalDockNode"
  | "terminalFullNode"
  | "compactEmptyCodexNode"
  | "compactEmptyGitNode"
  | "compactEmptyTerminalNode"
  | "compactGitBackNode"
>;

/**
 * 构建右侧附属区域节点，包括计划、终端、调试和紧凑布局占位内容。
 * @param options 二级布局所需的状态与交互参数。
 */
export function buildSecondaryNodes(options: SecondaryLayoutNodesOptions): SecondaryLayoutNodes {
  const planPanelNode = <PlanPanel {...options.planPanelProps} />;

  const terminalPanelNode = options.terminalState ? (
    <TerminalPanel
      containerRef={options.terminalState.containerRef}
      status={options.terminalState.status}
      message={options.terminalState.message}
    />
  ) : null;

  const terminalDockNode = (
    <TerminalDock
      {...options.terminalDockProps}
      terminalNode={terminalPanelNode}
    />
  );
  const terminalFullNode = (
    <TerminalDock
      {...options.terminalDockProps}
      terminalNode={terminalPanelNode}
      variant="full"
    />
  );

  const debugPanelNode = <DebugPanel {...options.debugPanelProps} />;

  const debugPanelFullNode = (
    <DebugPanel
      {...options.debugPanelProps}
      isOpen
      variant="full"
    />
  );

  const compactEmptyCodexNode = (
    <div className="compact-empty">
      <h3>未选择工作区</h3>
      <p>请选择一个项目开始对话。</p>
      <button className="ghost" onClick={options.compactNavProps.onGoProjects}>
        前往项目列表
      </button>
    </div>
  );

  const compactEmptyGitNode = (
    <div className="compact-empty">
      <h3>未选择工作区</h3>
      <p>请选择一个项目查看差异。</p>
      <button className="ghost" onClick={options.compactNavProps.onGoProjects}>
        前往项目列表
      </button>
    </div>
  );
  const compactEmptyTerminalNode = (
    <div className="compact-empty">
      <h3>未选择工作区</h3>
      <p>请选择一个项目打开终端。</p>
      <button className="ghost" onClick={options.compactNavProps.onGoProjects}>
        前往项目列表
      </button>
    </div>
  );

  const compactGitDiffActive =
    options.compactNavProps.centerMode === "diff" &&
    Boolean(options.compactNavProps.selectedDiffPath);
  const compactGitBackNode = (
    <div className="compact-git-back">
      <button
        type="button"
        className={`compact-git-switch-button${compactGitDiffActive ? "" : " active"}`}
        onClick={options.compactNavProps.onBackFromDiff}
      >
        文件
      </button>
      <button
        type="button"
        className={`compact-git-switch-button${compactGitDiffActive ? " active" : ""}`}
        onClick={options.compactNavProps.onShowSelectedDiff}
        disabled={!options.compactNavProps.hasActiveGitDiffs}
      >
        差异
      </button>
    </div>
  );

  return {
    planPanelNode,
    debugPanelNode,
    debugPanelFullNode,
    terminalDockNode,
    terminalFullNode,
    compactEmptyCodexNode,
    compactEmptyGitNode,
    compactEmptyTerminalNode,
    compactGitBackNode,
  };
}
