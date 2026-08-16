/** OpenAI-hosted Responses tools enabled by model-picker options. */

import type { ModelRequestOptions } from "./model-options";

/** Builds the provider-owned native tool descriptors for one request. */
export function buildNativeTools(
  options: Pick<ModelRequestOptions, "webSearch" | "imageGeneration">,
): Record<string, unknown>[] {
  return [
    ...(options.webSearch ? [{ type: "web_search" }] : []),
    ...(options.imageGeneration ? [{ type: "image_generation" }] : []),
  ];
}
