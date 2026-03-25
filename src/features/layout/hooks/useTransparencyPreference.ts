import { useEffect, useState } from "react";
import { isWindowsPlatform } from "../../../utils/platformPaths";

/**
 * 读取并保存透明效果偏好。
 * @param storageKey 本地存储键。
 */
export function useTransparencyPreference(storageKey = "reduceTransparency") {
  const [reduceTransparency, setReduceTransparency] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "true") {
        return true;
      }
      if (stored === "false") {
        return false;
      }
    } catch {
      // 忽略读取异常，继续使用默认值。
    }
    return isWindowsPlatform();
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(reduceTransparency));
    } catch {
      // 忽略写入异常，避免影响界面使用。
    }
  }, [reduceTransparency, storageKey]);

  return {
    reduceTransparency,
    setReduceTransparency,
  };
}
