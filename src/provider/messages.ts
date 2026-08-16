/** Conversion between VS Code chat history and Responses API input items. */

import * as vscode from "vscode";

export type InputItem = Record<string, unknown>;

export function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): InputItem[] {
  return messages.flatMap(convertMessage);
}

export function convertMessage(message: vscode.LanguageModelChatRequestMessage): InputItem[] {
  const assistant = message.role === vscode.LanguageModelChatMessageRole.Assistant;
  const content: Array<Record<string, unknown>> = [];
  const extra: InputItem[] = [];
  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelTextPart && part.value) {
      content.push({ type: assistant ? "output_text" : "input_text", text: part.value });
    } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
      content.push({ type: "input_image", detail: "auto", image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}` });
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      extra.push({ type: "function_call", call_id: part.callId, name: part.name, arguments: JSON.stringify(part.input ?? {}) });
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      extra.push({ type: "function_call_output", call_id: part.callId, output: part.content.map(partText).join("\n") });
    } else if (part instanceof vscode.LanguageModelThinkingPart) {
      const encrypted = part.metadata?.encrypted_content ?? part.metadata?.redactedData;
      if (typeof encrypted === "string") extra.push({ type: "reasoning", summary: [], encrypted_content: encrypted });
    }
  }
  const items: InputItem[] = content.length ? [{ type: "message", role: assistant ? "assistant" : "user", content }] : [];
  return [...items, ...extra];
}

export function partText(part: vscode.LanguageModelInputPart | unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) return part.value;
  if (part instanceof vscode.LanguageModelToolCallPart) return JSON.stringify(part.input ?? {});
  if (part instanceof vscode.LanguageModelToolResultPart) return part.content.map(partText).join("\n");
  return typeof part === "string" ? part : "";
}
