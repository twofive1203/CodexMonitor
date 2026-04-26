import { useEffect, useRef } from "react";
import {
  isGlassSupported,
  setLiquidGlassEffect,
  GlassMaterialVariant,
} from "tauri-plugin-liquid-glass-api";
import { Effect, EffectState, getCurrentWindow } from "@tauri-apps/api/window";
import type { DebugEntry } from "../../../types";

type Params = {
  reduceTransparency: boolean;
  onDebug?: (entry: DebugEntry) => void;
};

/**
 * 判断当前 WebView 是否运行在 Windows。
 *
 * @param userAgent 浏览器 user agent 字符串。
 */
function isWindowsUserAgent(userAgent: string) {
  return userAgent.includes("Windows");
}

export function useLiquidGlassEffect({ reduceTransparency, onDebug }: Params) {
  const supportedRef = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const apply = async () => {
      try {
        const window = getCurrentWindow();
        if (reduceTransparency) {
          if (supportedRef.current === null) {
            supportedRef.current = await isGlassSupported();
          }
          if (supportedRef.current) {
            await setLiquidGlassEffect({ enabled: false });
          }
          await window.setEffects({ effects: [] });
          return;
        }

        if (supportedRef.current === null) {
          supportedRef.current = await isGlassSupported();
        }
        if (cancelled) {
          return;
        }
        if (supportedRef.current) {
          await window.setEffects({ effects: [] });
          await setLiquidGlassEffect({
            enabled: true,
            cornerRadius: 16,
            variant: GlassMaterialVariant.Regular,
          });
          return;
        }

        const userAgent = navigator.userAgent ?? "";
        if (isWindowsUserAgent(userAgent)) {
          // Windows WebView2 在透明窗口叠加 Acrylic 时容易出现内存持续上涨。
          await window.setEffects({ effects: [] });
          return;
        }
        const isMac = userAgent.includes("Macintosh");
        const isLinux = userAgent.includes("Linux");

        if (!isMac && !isLinux) {
          return;
        }
        await window.setEffects({
          effects: [Effect.HudWindow],
          state: EffectState.Active,
          radius: 16,
        });
      } catch (error) {
        if (cancelled || !onDebug) {
          return;
        }
        onDebug({
          id: `${Date.now()}-client-liquid-glass-error`,
          timestamp: Date.now(),
          source: "error",
          label: "liquid-glass/apply-error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void apply();

    return () => {
      cancelled = true;
      void setLiquidGlassEffect({ enabled: false }).catch(() => {});
      void getCurrentWindow().setEffects({ effects: [] }).catch(() => {});
    };
  }, [onDebug, reduceTransparency]);
}
