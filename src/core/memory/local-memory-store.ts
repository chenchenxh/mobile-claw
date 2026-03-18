import type { MemoryRecord, MemoryRecordType } from "../../types/contracts.ts";
import { uid } from "../utils/id.ts";

interface IndexedMemoryRecord extends MemoryRecord {
  embedding: number[];
}

export class LocalMemoryStore {
  private readonly records = new Map<string, IndexedMemoryRecord>();

  write(channelId: string, type: MemoryRecordType, content: string): MemoryRecord {
    const id = uid("mem");
    const embedding = this.embed(content);
    const record: IndexedMemoryRecord = {
      id,
      channelId,
      type,
      content,
      embeddingRef: id,
      timestamp: Date.now(),
      embedding
    };
    this.records.set(id, record);
    return this.strip(record);
  }

  recall(channelId: string, query: string, limit = 5): MemoryRecord[] {
    const q = this.embed(query);
    const scored = Array.from(this.records.values())
      .filter((r) => r.channelId === channelId)
      .map((r) => ({ record: r, score: this.cosine(r.embedding, q) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.record);
    return scored.map((r) => this.strip(r));
  }

  list(channelId: string): MemoryRecord[] {
    return Array.from(this.records.values()).filter((r) => r.channelId === channelId).map((r) => this.strip(r));
  }

  dumpState(): Array<Omit<IndexedMemoryRecord, "embedding"> & { embedding: number[] }> {
    return Array.from(this.records.values()).map((r) => ({ ...r, embedding: [...r.embedding] }));
  }

  loadState(state: Array<Omit<IndexedMemoryRecord, "embedding"> & { embedding: number[] }>): void {
    this.records.clear();
    for (const record of state) {
      this.records.set(record.id, { ...record, embedding: [...record.embedding] });
    }
  }

  private strip(record: IndexedMemoryRecord): MemoryRecord {
    return {
      id: record.id,
      channelId: record.channelId,
      type: record.type,
      content: record.content,
      embeddingRef: record.embeddingRef,
      timestamp: record.timestamp
    };
  }

  private embed(text: string): number[] {
    const out = new Array(32).fill(0);
    for (let i = 0; i < text.length; i += 1) {
      out[i % out.length] += text.charCodeAt(i);
    }
    const norm = Math.sqrt(out.reduce((acc, v) => acc + v * v, 0)) || 1;
    return out.map((v) => v / norm);
  }

  private cosine(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
    return dot;
  }
}
