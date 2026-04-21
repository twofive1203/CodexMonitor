import type { ReactNode } from "react";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import MessagesSquare from "lucide-react/dist/esm/icons/messages-square";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";

type TabletNavTab = "codex" | "git" | "log";

type TabletNavProps = {
  activeTab: TabletNavTab;
  onSelect: (tab: TabletNavTab) => void;
  terminalTabLabel?: string;
};

/**
 * 平板侧边导航，负责在会话、Git 与终端/日志面板之间切换。
 * @param activeTab 当前激活页签。
 * @param onSelect 切换页签时的回调。
 * @param terminalTabLabel 终端页签文案；不支持终端时可退回“日志”。
 */
export function TabletNav({
  activeTab,
  onSelect,
  terminalTabLabel = "日志",
}: TabletNavProps) {
  const tabs: { id: TabletNavTab; label: string; icon: ReactNode }[] = [
    { id: "codex", label: "Codex", icon: <MessagesSquare className="tablet-nav-icon" /> },
    { id: "git", label: "Git", icon: <GitBranch className="tablet-nav-icon" /> },
    { id: "log", label: terminalTabLabel, icon: <TerminalSquare className="tablet-nav-icon" /> },
  ];

  return (
    <nav className="tablet-nav" aria-label="项目">
      <div className="tablet-nav-group">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tablet-nav-item ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => onSelect(tab.id)}
            aria-current={activeTab === tab.id ? "page" : undefined}
          >
            {tab.icon}
            <span className="tablet-nav-label">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
