import test from "node:test";
import assert from "node:assert/strict";
import { MobileClawKernel } from "../app/mobileclaw-kernel.ts";
import type { ModelProvider, WorkspaceConfig } from "../types/contracts.ts";

const providers: ModelProvider[] = [
  {
    id: "minimax",
    type: "minimax",
    authMode: "BYOK",
    authModes: ["BYOK"],
    capabilities: { supportsChat: true, supportsEmbedding: true, supportsStream: true }
  }
];

const ws: WorkspaceConfig = {
  id: "ws-auth",
  name: "Auth",
  defaultModel: "small",
  systemPrompt: "auth test",
  memoryPolicy: "LOCAL_ONLY",
  tierMapping: {
    small: { providerId: "minimax", modelId: "small", displayName: "MiniMax Small" },
    large: { providerId: "minimax", modelId: "large", displayName: "MiniMax Large" }
  }
};

test("single provider supports BYOK credentials", async () => {
  const kernel = new MobileClawKernel(providers);
  kernel.addWorkspace(ws);
  const channelId = kernel.createChannel(ws.id, "main");

  await kernel.configureProviderByok("minimax", "sk_minimax_test");
  await kernel.sendMessage({ channelId, text: "BYOK message", tier: "small" });

  const all = kernel.getMessages(channelId).map((m) => `${m.role}:${m.content}`).join("\n");
  assert.match(all, /BYOK message/);
});
