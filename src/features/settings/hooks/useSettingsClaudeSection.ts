import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppSettings } from "@/types";
import { normalizeCodexArgsInput } from "@/utils/codexArgsInput";

type UseSettingsClaudeSectionArgs = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

export type SettingsClaudeSectionProps = {
  appSettings: AppSettings;
  claudePathDraft: string;
  claudeArgsDraft: string;
  claudePermissionModeDraft: string;
  claudeDirty: boolean;
  isSavingSettings: boolean;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onSetClaudePathDraft: Dispatch<SetStateAction<string>>;
  onSetClaudeArgsDraft: Dispatch<SetStateAction<string>>;
  onSetClaudePermissionModeDraft: Dispatch<SetStateAction<string>>;
  onSaveClaudeSettings: () => Promise<void>;
};

/**
 * Claude 设置分区的草稿状态控制器。
 *
 * `appSettings`：当前应用设置。
 * `onUpdateAppSettings`：设置保存方法。
 */
export function useSettingsClaudeSection({
  appSettings,
  onUpdateAppSettings,
}: UseSettingsClaudeSectionArgs): SettingsClaudeSectionProps {
  const [claudePathDraft, setClaudePathDraft] = useState(
    appSettings.claudeBin ?? "",
  );
  const [claudeArgsDraft, setClaudeArgsDraft] = useState(
    appSettings.claudeArgs ?? "",
  );
  const [claudePermissionModeDraft, setClaudePermissionModeDraft] = useState(
    appSettings.claudePermissionMode ?? "default",
  );
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  useEffect(() => {
    setClaudePathDraft(appSettings.claudeBin ?? "");
  }, [appSettings.claudeBin]);

  useEffect(() => {
    setClaudeArgsDraft(appSettings.claudeArgs ?? "");
  }, [appSettings.claudeArgs]);

  useEffect(() => {
    setClaudePermissionModeDraft(appSettings.claudePermissionMode ?? "default");
  }, [appSettings.claudePermissionMode]);

  const nextClaudeBin = useMemo(
    () => (claudePathDraft.trim() ? claudePathDraft.trim() : null),
    [claudePathDraft],
  );
  const nextClaudeArgs = useMemo(
    () => normalizeCodexArgsInput(claudeArgsDraft),
    [claudeArgsDraft],
  );
  const nextClaudePermissionMode = useMemo(
    () =>
      claudePermissionModeDraft.trim()
        ? claudePermissionModeDraft.trim()
        : null,
    [claudePermissionModeDraft],
  );
  const claudeDirty =
    nextClaudeBin !== (appSettings.claudeBin ?? null) ||
    nextClaudeArgs !== (appSettings.claudeArgs ?? null) ||
    nextClaudePermissionMode !== (appSettings.claudePermissionMode ?? null);

  const handleSaveClaudeSettings = async () => {
    setIsSavingSettings(true);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        claudeBin: nextClaudeBin,
        claudeArgs: nextClaudeArgs,
        claudePermissionMode: nextClaudePermissionMode,
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  return {
    appSettings,
    claudePathDraft,
    claudeArgsDraft,
    claudePermissionModeDraft,
    claudeDirty,
    isSavingSettings,
    onUpdateAppSettings,
    onSetClaudePathDraft: setClaudePathDraft,
    onSetClaudeArgsDraft: setClaudeArgsDraft,
    onSetClaudePermissionModeDraft: setClaudePermissionModeDraft,
    onSaveClaudeSettings: handleSaveClaudeSettings,
  };
}
