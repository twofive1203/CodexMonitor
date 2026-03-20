export type RuntimeKind = "tauri" | "web";

export type RuntimeCapabilities = {
  kind: RuntimeKind;
  tray: boolean;
  nativeWindowControls: boolean;
  updater: boolean;
  dictation: boolean;
  revealInDir: boolean;
  openAppIcon: boolean;
  terminal: boolean;
  fileDialogs: boolean;
};

export const TAURI_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  kind: "tauri",
  tray: true,
  nativeWindowControls: true,
  updater: true,
  dictation: true,
  revealInDir: true,
  openAppIcon: true,
  terminal: true,
  fileDialogs: true,
};

export const WEB_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  kind: "web",
  tray: false,
  nativeWindowControls: false,
  updater: false,
  dictation: false,
  revealInDir: false,
  openAppIcon: false,
  terminal: false,
  fileDialogs: false,
};

type RuntimeCapabilityOverride = Partial<Omit<RuntimeCapabilities, "kind">>;

/**
 * 合并运行时能力默认值和后端覆盖值。
 *
 * `base`：当前运行时的默认能力；`override`：bootstrap 返回的能力开关。
 */
export function mergeRuntimeCapabilities(
  base: RuntimeCapabilities,
  override?: RuntimeCapabilityOverride | null,
): RuntimeCapabilities {
  if (!override) {
    return base;
  }
  return {
    ...base,
    ...override,
    kind: base.kind,
  };
}
