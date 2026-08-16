/** Server-executed tools understood by the ChatGPT Codex Responses backend. */

import type { ModelRequestOptions } from "../models/options";

export function buildHostedTools(
  options: Pick<ModelRequestOptions, "webSearch" | "imageGeneration">,
): Record<string, unknown>[] {
  return [
    ...(options.webSearch ? [{ type: "web_search" }] : []),
    ...(options.imageGeneration ? [{ type: "image_generation" }] : []),
  ];
}
