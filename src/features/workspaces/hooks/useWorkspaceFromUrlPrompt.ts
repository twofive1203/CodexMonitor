import { useCallback, useMemo, useState } from "react";
import type { AgentProvider } from "@/types";
import { pickWorkspacePath } from "@services/tauri";

type WorkspaceFromUrlPromptState = {
  url: string;
  destinationPath: string;
  targetFolderName: string;
  provider: AgentProvider;
  error: string | null;
  isSubmitting: boolean;
} | null;

type UseWorkspaceFromUrlPromptOptions = {
  defaultProvider: AgentProvider;
  onSubmit: (
    url: string,
    destinationPath: string,
    targetFolderName?: string | null,
    provider?: AgentProvider | null,
  ) => Promise<void>;
};

export function useWorkspaceFromUrlPrompt({
  defaultProvider,
  onSubmit,
}: UseWorkspaceFromUrlPromptOptions) {
  const [prompt, setPrompt] = useState<WorkspaceFromUrlPromptState>(null);

  const openPrompt = useCallback(() => {
    setPrompt({
      url: "",
      destinationPath: "",
      targetFolderName: "",
      provider: defaultProvider,
      error: null,
      isSubmitting: false,
    });
  }, [defaultProvider]);

  const closePrompt = useCallback(() => {
    setPrompt(null);
  }, []);

  const canSubmit = useMemo(() => {
    if (!prompt) {
      return false;
    }
    return prompt.url.trim().length > 0 && prompt.destinationPath.trim().length > 0;
  }, [prompt]);

  const chooseDestinationPath = useCallback(async () => {
    const selected = await pickWorkspacePath();
    if (!selected) {
      return;
    }
    setPrompt((prev) => (prev ? { ...prev, destinationPath: selected, error: null } : prev));
  }, []);

  const submitPrompt = useCallback(async () => {
    if (!prompt || prompt.isSubmitting) {
      return;
    }
    const url = prompt.url.trim();
    const destinationPath = prompt.destinationPath.trim();
    const targetFolderName = prompt.targetFolderName.trim() || null;

    if (!url) {
      setPrompt((prev) => (prev ? { ...prev, error: "必须填写远程 Git 地址。" } : prev));
      return;
    }
    if (!destinationPath) {
      setPrompt((prev) => (prev ? { ...prev, error: "必须选择目标目录。" } : prev));
      return;
    }

    setPrompt((prev) => (prev ? { ...prev, isSubmitting: true, error: null } : prev));
    try {
      await onSubmit(url, destinationPath, targetFolderName, prompt.provider);
      setPrompt(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPrompt((prev) => (prev ? { ...prev, isSubmitting: false, error: message } : prev));
    }
  }, [onSubmit, prompt]);

  return {
    workspaceFromUrlPrompt: prompt,
    openWorkspaceFromUrlPrompt: openPrompt,
    closeWorkspaceFromUrlPrompt: closePrompt,
    chooseWorkspaceFromUrlDestinationPath: chooseDestinationPath,
    submitWorkspaceFromUrlPrompt: submitPrompt,
    updateWorkspaceFromUrlUrl: (url: string) =>
      setPrompt((prev) => (prev ? { ...prev, url, error: null } : prev)),
    updateWorkspaceFromUrlTargetFolderName: (targetFolderName: string) =>
      setPrompt((prev) => (prev ? { ...prev, targetFolderName, error: null } : prev)),
    updateWorkspaceFromUrlProvider: (provider: AgentProvider) =>
      setPrompt((prev) => (prev ? { ...prev, provider, error: null } : prev)),
    clearWorkspaceFromUrlDestinationPath: () =>
      setPrompt((prev) => (prev ? { ...prev, destinationPath: "", error: null } : prev)),
    canSubmitWorkspaceFromUrlPrompt: canSubmit,
  };
}
