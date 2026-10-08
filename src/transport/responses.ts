/** Responses streaming primitives used by the VS Code provider. */

import { randomUUID } from "node:crypto";

interface FunctionCall {
  id?: string;
  name?: string;
  arguments?: string;
  fragments: Array<{ order: number; text: string }>;
  emitted: boolean;
  finished: boolean;
}

/** A normalized event emitted by the Codex Responses SSE parser. */
export interface CodexStreamEvent {
  text?: string;
  reasoning?: string;
  reasoningBoundary?: true;
  encryptedReasoning?: { id: string; data: string };
  toolCall?: { id: string; name: string; arguments: string };
  webSearchCall?: { id: string; status?: string; action?: Record<string, unknown> };
  webSearchAnnotation?: Record<string, unknown>;
  imageGenerationCall?: { id: string; status?: string; result?: string };
  usage?: Record<string, unknown>;
  error?: string;
}

/**
 * Incrementally parses server-sent events from the Codex Responses endpoint.
 *
 * The parser tolerates incomplete chunks and unknown event types so transport
 * changes do not interrupt an otherwise valid response.
 *
 * @see {@link OpenAICodexProvider} in `provider.ts`
 */
export class ResponsesStreamParser {
  private buffer = "";
  private readonly calls = new Map<string, FunctionCall>();
  private readonly reasoningItems = new Set<string>();
  private readonly requestId = randomUUID();
  private nextCallId = 0;
  private fragmentOrder = 0;
  private completed = false;
  private readonly imageGenerationCalls = new Set<string>();
  private textDeltaSeen = false;

