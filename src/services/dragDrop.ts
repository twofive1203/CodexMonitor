import { getCurrentWindow } from "@tauri-apps/api/window";

export type DragDropPayload = {
  type: "enter" | "over" | "leave" | "drop";
  position: { x: number; y: number };
  paths?: string[];
};

export type DragDropEvent = {
  payload: DragDropPayload;
};

type Listener = (event: DragDropEvent) => void;

type SubscriptionOptions = {
  onError?: (error: unknown) => void;
};

let unlisten: (() => void) | null = null;
let listenPromise: Promise<() => void> | null = null;
const listeners = new Set<Listener>();

/**
 * 启动窗口级拖拽事件订阅。
 *
 * `options`：订阅失败时的错误回调，可用于记录调试信息。
 */
function start(options?: SubscriptionOptions) {
  if (unlisten || listenPromise) {
    return;
  }
  try {
    listenPromise = getCurrentWindow().onDragDropEvent((event) => {
      for (const listener of listeners) {
        try {
          listener(event as DragDropEvent);
        } catch (error) {
          console.error("[drag-drop] listener failed", error);
        }
      }
    }) as Promise<() => void>;
  } catch (error) {
    listenPromise = null;
    options?.onError?.(error);
    return;
  }
  listenPromise
    .then((handler) => {
      listenPromise = null;
      if (listeners.size === 0) {
        handler();
        return;
      }
      unlisten = handler;
    })
    .catch((error) => {
      listenPromise = null;
      options?.onError?.(error);
    });
}

/**
 * 停止窗口级拖拽事件订阅。
 *
 * 无入参；若当前没有活跃订阅则直接忽略。
 */
function stop() {
  if (!unlisten) {
    return;
  }
  try {
    unlisten();
  } catch {
    // Ignore double-unlisten when tearing down.
  }
  unlisten = null;
}

/**
 * 订阅窗口级拖拽事件。
 *
 * `onEvent`：拖拽事件回调；`options`：订阅失败时的错误回调。
 */
export function subscribeWindowDragDrop(
  onEvent: Listener,
  options?: SubscriptionOptions,
) {
  listeners.add(onEvent);
  start(options);
  return () => {
    listeners.delete(onEvent);
    if (listeners.size === 0) {
      stop();
    }
  };
}
