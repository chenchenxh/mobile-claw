import test from "node:test";
import assert from "node:assert/strict";
import { MessageBus } from "../core/bus/message-bus.ts";
import { ChannelRegistry, type ChannelPlugin } from "../core/channel/registry.ts";

test("channel registry dispatches outbound events to matched plugins", async () => {
  const bus = new MessageBus();
  const registry = new ChannelRegistry();
  let received = "";

  const plugin: ChannelPlugin = {
    id: "mock",
    displayName: "Mock",
    matches: (event) => event.channelId.startsWith("ch_"),
    onOutbound: async (event) => {
      received = event.text;
    }
  };

  registry.register(plugin);
  registry.attachBus(bus);

  bus.publishOutbound({ channelId: "other", text: "ignore", ts: Date.now() });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(received, "");

  bus.publishOutbound({ channelId: "ch_1", text: "hello", ts: Date.now() });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(received, "hello");
});
