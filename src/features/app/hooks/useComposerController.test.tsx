// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import {
  COMPOSER_DRAFTS_STORAGE_KEY,
  readStoredDraft,
} from "../../composer/utils/draftStorage";
import { useComposerController } from "./useComposerController";

const useComposerImagesMock = vi.fn();
const useQueuedSendMock = vi.fn();

vi.mock("../../composer/hooks/useComposerImages", () => ({
  useComposerImages: (args: unknown) => useComposerImagesMock(args),
}));

vi.mock("../../threads/hooks/useQueuedSend", () => ({
  useQueuedSend: (args: unknown) => useQueuedSendMock(args),
}));

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Project",
  path: "/tmp/project",
  connected: true,
  kind: "main",
  settings: { sidebarCollapsed: false },
};

function buildControllerArgs(
  overrides?: Partial<Parameters<typeof useComposerController>[0]>,
): Parameters<typeof useComposerController>[0] {
  return {
    activeThreadId: "thread-1",
    activeTurnId: null,
    activeWorkspaceId: workspace.id,
    activeWorkspace: workspace,
    isProcessing: false,
    isReviewing: false,
    queueFlushPaused: false,
    steerEnabled: true,
    followUpMessageBehavior: "queue" as const,
    appsEnabled: false,
    connectWorkspace: vi.fn(async () => undefined),
    startThreadForWorkspace: vi.fn(async () => null),
    sendUserMessage: vi.fn(async () => ({ status: "sent" as const })),
    sendUserMessageToThread: vi.fn(async () => undefined),
    startFork: vi.fn(async () => undefined),
    startReview: vi.fn(async () => undefined),
    startResume: vi.fn(async () => undefined),
    startCompact: vi.fn(async () => undefined),
    startApps: vi.fn(async () => undefined),
    startMcp: vi.fn(async () => undefined),
    startFast: vi.fn(async () => undefined),
    startStatus: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("useComposerController", () => {
  beforeEach(() => {
    localStorage.clear();
    useComposerImagesMock.mockReset();
    useQueuedSendMock.mockReset();
    useComposerImagesMock.mockReturnValue({
      activeImages: [],
      attachImages: vi.fn(),
      pickImages: vi.fn(),
      removeImage: vi.fn(),
      clearActiveImages: vi.fn(),
      setImagesForThread: vi.fn(),
      removeImagesForThread: vi.fn(),
    });
    useQueuedSendMock.mockReturnValue({
      activeQueue: [],
      handleSend: vi.fn(),
      queueMessage: vi.fn(),
      removeQueuedMessage: vi.fn(),
    });
  });

  it("restores persisted thread drafts after重新挂载", () => {
    const args = buildControllerArgs();
    const first = renderHook(() => useComposerController(args));

    act(() => {
      first.result.current.handleDraftChange("继续修这个问题");
    });

    expect(first.result.current.activeDraft).toBe("继续修这个问题");
    expect(readStoredDraft(COMPOSER_DRAFTS_STORAGE_KEY, "thread-1")).toBe(
      "继续修这个问题",
    );

    first.unmount();

    const second = renderHook(() => useComposerController(args));
    expect(second.result.current.activeDraft).toBe("继续修这个问题");
  });

  it("在新建会话阶段按工作区保存草稿", () => {
    const args = buildControllerArgs({ activeThreadId: null });
    const first = renderHook(() => useComposerController(args));

    act(() => {
      first.result.current.handleDraftChange("先记下这段提示词");
    });

    expect(readStoredDraft(COMPOSER_DRAFTS_STORAGE_KEY, "draft-ws-1")).toBe(
      "先记下这段提示词",
    );
    expect(first.result.current.activeDraft).toBe("先记下这段提示词");

    first.unmount();

    const second = renderHook(() => useComposerController(args));
    expect(second.result.current.activeDraft).toBe("先记下这段提示词");
  });
});
