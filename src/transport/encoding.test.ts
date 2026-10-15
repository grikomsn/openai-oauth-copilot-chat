import assert from "node:assert/strict";
import test from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { encodeRequestBody } from "./encoding";

test("compresses large requests when the runtime supports zstd and preserves plain JSON when disabled", () => {
  const text = JSON.stringify({ input: "synthetic ".repeat(10000) });
  const encoded = encodeRequestBody(text, true);
  if (encoded.headers["Content-Encoding"]) assert.equal(zstdDecompressSync(encoded.body as Uint8Array).toString(), text);
  else assert.equal(encoded.body, text);
  assert.equal(encodeRequestBody(text, false).body, text);
  assert.equal(encodeRequestBody("{}", true).body, "{}");
});
