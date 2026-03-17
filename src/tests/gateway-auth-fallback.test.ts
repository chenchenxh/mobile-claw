import test from "node:test";
import assert from "node:assert/strict";
import { GatewayRouter } from "../core/gateway/gateway-router.ts";
import { BaseMockAdapter } from "../core/gateway/base-mock-adapter.ts";
import { InMemoryCredentialStore } from "../core/credentials/in-memory-credential-store.ts";
import type { ModelProvider } from "../types/contracts.ts";

const openaiProvider: ModelProvider = {
  id: "openai",
  type: "openai",
  authMode: "BYOK",
  capabilities: { supportsChat: true, supportsStream: true, supportsEmbedding: true }
};
const googleProvider: ModelProvider = {
  id: "google",
  type: "google",
  authMode: "OAUTH",
  capabilities: { supportsChat: true, supportsStream: true, supportsEmbedding: true }
};

test("BYOK and OAuth session validation + fallback chat", async () => {
  const credentials = new InMemoryCredentialStore();
  const router = new GatewayRouter();
  router.registerAdapter(new BaseMockAdapter({ provider: openaiProvider, models: ["small"], failOnceOnChat: true }, credentials));
  router.registerAdapter(new BaseMockAdapter({ provider: googleProvider, models: ["large"] }, credentials));

  const byokRef = await credentials.saveKey("openai", "sk_abc");
  const oauthRef = await credentials.startOAuth("google", "code_1");
  const primary = { providerId: "openai", modelId: "small", credentialRef: byokRef };
  const fallback = { providerId: "google", modelId: "large", credentialRef: oauthRef };

  assert.equal(await router.validateSession(primary), true);
  assert.equal(await router.validateSession(fallback), true);

  const response = await router.chatWithFallback(
    { modelId: "small", messages: [{ id: "m1", role: "user", content: "hello", ts: Date.now() }] },
    { primary, fallback }
  );
  assert.match(response.text, /\[google\/large\] hello/);

  await credentials.revoke(oauthRef);
  assert.equal(await router.validateSession(fallback), false);
});
