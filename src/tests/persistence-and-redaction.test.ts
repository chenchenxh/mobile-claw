import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MobileClawKernel } from "../app/mobileclaw-kernel.ts";
import { FileStateStore } from "../core/persistence/file-state-store.ts";
import { redactSensitive } from "../core/security/redaction.ts";
import type { ModelProvider, WorkspaceConfig } from "../types/contracts.ts";

const providers: ModelProvider[] = [
  {
    id: "deepseek",
    type: "deepseek",
    authMode: "BYOK",
    capabilities: { supportsChat: true, supportsEmbedding: true, supportsStream: true }
  }
];

const ws: WorkspaceConfig = {
  id: "ws-persist",
  name: "Persist",
  defaultModel: "small",
  systemPrompt: "persist",
  memoryPolicy: "LOCAL_ONLY"
};

test("state persists and restores after kernel restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mobileclaw-"));
    const statePath = join(dir, "state.json");
    const persistence = new FileStateStore(statePath);
    try {
    const kernel1 = new MobileClawKernel(providers, { persistence });
    kernel1.addWorkspace(ws);
    const channelId = kernel1.createChannel(ws.id, "main");
    const cred = await kernel1.credentials.saveKey("deepseek", "sk_test_persist");
    await kernel1.sendMessage({
      channelId,
      text: "我喜欢离线存储",
      primary: { providerId: "deepseek", modelId: "small", credentialRef: cred }
    });
    await kernel1.persistNow();

    const kernel2 = new MobileClawKernel(providers, { persistence });
    await kernel2.loadPersistedState();
    const channels = kernel2.channels.listChannels(ws.id);
    assert.equal(channels.length, 1);
    const restoredMessages = kernel2.getMessages(channels[0].id);
    assert.equal(restoredMessages.length > 0, true);
    assert.equal(kernel2.memory.list(channels[0].id).length > 0, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("redactSensitive hides token-like values", () => {
  const raw = "Authorization: Bearer token_123 sk-abcdefghi oauth_access_xxx";
  const redacted = redactSensitive(raw);
  assert.doesNotMatch(redacted, /sk-abcdefghi/);
  assert.doesNotMatch(redacted, /oauth_access_xxx/);
  assert.match(redacted, /\[REDACTED\]/);
});

test("cron jobs persist and restore after kernel restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mobileclaw-cron-"));
  const statePath = join(dir, "state.json");
  const persistence = new FileStateStore(statePath);
  try {
    const kernel1 = new MobileClawKernel(providers, { persistence });
    kernel1.addWorkspace(ws);
    const channelId = kernel1.createChannel(ws.id, "cron");
    await kernel1.configureProviderByok("deepseek", "sk_cron_persist");
    kernel1.addCronJob({
      name: "daily-reminder",
      schedule: { kind: "every", everyMs: 60_000 },
      payload: { channelId, text: "记得复盘今天进度", tier: "small" }
    });
    await kernel1.persistNow();
    await kernel1.shutdown();

    const kernel2 = new MobileClawKernel(providers, { persistence });
    await kernel2.loadPersistedState();
    const jobs = kernel2.listCronJobs(true);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].name, "daily-reminder");
    assert.equal(jobs[0].payload.channelId, channelId);
    await kernel2.shutdown();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
