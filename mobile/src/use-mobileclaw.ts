import { useEffect, useMemo, useState } from "react";
import { MobileClawKernel } from "../../src/app/mobileclaw-kernel";
import type { Message, ModelProvider, ModelSession, WorkspaceConfig } from "../../src/types/contracts";

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

const ws: WorkspaceConfig = {
  id: "ws_mobile",
  name: "MobileClaw",
  defaultModel: "small",
  systemPrompt: "You are MobileClaw mobile assistant.",
  memoryPolicy: "LOCAL_ONLY"
};

export type DrawerTab = "chat" | "channels" | "tools" | "settings";

export function useMobileClaw() {
  const kernel = useMemo(() => new MobileClawKernel(providers), []);
  const [activeTab, setActiveTab] = useState<DrawerTab>("chat");
  const [ready, setReady] = useState(false);
  const [channelId, setChannelId] = useState<string>("");
  const [session, setSession] = useState<ModelSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    let mounted = true;
    const setup = async () => {
      kernel.addWorkspace(ws);
      const first = kernel.channels.listChannels(ws.id)[0];
      const created = first?.id ?? kernel.createChannel(ws.id, "General");
      const cred = await kernel.credentials.saveKey("openai", "demo_local_key");
      if (!mounted) return;
      setChannelId(created);
      setSession({ providerId: "openai", modelId: "small", credentialRef: cred });
      setMessages(kernel.getMessages(created));
      setReady(true);
    };
    void setup();
    return () => {
      mounted = false;
    };
  }, [kernel]);

  const send = async (text: string) => {
    if (!session || !channelId) return;
    await kernel.sendMessage({ channelId, text, primary: session });
    setMessages(kernel.getMessages(channelId));
  };

  const switchChannel = (nextChannelId: string) => {
    setChannelId(nextChannelId);
    setMessages(kernel.getMessages(nextChannelId));
  };

  const createChannel = (name: string) => {
    const id = kernel.createChannel(ws.id, name);
    switchChannel(id);
  };

  const switchModel = (modelId: "small" | "large") => {
    if (!channelId || !session) return;
    kernel.channels.updateChannelModel(channelId, modelId);
    setSession({ ...session, modelId });
  };

  return {
    ready,
    activeTab,
    setActiveTab,
    channelId,
    session,
    messages,
    send,
    switchModel,
    switchChannel,
    createChannel,
    channels: kernel.channels.listChannels(ws.id)
  };
}
