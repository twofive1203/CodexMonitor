import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent } from "../types";
import {
  subscribeAppServerEvents,
  subscribeMenuNewAgent,
  subscribeTerminalOutput,
} from "./events";

const subscribeMock = vi.fn();

vi.mock("./runtime/client", () => ({
  getRuntimeClient: () => ({
    subscribe: subscribeMock,
  }),
}));

describe("events subscriptions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("delivers payloads and unsubscribes on cleanup", async () => {
    let listener: (payload: AppServerEvent) => void = () => {};
    const unlisten = vi.fn();

    subscribeMock.mockImplementation((_event, handler) => {
      listener = handler as (payload: AppServerEvent) => void;
      return Promise.resolve(unlisten);
    });

    const onEvent = vi.fn();
    const cleanup = subscribeAppServerEvents(onEvent);
    const payload: AppServerEvent = {
      workspace_id: "ws-1",
      message: { method: "ping" },
    };

    listener(payload);
    expect(onEvent).toHaveBeenCalledWith(payload);

    cleanup();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("cleans up listeners that resolve after unsubscribe", async () => {
    let resolveListener: (handler: () => void) => void = () => {};
    const unlisten = vi.fn();

    subscribeMock.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListener = resolve;
        }),
    );

    const cleanup = subscribeMenuNewAgent(() => {});
    cleanup();

    resolveListener(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("reports listen errors through options", async () => {
    const error = new Error("nope");
    subscribeMock.mockRejectedValueOnce(error);

    const onError = vi.fn();
    const cleanup = subscribeTerminalOutput(() => {}, { onError });

    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);

    cleanup();
  });

  it("fans out app-server events to multiple subscribers with one runtime subscription", async () => {
    let listener: (payload: AppServerEvent) => void = () => {};
    const unlisten = vi.fn();

    subscribeMock.mockImplementation((_event, handler) => {
      listener = handler as (payload: AppServerEvent) => void;
      return Promise.resolve(unlisten);
    });

    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const cleanupFirst = subscribeAppServerEvents(firstListener);
    const cleanupSecond = subscribeAppServerEvents(secondListener);

    expect(subscribeMock).toHaveBeenCalledTimes(1);

    const payload: AppServerEvent = {
      workspace_id: "ws-2",
      message: { method: "item/tool/requestUserInput", id: "req-1" },
    };
    listener(payload);

    expect(firstListener).toHaveBeenCalledWith(payload);
    expect(secondListener).toHaveBeenCalledWith(payload);

    cleanupFirst();
    cleanupSecond();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("continues fanout when one app-server listener throws", async () => {
    let listener: (payload: AppServerEvent) => void = () => {};
    const unlisten = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    subscribeMock.mockImplementation((_event, handler) => {
      listener = handler as (payload: AppServerEvent) => void;
      return Promise.resolve(unlisten);
    });

    const failingListener = vi.fn(() => {
      throw new Error("listener failed");
    });
    const healthyListener = vi.fn();
    const cleanupFailing = subscribeAppServerEvents(failingListener);
    const cleanupHealthy = subscribeAppServerEvents(healthyListener);

    const payload: AppServerEvent = {
      workspace_id: "ws-3",
      message: { method: "item/permissions/requestApproval", id: 7 },
    };
    listener(payload);

    expect(failingListener).toHaveBeenCalledWith(payload);
    expect(healthyListener).toHaveBeenCalledWith(payload);
    expect(errorSpy).toHaveBeenCalled();

    cleanupFailing();
    cleanupHealthy();
    errorSpy.mockRestore();
  });
});
