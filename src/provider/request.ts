/** Construction of stateless ChatGPT Codex Responses requests. */

import * as vscode from "vscode";
import { applyModelRequestOptions, type ModelRequestOptions } from "../models/options";
import { buildPromptCacheRequestFields } from "../features/prompt-cache";
import { buildClientTools } from "../tools/client-tools";
import { buildHostedTools } from "../tools/hosted-tools";
import { convertMessages } from "./messages";

const DEFAULT_INSTRUCTIONS = "You are OpenAI Codex, a coding agent in Visual Studio Code. Be concise, correct, and use the supplied tools when useful.";

export function buildRequest(
  model: string,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  requestOptions: ModelRequestOptions,
  supportsParallelToolCalls: boolean,
  supportsReasoningSummaryParameter: boolean,
): Record<string, unknown> {
  const allTools = [...buildHostedTools(requestOptions), ...buildClientTools(options.tools)];
  const convertedInput = convertMessages(messages);
  const input = convertedInput.length
    ? convertedInput
    : [{ type: "message", role: "user", content: [{ type: "input_text", text: "" }] }];
  const promptCache = buildPromptCacheRequestFields({ model, instructions: DEFAULT_INSTRUCTIONS, tools: allTools, input });
  return applyModelRequestOptions({
    model,
    instructions: DEFAULT_INSTRUCTIONS,
    ...promptCache,
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
    ...(allTools.length ? {
      tools: allTools,
      tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto",
      parallel_tool_calls: supportsParallelToolCalls,
    } : {}),
  }, requestOptions, supportsReasoningSummaryParameter);
}
