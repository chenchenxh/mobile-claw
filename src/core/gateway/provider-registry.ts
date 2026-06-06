import type { AuthMode, OAuthClientConfig, ProviderType } from "../../types/contracts.ts";

export interface ProviderSpec {
  id: string;
  type: ProviderType;
  displayName: string;
  authModes: AuthMode[];
  defaultApiBase?: string;
  visibleInSettings?: boolean;
  oauthPreset?: OAuthClientConfig;
}

const REDIRECT_URI = "mobileclaw://oauth";

export const PROVIDER_SPECS: ProviderSpec[] = [
  {
    id: "openai",
    type: "openai",
    displayName: "OpenAI",
    authModes: ["BYOK", "OAUTH"],
    defaultApiBase: "https://api.openai.com/v1",
    visibleInSettings: true,
    oauthPreset: {
      clientId: "mobileclaw_openai_public",
      authEndpoint: "https://auth.openai.com/oauth/authorize",
      tokenEndpoint: "https://auth.openai.com/oauth/token",
      scopes: ["openid", "profile"],
      redirectUri: REDIRECT_URI
    }
  },
  {
    id: "minimax",
    type: "minimax",
    displayName: "MiniMax",
    authModes: ["BYOK", "OAUTH"],
    // Align OpenClaw default MiniMax API path.
    defaultApiBase: "https://api.minimax.io/anthropic",
    visibleInSettings: true,
    oauthPreset: {
      // Align OpenClaw MiniMax OAuth defaults (device-code flow, global endpoint).
      clientId: "78257093-7e40-4613-99e0-527b14b39113",
      authEndpoint: "https://api.minimax.io/oauth/code",
      tokenEndpoint: "https://api.minimax.io/oauth/token",
      apiBaseUrl: "https://api.minimax.io/anthropic",
      scopes: ["group_id", "profile", "model.completion"],
      redirectUri: REDIRECT_URI
    }
  },
  {
    id: "google",
    type: "google",
    displayName: "Google Gemini (Legacy)",
    authModes: ["BYOK", "OAUTH"],
    visibleInSettings: false
  }
];

export function getProviderSpec(providerId: string): ProviderSpec | undefined {
  return PROVIDER_SPECS.find((p) => p.id === providerId);
}

export function listVisibleProviderSpecs(): ProviderSpec[] {
  return PROVIDER_SPECS.filter((p) => p.visibleInSettings);
}