  /**
   * Adds a transport chunk and returns every complete event it contains.
   *
   * @param chunk A UTF-8 SSE chunk decoded as text.
   */
  push(chunk: string): CodexStreamEvent[] {
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, "\n");
    const events: CodexStreamEvent[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n\n")) >= 0) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const event = this.parseBlock(block);
      if (event) events.push(...event);
    }
    return events;
  }

  /** Flushes the final unterminated SSE block, if one exists. */
  finish(): CodexStreamEvent[] {
    const tail = this.buffer.trim();
    this.buffer = "";
    return tail ? this.parseBlock(tail) ?? [] : [];
  }

  /** A transport EOF is successful only after the response completed. */
  validateCompletion(): void {
    if (!this.completed) throw new Error("Codex response stream ended before response.completed");
    if ([...this.calls.values()].some((call) => !call.emitted)) throw new Error("Codex response ended with an unfinished function call");
  }

  private callFor(value: Record<string, unknown>, item: Record<string, unknown> = value): FunctionCall {
    const aliases = [
      stringField(item, "id") ?? stringField(value, "item_id"),
      stringField(item, "call_id") ?? stringField(value, "call_id"),
      typeof value.output_index === "number" ? `index:${value.output_index}` : undefined,
    ].filter((alias): alias is string => alias !== undefined);
    const matches = [...new Set(aliases.map((alias) => this.calls.get(alias)).filter((call): call is FunctionCall => call !== undefined))];
    const call = matches[0] ?? { fragments: [], emitted: false, finished: false };
    for (const other of matches.slice(1)) {
      call.fragments.push(...other.fragments);
      call.id ??= other.id;
      call.name ??= other.name;
      call.arguments ??= other.arguments;
      call.emitted ||= other.emitted;
      call.finished ||= other.finished;
      for (const [alias, state] of this.calls) if (state === other) this.calls.set(alias, call);
    }
    for (const alias of aliases) this.calls.set(alias, call);
    call.id = stringField(item, "call_id") ?? call.id;
    call.name = stringField(item, "name") ?? call.name;
    return call;
  }

  private emitCall(call: FunctionCall, final: boolean): CodexStreamEvent[] {
    if (call.emitted) return [];
    const args = call.arguments ?? (call.fragments.sort((a, b) => a.order - b.order).map((fragment) => fragment.text).join(""));
    try {
      const parsed: unknown = JSON.parse(args);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !call.name) throw new Error("Invalid function call");
    } catch {
      return final ? [{ error: "Codex returned an incomplete or invalid function call" }] : [];
    }
    call.emitted = true;
    return [{ toolCall: { id: call.id!, name: call.name!, arguments: args } }];
  }

  private outputItem(value: Record<string, unknown>, item: Record<string, unknown>, final = false): CodexStreamEvent[] {
    if (item.type === "function_call") {
      const call = this.callFor(value, item);
      call.id ??= stringField(item, "id") ?? `codex-tool-${this.requestId}-${++this.nextCallId}`;
      call.arguments = stringField(item, "arguments") ?? call.arguments;
      call.finished = true;
      return this.emitCall(call, final);
    }
    if (item.type === "reasoning") {
      const encrypted = stringField(item, "encrypted_content");
      const id = stringField(item, "id") ?? `reasoning-${this.requestId}-${++this.nextCallId}`;
      if (encrypted && !this.reasoningItems.has(id)) {
        this.reasoningItems.add(id);
        return [{ encryptedReasoning: { id, data: encrypted } }];
      }
    }
    if (item.type === "web_search_call") return [{ webSearchCall: {
      id: stringField(item, "id") ?? `web-search-${this.requestId}-${++this.nextCallId}`,
      status: stringField(item, "status"), action: recordField(item, "action"),
    } }];
    const imageEvent = imageGenerationEvent(item, this.imageGenerationCalls);
    return imageEvent ? [imageEvent] : [];
  }

  private parseBlock(block: string): CodexStreamEvent[] | undefined {
    const data = block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return undefined;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    const type = typeof value.type === "string" ? value.type : "";
    const delta = typeof value.delta === "string" ? value.delta : "";
    if (type === "response.output_text.delta" && delta) {
      this.textDeltaSeen = true;
      return [{ text: delta }];
    }
    if ((type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") && delta) {
      return [{ reasoning: delta }];
    }
    if (type === "response.reasoning_summary_part.done") {
      return [{ reasoningBoundary: true }];
    }
    if (type === "response.output_item.added") {
      const item = recordField(value, "item");
      if (item?.type === "function_call") this.callFor(value, item);
    }
    if (type === "response.function_call_arguments.delta") {
      this.callFor(value).fragments.push({ order: this.fragmentOrder++, text: delta });
      return undefined;
    }
    if (type === "response.function_call_arguments.done") {
      const call = this.callFor(value);
      call.arguments = stringField(value, "arguments") ?? call.arguments;
      return call.finished ? this.emitCall(call, false) : undefined;
    }
    if (type === "response.output_text.annotation.added") {
      const annotation = recordField(value, "annotation");
      return annotation ? [{ webSearchAnnotation: annotation }] : undefined;
    }
    if (type === "response.output_item.done") {
      const item = recordField(value, "item");
      return item ? this.outputItem(value, item) : undefined;
    }
    if (type === "response.completed") {
      const response = recordField(value, "response");
      if (response?.status && response.status !== "completed") return [{ error: "Codex response did not complete" }];
      this.completed = true;
      const events: CodexStreamEvent[] = [];
      const output = response?.output;
      if (Array.isArray(output)) {
        for (const [output_index, item] of output.entries()) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const outputItem = item as Record<string, unknown>;
            events.push(...this.outputItem({ output_index }, outputItem, true));
            if (!this.textDeltaSeen) {
              const text = responseOutputText(outputItem);
              if (text) events.push({ text });
            }
          }
        }
      }
      for (const call of new Set(this.calls.values())) if (call.finished && !call.emitted) events.push(...this.emitCall(call, true));
      const usage = recordField(response ?? {}, "usage");
      if (usage) events.push({ usage });
      return events.length ? events : undefined;
    }
    if (type === "response.incomplete") return [{ error: "Codex response is incomplete" }];
    if (type === "error" || type === "response.failed") {
      const error = recordField(value, "error") ?? recordField(recordField(value, "response") ?? {}, "error");
      return [{ error: stringField(error ?? {}, "message") ?? "Codex stream failed" }];
    }
    return undefined;
  }
}

function responseOutputText(item: Record<string, unknown>): string | undefined {
  if (item.type !== "message" || !Array.isArray(item.content)) return undefined;
  const text = item.content.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const part = value as Record<string, unknown>;
    return (part.type === "output_text" || part.type === "text") && typeof part.text === "string" ? [part.text] : [];
  }).join("");
  return text || undefined;
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const field = value[key];
  return field && typeof field === "object" && !Array.isArray(field) ? field as Record<string, unknown> : undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] as string : undefined;
}

function imageGenerationEvent(
  item: Record<string, unknown>,
  emitted: Set<string>,
): CodexStreamEvent | undefined {
  if (item.type !== "image_generation_call") return undefined;
  const id = stringField(item, "id") ?? `image-generation-${Date.now()}`;
  const status = stringField(item, "status");
  const result = stringField(item, "result");
  if (!result && status !== "failed") return undefined;
  if (emitted.has(id)) return undefined;
  emitted.add(id);
  return { imageGenerationCall: { id, status, ...(result ? { result } : {}) } };
}
