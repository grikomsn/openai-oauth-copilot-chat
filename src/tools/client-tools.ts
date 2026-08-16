/** Conversion of caller-executed VS Code tools to Responses API function tools. */

import * as vscode from "vscode";

export function buildClientTools(
  tools: readonly vscode.LanguageModelChatTool[] | undefined,
): Array<Record<string, unknown>> {
  return (tools ?? []).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema && typeof tool.inputSchema === "object"
      ? tool.inputSchema
      : { type: "object", properties: {} },
    strict: false,
  }));
}
