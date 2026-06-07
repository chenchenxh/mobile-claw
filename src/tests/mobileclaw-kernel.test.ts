import test from "node:test";
import assert from "node:assert/strict";
import { MobileClawKernel } from "../app/mobileclaw-kernel.ts";
import type { ModelProvider, ModelSession, WorkspaceConfig } from "../types/contracts.ts";

const providers: ModelProvider[] = [
  {
    id: "deepseek",
    type: "deepseek",
    authMode: "BYOK",
    capabilities: { supportsChat: true, supportsEmbedding: true, supportsStream: true }
  },
  {
    id: "minimax",
    type: "minimax",
    authMode: "BYOK",
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

async function createAuthedSessions(kernel: MobileClawKernel): Promise<{ primary: ModelSession; fallback: ModelSession }> {
  const primaryCredentialRef = await kernel.credentials.saveKey("deepseek", "sk-local-test");
  const fallbackCredentialRef = await kernel.credentials.saveKey("minimax", "sk-minimax-test");
  return {
    primary: { providerId: "deepseek", modelId: "small", credentialRef: primaryCredentialRef },
    fallback: { providerId: "minimax", modelId: "large", credentialRef: fallbackCredentialRef }
  };
}

test("same channel keeps context when switching model", async () => {
  const kernel = new MobileClawKernel(providers);
  kernel.addWorkspace(defaultWorkspace);
  const channelId = kernel.createChannel("ws1", "daily");
  const { primary, fallback } = await createAuthedSessions(kernel);

  await kernel.sendMessage({ channelId, text: "你好，我是前端开发", primary });
  await kernel.sendMessage({ channelId, text: "记住我喜欢React Native", primary: fallback, fallback: primary });

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
  const { primary } = await createAuthedSessions(kernel);

  await kernel.sendMessage({ channelId: chA, text: "我喜欢咖啡", primary });
  await kernel.sendMessage({ channelId: chB, text: "我喜欢茶", primary });

  const memA = kernel.memory.list(chA).map((m) => m.content).join("|");
  const memB = kernel.memory.list(chB).map((m) => m.content).join("|");
  assert.match(memA, /咖啡/);
  assert.doesNotMatch(memA, /茶/);
  assert.match(memB, /茶/);
  assert.doesNotMatch(memB, /咖啡/);
});

test("ensureWorkspaceAndDefaultChannel self-heals missing workspace on startup", () => {
  const kernel = new MobileClawKernel(providers);
  kernel.channels.loadState({
    workspaces: [],
    channels: [
      {
        id: "orphan_channel",
        workspaceId: "unknown_workspace",
        name: "Orphan",
        systemPrompt: "old",
        defaultModel: "small",
        messageIds: []
      }
    ],
    messages: []
  });

  const channelId = kernel.ensureWorkspaceAndDefaultChannel(defaultWorkspace, "General");
  assert.notEqual(channelId, "orphan_channel");
  assert.equal(kernel.channels.listChannels(defaultWorkspace.id).length, 1);
  assert.equal(kernel.channels.getChannel(channelId).workspaceId, defaultWorkspace.id);
  assert.doesNotThrow(() => kernel.getWorkspaceConfig(defaultWorkspace.id));
  assert.doesNotThrow(() => kernel.getChannelContext(channelId));
});

test("sendMessage publishes bus events", async () => {
  const kernel = new MobileClawKernel(providers);
  kernel.addWorkspace(defaultWorkspace);
  const channelId = kernel.createChannel("ws1", "bus");
  const { primary } = await createAuthedSessions(kernel);

  let outboundText = "";
  const off = kernel.bus.onOutbound((event) => {
    outboundText = event.text;
  });
  await kernel.sendMessage({
    channelId,
    text: "bus hello",
    primary
  });
  off();

  assert.match(outboundText, /bus hello/);
  assert.equal(kernel.bus.outboundSize, 1);
});

test("prompt assembly report is channel-specific and recall system text is hidden from chat list", async () => {
  const kernel = new MobileClawKernel(providers);
  kernel.addWorkspace(defaultWorkspace);
  const chA = kernel.createChannel("ws1", "A");
  const chB = kernel.createChannel("ws1", "B");
  const { primary } = await createAuthedSessions(kernel);

  kernel.setWorkspaceSoul("ws1", "你是一个严谨的助手。");
  kernel.setChannelSoul(chB, "你在频道B需要更简短回复。");

  await kernel.sendMessage({ channelId: chA, text: "记住我喜欢短回复", primary });
  await kernel.sendMessage({ channelId: chB, text: "记住我喜欢详细说明", primary });

  const reportA = kernel.getLastPromptReport(chA);
  const reportB = kernel.getLastPromptReport(chB);
  assert.ok(reportA);
  assert.ok(reportB);
  assert.notEqual(reportA?.id, reportB?.id);
  assert.notEqual(reportA?.totalChars, reportB?.totalChars);

  const systemRecallRows = kernel.getMessages(chA).filter((m) => m.role === "system" && /Recalled memories:/.test(m.content));
  assert.equal(systemRecallRows.length, 0);
  assert.ok(kernel.listAssets("developer").length >= 1);
  assert.ok(kernel.readAsset("developer", "workspace/SOUL.md"));
  assert.equal(kernel.readAsset("user", "agents/main/agent/models.json"), null);
  assert.ok(kernel.readAsset("user", "workspace/MEMORY.md"));
});

test("workspace SOUL file update is reflected in prompt assembly", async () => {
  const kernel = new MobileClawKernel(providers);
  kernel.addWorkspace(defaultWorkspace);
  const channelId = kernel.createChannel("ws1", "soul");
  const { primary } = await createAuthedSessions(kernel);

  const pending = kernel.applyWorkspaceEdit({
    channelId,
    text: "把 SOUL.md 改成 你是一个冷静、直接、可靠的助手",
    actorRole: "developer"
  });
  assert.equal(pending.handled, true);
  assert.equal(pending.requiresConfirmation, true);

  const confirmed = kernel.confirmPendingWorkspaceEdit(channelId);
  assert.equal(confirmed.handled, true);
  await kernel.sendMessage({ channelId, text: "你的soul是什么", primary });
  const report = kernel.getLastPromptReport(channelId);
  const soulSegment = report?.segments.find((seg) => seg.source === "soul");
  assert.ok(soulSegment);
  assert.match(soulSegment?.content ?? "", /冷静、直接、可靠/);
});

test("user cannot edit BOOTSTRAP.md via workspace edit api", () => {
  const kernel = new MobileClawKernel(providers);
  kernel.addWorkspace(defaultWorkspace);
  const channelId = kernel.createChannel("ws1", "guard");
  const result = kernel.applyWorkspaceEdit({
    channelId,
    text: "更新 BOOTSTRAP.md 为 hello",
    actorRole: "user"
  });
  assert.equal(result.handled, false);
});

test("MEMORY.md is injected only for main context channels", async () => {
  const kernel = new MobileClawKernel(providers);
  const mainChannel = kernel.ensureWorkspaceAndDefaultChannel(defaultWorkspace, "main");
  const sharedChannel = kernel.createChannel("ws1", "shared");
  const { primary } = await createAuthedSessions(kernel);

  await kernel.sendMessage({ channelId: mainChannel, text: "main memory check", primary });
  await kernel.sendMessage({ channelId: sharedChannel, text: "shared memory check", primary });

  const mainReport = kernel.getLastPromptReport(mainChannel);
  const sharedReport = kernel.getLastPromptReport(sharedChannel);
  assert.ok(mainReport?.contextFiles?.some((f) => f.path === "workspace/MEMORY.md"));
  assert.equal(sharedReport?.contextFiles?.some((f) => f.path === "workspace/MEMORY.md"), false);
});

test("BOOTSTRAP.md is skipped after setupCompletedAt", async () => {
  const kernel = new MobileClawKernel(providers);
  const channelId = kernel.ensureWorkspaceAndDefaultChannel(defaultWorkspace, "main");
  const { primary } = await createAuthedSessions(kernel);

  const docs = (kernel as unknown as { assetDocs: Map<string, { path: string; name: string; updatedAt: number; contentMd: string }> }).assetDocs;
  docs.set("workspace/.openclaw/workspace-state.json", {
    path: "workspace/.openclaw/workspace-state.json",
    name: "workspace-state.json",
    updatedAt: Date.now(),
    contentMd: JSON.stringify(
      {
        workspaceId: defaultWorkspace.id,
        bootstrapSeededAt: Date.now() - 1000,
        setupCompletedAt: Date.now(),
        updatedAt: Date.now()
      },
      null,
      2
    )
  });

  await kernel.sendMessage({ channelId, text: "bootstrap check", primary });
  const report = kernel.getLastPromptReport(channelId);
  assert.equal(report?.contextFiles?.some((f) => f.path === "workspace/BOOTSTRAP.md"), false);
});

test("kernel cron job triggers agent message", async () => {
  const kernel = new MobileClawKernel(providers);
  kernel.addWorkspace(defaultWorkspace);
  const channelId = kernel.createChannel("ws1", "cron");
  await kernel.configureProviderByok("deepseek", "sk_cron_test");

  kernel.addCronJob({
    name: "cron-once",
    schedule: { kind: "at", atMs: Date.now() + 20 },
    payload: { channelId, text: "cron hello", tier: "small" },
    deleteAfterRun: true
  });

  await new Promise((resolve) => setTimeout(resolve, 70));
  const all = kernel.getMessages(channelId).map((m) => `${m.role}:${m.content}`).join("\n");
  assert.match(all, /cron hello/);
  const records = kernel.listCronExecutionRecords(20);
  assert.ok(records.length >= 1);
  assert.equal(records[0]?.jobId !== undefined, true);
  await kernel.shutdown();
});
