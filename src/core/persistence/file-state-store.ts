import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StoredCredential, WorkspaceConfig } from "../../types/contracts.ts";
import type { Channel } from "../channel/channel-service.ts";
import type { Message } from "../../types/contracts.ts";

export interface PersistedAppState {
  version: 1;
  workspaces: WorkspaceConfig[];
  channels: Channel[];
  messages: Message[];
  memoryRecords: Array<{
    id: string;
    channelId: string;
    type: "preference" | "fact" | "goal";
    content: string;
    embeddingRef: string;
    timestamp: number;
    embedding: number[];
  }>;
  credentials: StoredCredential[];
}

export class FileStateStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async save(state: PersistedAppState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(state, null, 2), "utf8");
  }

  async load(): Promise<PersistedAppState | null> {
    try {
      const raw = await readFile(this.path, "utf8");
      const state = JSON.parse(raw) as PersistedAppState;
      if (state.version !== 1) throw new Error(`unsupported state version: ${String((state as { version?: unknown }).version)}`);
      return state;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT")) return null;
      throw err;
    }
  }
}
