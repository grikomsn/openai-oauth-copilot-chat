/** Projection of normalized Responses stream events into VS Code response parts. */

import * as vscode from "vscode";
import { decodeGeneratedImage } from "../features/image-generation";
import { ResponsesStreamParser, type CodexStreamEvent } from "../transport/responses";
import { toProviderUsagePayload } from "../usage/domain";

export async function consumeStream(
  body: ReadableStream<Uint8Array>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
  token: vscode.CancellationToken,
  onUsage?: (usage: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new ResponsesStreamParser();
  while (true) {
    if (token.isCancellationRequested) {
      await reader.cancel();
      return;
    }
    const result = await reader.read();
    if (result.done) break;
    for (const event of parser.push(decoder.decode(result.value, { stream: true }))) {
      reportEvent(event, progress);
      if (event.usage) onUsage?.(event.usage);
    }
  }
  for (const event of parser.finish()) {
    reportEvent(event, progress);
    if (event.usage) onUsage?.(event.usage);
  }
}

export function reportEvent(
  event: CodexStreamEvent,
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
): void {
  if (event.error) throw new Error(event.error);
  if (event.text) progress.report(new vscode.LanguageModelTextPart(event.text));
  if (event.reasoning) {
    const ThinkingPart = (vscode as unknown as { LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart }).LanguageModelThinkingPart;
    if (ThinkingPart) progress.report(new ThinkingPart(event.reasoning));
  }
  if (event.reasoningBoundary) {
    const ThinkingPart = (vscode as unknown as { LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart }).LanguageModelThinkingPart;
    if (ThinkingPart) progress.report(new ThinkingPart("", "", { vscode_reasoning_done: true }));
  }
  if (event.encryptedReasoning) {
    const ThinkingPart = (vscode as unknown as { LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart }).LanguageModelThinkingPart;
    if (ThinkingPart) progress.report(new ThinkingPart([], event.encryptedReasoning.id, {
      encrypted_content: event.encryptedReasoning.data,
      redactedData: event.encryptedReasoning.data,
    }));
  }
  if (event.toolCall) {
    progress.report(new vscode.LanguageModelToolCallPart(event.toolCall.id, event.toolCall.name, parseArguments(event.toolCall.arguments)));
  }
  if (event.webSearchCall) reportDataPart(progress, "web-search", event.webSearchCall);
  if (event.webSearchAnnotation) reportDataPart(progress, "web-search-annotation", event.webSearchAnnotation);
  if (event.imageGenerationCall) {
    if (event.imageGenerationCall.status === "failed") throw new Error("Codex image generation failed");
    if (event.imageGenerationCall.result) {
      const image = decodeGeneratedImage(event.imageGenerationCall.result);
      progress.report(vscode.LanguageModelDataPart.image(image.data, image.mimeType));
    }
  }
  if (event.usage) {
    const usage = toProviderUsagePayload(event.usage);
    if (usage) progress.report(new vscode.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(usage)), "usage"));
  }
}

function reportDataPart(
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
  kind: string,
  value: Record<string, unknown>,
): void {
  progress.report(new vscode.LanguageModelDataPart(
    new TextEncoder().encode(JSON.stringify({ kind, ...value })),
    "application/vnd.openai.web-search+json",
  ));
}

function parseArguments(value: string): object {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed as object : { value: parsed };
  } catch {
    return { value };
  }
}
