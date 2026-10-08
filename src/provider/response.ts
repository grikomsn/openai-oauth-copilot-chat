/** Projection of normalized Responses stream events into VS Code response parts. */

import type * as vscode from "vscode";
import { decodeGeneratedImage } from "../features/image-generation";
import { ResponsesStreamParser, type CodexStreamEvent } from "../transport/responses";
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
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new ResponsesStreamParser();
  const reporter = new ResponseReporter(progress, parts);
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
  private thinkingOpen = false;

  constructor(
    private readonly progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    private readonly parts: ResponseParts,
  ) {}

  closeThinking(): void {
    if (!this.thinkingOpen) return;
    this.thinkingOpen = false;
    this.progress.report(new this.parts.LanguageModelThinkingPart("", "", { vscode_reasoning_done: true }));
  }

  report(event: CodexStreamEvent): void {
    if (event.error) throw new Error(event.error);
    if (event.reasoning) {
      this.thinkingOpen = true;
      this.progress.report(new this.parts.LanguageModelThinkingPart(event.reasoning));
    }
    if (event.reasoningBoundary || event.text || event.toolCall || event.imageGenerationCall || event.webSearchCall) this.closeThinking();
    if (event.text) this.progress.report(new this.parts.LanguageModelTextPart(event.text));
    if (event.encryptedReasoning) {
      this.progress.report(new this.parts.LanguageModelThinkingPart([], event.encryptedReasoning.id, {
        encrypted_content: event.encryptedReasoning.data,
        redactedData: event.encryptedReasoning.data,
      }));
    }
    if (event.toolCall) {
      this.progress.report(new this.parts.LanguageModelToolCallPart(event.toolCall.id, event.toolCall.name, parseArguments(event.toolCall.arguments)));
    }
    if (event.webSearchCall) reportDataPart(this.progress, this.parts, "web-search", event.webSearchCall);
    if (event.webSearchAnnotation) reportDataPart(this.progress, this.parts, "web-search-annotation", event.webSearchAnnotation);
    if (event.imageGenerationCall) {
      if (event.imageGenerationCall.status === "failed") throw new Error("Codex image generation failed");
      if (event.imageGenerationCall.result) {
        const image = decodeGeneratedImage(event.imageGenerationCall.result);
        this.progress.report(this.parts.LanguageModelDataPart.image(image.data, image.mimeType));
      }
    }
    if (event.usage) {
      const usage = toProviderUsagePayload(event.usage);
      if (usage) this.progress.report(new this.parts.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(usage)), "usage"));
    }
  }
}

function reportDataPart(
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
  parts: ResponseParts,
  kind: string,
  value: Record<string, unknown>,
): void {
  progress.report(new parts.LanguageModelDataPart(
    new TextEncoder().encode(JSON.stringify({ kind, ...value })),
    "application/vnd.openai.web-search+json",
  ));
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
