import test from "node:test";
import assert from "node:assert/strict";
import { MobileClawKernel } from "../app/mobileclaw-kernel.ts";
import type { ModelProvider, ModelSession, WorkspaceConfig } from "../types/contracts.ts";

const providers: ModelProvider[] = [
  {
    id: "openai",
    type: "openai",
    authMode: "BYOK",
    capabilities: { supportsChat: true, supportsEmbedding: true, supportsStream: true }
  },
  {
    id: "google",
    type: "google",
    authMode: "OAUTH",
    capabilities: { supportsChat: true, supportsEmbedding: true, supportsStream: true }
  }
];

const defaultWorkspace: WorkspaceConfig = {
  id: "ws1",
  name: "Personal",
  defaultModel: "small",
  systemPrompt: "You are MobileClaw",
  memoryPolicy: "LOCAL_ONLY"
};

async function createAuthedSessions(kernel: MobileClawKernel): Promise<{ byok: ModelSession; oauth: ModelSession }> {
  const byokCredentialRef = await kernel.credentials.saveKey("openai", "sk-local-test");
  const oauthCredentialRef = await kernel.credentials.startOAuth("google", "mock_auth_code");
  return {
    byok: { providerId: "openai", modelId: "small", credentialRef: byokCredentialRef },
    oauth: { providerId: "google", modelId: "large", credentialRef: oauthCredentialRef }
  };
}

test("same channel keeps context when switching model", async () => {
  const kernel = new MobileClawKernel(providers);
  kernel.addWorkspace(defaultWorkspace);
  const channelId = kernel.createChannel("ws1", "daily");
  const { byok, oauth } = await createAuthedSessions(kernel);

  await kernel.sendMessage({ channelId, text: "你好，我是前端开发", primary: byok });
  await kernel.sendMessage({ channelId, text: "记住我喜欢React Native", primary: oauth, fallback: byok });

  const messages = kernel.getMessages(channelId);
  const userMessages = messages.filter((m) => m.role === "user");
  assert.equal(userMessages.length, 2);
  assert.equal(userMessages[0].content, "你好，我是前端开发");
  assert.equal(userMessages[1].content, "记住我喜欢React Native");
});

test("memory is isolated by channel", async () => {
  const kernel = new MobileClawKernel(providers);
  kernel.addWorkspace(defaultWorkspace);
  const chA = kernel.createChannel("ws1", "A");
  const chB = kernel.createChannel("ws1", "B");
  const { byok } = await createAuthedSessions(kernel);

  await kernel.sendMessage({ channelId: chA, text: "我喜欢咖啡", primary: byok });
  await kernel.sendMessage({ channelId: chB, text: "我喜欢茶", primary: byok });

  const memA = kernel.memory.list(chA).map((m) => m.content).join("|");
  const memB = kernel.memory.list(chB).map((m) => m.content).join("|");
  assert.match(memA, /咖啡/);
  assert.doesNotMatch(memA, /茶/);
  assert.match(memB, /茶/);
  assert.doesNotMatch(memB, /咖啡/);
});
