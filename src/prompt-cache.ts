import { createHash, randomUUID } from "node:crypto";

/**
 * Stable request-prefix inputs used to derive a privacy-safe prompt-cache key.
 *
 * @example
 * ```ts
 * const context: PromptCacheContext = {
 *   model: "gpt-5.6-sol",
 *   instructions: "Act as a coding assistant.",
 *   tools: [],
 *   input: [{ type: "message", role: "user", content: [] }],
 * };
 * ```
 *
 * @see {@link createPromptCacheKey}
 */
export interface PromptCacheContext {
  model: string;
  instructions: string;
  tools: readonly Record<string, unknown>[];
  input: readonly Record<string, unknown>[];
}

/**
 * Request fields added to a stateless Responses API body for cache routing.
 *
 * @example
 * ```ts
 * const fields = buildPromptCacheRequestFields(context);
 * console.log(fields.prompt_cache_key);
 * ```
 *
 * @see {@link buildPromptCacheRequestFields}
 */
export interface PromptCacheRequestFields {
  input: readonly Record<string, unknown>[];
  prompt_cache_key: string;
}

/**
 * Transport identities used alongside a prompt-cache key.
 *
 * @example
 * ```ts
 * const headers = createPromptCacheTransportHeaders("cache-key");
 * console.log(headers["session-id"] !== headers["thread-id"]);
 * ```
 *
 * @see {@link createPromptCacheTransportHeaders}
 */
export interface PromptCacheTransportHeaders {
  "session-id": string;
  "thread-id": string;
}

/**
 * Derives a deterministic UUID-shaped session id from a prompt-cache key.
 *
 * @example
 * ```ts
 * const sessionId = createPromptCacheAffinitySessionId("cache-key");
 * ```
 *
 * @see {@link createPromptCacheKey}
 * @see {@link createPromptCacheTransportHeaders}
 */
export function createPromptCacheAffinitySessionId(promptCacheKey: string): string {
  const hash = createHash("sha256").update(`prompt-cache-session:v1:${promptCacheKey}`).digest("hex");
  // Preserve UUID version and variant bits while keeping the value deterministic.
  const versioned = `${hash.slice(0, 12)}5${hash.slice(13, 16)}`;
  const variant = `${((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 20)}`;
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${variant}-${hash.slice(20, 32)}`;
}

/**
 * Builds stable cache-affinity and fresh per-request transport headers.
 *
 * @example
 * ```ts
 * const headers = createPromptCacheTransportHeaders(createPromptCacheKey(context));
 * ```
 *
 * @see {@link createPromptCacheAffinitySessionId}
 * @see {@link PromptCacheTransportHeaders}
 */
export function createPromptCacheTransportHeaders(promptCacheKey: string): PromptCacheTransportHeaders {
  // Session identity routes eligible cache prefixes; thread identity must never be reused across requests.
  return {
    "session-id": createPromptCacheAffinitySessionId(promptCacheKey),
    "thread-id": randomUUID(),
  };
}

/**
 * Hashes the model, instructions, tools, and stable opening input without exposing prompt text.
 * Later conversation turns and tool results do not change the key.
 *
 * @example
 * ```ts
 * const key = createPromptCacheKey(context);
 * console.log(key.length); // 64 hexadecimal characters
 * ```
 *
 * @see {@link PromptCacheContext}
 * @see {@link buildPromptCacheRequestFields}
 */
export function createPromptCacheKey(context: PromptCacheContext): string {
  // VS Code exposes no chat-session ID, so anchor the key to the stable request prefix.
  const firstUserMessage = context.input.findIndex((item) => item.type === "message" && item.role === "user");
  const rootLength = firstUserMessage >= 0 ? firstUserMessage + 1 : Math.min(1, context.input.length);
  // Include the first user turn only; appending assistant/tool history must preserve cache affinity.
  const conversationRoot = context.input.slice(0, rootLength);
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    model: context.model,
    instructions: context.instructions,
    tools: context.tools,
    input: conversationRoot,
  })).digest("hex");
}

/**
 * Returns the original input plus its deterministic prompt-cache key.
 *
 * @example
 * ```ts
 * const request = { model: context.model, ...buildPromptCacheRequestFields(context) };
 * ```
 *
 * @see {@link createPromptCacheKey}
 * @see {@link PromptCacheRequestFields}
 */
export function buildPromptCacheRequestFields(context: PromptCacheContext): PromptCacheRequestFields {
  return {
    input: context.input,
    prompt_cache_key: createPromptCacheKey(context),
  };
}
