import { Linking, NativeModules } from "react-native";
import type { OAuthClientConfig, OAuthTokens } from "../../../src/types/contracts";
import { appLogger } from "../../../src/core/observability/app-logger";

type CredentialModule = {
  createPkce(): Promise<{ verifier: string; challenge: string }>;
};

const cred: CredentialModule | undefined = NativeModules.MobileClawCredentialModule as CredentialModule | undefined;

export interface OAuthStartResult {
  authUrl: string;
  redirectUri: string;
  state: string;
  codeVerifier: string;
}

export interface MiniMaxDeviceCodeStartResult {
  verificationUri: string;
  userCode: string;
  state: string;
  codeVerifier: string;
  intervalMs: number;
  expiresAtMs: number;
}

export async function startOAuth(config: OAuthClientConfig, providerId = "provider"): Promise<OAuthStartResult> {
  if (!cred?.createPkce) throw new Error("PKCE is unavailable (MobileClawCredentialModule.createPkce missing)");
  const pkce = await cred.createPkce();
  const state = randomState();
  try {
    // Validate base endpoint shape.
    new URL(config.authEndpoint);
  } catch {
    throw new Error("授权地址无效，请检查提供商配置");
  }
  const authUrl = buildUrlWithQuery(config.authEndpoint, {
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
    ...(config.extraAuthParams ?? {})
  });
  // Always open with system default browser to preserve login sessions.
  await Linking.openURL(authUrl);
  appLogger.info({
    module: "oauth",
    event: "open_authorize",
    message: "已拉起授权网页",
    context: { providerId, authEndpoint: config.authEndpoint, redirectUri: config.redirectUri }
  });
  return { authUrl, redirectUri: config.redirectUri, state, codeVerifier: pkce.verifier };
}

export async function startMiniMaxDeviceOAuth(
  config: OAuthClientConfig,
  providerId = "minimax"
): Promise<MiniMaxDeviceCodeStartResult> {
  if (!cred?.createPkce) throw new Error("PKCE is unavailable (MobileClawCredentialModule.createPkce missing)");
  const pkce = await cred.createPkce();
  const state = randomState();
  const body = toFormUrlEncoded({
    response_type: "code",
    client_id: config.clientId,
    scope: config.scopes.join(" "),
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state
  });
  const response = await fetch(config.authEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-request-id": randomState()
    },
    body
  });
  if (!response.ok) {
    const text = await response.text();
    const parsed = parseMiniMaxBaseResp(text);
    const detail = parsed ? `${parsed.statusCode}:${parsed.statusMsg}` : text;
    throw new Error(`MiniMax 授权初始化失败（${response.status}）${detail ? `：${detail}` : ""}`);
  }
  const payload = (await response.json()) as {
    user_code?: string;
    verification_uri?: string;
    expired_in?: number;
    interval?: number;
    state?: string;
    error?: string;
  };
  if (!payload.user_code || !payload.verification_uri) {
    throw new Error(payload.error ?? "MiniMax 授权初始化返回不完整（缺少 user_code/verification_uri）");
  }
  if (payload.state && payload.state !== state) {
    throw new Error("MiniMax 授权状态校验失败，请重试");
  }
  const verificationUri = payload.verification_uri;
  // Always open with system default browser to preserve login sessions.
  await Linking.openURL(verificationUri);
  appLogger.info({
    module: "oauth",
    event: "open_minimax_verify",
    message: "已拉起 MiniMax 授权页",
    context: { providerId, verificationUri }
  });
  const intervalMs = Math.max(2000, Number(payload.interval ?? 2000));
  const expiresAtMs = Number(payload.expired_in ?? 0);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
    throw new Error("MiniMax 授权过期时间无效，请重试");
  }
  return {
    verificationUri,
    userCode: payload.user_code,
    state,
    codeVerifier: pkce.verifier,
    intervalMs,
    expiresAtMs
  };
}

export async function waitForOAuthRedirect(redirectUri: string, expectedState: string, timeoutMs = 2 * 60_000): Promise<string> {
  const initialUrl = await Linking.getInitialURL();
  const fromInitial = initialUrl ? parseOAuthCode(initialUrl, redirectUri, expectedState) : null;
  if (fromInitial) return fromInitial;

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.remove();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("授权超时，请在授权后返回 App 并重试")));
    }, timeoutMs);

    const onUrl = (event: { url: string }) => {
      try {
        const code = parseOAuthCode(event.url, redirectUri, expectedState);
        if (!code) return;
        finish(() => resolve(code));
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    };

    const sub = Linking.addEventListener("url", onUrl);
  });
}

export async function exchangeCodeForToken(config: OAuthClientConfig, code: string, codeVerifier: string): Promise<OAuthTokens> {
  const body = toFormUrlEncoded({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier
  });

  const res = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    let detail = "";
    try {
      const payload = await res.json() as any;
      detail = payload?.error_description || payload?.error || payload?.message || "";
    } catch {
      // noop
    }
    const suffix = detail ? `：${String(detail)}` : "";
    throw new Error(`Token 交换失败（${res.status}）${suffix}`);
  }
  const json = (await res.json()) as any;
  const now = Date.now();
  const tokens = {
    accessToken: String(json.access_token ?? ""),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: json.expires_in ? now + Number(json.expires_in) * 1000 : undefined,
    resourceUrl: json.resource_url ? String(json.resource_url) : undefined
  };
  appLogger.info({
    module: "oauth",
    event: "token_exchanged",
    message: "Token 交换成功",
    context: { tokenEndpoint: config.tokenEndpoint, hasResourceUrl: Boolean(tokens.resourceUrl) }
  });
  return tokens;
}

