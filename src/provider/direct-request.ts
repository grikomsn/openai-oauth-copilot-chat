/** Request restrictions for the ChatGPT plan public API route. */
export const DIRECT_TOOL_NAMESPACE = "copilot";

export function adaptDirectRequest(body: Record<string, unknown>): Record<string, unknown> {
  const allowed = ["model", "instructions", "input", "include", "reasoning", "text", "prompt_cache_key", "tool_choice", "parallel_tool_calls"];
  const request = Object.fromEntries(allowed.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
  const tools = Array.isArray(body.tools) ? body.tools.filter(isRecord) : [];
  const functions = tools.filter((tool) => tool.type === "function");
  const hosted = tools.filter((tool) => tool.type === "web_search");
  const directTools = [
    ...(functions.length ? [{ type: "namespace", name: DIRECT_TOOL_NAMESPACE, description: "Tools executed by GitHub Copilot in Visual Studio Code.", tools: functions }] : []),
    ...hosted,
  ];
  if (directTools.length) request.tools = directTools;
  else { delete request.tool_choice; delete request.parallel_tool_calls; }
  if (isRecord(request.reasoning) && !Object.keys(request.reasoning).length) delete request.reasoning;
  request.input = Array.isArray(body.input) ? body.input.map((item: unknown) => {
    if (!isRecord(item) || item.type !== "function_call") return item;
    return { ...item, namespace: DIRECT_TOOL_NAMESPACE };
  }) : [];
  return { ...request, store: false, stream: true };
}

function isRecord(raw: unknown): raw is Record<string, unknown> { return Boolean(raw) && typeof raw === "object" && !Array.isArray(raw); }
