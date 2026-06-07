import test from "node:test";
import assert from "node:assert/strict";
import { GatewayRouter } from "../core/gateway/gateway-router.ts";
import { BaseMockAdapter } from "../core/gateway/base-mock-adapter.ts";
import { InMemoryCredentialStore } from "../core/credentials/in-memory-credential-store.ts";
import type { ModelProvider } from "../types/contracts.ts";

const deepseekProvider: ModelProvider = {
  id: "deepseek",
  type: "deepseek",
  authMode: "BYOK",
  capabilities: { supportsChat: true, supportsStream: true, supportsEmbedding: true }
};
const minimaxProvider: ModelProvider = {
  id: "minimax",
  type: "minimax",
  authMode: "BYOK",
  capabilities: { supportsChat: true, supportsStream: true, supportsEmbedding: true }
};

test("BYOK session validation + fallback chat", async () => {
  const credentials = new InMemoryCredentialStore();
  const router = new GatewayRouter();
  router.registerAdapter(new BaseMockAdapter({ provider: deepseekProvider, models: ["small"], failOnceOnChat: true }, credentials));
  router.registerAdapter(new BaseMockAdapter({ provider: minimaxProvider, models: ["large"] }, credentials));

  const primaryRef = await credentials.saveKey("deepseek", "sk_abc");
  const fallbackRef = await credentials.saveKey("minimax", "sk_minimax");
  const primary = { providerId: "deepseek", modelId: "small", credentialRef: primaryRef };
  const fallback = { providerId: "minimax", modelId: "large", credentialRef: fallbackRef };

  assert.equal(await router.validateSession(primary), true);
  assert.equal(await router.validateSession(fallback), true);

  const response = await router.chatWithFallback(
    { modelId: "small", messages: [{ id: "m1", role: "user", content: "hello", ts: Date.now() }] },
    { primary, fallback }
  );
  assert.match(response.text, /\[minimax\/large\] hello/);

  await credentials.revoke(fallbackRef);
  assert.equal(await router.validateSession(fallback), false);
});
