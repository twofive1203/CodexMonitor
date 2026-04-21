import type { ReactNode } from "react";
import FolderKanban from "lucide-react/dist/esm/icons/folder-kanban";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import House from "lucide-react/dist/esm/icons/house";
import MessagesSquare from "lucide-react/dist/esm/icons/messages-square";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";

type TabKey = "home" | "projects" | "codex" | "git" | "log";

type TabBarProps = {
  activeTab: TabKey;
  onSelect: (tab: TabKey) => void;
  terminalTabLabel?: string;
};

/**
 * 紧凑布局底部导航，负责在首页、项目、会话、Git 与终端/日志之间切换。
 * @param activeTab 当前激活页签。
 * @param onSelect 切换页签时的回调。
 * @param terminalTabLabel 终端页签文案；不支持终端时可退回“日志”。
 */
export function TabBar({
  activeTab,
  onSelect,
  terminalTabLabel = "日志",
}: TabBarProps) {
  const tabs: { id: TabKey; label: string; icon: ReactNode }[] = [
    { id: "home", label: "首页", icon: <House className="tabbar-icon" /> },
    { id: "projects", label: "项目", icon: <FolderKanban className="tabbar-icon" /> },
    { id: "codex", label: "Codex", icon: <MessagesSquare className="tabbar-icon" /> },
    { id: "git", label: "Git", icon: <GitBranch className="tabbar-icon" /> },
    { id: "log", label: terminalTabLabel, icon: <TerminalSquare className="tabbar-icon" /> },
  ];

  return (
    <nav className="tabbar" aria-label="主导航">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tabbar-item ${activeTab === tab.id ? "active" : ""}`}
          onClick={() => onSelect(tab.id)}
          aria-current={activeTab === tab.id ? "page" : undefined}
        >
          {tab.icon}
          <span className="tabbar-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
