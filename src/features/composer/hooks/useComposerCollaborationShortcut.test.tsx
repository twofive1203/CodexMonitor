// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerCollaborationShortcut } from "./useComposerCollaborationShortcut";

const subscribeMock = vi.fn();

vi.mock("@services/events", () => ({
  subscribeMenuComposerCycleCollaboration: (handler: () => void) =>
    subscribeMock(handler),
}));

function ShortcutHarness(props: {
  shortcut: string | null;
  collaborationModes: { id: string; label: string }[];
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useComposerCollaborationShortcut({
    textareaRef,
    shortcut: props.shortcut,
    collaborationModes: props.collaborationModes,
    selectedCollaborationModeId: props.selectedCollaborationModeId,
    onSelectCollaborationMode: props.onSelectCollaborationMode,
  });

  return <textarea ref={textareaRef} aria-label="prompt" />;
}

describe("useComposerCollaborationShortcut", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    subscribeMock.mockReturnValue(() => {});
  });

  beforeEach(() => {
    subscribeMock.mockReturnValue(() => {});
  });

  it("cycles collaboration mode on Shift+Tab while focused", () => {
    const onSelectCollaborationMode = vi.fn();
    const { getByLabelText } = render(
      <ShortcutHarness
        shortcut="shift+tab"
        collaborationModes={[
          { id: "default", label: "Default" },
          { id: "plan", label: "Plan" },
        ]}
        selectedCollaborationModeId="default"
        onSelectCollaborationMode={onSelectCollaborationMode}
      />,
    );

    const textarea = getByLabelText("prompt") as HTMLTextAreaElement;
    textarea.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onSelectCollaborationMode).toHaveBeenCalledWith("plan");
  });

  it("does nothing when textarea is not focused", () => {
    const onSelectCollaborationMode = vi.fn();
    render(
      <ShortcutHarness
        shortcut="shift+tab"
        collaborationModes={[
          { id: "default", label: "Default" },
          { id: "plan", label: "Plan" },
        ]}
        selectedCollaborationModeId="default"
        onSelectCollaborationMode={onSelectCollaborationMode}
      />,
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(onSelectCollaborationMode).not.toHaveBeenCalled();
  });

  it("cycles collaboration mode from menu event and focuses textarea", () => {
    let menuHandler: () => void = () => {};
    subscribeMock.mockImplementation((handler: () => void) => {
      menuHandler = handler;
      return () => {};
    });
    const onSelectCollaborationMode = vi.fn();
    const { getByLabelText } = render(
      <ShortcutHarness
        shortcut="shift+tab"
        collaborationModes={[
          { id: "default", label: "Default" },
          { id: "plan", label: "Plan" },
        ]}
        selectedCollaborationModeId="default"
        onSelectCollaborationMode={onSelectCollaborationMode}
      />,
    );

    menuHandler();

    expect(onSelectCollaborationMode).toHaveBeenCalledWith("plan");
    expect(document.activeElement).toBe(getByLabelText("prompt"));
  });
});
