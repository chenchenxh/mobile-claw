import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AssetDoc,
  InternalConfigDoc,
  OAuthClientConfig,
  PromptAssemblyReport,
  StoredCredential,
  WorkspaceConfig
} from "../../types/contracts.ts";
import type { Channel } from "../channel/channel-service.ts";
import type { Message } from "../../types/contracts.ts";
import type { CronJob } from "../cron/types.ts";
import type { CronExecutionRecord } from "../cron/types.ts";

export interface PersistedAppState {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
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
  providerCredentialRefs?: Record<string, string>;
  oauthClientConfigs?: Record<string, OAuthClientConfig>;
  cronJobs?: CronJob[];
  cronExecutionRecords?: CronExecutionRecord[];
  workspaceSoulMap?: Record<string, string>;
  channelSoulMap?: Record<string, string>;
  promptReports?: Record<string, PromptAssemblyReport>;
  assetDocs?: Record<string, AssetDoc>;
  internalConfigDocs?: Record<string, InternalConfigDoc>;
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
      if (
        state.version !== 1 &&
        state.version !== 2 &&
        state.version !== 3 &&
        state.version !== 4 &&
        state.version !== 5 &&
        state.version !== 6 &&
        state.version !== 7 &&
        state.version !== 8 &&
        state.version !== 9
      ) {
        throw new Error(`unsupported state version: ${String((state as { version?: unknown }).version)}`);
      }
      return state;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT")) return null;
      throw err;
    }
  }
}
