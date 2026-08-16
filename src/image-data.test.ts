import assert from "node:assert/strict";
import test from "node:test";
import { decodeGeneratedImage } from "./image-data";

test("decodes a PNG result and detects its MIME type", () => {
  const result = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  const image = decodeGeneratedImage(result);
  assert.equal(image.mimeType, "image/png");
  assert.deepEqual([...image.data], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test("preserves a data URL MIME type", () => {
  const result = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString("base64")}`;
  assert.equal(decodeGeneratedImage(result).mimeType, "image/jpeg");
});

test("rejects malformed image results", () => {
  assert.throws(() => decodeGeneratedImage("not base64?"), /invalid generated image/);
  assert.throws(() => decodeGeneratedImage(""), /invalid generated image/);
});
