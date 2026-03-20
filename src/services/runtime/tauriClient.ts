import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  TAURI_RUNTIME_CAPABILITIES,
  type RuntimeCapabilities,
} from "./capabilities";
import type { RuntimeEventName, RuntimeSubscribeOptions } from "./events";

export type RuntimeUnsubscribe = () => void;

export type RuntimeClient = {
  kind: "tauri" | "web";
  getCapabilities: () => RuntimeCapabilities;
  invoke: <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => Promise<T>;
  subscribe: <T>(
    eventName: RuntimeEventName,
    onEvent: (payload: T) => void,
    options?: RuntimeSubscribeOptions,
  ) => Promise<RuntimeUnsubscribe>;
};

/**
 * 判断当前是否运行在 Tauri 宿主中。
 *
 * 无入参，返回 `true` 表示当前可使用 Tauri 原生桥接。
 */
export function canUseTauriRuntime(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export const tauriRuntimeClient: RuntimeClient = {
  kind: "tauri",
  getCapabilities: () => TAURI_RUNTIME_CAPABILITIES,
  invoke: (command, args) =>
    args === undefined ? tauriInvoke(command) : tauriInvoke(command, args),
  subscribe: async <T,>(
    eventName: RuntimeEventName,
    onEvent: (payload: T) => void,
    options?: RuntimeSubscribeOptions,
  ) => {
    try {
      return await listen<T>(eventName, (event) => {
        onEvent(event.payload);
      });
    } catch (error) {
      options?.onError?.(error);
      throw error;
    }
  },
};
