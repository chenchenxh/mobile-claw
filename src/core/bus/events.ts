import type { Message } from "../../types/contracts.ts";

export interface InboundMessageEvent {
  channelId: string;
  text: string;
  ts: number;
}

export interface OutboundMessageEvent {
  channelId: string;
  text: string;
  ts: number;
}

export interface AgentProgressEvent {
  channelId: string;
  stage: "receive" | "recall" | "model_call" | "respond";
  detail?: string;
  ts: number;
}

export interface ChannelSnapshotEvent {
  channelId: string;
  messages: Message[];
  ts: number;
}
