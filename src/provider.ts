import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { messageOf, responseError } from "./errors";
import {
  applyModelRequestOptions,
  buildModelConfigurationSchema,
  resolveModelRequestOptions,
  type ModelRequestOptions,
} from "./model-options";
import { OpenAIOAuth } from "./oauth";
import {
  CHATGPT_CODEX_RESPONSES_URL,
  CHATGPT_CODEX_USAGE_URL,
  OAUTH_ORIGINATOR,
} from "./protocol";
import { ResponsesStreamParser, type CodexStreamEvent } from "./sse";
import {
  mergeQuotaPayload,
  recordRequestUsage,
  toProviderUsagePayload,
  type CodexUsageSnapshot,
} from "./usage";

const DEFAULT_INSTRUCTIONS = "You are OpenAI Codex, a coding agent in Visual Studio Code. Be concise, correct, and use the supplied tools when useful.";
const MODELS: ReadonlyArray<{ id: string; input: number; output: number; image?: boolean }> = [
  { id: "gpt-5.6-sol", input: 372_000, output: 128_000, image: true },
  { id: "gpt-5.6-terra", input: 372_000, output: 128_000, image: true },
  { id: "gpt-5.6-luna", input: 372_000, output: 128_000, image: true },
  { id: "gpt-5.5", input: 272_000, output: 128_000, image: true },
  { id: "gpt-5.4", input: 272_000, output: 128_000, image: true },
  { id: "gpt-5.4-mini", input: 128_000, output: 64_000, image: true },
  { id: "gpt-5.3-codex", input: 272_000, output: 128_000, image: true },
  { id: "gpt-5.3-codex-spark", input: 128_000, output: 64_000, image: true },
  { id: "gpt-5.2", input: 272_000, output: 128_000, image: true },
];

export interface CodexModel extends vscode.LanguageModelChatInformation {
  rawModelId: string;
}

type InputItem = Record<string, unknown>;

export class OpenAICodexProvider implements vscode.LanguageModelChatProvider<CodexModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly usageEmitter = new vscode.EventEmitter<CodexUsageSnapshot>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  readonly onDidChangeUsage = this.usageEmitter.event;
  private usage: CodexUsageSnapshot;
  private lastQuotaFetchAt = 0;

  constructor(
    private readonly oauth: OpenAIOAuth,
    private readonly output: vscode.OutputChannel,
    private readonly userAgent: string,
    initialUsage: CodexUsageSnapshot = {},
  ) {
    this.usage = initialUsage;
  }

  fireDidChange(): void {
    this.changeEmitter.fire();
  }

  getUsageSnapshot(): CodexUsageSnapshot {
    return this.usage;
  }

  clearUsage(): void {
    this.setUsage({});
  }

  async refreshUsage(): Promise<CodexUsageSnapshot> {
    try {
      let credentials = await this.oauth.getAccessToken();
      let response = await this.sendUsageRequest(credentials);
      if (response.status === 401) {
        credentials = await this.oauth.getAccessToken(true);
        response = await this.sendUsageRequest(credentials);
      }
      if (!response.ok) throw await responseError("Unable to refresh OpenAI Codex usage", response);
      this.lastQuotaFetchAt = Date.now();
      this.setUsage(mergeQuotaPayload(this.usage, await response.json(), this.lastQuotaFetchAt));
      return this.usage;
    } catch (error) {
      this.setUsage({ ...this.usage, error: messageOf(error), updatedAt: Date.now() });
      throw error;
    }
  }

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<CodexModel[]> {
    if (token.isCancellationRequested) return [];
    return MODELS.map((model) => {
      const defaults = resolveRequestOptions(model.id, undefined);
      return {
        id: model.id,
        rawModelId: model.id,
        name: `${formatModelName(model.id)} (OAuth)`,
        family: `openai-${model.id}`,
        version: "1.0.0",
        detail: "OpenAI Codex OAuth",
        tooltip: `${model.id} through your ChatGPT subscription`,
        maxInputTokens: model.input,
        maxOutputTokens: model.output,
        isUserSelectable: true,
        configurationSchema: buildModelConfigurationSchema(model.id, defaults),
        capabilities: { imageInput: model.image, toolCalling: true },
      };
    });
  }

  async provideLanguageModelChatResponse(
    model: CodexModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const requestOptions = resolveRequestOptions(model.rawModelId, options.modelConfiguration);
    const body = buildRequest(model.rawModelId, messages, options, requestOptions);
    let credentials = await this.oauth.getAccessToken();
    let response = await this.sendRequest(credentials, body, token);
    if (response.status === 401) {
      credentials = await this.oauth.getAccessToken(true);
      response = await this.sendRequest(credentials, body, token);
    }
    if (response.status === 400 && ["xhigh", "max", "ultra"].includes(requestOptions.reasoningEffort)) {
      this.output.appendLine(`[request] ${model.rawModelId} rejected ${requestOptions.reasoningEffort}; retrying with high`);
      response = await this.sendRequest(credentials, { ...body, reasoning: { effort: "high", summary: "auto" } }, token);
    }
    if (!response.ok) throw await responseError(`OpenAI Codex request failed for ${model.rawModelId}`, response);
    if (!response.body) throw new Error("OpenAI Codex returned an empty response stream");

    if (configuration().get("debugLogging", false)) {
      this.output.appendLine(`[request] model=${model.rawModelId} speed=${requestOptions.speedMode} effort=${requestOptions.reasoningEffort} initiator=${options.requestInitiator ?? "unknown"}`);
    }
    await consumeStream(response.body, progress, token, (usage) => this.captureRequestUsage(usage, model.rawModelId));
    if (Date.now() - this.lastQuotaFetchAt > 60_000) {
      void this.refreshUsage().catch((error) => this.output.appendLine(`[usage] refresh failed: ${messageOf(error)}`));
    }
  }

  async provideTokenCount(
    _model: CodexModel,
    value: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const text = typeof value === "string" ? value : value.content.map(partText).join("\n");
    return Math.max(1, Math.ceil(text.length / 4));
  }

  async testConnection(): Promise<{ model: string; text: string; speedMode: string; reasoningEffort: string }> {
    const model = MODELS[0].id;
    const requestOptions = resolveRequestOptions(model, undefined);
    const credentials = await this.oauth.getAccessToken();
    const body = applyModelRequestOptions({
      model,
      instructions: "Follow the user's instruction exactly.",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Reply with exactly: OpenAI Codex connection verified" }] }],
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
    }, requestOptions);
    const response = await this.sendRequest(credentials, body, new vscode.CancellationTokenSource().token);
    if (!response.ok) throw await responseError("OpenAI Codex connection test failed", response);
    if (!response.body) throw new Error("OpenAI Codex returned an empty response stream");
    const text: string[] = [];
    await consumeStream(response.body, { report: (part) => {
      if (part instanceof vscode.LanguageModelTextPart) text.push(part.value);
    } }, new vscode.CancellationTokenSource().token, (usage) => this.captureRequestUsage(usage, model));
    return { model, text: text.join("").trim() || "(empty response)", ...requestOptions };
  }

  private async sendUsageRequest(credentials: { token: string; accountId?: string }): Promise<Response> {
    return fetch(CHATGPT_CODEX_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        Accept: "application/json",
        "User-Agent": this.userAgent,
        ...(credentials.accountId ? { "Chatgpt-Account-Id": credentials.accountId } : {}),
      },
    });
  }

  private captureRequestUsage(raw: Record<string, unknown>, modelId: string): void {
    const payload = toProviderUsagePayload(raw);
    if (!payload) return;
    if (configuration().get("debugLogging", false)) {
      this.output.appendLine(`[usage] model=${modelId} ${JSON.stringify(payload)}`);
    }
    this.setUsage(recordRequestUsage(this.usage, raw, modelId));
  }

  private setUsage(usage: CodexUsageSnapshot): void {
    this.usage = usage;
    this.usageEmitter.fire(usage);
  }

  private async sendRequest(
    credentials: { token: string; accountId?: string },
    body: Record<string, unknown>,
    cancellation: vscode.CancellationToken,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(10, configuration().get("requestTimeoutSeconds", 600)) * 1000);
    const listener = cancellation.onCancellationRequested(() => controller.abort());
    const sessionId = randomUUID();
    try {
      return await fetch(CHATGPT_CODEX_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "User-Agent": this.userAgent,
          Originator: OAUTH_ORIGINATOR,
          Session_id: sessionId,
          Conversation_id: sessionId,
          ...(credentials.accountId ? { "Chatgpt-Account-Id": credentials.accountId } : {}),
        },
        body: JSON.stringify({ ...body, prompt_cache_key: sessionId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      listener.dispose();
    }
  }
}

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("openaiCodex");
}

