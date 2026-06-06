import test from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_SPECS,
  getProviderSpec,
  listVisibleProviderSpecs
} from "../core/gateway/provider-registry.ts";

test("provider registry exposes openai and minimax defaults", () => {
  const openai = getProviderSpec("openai");
  const minimax = getProviderSpec("minimax");
  assert.ok(openai);
  assert.ok(minimax);
  assert.equal(openai?.defaultApiBase, "https://api.openai.com/v1");
  assert.equal(minimax?.defaultApiBase, "https://api.minimax.io/anthropic");
  assert.ok(openai?.authModes.includes("BYOK"));
  assert.ok(minimax?.authModes.includes("OAUTH"));
});

test("visible providers only include UI-facing providers", () => {
  const visible = listVisibleProviderSpecs().map((p) => p.id);
  assert.ok(visible.includes("openai"));
  assert.ok(visible.includes("minimax"));
  assert.equal(visible.includes("google"), false);
  assert.ok(PROVIDER_SPECS.length >= visible.length);
});

test("oauth presets are built-in for openai/minimax to support zero-parameter default flow", () => {
  const openai = getProviderSpec("openai");
  const minimax = getProviderSpec("minimax");
  assert.ok(openai?.oauthPreset);
  assert.ok(minimax?.oauthPreset);
  assert.ok((openai?.oauthPreset?.clientId ?? "").length > 0);
  assert.ok((minimax?.oauthPreset?.clientId ?? "").length > 0);
  assert.ok((openai?.oauthPreset?.authEndpoint ?? "").startsWith("https://"));
  assert.ok((minimax?.oauthPreset?.tokenEndpoint ?? "").startsWith("https://"));
  assert.match(minimax?.oauthPreset?.authEndpoint ?? "", /\/oauth\/code$/);
  assert.match(minimax?.oauthPreset?.tokenEndpoint ?? "", /\/oauth\/token$/);
});
