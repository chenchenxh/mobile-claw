import test from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_SPECS,
  getProviderSpec,
  listVisibleProviderSpecs
} from "../core/gateway/provider-registry.ts";

test("provider registry exposes DeepSeek and MiniMax API Key defaults", () => {
  const deepseek = getProviderSpec("deepseek");
  const minimax = getProviderSpec("minimax");
  assert.ok(deepseek);
  assert.ok(minimax);
  assert.equal(deepseek?.defaultApiBase, "https://api.deepseek.com");
  assert.equal(minimax?.defaultApiBase, "https://api.minimax.io/anthropic");
  assert.ok(deepseek?.authModes.includes("BYOK"));
  assert.equal(deepseek?.authModes.includes("OAUTH"), false);
  assert.ok(minimax?.authModes.includes("BYOK"));
  assert.equal(minimax?.authModes.includes("OAUTH"), false);
});

test("visible providers only include UI-facing providers", () => {
  const visible = listVisibleProviderSpecs().map((p) => p.id);
  assert.deepEqual(visible, ["deepseek", "minimax"]);
  assert.ok(visible.includes("deepseek"));
  assert.ok(visible.includes("minimax"));
  assert.equal(PROVIDER_SPECS.length, visible.length);
});

test("visible providers only support API Key auth", () => {
  const deepseek = getProviderSpec("deepseek");
  const minimax = getProviderSpec("minimax");
  assert.deepEqual(deepseek?.authModes, ["BYOK"]);
  assert.deepEqual(minimax?.authModes, ["BYOK"]);
});
