import { useCallback, useRef, useState } from "react";
import type { DebugEntry } from "../../../types";

const MAX_DEBUG_ENTRIES = 200;
const MAX_DEBUG_STRING_CHARS = 4000;
const MAX_DEBUG_ARRAY_ITEMS = 8;
const MAX_DEBUG_OBJECT_KEYS = 24;
const MAX_DEBUG_DEPTH = 4;

/**
 * 截断调试日志中的长文本，避免大响应长期驻留在 WebView 内存。
 *
 * @param value 原始文本。
 */
function trimDebugString(value: string) {
  if (value.length <= MAX_DEBUG_STRING_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_DEBUG_STRING_CHARS)}... [已截断 ${value.length - MAX_DEBUG_STRING_CHARS} 字符]`;
}

/**
 * 递归摘要调试 payload，并断开对原始大对象的引用。
 *
 * @param payload 需要写入调试面板的原始 payload。
 * @param depth 当前递归深度。
 * @param seen 已访问对象集合，用于处理循环引用。
 */
function summarizePayload(
  payload: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof payload === "string") {
    return trimDebugString(payload);
  }
  if (Array.isArray(payload)) {
    return {
      _type: "array",
      count: payload.length,
      sample: payload
        .slice(0, MAX_DEBUG_ARRAY_ITEMS)
        .map((entry) => summarizePayload(entry, depth + 1, seen)),
    };
  }
  if (payload && typeof payload === "object") {
    if (seen.has(payload)) {
      return "[Circular]";
    }
    seen.add(payload);
    const obj = payload as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (depth >= MAX_DEBUG_DEPTH) {
      return { _type: "object", keys: keys.slice(0, MAX_DEBUG_OBJECT_KEYS) };
    }
    const summarized: Record<string, unknown> = {};
    for (const key of keys.slice(0, MAX_DEBUG_OBJECT_KEYS)) {
      summarized[key] = summarizePayload(obj[key], depth + 1, seen);
    }
    if (keys.length > MAX_DEBUG_OBJECT_KEYS) {
      summarized._truncatedKeys = keys.length - MAX_DEBUG_OBJECT_KEYS;
    }
    return summarized;
  }
  return payload;
}

export function useDebugLog() {
  const [debugOpen, setDebugOpenState] = useState(false);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [hasDebugAlerts, setHasDebugAlerts] = useState(false);
  const [debugPinned, setDebugPinned] = useState(false);
  const debugOpenRef = useRef(debugOpen);
  debugOpenRef.current = debugOpen;

  const isAlertEntry = useCallback((entry: DebugEntry) => {
    if (entry.source === "error" || entry.source === "stderr") {
      return true;
    }
    const label = entry.label.toLowerCase();
    if (label.includes("warn") || label.includes("warning")) {
      return true;
    }
    if (typeof entry.payload === "string") {
      const payload = entry.payload.toLowerCase();
      return payload.includes("warn") || payload.includes("warning");
    }
    return false;
  }, []);

  const addDebugEntry = useCallback(
    (entry: DebugEntry) => {
      const isAlert = isAlertEntry(entry);
      if (!debugOpenRef.current && !isAlert) {
        return;
      }
      if (isAlert) {
        setHasDebugAlerts(true);
      }
      const compactEntry = { ...entry, payload: summarizePayload(entry.payload) };
      setDebugEntries((prev) => [...prev, compactEntry].slice(-MAX_DEBUG_ENTRIES));
    },
    [isAlertEntry],
  );

  const handleCopyDebug = useCallback(async () => {
    const text = debugEntries
      .map((entry) => {
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        const payload =
          entry.payload !== undefined
            ? typeof entry.payload === "string"
              ? entry.payload
              : JSON.stringify(entry.payload, null, 2)
            : "";
        return [entry.source.toUpperCase(), timestamp, entry.label, payload]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
    if (text) {
      await navigator.clipboard.writeText(text);
    }
  }, [debugEntries]);

  const clearDebugEntries = useCallback(() => {
    setDebugEntries([]);
    setHasDebugAlerts(false);
  }, []);

  const setDebugOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setDebugOpenState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        if (resolved) {
          setDebugPinned(true);
        }
        return resolved;
      });
    },
    [],
  );

  const showDebugButton = hasDebugAlerts || debugOpen || debugPinned;

  return {
    debugOpen,
    setDebugOpen,
    debugEntries,
    hasDebugAlerts,
    showDebugButton,
    addDebugEntry,
    handleCopyDebug,
    clearDebugEntries,
  };
}
