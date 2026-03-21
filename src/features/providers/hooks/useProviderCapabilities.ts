import { useEffect, useState } from "react";
import type { AgentProvider, ProviderCapabilities } from "@/types";
import { getProviderCapabilities } from "@services/tauri";
import {
  PROVIDER_CAPABILITY_FALLBACKS,
  resolveProviderCapabilities,
} from "@utils/agentProvider";

type ProviderCapabilitiesState = {
  capabilities: ProviderCapabilities | null;
  isLoading: boolean;
  error: string | null;
};

const capabilityCache = new Map<AgentProvider, ProviderCapabilities>();
const capabilityRequestCache = new Map<
  AgentProvider,
  Promise<ProviderCapabilities>
>();

/**
 * 读取并缓存指定 provider 的能力快照。
 *
 * `provider`：目标 provider。
 */
async function loadProviderCapabilities(
  provider: AgentProvider,
): Promise<ProviderCapabilities> {
  const cached = capabilityCache.get(provider);
  if (cached) {
    return cached;
  }
  const inFlight = capabilityRequestCache.get(provider);
  if (inFlight) {
    return inFlight;
  }
  const request = getProviderCapabilities(provider)
    .then((capabilities) => {
      capabilityCache.set(provider, capabilities);
      capabilityRequestCache.delete(provider);
      return capabilities;
    })
    .catch((error) => {
      capabilityRequestCache.delete(provider);
      throw error;
    });
  capabilityRequestCache.set(provider, request);
  return request;
}

/**
 * 读取单个 provider 的能力，并提供前端兜底值。
 *
 * `provider`：目标 provider，可为空。
 */
export function useProviderCapabilities(
  provider: AgentProvider | null | undefined,
): ProviderCapabilitiesState {
  const [state, setState] = useState<ProviderCapabilitiesState>(() => {
    if (!provider) {
      return {
        capabilities: null,
        isLoading: false,
        error: null,
      };
    }
    const cached = capabilityCache.get(provider);
    return {
      capabilities: resolveProviderCapabilities(provider, cached),
      isLoading: !cached,
      error: null,
    };
  });

  useEffect(() => {
    if (!provider) {
      setState({
        capabilities: null,
        isLoading: false,
        error: null,
      });
      return;
    }
    const cached = capabilityCache.get(provider);
    setState({
      capabilities: resolveProviderCapabilities(provider, cached),
      isLoading: !cached,
      error: null,
    });
    let canceled = false;
    void loadProviderCapabilities(provider)
      .then((capabilities) => {
        if (canceled) {
          return;
        }
        setState({
          capabilities,
          isLoading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (canceled) {
          return;
        }
        setState({
          capabilities: PROVIDER_CAPABILITY_FALLBACKS[provider],
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      canceled = true;
    };
  }, [provider]);

  return state;
}
