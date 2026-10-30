import test from "node:test";
import { resolve } from "node:path";

class TextPart { constructor(readonly value: string) {} }
class ThinkingPart { constructor(readonly value: string, readonly id?: string, readonly metadata?: Record<string, unknown>) {} }
class ToolCallPart { constructor(readonly callId: string, readonly name: string, readonly input: object) {} }
class ToolResultPart { constructor(readonly callId: string, readonly content: unknown[]) {} }
class DataPart { constructor(readonly data: Uint8Array, readonly mimeType: string) {} }
class Emitter {
  private readonly listeners = new Set<(value: unknown) => void>();
  readonly event = (listener: (value: unknown) => void): { dispose(): void } => {
    this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } };
  };
  fire(value?: unknown): void { for (const listener of this.listeners) listener(value); }
  dispose(): void { this.listeners.clear(); }
}
class Cancellation {
  private readonly emitter = new Emitter();
  readonly token = { isCancellationRequested: false, onCancellationRequested: this.emitter.event };
  cancel(): void { this.token.isCancellationRequested = true; this.emitter.fire(); }
  dispose(): void { this.emitter.dispose(); }
}

test("injected HTTP exercises stream and catalog isolation end to end", async () => {
  const values = new Map<string, unknown>();
  const configuration = {
    get: (key: string, fallback?: unknown): unknown => values.get(key) ?? fallback,
    inspect: (key: string): { globalValue: unknown } => ({ globalValue: values.get(key) }),
    update: async (key: string, value: unknown): Promise<void> => { values.set(key, value); },
  };
  const fake = {
    EventEmitter: Emitter, CancellationTokenSource: Cancellation,
    LanguageModelTextPart: TextPart, LanguageModelThinkingPart: ThinkingPart,
    LanguageModelToolCallPart: ToolCallPart, LanguageModelToolResultPart: ToolResultPart,
    LanguageModelDataPart: DataPart, LanguageModelToolResult: class { constructor(readonly content: unknown[]) {} },
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 }, LanguageModelChatToolMode: { Required: 2 },
    LanguageModelChatMessage: {
      User: (value: string | unknown[]) => ({ role: 1, content: typeof value === "string" ? [new TextPart(value)] : value }),
      Assistant: (content: unknown[]) => ({ role: 2, content }),
    },
    ConfigurationTarget: { Global: 1 }, workspace: { getConfiguration: () => configuration },
  };
  type Loader = (name: string, parent: unknown, main?: boolean) => unknown;
  const runtime = require("node:module") as { _load: Loader };
  const original = runtime._load;
  runtime._load = function(name, parent, main): unknown {
    return name === "vscode" ? fake : original.call(this, name, parent, main);
  };
  try {
    const fixture = require(resolve("test/native/index.js")) as { run(): Promise<void> };
    await fixture.run();
  } finally { runtime._load = original; }
});
