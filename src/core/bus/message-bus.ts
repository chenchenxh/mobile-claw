import type {
  AgentProgressEvent,
  ChannelSnapshotEvent,
  InboundMessageEvent,
  OutboundMessageEvent
} from "./events.ts";

type Listener<T> = (event: T) => void;

class AsyncEventQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(value: T) => void> = [];
  private readonly listeners = new Set<Listener<T>>();

  publish(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
    for (const listener of this.listeners) listener(item);
  }

  async consume(): Promise<T> {
    const next = this.items.shift();
    if (next !== undefined) return next;
    return new Promise<T>((resolve) => this.waiters.push(resolve));
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  size(): number {
    return this.items.length;
  }
}

export class MessageBus {
  private readonly inbound = new AsyncEventQueue<InboundMessageEvent>();
  private readonly outbound = new AsyncEventQueue<OutboundMessageEvent>();
  private readonly progress = new AsyncEventQueue<AgentProgressEvent>();
  private readonly snapshot = new AsyncEventQueue<ChannelSnapshotEvent>();

  publishInbound(event: InboundMessageEvent): void {
    this.inbound.publish(event);
  }

  publishOutbound(event: OutboundMessageEvent): void {
    this.outbound.publish(event);
  }

  publishProgress(event: AgentProgressEvent): void {
    this.progress.publish(event);
  }

  publishSnapshot(event: ChannelSnapshotEvent): void {
    this.snapshot.publish(event);
  }

  consumeInbound(): Promise<InboundMessageEvent> {
    return this.inbound.consume();
  }

  consumeOutbound(): Promise<OutboundMessageEvent> {
    return this.outbound.consume();
  }

  consumeProgress(): Promise<AgentProgressEvent> {
    return this.progress.consume();
  }

  consumeSnapshot(): Promise<ChannelSnapshotEvent> {
    return this.snapshot.consume();
  }

  onInbound(listener: Listener<InboundMessageEvent>): () => void {
    return this.inbound.subscribe(listener);
  }

  onOutbound(listener: Listener<OutboundMessageEvent>): () => void {
    return this.outbound.subscribe(listener);
  }

  onProgress(listener: Listener<AgentProgressEvent>): () => void {
    return this.progress.subscribe(listener);
  }

  onSnapshot(listener: Listener<ChannelSnapshotEvent>): () => void {
    return this.snapshot.subscribe(listener);
  }

  get inboundSize(): number {
    return this.inbound.size();
  }

  get outboundSize(): number {
    return this.outbound.size();
  }
}
