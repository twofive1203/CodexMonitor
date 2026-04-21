import type { RefCallback } from "react";
import type { TerminalStatus } from "../../../types";

type TerminalPanelProps = {
  containerRef: RefCallback<HTMLDivElement>;
  status: TerminalStatus;
  message: string;
};

/**
 * 终端展示面板，负责提供 xterm 容器和状态覆盖层。
 * @param containerRef 终端容器挂载回调。
 * @param status 当前终端状态。
 * @param message 终端状态提示文案。
 */
export function TerminalPanel({ containerRef, status, message }: TerminalPanelProps) {
  return (
    <div className="terminal-shell">
      <div ref={containerRef} className="terminal-surface" />
      {status !== "ready" && (
        <div className="terminal-overlay">
          <div className="terminal-status">{message}</div>
        </div>
      )}
    </div>
  );
}
