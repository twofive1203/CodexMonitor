import { useCallback, useEffect } from "react";
import { subscribeMenuComposerCycleCollaboration } from "@services/events";
import { matchesShortcut } from "@utils/shortcuts";
import { useTauriEvent } from "../../app/hooks/useTauriEvent";

type CollaborationModeOption = { id: string; label: string };

type UseComposerCollaborationShortcutOptions = {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  shortcut: string | null;
  collaborationModes: CollaborationModeOption[];
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
};

/**
 * 绑定输入框的协作模式切换快捷键和菜单事件。
 *
 * @param options 输入框引用、快捷键配置、协作模式列表与选择回调。
 */
export function useComposerCollaborationShortcut({
  textareaRef,
  shortcut,
  collaborationModes,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
}: UseComposerCollaborationShortcutOptions) {
  const cycleCollaborationMode = useCallback(() => {
    if (collaborationModes.length === 0) {
      return false;
    }
    const currentIndex = collaborationModes.findIndex(
      (mode) => mode.id === selectedCollaborationModeId,
    );
    const nextIndex =
      currentIndex >= 0 ? (currentIndex + 1) % collaborationModes.length : 0;
    const nextMode = collaborationModes[nextIndex];
    if (!nextMode) {
      return false;
    }
    onSelectCollaborationMode(nextMode.id);
    return true;
  }, [
    collaborationModes,
    onSelectCollaborationMode,
    selectedCollaborationModeId,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || document.activeElement !== textareaRef.current) {
        return;
      }
      if (!matchesShortcut(event, shortcut)) {
        return;
      }
      if (cycleCollaborationMode()) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cycleCollaborationMode, shortcut, textareaRef]);

  useTauriEvent(subscribeMenuComposerCycleCollaboration, () => {
    if (cycleCollaborationMode()) {
      textareaRef.current?.focus();
    }
  });
}