export async function pollMiniMaxDeviceToken(params: {
  config: OAuthClientConfig;
  userCode: string;
  codeVerifier: string;
  intervalMs: number;
  expiresAtMs: number;
  isCancelled?: () => boolean;
  onTick?: (message: string) => void;
}): Promise<OAuthTokens> {
  const grantType = "urn:ietf:params:oauth:grant-type:user_code";
  let interval = Math.max(2000, params.intervalMs);

  while (Date.now() < params.expiresAtMs) {
    if (params.isCancelled?.()) throw new Error("授权已取消");
    params.onTick?.("等待 MiniMax 授权确认...");
    const body = toFormUrlEncoded({
      grant_type: grantType,
      client_id: params.config.clientId,
      user_code: params.userCode,
      code_verifier: params.codeVerifier
    });
    const response = await fetch(params.config.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body
    });
    const text = await response.text();
    let payload: any = undefined;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const parsed = parseMiniMaxBaseResp(text);
      const msg = parsed ? `${parsed.statusCode}:${parsed.statusMsg}` : (payload?.base_resp?.status_msg || text || `HTTP ${response.status}`);
      throw new Error(`MiniMax Token 交换失败：${String(msg)}`);
    }

    if (!payload || payload.status == null) {
      throw new Error("MiniMax Token 响应解析失败");
    }
    if (payload.status === "success") {
      if (!payload.access_token) throw new Error("MiniMax Token 缺少 access_token");
      const now = Date.now();
      const tokens = {
        accessToken: String(payload.access_token),
        refreshToken: payload.refresh_token ? String(payload.refresh_token) : undefined,
        expiresAt: payload.expired_in ? now + Number(payload.expired_in) * 1000 : undefined,
        resourceUrl: payload.resource_url ? String(payload.resource_url) : undefined
      };
      appLogger.info({
        module: "oauth",
        event: "minimax_token_exchanged",
        message: "MiniMax Token 交换成功",
        context: { tokenEndpoint: params.config.tokenEndpoint, hasResourceUrl: Boolean(tokens.resourceUrl) }
      });
      return tokens;
    }
    if (payload.status === "error") {
      throw new Error(payload?.base_resp?.status_msg || "MiniMax OAuth 授权失败");
    }

    await sleep(interval);
    interval = Math.max(interval, 2000);
  }

  throw new Error("MiniMax 授权超时，请重试");
}

function randomState(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseOAuthCode(urlString: string, redirectUri: string, expectedState: string): string | null {
  let url: URL;
  let target: URL;
  try {
    url = new URL(urlString);
    target = new URL(redirectUri);
  } catch {
    return null;
  }
  if (url.protocol !== target.protocol || url.host !== target.host) return null;
  if (target.pathname && target.pathname !== "/" && url.pathname !== target.pathname) return null;
  const queryParams = parseParams(url.search);
  const hashParams = parseFragmentParams(url.hash);
  const queryCode = queryParams.code;
  const queryState = queryParams.state;
  const queryError = queryParams.error;
  const queryErrorDescription = queryParams.error_description;
  const hashCode = hashParams.code;
  const hashState = hashParams.state;
  const hashError = hashParams.error;
  const hashErrorDescription = hashParams.error_description;
  const oauthError = queryError ?? hashError;
  const oauthErrorDescription = queryErrorDescription ?? hashErrorDescription;
  if (oauthError) {
    throw new Error(`授权被拒绝或失败：${oauthErrorDescription || oauthError}`);
  }
  const state = queryState ?? hashState;
  if (state && state !== expectedState) throw new Error("授权状态校验失败，请重试");
  const code = queryCode ?? hashCode;
  if (!code) throw new Error("授权码缺失，请重试授权流程");
  return code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMiniMaxBaseResp(text: string): { statusCode?: number; statusMsg?: string } | null {
  if (!text) return null;
  try {
    const payload = JSON.parse(text) as any;
    const statusCode = payload?.base_resp?.status_code;
    const statusMsg = payload?.base_resp?.status_msg;
    if (statusCode == null && statusMsg == null) return null;
    return { statusCode, statusMsg };
  } catch {
    return null;
  }
}

function buildUrlWithQuery(baseUrl: string, params: Record<string, string | undefined>): string {
  const split = baseUrl.split("#");
  const withoutHash = split[0] ?? baseUrl;
  const fragment = split.length > 1 ? `#${split.slice(1).join("#")}` : "";
  const [path, existingQuery = ""] = withoutHash.split("?");
  const merged: Array<[string, string]> = [];
  merged.push(...Object.entries(parseParams(existingQuery)).map(([k, v]) => [k, v]));
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    const idx = merged.findIndex(([key]) => key === k);
    if (idx >= 0) merged[idx] = [k, v];
    else merged.push([k, v]);
  }
  if (merged.length === 0) return `${path}${fragment}`;
  const query = merged.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `${path}?${query}${fragment}`;
}

function toFormUrlEncoded(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v)).replace(/%20/g, "+")}`)
    .join("&");
}

function parseFragmentParams(hash: string): Record<string, string> {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  return parseParams(text);
}

function parseParams(raw: string): Record<string, string> {
  const text = raw.startsWith("?") ? raw.slice(1) : raw;
  if (!text) return {};
  const result: Record<string, string> = {};
  for (const pair of text.split("&")) {
    if (!pair) continue;
    const [keyRaw, ...rest] = pair.split("=");
    const valueRaw = rest.join("=");
    const key = safeDecode(keyRaw ?? "").trim();
    if (!key) continue;
    result[key] = safeDecode(valueRaw ?? "");
  }
  return result;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}
