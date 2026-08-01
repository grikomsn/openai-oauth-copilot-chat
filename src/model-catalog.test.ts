import assert from "node:assert/strict";
import test from "node:test";
import { CODEX_MODELS } from "./model-catalog";

test("exposes the current visible Codex model metadata", () => {
  assert.deepEqual(CODEX_MODELS, [
    { id: "gpt-5.6-sol", input: 272_000, output: 128_000, image: true },
    { id: "gpt-5.6-terra", input: 272_000, output: 128_000, image: true },
    { id: "gpt-5.6-luna", input: 272_000, output: 128_000, image: true },
    { id: "gpt-5.5", input: 272_000, output: 128_000, image: true },
    { id: "gpt-5.2", input: 272_000, output: 128_000, image: true },
  ]);
});
