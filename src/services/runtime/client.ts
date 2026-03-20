import type { RuntimeCapabilities, RuntimeKind } from "./capabilities";
import { canUseTauriRuntime, tauriRuntimeClient, type RuntimeClient } from "./tauriClient";
import { webRuntimeClient } from "./webClient";

/**
 * 返回当前前端运行时类型。
 *
 * 无入参，返回 `tauri` 或 `web`。
 */
export function getRuntimeKind(): RuntimeKind {
  return canUseTauriRuntime() ? "tauri" : "web";
}

/**
 * 返回当前运行时客户端。
 *
 * 无入参，内部会根据宿主环境自动选择 Tauri 或 Web 实现。
 */
export function getRuntimeClient(): RuntimeClient {
  return getRuntimeKind() === "tauri" ? tauriRuntimeClient : webRuntimeClient;
}

/**
 * 判断当前是否为纯 Web runtime。
 *
 * 无入参，返回 `true` 表示当前运行在浏览器中。
 */
export function isWebRuntime() {
  return getRuntimeKind() === "web";
}

/**
 * 返回当前运行时能力集合。
 *
 * 无入参，能力值用于统一控制 Web 不支持的入口。
 */
export function getRuntimeCapabilities(): RuntimeCapabilities {
  return getRuntimeClient().getCapabilities();
}
