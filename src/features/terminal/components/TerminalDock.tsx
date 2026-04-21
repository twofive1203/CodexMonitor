import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { TerminalTab } from "../hooks/useTerminalTabs";

type TerminalDockProps = {
  isOpen: boolean;
  terminals: TerminalTab[];
  activeTerminalId: string | null;
  onSelectTerminal: (terminalId: string) => void;
  onNewTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
  onResizeStart?: (event: ReactMouseEvent) => void;
  terminalNode: ReactNode;
  variant?: "dock" | "full";
};

/**
 * 终端容器，负责渲染标签页、创建/关闭操作以及终端内容区域。
 * @param isOpen 是否显示终端容器。
 * @param terminals 当前工作区的终端标签页集合。
 * @param activeTerminalId 当前激活的终端标签页 ID。
 * @param onSelectTerminal 选择终端标签页时的回调。
 * @param onNewTerminal 新建终端时的回调。
 * @param onCloseTerminal 关闭终端时的回调。
 * @param onResizeStart 开始拖拽调整终端高度时的回调，仅停靠模式使用。
 * @param terminalNode 终端主体节点。
 * @param variant 终端展示模式，`dock` 为桌面停靠，`full` 为紧凑布局全页展示。
 */
export function TerminalDock({
  isOpen,
  terminals,
  activeTerminalId,
  onSelectTerminal,
  onNewTerminal,
  onCloseTerminal,
  onResizeStart,
  terminalNode,
  variant = "dock",
}: TerminalDockProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <section className={`terminal-panel${variant === "full" ? " terminal-panel--full" : ""}`}>
      {variant === "dock" && onResizeStart && (
        <div
          className="terminal-panel-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整终端面板大小"
          onMouseDown={onResizeStart}
        />
      )}
      <div className="terminal-header">
        <div className="terminal-tabs" role="tablist" aria-label="终端标签页">
          {terminals.map((tab) => (
            <button
              key={tab.id}
              className={`terminal-tab${
                tab.id === activeTerminalId ? " active" : ""
              }`}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTerminalId}
              onClick={() => onSelectTerminal(tab.id)}
            >
              <span className="terminal-tab-label">{tab.title}</span>
              <span
                className="terminal-tab-close"
                role="button"
                aria-label={`关闭 ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTerminal(tab.id);
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button
            className="terminal-tab-add"
            type="button"
            onClick={onNewTerminal}
            aria-label="新建终端"
            title="新建终端"
          >
            +
          </button>
        </div>
      </div>
      <div className="terminal-body">{terminalNode}</div>
    </section>
  );
}
