import { createHash } from "node:crypto";

export interface PromptCacheContext {
  model: string;
  instructions: string;
  tools: readonly Record<string, unknown>[];
  input: readonly Record<string, unknown>[];
}

export interface PromptCacheRequestFields {
  input: readonly Record<string, unknown>[];
  prompt_cache_key: string;
}

export interface PromptCacheTransportHeaders {
  "session-id": string;
  "thread-id": string;
}

export function createPromptCacheSessionId(promptCacheKey: string): string {
  const hash = createHash("sha256").update(`prompt-cache-session:v1:${promptCacheKey}`).digest("hex");
  const versioned = `${hash.slice(0, 12)}5${hash.slice(13, 16)}`;
  const variant = `${((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 20)}`;
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${variant}-${hash.slice(20, 32)}`;
}

export function createPromptCacheTransportHeaders(promptCacheKey: string): PromptCacheTransportHeaders {
  const sessionId = createPromptCacheSessionId(promptCacheKey);
  return { "session-id": sessionId, "thread-id": sessionId };
}

export function createPromptCacheKey(context: PromptCacheContext): string {
  // VS Code exposes no chat-session ID, so anchor the key to the stable request prefix.
  const firstUserMessage = context.input.findIndex((item) => item.type === "message" && item.role === "user");
  const rootLength = firstUserMessage >= 0 ? firstUserMessage + 1 : Math.min(1, context.input.length);
  const conversationRoot = context.input.slice(0, rootLength);
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    model: context.model,
    instructions: context.instructions,
    tools: context.tools,
    input: conversationRoot,
  })).digest("hex");
}

export function buildPromptCacheRequestFields(context: PromptCacheContext): PromptCacheRequestFields {
  return {
    input: context.input,
    prompt_cache_key: createPromptCacheKey(context),
  };
}
