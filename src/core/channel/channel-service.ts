import type { Message, TierMapping, WorkspaceConfig } from "../../types/contracts.ts";
import { uid } from "../utils/id.ts";

export interface Channel {
  id: string;
  workspaceId: string;
  name: string;
  systemPrompt: string;
  defaultModel: string;
  contextType?: "main" | "shared";
  tierMappingOverride?: TierMapping;
  messageIds: string[];
}

export class ChannelService {
  private readonly workspaces = new Map<string, WorkspaceConfig>();
  private readonly channels = new Map<string, Channel>();
  private readonly messages = new Map<string, Message>();
  private nextMessageSeq = 1;

  upsertWorkspace(config: WorkspaceConfig): void {
    this.workspaces.set(config.id, config);
  }

  createChannel(
    workspaceId: string,
    name: string,
    overrides?: Partial<Pick<Channel, "systemPrompt" | "defaultModel" | "contextType">>
  ): Channel {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) throw new Error(`workspace ${workspaceId} not found`);
    const channel: Channel = {
      id: uid("ch"),
      workspaceId,
      name,
      systemPrompt: overrides?.systemPrompt ?? ws.systemPrompt,
      defaultModel: overrides?.defaultModel ?? ws.defaultModel,
      contextType: overrides?.contextType ?? "shared",
      messageIds: []
    };
    this.channels.set(channel.id, channel);
    return channel;
  }

  getChannel(channelId: string): Channel {
    const ch = this.channels.get(channelId);
    if (!ch) throw new Error(`channel ${channelId} not found`);
    return ch;
  }

  listChannels(workspaceId: string): Channel[] {
    return Array.from(this.channels.values()).filter((c) => c.workspaceId === workspaceId);
  }

  removeChannel(channelId: string): boolean {
    const ch = this.channels.get(channelId);
    if (!ch) return false;
    this.channels.delete(channelId);
    for (const id of ch.messageIds) {
      this.messages.delete(id);
    }
    return true;
  }

  renameChannel(channelId: string, nextName: string): boolean {
    const ch = this.channels.get(channelId);
    if (!ch) return false;
    ch.name = nextName;
    return true;
  }

  updateChannelModel(channelId: string, modelId: string): void {
    const ch = this.getChannel(channelId);
    ch.defaultModel = modelId;
  }

  setChannelTierMapping(channelId: string, mapping: TierMapping): void {
    const ch = this.getChannel(channelId);
    ch.tierMappingOverride = mapping;
  }

  appendMessage(
    channelId: string,
    role: Message["role"],
    content: string,
    sourceType?: Message["sourceType"],
    flowRunId?: Message["flowRunId"],
    meta?: Pick<Message, "visibility" | "normalizedFromToolCall">
  ): Message {
    const ch = this.getChannel(channelId);
    const message: Message = {
      id: uid("msg"),
      role,
      content,
      ts: Date.now(),
      seq: this.nextMessageSeq++,
      sourceType,
      flowRunId,
      visibility: meta?.visibility,
      normalizedFromToolCall: meta?.normalizedFromToolCall
    };
    this.messages.set(message.id, message);
    ch.messageIds.push(message.id);
    return message;
  }

  getRecentMessages(channelId: string, limit = 30): Message[] {
    const ch = this.getChannel(channelId);
    const ids = ch.messageIds.slice(-limit);
    return ids.map((id) => this.messages.get(id)).filter((m): m is Message => Boolean(m));
  }

  dumpState(): {
    workspaces: WorkspaceConfig[];
    channels: Channel[];
    messages: Message[];
  } {
    return {
      workspaces: Array.from(this.workspaces.values()),
      channels: Array.from(this.channels.values()),
      messages: Array.from(this.messages.values())
    };
  }

  loadState(state: {
    workspaces: WorkspaceConfig[];
    channels: Channel[];
    messages: Message[];
  }): void {
    this.workspaces.clear();
    this.channels.clear();
    this.messages.clear();
    for (const ws of state.workspaces) this.workspaces.set(ws.id, ws);
    for (const ch of state.channels) {
      this.channels.set(ch.id, {
        ...ch,
        contextType: ch.contextType ?? "shared"
      });
    }
    for (const msg of state.messages) this.messages.set(msg.id, msg);
    const maxSeq = state.messages.reduce((acc, msg) => Math.max(acc, msg.seq ?? 0), 0);
    this.nextMessageSeq = Math.max(1, maxSeq + 1);
  }

  reset(): void {
    this.workspaces.clear();
    this.channels.clear();
    this.messages.clear();
    this.nextMessageSeq = 1;
  }
}
