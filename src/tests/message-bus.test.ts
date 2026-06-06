import test from "node:test";
import assert from "node:assert/strict";
import { MessageBus } from "../core/bus/message-bus.ts";

test("message bus publish/consume and listener flow", async () => {
  const bus = new MessageBus();
  let outboundSeen = "";

  const off = bus.onOutbound((event) => {
    outboundSeen = event.text;
  });

  bus.publishInbound({ channelId: "ch1", text: "hello", ts: Date.now() });
  const inbound = await bus.consumeInbound();
  assert.equal(inbound.channelId, "ch1");
  assert.equal(inbound.text, "hello");

  bus.publishOutbound({ channelId: "ch1", text: "world", ts: Date.now() });
  const outbound = await bus.consumeOutbound();
  assert.equal(outbound.text, "world");
  assert.equal(outboundSeen, "world");

  off();
});
