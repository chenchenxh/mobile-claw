import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { MobileClawKernel } from "../app/mobileclaw-kernel.ts";
import { FileStateStore } from "../core/persistence/file-state-store.ts";
import { OpenAICompatibleAdapter } from "../core/gateway/openai-compatible-adapter.ts";
import { GeminiAdapter } from "../core/gateway/gemini-adapter.ts";
import type { ModelProvider, ModelSession, WorkspaceConfig } from "../types/contracts.ts";

const providers: ModelProvider[] = [
  { id: "openai", type: "openai", authMode: "BYOK", capabilities: { supportsChat: true, supportsEmbedding: true, supportsStream: true } },
  { id: "google", type: "google", authMode: "BYOK", capabilities: { supportsChat: true, supportsEmbedding: true, supportsStream: true } }
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
  kernel.registerProviderAdapter(new OpenAICompatibleAdapter(providers[0], kernel.credentials));
  kernel.registerProviderAdapter(new GeminiAdapter(providers[1], kernel.credentials));

  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!openaiKey && !geminiKey) {
    console.log("Set OPENAI_API_KEY or GEMINI_API_KEY to run real model chat.");
    return;
  }

  kernel.addWorkspace(workspace);
  const existing = kernel.channels.listChannels(workspace.id)[0];
  const channelId = existing?.id ?? kernel.createChannel(workspace.id, "default");

  let primary: ModelSession;
  if (openaiKey) {
    const cred = await kernel.credentials.saveKey("openai", openaiKey);
    primary = { providerId: "openai", modelId: "gpt-4o-mini", credentialRef: cred };
  } else {
    const cred = await kernel.credentials.saveKey("google", geminiKey as string);
    primary = { providerId: "google", modelId: "gemini-2.5-flash", credentialRef: cred };
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
