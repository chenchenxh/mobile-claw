import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryCredentialStore } from "../core/credentials/in-memory-credential-store.ts";
import { MiniMaxAnthropicAdapter } from "../core/gateway/minimax-anthropic-adapter.ts";
import type { ChatRequest, ModelProvider, ModelSession } from "../types/contracts.ts";

const provider: ModelProvider = {
  id: "minimax",
  type: "minimax",
  authMode: "BYOK",
  capabilities: { supportsChat: true, supportsEmbedding: true, supportsStream: true }
};

const request: ChatRequest = {
  modelId: "MiniMax-M2.5",
  messages: [{ id: "m1", role: "user", content: "hello", ts: Date.now() }]
};

test("minimax adapter extracts text from content[].text", async () => {
  const credentials = new InMemoryCredentialStore();
  const credentialRef = await credentials.saveKey("minimax", "sk-test");
  const adapter = new MiniMaxAnthropicAdapter(provider, credentials);
  const session: ModelSession = { providerId: "minimax", modelId: "MiniMax-M2.5", credentialRef };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text: "你好，世界" }], usage: {} }), { status: 200 })) as typeof fetch;
  try {
    const result = await adapter.chat(request, session);
    assert.equal(result.text, "你好，世界");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("minimax adapter extracts text from text field fallback", async () => {
  const credentials = new InMemoryCredentialStore();
  const credentialRef = await credentials.saveKey("minimax", "sk-test");
  const adapter = new MiniMaxAnthropicAdapter(provider, credentials);
  const session: ModelSession = { providerId: "minimax", modelId: "MiniMax-M2.7", credentialRef };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ text: "fallback text" }), { status: 200 })) as typeof fetch;
  try {
    const result = await adapter.chat(request, session);
    assert.equal(result.text, "fallback text");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("minimax adapter throws empty_response when payload has no displayable text", async () => {
  const credentials = new InMemoryCredentialStore();
  const credentialRef = await credentials.saveKey("minimax", "sk-test");
  const adapter = new MiniMaxAnthropicAdapter(provider, credentials);
  const session: ModelSession = { providerId: "minimax", modelId: "MiniMax-M2.7", credentialRef };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ content: [{ type: "thinking", text: "" }] }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(() => adapter.chat(request, session), /empty_response/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
