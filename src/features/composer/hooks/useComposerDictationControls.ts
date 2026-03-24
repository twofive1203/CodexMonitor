import { useCallback } from "react";

type DictationState = "idle" | "listening" | "processing";

type UseComposerDictationControlsArgs = {
  disabled: boolean;
  dictationEnabled: boolean;
  dictationState: DictationState;
  onToggleDictation?: () => void;
  onCancelDictation?: () => void;
  onOpenDictationSettings?: () => void;
};

export function useComposerDictationControls({
  disabled,
  dictationEnabled,
  dictationState,
  onToggleDictation,
  onCancelDictation,
  onOpenDictationSettings,
}: UseComposerDictationControlsArgs) {
  const isDictating = dictationState === "listening";
  const isDictationProcessing = dictationState === "processing";
  const isDictationBusy = dictationState !== "idle";
  const allowOpenDictationSettings = Boolean(
    onOpenDictationSettings && !dictationEnabled && !disabled && !isDictationProcessing,
  );
  const micDisabled =
    disabled ||
    (!allowOpenDictationSettings &&
      (isDictationProcessing ? !onCancelDictation : !dictationEnabled || !onToggleDictation));
  const micAriaLabel = allowOpenDictationSettings
    ? "打开听写设置"
    : isDictationProcessing
      ? "取消转写"
      : isDictating
        ? "停止听写"
        : "开始听写";
  const micTitle = allowOpenDictationSettings
    ? "听写已禁用，打开设置"
    : isDictationProcessing
      ? "取消转写"
      : isDictating
        ? "停止听写"
        : "开始听写";

  const handleMicClick = useCallback(() => {
    if (isDictationProcessing) {
      if (disabled || !onCancelDictation) {
        return;
      }
      onCancelDictation();
      return;
    }
    if (allowOpenDictationSettings) {
      onOpenDictationSettings?.();
      return;
    }
    if (!onToggleDictation || micDisabled) {
      return;
    }
    onToggleDictation();
  }, [
    allowOpenDictationSettings,
    disabled,
    isDictationProcessing,
    micDisabled,
    onCancelDictation,
    onOpenDictationSettings,
    onToggleDictation,
  ]);

  return {
    allowOpenDictationSettings,
    handleMicClick,
    isDictating,
    isDictationBusy,
    isDictationProcessing,
    micAriaLabel,
    micDisabled,
    micTitle,
  };
}
