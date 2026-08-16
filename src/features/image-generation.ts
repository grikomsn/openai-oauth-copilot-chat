/** Converts Responses image-generation results into VS Code image data. */

export interface GeneratedImage {
  data: Uint8Array;
  mimeType: string;
}

/**
 * Decodes the base64 result returned by the Responses image-generation tool.
 * Data URLs preserve their declared MIME type; bare results use signatures
 * when available and otherwise follow the API's default PNG output.
 */
export function decodeGeneratedImage(result: string): GeneratedImage {
  const dataUrl = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(result.trim());
  const mimeType = dataUrl?.[1]?.toLowerCase();
  const encoded = dataUrl?.[2] ?? result;
  const normalized = encoded.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized || !/^[a-z0-9+/]*={0,2}$/i.test(normalized)) {
    throw new Error("Codex returned an invalid generated image result");
  }

  const data = Buffer.from(normalized, "base64");
  if (!data.length) throw new Error("Codex returned an empty generated image result");
  return { data, mimeType: mimeType ?? detectImageMimeType(data) };
}

function detectImageMimeType(data: Uint8Array): string {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(data, 0, 4) === "GIF8") return "image/gif";
  if (ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 4) === "WEBP") return "image/webp";
  return "image/png";
}

function startsWith(data: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => data[index] === value);
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.slice(offset, offset + length));
}
