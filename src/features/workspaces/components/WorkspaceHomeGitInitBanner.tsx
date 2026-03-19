type WorkspaceHomeGitInitBannerProps = {
  isLoading: boolean;
  onInitGitRepo: () => void | Promise<void>;
};

export function WorkspaceHomeGitInitBanner({
  isLoading,
  onInitGitRepo,
}: WorkspaceHomeGitInitBannerProps) {
  return (
    <div className="workspace-home-git-banner" role="region" aria-label="Git 设置">
      <div className="workspace-home-git-banner-title">
        这个项目还没有初始化 Git。
      </div>
      <div className="workspace-home-git-banner-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void onInitGitRepo()}
          disabled={isLoading}
        >
          {isLoading ? "初始化中..." : "初始化 Git"}
        </button>
      </div>
    </div>
  );
}

