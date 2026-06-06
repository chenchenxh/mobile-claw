import type { OutboundMessageEvent } from "../bus/events.ts";
import type { MessageBus } from "../bus/message-bus.ts";

export interface ChannelPlugin {
  id: string;
  displayName: string;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  matches?(event: OutboundMessageEvent): boolean;
  onOutbound?(event: OutboundMessageEvent): Promise<void>;
}

export class ChannelRegistry {
  private readonly plugins = new Map<string, ChannelPlugin>();
  private unsubOutbound: (() => void) | null = null;

  register(plugin: ChannelPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  unregister(pluginId: string): boolean {
    return this.plugins.delete(pluginId);
  }

  get(pluginId: string): ChannelPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  list(): ChannelPlugin[] {
    return Array.from(this.plugins.values());
  }

  attachBus(bus: MessageBus): void {
    if (this.unsubOutbound) this.unsubOutbound();
    this.unsubOutbound = bus.onOutbound((event) => {
      void this.dispatchOutbound(event);
    });
  }

  async startAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.start) await plugin.start();
    }
  }

  async stopAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.stop) await plugin.stop();
    }
  }

  private async dispatchOutbound(event: OutboundMessageEvent): Promise<void> {
    for (const plugin of this.plugins.values()) {
      const matched = plugin.matches ? plugin.matches(event) : true;
      if (!matched) continue;
      if (plugin.onOutbound) await plugin.onOutbound(event);
    }
  }
}
