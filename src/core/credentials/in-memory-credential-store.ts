import type { CredentialStore, OAuthTokens, StoredCredential } from "../../types/contracts.ts";
import { uid } from "../utils/id.ts";

export class InMemoryCredentialStore implements CredentialStore {
  private readonly credentials = new Map<string, StoredCredential>();

  async saveKey(providerId: string, key: string): Promise<string> {
    const now = Date.now();
    const id = uid("cred");
    this.credentials.set(id, {
      id,
      providerId,
      authMode: "BYOK",
      apiKey: key,
      createdAt: now,
      updatedAt: now
    });
    return id;
  }

  async startOAuth(providerId: string, authCode: string): Promise<string> {
    const now = Date.now();
    const id = uid("cred");
    this.credentials.set(id, {
      id,
      providerId,
      authMode: "OAUTH",
      oauth: this.mockExchange(authCode),
      createdAt: now,
      updatedAt: now
    });
    return id;
  }

  async saveOAuthTokens(providerId: string, tokens: OAuthTokens): Promise<string> {
    const now = Date.now();
    const id = uid("cred");
    this.credentials.set(id, {
      id,
      providerId,
      authMode: "OAUTH",
      oauth: tokens,
      createdAt: now,
      updatedAt: now
    });
    return id;
  }

  async refreshToken(credentialRef: string): Promise<void> {
    const existing = this.mustGet(credentialRef);
    if (existing.authMode !== "OAUTH") throw new Error("refreshToken only supports OAUTH credential");
    const oauth = existing.oauth ?? {};
    existing.oauth = {
      accessToken: uid("access"),
      refreshToken: oauth.refreshToken ?? uid("refresh"),
      expiresAt: Date.now() + 60 * 60 * 1000
    };
    existing.updatedAt = Date.now();
  }

  async revoke(credentialRef: string): Promise<void> {
    this.credentials.delete(credentialRef);
  }

  async get(credentialRef: string): Promise<StoredCredential | null> {
    return this.credentials.get(credentialRef) ?? null;
  }

  dumpState(): StoredCredential[] {
    return Array.from(this.credentials.values()).map((c) => ({ ...c }));
  }

  loadState(state: StoredCredential[]): void {
    this.credentials.clear();
    for (const credential of state) this.credentials.set(credential.id, { ...credential });
  }

  reset(): void {
    this.credentials.clear();
  }

  private mustGet(credentialRef: string): StoredCredential {
    const credential = this.credentials.get(credentialRef);
    if (!credential) throw new Error(`credential ${credentialRef} not found`);
    return credential;
  }

  private mockExchange(authCode: string): OAuthTokens {
    return {
      accessToken: `oauth_access_${authCode}_${Math.random().toString(36).slice(2, 8)}`,
      refreshToken: uid("refresh"),
      expiresAt: Date.now() + 60 * 60 * 1000
    };
  }
}
