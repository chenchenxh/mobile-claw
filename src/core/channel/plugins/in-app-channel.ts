import type { OutboundMessageEvent } from "../../bus/events.ts";
import type { ChannelPlugin } from "../registry.ts";

export class InAppChannelPlugin implements ChannelPlugin {
  readonly id = "in_app";
  readonly displayName = "In-App Channel";
  private readonly sent: OutboundMessageEvent[] = [];

  matches(): boolean {
    return true;
  }

  async onOutbound(event: OutboundMessageEvent): Promise<void> {
    this.sent.push(event);
    // Keep a small ring buffer for diagnostics.
    if (this.sent.length > 100) this.sent.splice(0, this.sent.length - 100);
  }

  listRecent(limit = 20): OutboundMessageEvent[] {
    return this.sent.slice(-limit);
  }
}
