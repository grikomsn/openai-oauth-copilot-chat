/** Estimates VS Code input parts without turning image bytes into prompt text. */
export function estimateChatTokens(
  input: string | { readonly content: readonly unknown[] },
): number {
  if (typeof input === "string") return textTokens(input);
  // Include message framing even for an otherwise empty message.
  return 8 + input.content.reduce<number>((total, part) => total + partTokens(part), 0);
}

function partTokens(part: unknown): number {
  if (typeof part === "string") return textTokens(part);
  if (!part || typeof part !== "object") return 0;
  const value = part as Record<string, unknown>;
  if (typeof value.mimeType === "string") {
    // This is a heuristic, not a model-specific vision tokenizer.
    if (value.mimeType.startsWith("image/")) return 1024;
    if (value.mimeType.startsWith("text/") && value.data instanceof Uint8Array) {
      return textTokens(new TextDecoder().decode(value.data));
    }
    return 0;
  }
  // Tool results contain nested text/data parts, including proposed Part2 types.
  if (Array.isArray(value.content)) {
    return 8 + value.content.reduce<number>((total, nested) => total + partTokens(nested), 0);
  }
  if (typeof value.name === "string" && "input" in value) {
    return 8 + textTokens(value.name + JSON.stringify(value.input ?? {}));
  }
  // Text and thinking parts share value; thinking may contain multiple segments.
  if (typeof value.value === "string") return textTokens(value.value);
  if (Array.isArray(value.value)) {
    return value.value.reduce<number>((total, segment) => total + (typeof segment === "string" ? textTokens(segment) : 0), 0);
  }
  return 0;
}

function textTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
