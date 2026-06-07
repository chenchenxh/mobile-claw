import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { MobileClawKernel } from "../app/mobileclaw-kernel.ts";
import { FileStateStore } from "../core/persistence/file-state-store.ts";
import { DeepSeekCompatibleAdapter } from "../core/gateway/deepseek-compatible-adapter.ts";
import { MiniMaxAnthropicAdapter } from "../core/gateway/minimax-anthropic-adapter.ts";
import type { ModelProvider, ModelSession, WorkspaceConfig } from "../types/contracts.ts";

const providers: ModelProvider[] = [
  { id: "deepseek", type: "deepseek", authMode: "BYOK", capabilities: { supportsChat: true, supportsEmbedding: true, supportsStream: true } },
  { id: "minimax", type: "minimax", authMode: "BYOK", capabilities: { supportsChat: true, supportsEmbedding: true, supportsStream: true } }
];

const workspace: WorkspaceConfig = {
  id: "ws_demo",
  name: "Demo Workspace",
  defaultModel: "gpt-4o-mini",
  systemPrompt: "You are MobileClaw Demo.",
  memoryPolicy: "LOCAL_ONLY"
};

async function main(): Promise<void> {
  const kernel = new MobileClawKernel(providers, {
    persistence: new FileStateStore(".mobileclaw/state.json")
  });
  await kernel.loadPersistedState();
  kernel.registerProviderAdapter(new DeepSeekCompatibleAdapter(providers[0], kernel.credentials));
  kernel.registerProviderAdapter(new MiniMaxAnthropicAdapter(providers[1], kernel.credentials));

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const minimaxKey = process.env.MINIMAX_API_KEY;
  if (!deepseekKey && !minimaxKey) {
    console.log("Set DEEPSEEK_API_KEY or MINIMAX_API_KEY to run real model chat.");
    return;
  }

  kernel.addWorkspace(workspace);
  const existing = kernel.channels.listChannels(workspace.id)[0];
  const channelId = existing?.id ?? kernel.createChannel(workspace.id, "default");

  let primary: ModelSession;
  if (deepseekKey) {
    const cred = await kernel.credentials.saveKey("deepseek", deepseekKey);
    primary = { providerId: "deepseek", modelId: "deepseek-v4-flash", credentialRef: cred };
  } else {
    const cred = await kernel.credentials.saveKey("minimax", minimaxKey as string);
    primary = { providerId: "minimax", modelId: "MiniMax-M2.5", credentialRef: cred };
  }

  console.log("MobileClaw CLI demo started. Type '/exit' to quit.");
  const rl = readline.createInterface({ input, output });
  while (true) {
    const q = await rl.question("> ");
    if (q.trim() === "/exit") break;
    if (!q.trim()) continue;
    const response = await kernel.sendMessage({ channelId, text: q, primary });
    console.log(response.text);
  }
  rl.close();
  await kernel.persistNow();
}

void main();
