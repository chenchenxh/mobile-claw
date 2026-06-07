import type { AuthMode, ProviderType } from "../../types/contracts.ts";

export interface ProviderSpec {
  id: string;
  type: ProviderType;
  displayName: string;
  authModes: AuthMode[];
  defaultApiBase?: string;
  visibleInSettings?: boolean;
}

export const PROVIDER_SPECS: ProviderSpec[] = [
  {
    id: "deepseek",
    type: "deepseek",
    displayName: "DeepSeek API Key",
    authModes: ["BYOK"],
    defaultApiBase: "https://api.deepseek.com",
    visibleInSettings: true
  },
  {
    id: "minimax",
    type: "minimax",
    displayName: "MiniMax API Key",
    authModes: ["BYOK"],
    defaultApiBase: "https://api.minimax.io/anthropic",
    visibleInSettings: true
  }
];

export function getProviderSpec(providerId: string): ProviderSpec | undefined {
  return PROVIDER_SPECS.find((p) => p.id === providerId);
}

export function listVisibleProviderSpecs(): ProviderSpec[] {
  return PROVIDER_SPECS.filter((p) => p.visibleInSettings);
}
