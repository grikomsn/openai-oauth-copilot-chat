/** Optional encoding for the ChatGPT endpoints that accept zstd requests. */
import * as zlib from "node:zlib";

export function encodeRequestBody(text: string, enabled: boolean): { body: BodyInit; headers: Record<string, string> } {
  if (!enabled || Buffer.byteLength(text) < 1024 || typeof zlib.zstdCompressSync !== "function") return { body: text, headers: {} };
  try {
    const compressed = zlib.zstdCompressSync(text);
    if (compressed.byteLength >= Buffer.byteLength(text)) return { body: text, headers: {} };
    return { body: Uint8Array.from(compressed), headers: { "Content-Encoding": "zstd" } };
  } catch { return { body: text, headers: {} }; }
}