function resolveRequestOptions(
  modelId: string,
  requestConfiguration: Readonly<Record<string, unknown>> | undefined,
): ModelRequestOptions {
  const config = configuration();
  return resolveModelRequestOptions(modelId, requestConfiguration, {
    speedMode: config.get("speedMode", "normal"),
    reasoningEffort: config.get("reasoningEffort", "high"),
  });
}

function buildRequest(
  model: string,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  requestOptions: ModelRequestOptions,
): Record<string, unknown> {
  const tools = (options.tools ?? []).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} },
    strict: false,
  }));
  const input = messages.flatMap(convertMessage);
  return applyModelRequestOptions({
    model,
    instructions: DEFAULT_INSTRUCTIONS,
    input: input.length ? input : [{ type: "message", role: "user", content: [{ type: "input_text", text: "" }] }],
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
    ...(tools.length ? {
      tools,
      tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto",
      parallel_tool_calls: true,
    } : {}),
  }, requestOptions);
}

function convertMessage(message: vscode.LanguageModelChatRequestMessage): InputItem[] {
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

async function consumeStream(
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

function reportEvent(event: CodexStreamEvent, progress: vscode.Progress<vscode.LanguageModelResponsePart2>): void {
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
  if (event.usage) {
    const usage = toProviderUsagePayload(event.usage);
    if (usage) progress.report(new vscode.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(usage)), "usage"));
  }
}

function parseArguments(value: string): object {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed as object : { value: parsed };
  } catch {
    return { value };
  }
}

function partText(part: vscode.LanguageModelInputPart | unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) return part.value;
  if (part instanceof vscode.LanguageModelToolCallPart) return JSON.stringify(part.input ?? {});
  if (part instanceof vscode.LanguageModelToolResultPart) return part.content.map(partText).join("\n");
  return typeof part === "string" ? part : "";
}

function formatModelName(id: string): string {
  return id.split("-").map((part) => part === "gpt" ? "GPT" : part === "codex" ? "Codex" : part === "sol" ? "Sol" : part === "terra" ? "Terra" : part === "luna" ? "Luna" : part === "spark" ? "Spark" : part).join(" ");
}
