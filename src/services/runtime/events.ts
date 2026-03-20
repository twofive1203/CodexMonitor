export type RuntimeEventName =
  | "app-server-event"
  | "dictation-download"
  | "dictation-event"
  | "terminal-output"
  | "terminal-exit"
  | "updater-check"
  | "tray-open-thread"
  | "menu-new-agent"
  | "menu-new-worktree-agent"
  | "menu-new-clone-agent"
  | "menu-add-workspace"
  | "menu-add-workspace-from-url"
  | "menu-open-settings"
  | "menu-toggle-projects-sidebar"
  | "menu-toggle-git-sidebar"
  | "menu-toggle-debug-panel"
  | "menu-toggle-terminal"
  | "menu-next-agent"
  | "menu-prev-agent"
  | "menu-next-workspace"
  | "menu-prev-workspace"
  | "menu-composer-cycle-model"
  | "menu-composer-cycle-access"
  | "menu-composer-cycle-reasoning"
  | "menu-composer-cycle-collaboration";

export type RuntimeSubscribeOptions = {
  onError?: (error: unknown) => void;
};
