import { useEffect, useRef } from "react";
import { subscribeAppServerEvents } from "../../../services/events";
import {
  getAppServerParams,
  getAppServerRawMethod,
} from "../../../utils/appServerEvents";
import {
  METHODS_ROUTED_IN_USE_APP_SERVER_EVENTS,
  routeAppServerEvent,
} from "./appServerEventRouting/routes";
import type { AppServerEventHandlers } from "./appServerEventRouting/types";

export { METHODS_ROUTED_IN_USE_APP_SERVER_EVENTS };
export type { AppServerEventHandlers };

/**
 * 方法说明：订阅 app-server 事件，并交给路由表解析分发。
 * 入参说明：handlers 为各业务域注册的事件回调集合。
 */
export function useAppServerEvents(handlers: AppServerEventHandlers) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const unlisten = subscribeAppServerEvents((payload) => {
      const currentHandlers = handlersRef.current;
      currentHandlers.onAppServerEvent?.(payload);

      const method = getAppServerRawMethod(payload);
      if (!method) {
        return;
      }

      routeAppServerEvent(
        payload.workspace_id,
        method,
        getAppServerParams(payload),
        currentHandlers,
        payload,
      );
    });

    return () => {
      unlisten();
    };
  }, []);
}
