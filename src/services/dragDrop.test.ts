import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentWindowMock = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => getCurrentWindowMock(),
}));

describe("dragDrop", () => {
  beforeEach(() => {
    vi.resetModules();
    getCurrentWindowMock.mockReset();
  });

  it("falls back cleanly when Tauri window metadata is unavailable", async () => {
    getCurrentWindowMock.mockImplementation(() => {
      throw new Error("tauri window unavailable");
    });
    const onError = vi.fn();
    const onEvent = vi.fn();
    const { subscribeWindowDragDrop } = await import("./dragDrop");

    const unsubscribe = subscribeWindowDragDrop(onEvent, { onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onEvent).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("forwards drag events to subscribed listeners", async () => {
    const state: { dragHandler: ((event: unknown) => void) | null } = {
      dragHandler: null,
    };
    const unlisten = vi.fn();

    getCurrentWindowMock.mockReturnValue({
      onDragDropEvent: vi.fn((handler: (event: unknown) => void) => {
        state.dragHandler = handler;
        return Promise.resolve(unlisten);
      }),
    });

    const onEvent = vi.fn();
    const { subscribeWindowDragDrop } = await import("./dragDrop");

    const unsubscribe = subscribeWindowDragDrop(onEvent);
    await Promise.resolve();
    if (state.dragHandler === null) {
      throw new Error("expected drag handler to be registered");
    }
    state.dragHandler({
      payload: {
        type: "drop",
        position: { x: 12, y: 34 },
        paths: ["C:/tmp/demo.png"],
      },
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      payload: {
        type: "drop",
        position: { x: 12, y: 34 },
        paths: ["C:/tmp/demo.png"],
      },
    });

    unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
