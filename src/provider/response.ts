/** Projection of normalized Responses stream events into VS Code response parts. */

import type * as vscode from "vscode";
import { decodeGeneratedImage } from "../features/image-generation";
import { ResponsesStreamParser, type CodexStreamEvent } from "../transport/responses";
import { ResponseWriter } from "../kit/response-writer";
import { toProviderUsagePayload } from "../usage/domain";

export interface ResponseParts {
  LanguageModelTextPart: typeof vscode.LanguageModelTextPart;
  LanguageModelThinkingPart: typeof vscode.LanguageModelThinkingPart;
  LanguageModelToolCallPart: typeof vscode.LanguageModelToolCallPart;
  LanguageModelDataPart: typeof vscode.LanguageModelDataPart;
}

export async function consumeStream(
  body: ReadableStream<Uint8Array>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
  token: vscode.CancellationToken,
  parts: ResponseParts,
  onUsage?: (usage: Record<string, unknown>) => void,
  toolNamespace?: string,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new ResponsesStreamParser();
  const reporter = new ResponseReporter(progress, parts, toolNamespace);
  const report = (events: CodexStreamEvent[]): void => {
    for (const event of events) {
      reporter.report(event);
      if (event.usage) onUsage?.(event.usage);
    }
  };
  const cancellation = token.onCancellationRequested(() => { void reader.cancel().catch(() => undefined); });
  let finished = false;
  try {
    if (token.isCancellationRequested) return;
    while (true) {
      const result = await reader.read();
      if (token.isCancellationRequested) return;
      if (result.done) break;
      report(parser.push(decoder.decode(result.value, { stream: true })));
    }
    report(parser.push(decoder.decode()));
    report(parser.finish());
    parser.validateCompletion();
    finished = true;
  } finally {
    reporter.closeThinking();
    cancellation.dispose();
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** One reporter per response keeps each reasoning segment separate from visible output. */
export class ResponseReporter {
  private readonly writer: ResponseWriter;
  static nextReporterId = 0;

  constructor(
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    private readonly parts: ResponseParts,
    private readonly toolNamespace?: string,
  ) {
    this.writer = new ResponseWriter(progress, parts, "codex", String(ResponseReporter.nextReporterId++));
  }

  closeThinking(): void {
    this.writer.closeThinking();
  }

  report(event: CodexStreamEvent): void {
    if (event.failure) throw event.failure;
    if (event.error) throw new Error(event.error);
    if (event.reasoning) this.writer.thinking(event.reasoning);
    if (event.reasoningBoundary || event.text || event.toolCall || event.imageGenerationCall || event.webSearchCall) this.writer.closeThinking();
    if (event.text) this.writer.text(event.text);
    if (event.encryptedReasoning) {
      // Opaque reasoning rides along without opening or closing a visible segment.
      this.writer.report(new this.parts.LanguageModelThinkingPart([], event.encryptedReasoning.id, {
        encrypted_content: event.encryptedReasoning.data,
        redactedData: event.encryptedReasoning.data,
      }), { closesThinking: false });
    }
    if (event.toolCall) {
      if (this.toolNamespace && event.toolCall.namespace && event.toolCall.namespace !== this.toolNamespace) throw new Error("ChatGPT returned a tool from an unknown namespace.");
      this.writer.toolCall(event.toolCall.id, event.toolCall.name, parseArguments(event.toolCall.arguments));
    }
    if (event.webSearchCall) this.writer.report(dataPart(this.parts, "web-search", event.webSearchCall));
    if (event.webSearchAnnotation) this.writer.report(dataPart(this.parts, "web-search-annotation", event.webSearchAnnotation), { closesThinking: false });
    if (event.imageGenerationCall) {
      if (event.imageGenerationCall.status === "failed") throw new Error("Codex image generation failed");
      if (event.imageGenerationCall.result) {
        const image = decodeGeneratedImage(event.imageGenerationCall.result);
        this.writer.report(this.parts.LanguageModelDataPart.image(image.data, image.mimeType));
      }
    }
    if (event.usage) this.writer.usage(toProviderUsagePayload(event.usage));
  }
}

function dataPart(parts: ResponseParts, kind: string, value: Record<string, unknown>): vscode.LanguageModelDataPart {
  return new parts.LanguageModelDataPart(
    new TextEncoder().encode(JSON.stringify({ kind, ...value })),
    "application/vnd.openai.web-search+json",
  );
}

function parseArguments(value: string): object {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid arguments");
    return parsed as object;
  } catch {
    throw new Error("Codex returned invalid function arguments");
  }
}
