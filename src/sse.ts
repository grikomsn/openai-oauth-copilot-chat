export interface CodexStreamEvent {
  text?: string;
  reasoning?: string;
  reasoningBoundary?: true;
  encryptedReasoning?: { id: string; data: string };
  toolCall?: { id: string; name: string; arguments: string };
  usage?: Record<string, unknown>;
  error?: string;
}

export class ResponsesStreamParser {
  private buffer = "";
  private readonly toolArguments = new Map<string, string>();

  push(chunk: string): CodexStreamEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
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

  finish(): CodexStreamEvent[] {
    const tail = this.buffer.trim();
    this.buffer = "";
    return tail ? this.parseBlock(tail) ?? [] : [];
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
    if (type === "response.output_text.delta" && delta) return [{ text: delta }];
    if ((type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") && delta) {
      return [{ reasoning: delta }];
    }
    if (type === "response.reasoning_summary_part.done") {
      return [{ reasoningBoundary: true }];
    }
    if (type === "response.function_call_arguments.delta") {
      const id = stringField(value, "item_id") ?? stringField(value, "call_id") ?? String(value.output_index ?? "tool");
      this.toolArguments.set(id, (this.toolArguments.get(id) ?? "") + delta);
      return undefined;
    }
    if (type === "response.output_item.done") {
      const item = recordField(value, "item");
      if (item?.type === "function_call") {
        const id = stringField(item, "call_id") ?? stringField(item, "id") ?? `codex-tool-${Date.now()}`;
        const args = stringField(item, "arguments") ?? this.toolArguments.get(stringField(item, "id") ?? id) ?? "{}";
        return [{ toolCall: { id, name: stringField(item, "name") ?? "tool", arguments: args } }];
      }
      if (item?.type === "reasoning") {
        const encrypted = stringField(item, "encrypted_content");
        if (encrypted) return [{ encryptedReasoning: { id: stringField(item, "id") ?? `reasoning-${Date.now()}`, data: encrypted } }];
      }
    }
    if (type === "response.completed") {
      const response = recordField(value, "response");
      const usage = recordField(response ?? {}, "usage");
      return usage ? [{ usage }] : undefined;
    }
    if (type === "error" || type === "response.failed") {
      const error = recordField(value, "error") ?? recordField(recordField(value, "response") ?? {}, "error");
      return [{ error: stringField(error ?? {}, "message") ?? "Codex stream failed" }];
    }
    return undefined;
  }
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const field = value[key];
  return field && typeof field === "object" && !Array.isArray(field) ? field as Record<string, unknown> : undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] as string : undefined;
}
