import { useEffect, useRef } from "react";
import { ModalShell } from "../../design-system/components/modal/ModalShell";

type WorkspaceFromUrlPromptProps = {
  url: string;
  destinationPath: string;
  targetFolderName: string;
  error: string | null;
  isBusy: boolean;
  canSubmit: boolean;
  onUrlChange: (value: string) => void;
  onTargetFolderNameChange: (value: string) => void;
  onChooseDestinationPath: () => void;
  onClearDestinationPath: () => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function WorkspaceFromUrlPrompt({
  url,
  destinationPath,
  targetFolderName,
  error,
  isBusy,
  canSubmit,
  onUrlChange,
  onTargetFolderNameChange,
  onChooseDestinationPath,
  onClearDestinationPath,
  onCancel,
  onConfirm,
}: WorkspaceFromUrlPromptProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <ModalShell
      ariaLabel="通过仓库地址添加工作区"
      className="workspace-from-url-modal"
      cardClassName="workspace-from-url-modal-card"
      onBackdropClick={() => {
        if (!isBusy) {
          onCancel();
        }
      }}
    >
      <div className="workspace-from-url-modal-content">
        <div className="ds-modal-title">通过仓库地址添加工作区</div>
        <label className="ds-modal-label" htmlFor="workspace-url-input">
          远程 Git 地址
        </label>
        <input
          id="workspace-url-input"
          ref={inputRef}
          className="ds-modal-input"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://github.com/org/repo.git"
        />
        <label className="ds-modal-label" htmlFor="workspace-url-target-name">
          目标文件夹名称（可选）
        </label>
        <input
          id="workspace-url-target-name"
          className="ds-modal-input"
          value={targetFolderName}
          onChange={(event) => onTargetFolderNameChange(event.target.value)}
          placeholder="默认使用仓库名"
        />
        <label className="ds-modal-label" htmlFor="workspace-url-destination">
          目标父目录
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            id="workspace-url-destination"
            className="ds-modal-input"
            value={destinationPath}
            placeholder="未设置"
            readOnly
            rows={1}
            wrap="off"
          />
          <button type="button" className="ghost ds-modal-button" onClick={onChooseDestinationPath}>
            选择…
          </button>
          <button
            type="button"
            className="ghost ds-modal-button"
            onClick={onClearDestinationPath}
            disabled={destinationPath.trim().length === 0 || isBusy}
          >
            清空
          </button>
        </div>
        {error && <div className="ds-modal-error">{error}</div>}
        <div className="ds-modal-actions">
          <button className="ghost ds-modal-button" onClick={onCancel} disabled={isBusy}>
            取消
          </button>
          <button
            className="primary ds-modal-button"
            onClick={onConfirm}
            disabled={isBusy || !canSubmit}
          >
            {isBusy ? "克隆中…" : "克隆并添加"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
