import test from "node:test";
import assert from "node:assert/strict";
import { resolveMaterialTheme, resolveThemeMode } from "../../mobile/src/theme/material.ts";

test("theme preference resolves correctly", () => {
  assert.equal(resolveThemeMode("system", "dark"), "dark");
  assert.equal(resolveThemeMode("system", "light"), "light");
  assert.equal(resolveThemeMode("system", null), "light");
  assert.equal(resolveThemeMode("light", "dark"), "light");
  assert.equal(resolveThemeMode("dark", "light"), "dark");
});

test("resolved material theme returns readable token set", () => {
  const light = resolveMaterialTheme("light", "dark");
  const dark = resolveMaterialTheme("dark", "light");
  assert.equal(light.mode, "light");
  assert.equal(dark.mode, "dark");
  assert.notEqual(light.color.background, dark.color.background);
  assert.equal(typeof light.spacing(2), "number");
});
