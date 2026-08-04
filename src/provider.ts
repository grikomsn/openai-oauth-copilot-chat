import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { messageOf, responseError } from "./errors";
import {
  applyModelRequestOptions,
  buildModelConfigurationSchema,
  modelOptionSpec,
  resolveModelRequestOptions,
  type ModelOptionSpec,
  type ModelRequestOptions,
  type SpeedMode,
} from "./model-options";
import {
  expandCodexModelVariants,
  parseCodexModelsPayload,
  type CodexModelMetadata,
} from "./model-catalog";
import { OpenAIOAuth } from "./oauth";
import { buildPromptCacheRequestFields, createPromptCacheTransportHeaders } from "./prompt-cache";
import {
  CODEX_MODELS_CLIENT_VERSION,
  CHATGPT_CODEX_RESPONSES_URL,
  CHATGPT_CODEX_USAGE_URL,
  chatgptCodexModelsUrl,
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

export interface CodexModel extends vscode.LanguageModelChatInformation {
  rawModelId: string;
  speedMode: SpeedMode;
  optionSpec: ModelOptionSpec;
  supportsParallelToolCalls: boolean;
}

type InputItem = Record<string, unknown>;
type OAuthCredentials = { token: string; accountId?: string };

/**
 * Adapts live ChatGPT Codex models and Responses API streams to VS Code Chat.
 *
 * @example
 * ```ts
 * const provider = new OpenAICodexProvider(oauth, output, userAgent);
 * vscode.lm.registerLanguageModelChatProvider("openai-codex", provider);
 * ```
 *
 * @see {@link CodexModel}
 * @see {@link OpenAIOAuth}
 */
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
    private readonly fetcher: typeof fetch = fetch,
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
      const response = await this.sendWithAuthRetry((credentials) => this.sendUsageRequest(credentials));
      if (!response.ok) throw await responseError("Unable to refresh OpenAI Codex usage", response);
      this.lastQuotaFetchAt = Date.now();
      this.setUsage(mergeQuotaPayload(this.usage, await response.json(), this.lastQuotaFetchAt));
      return this.usage;
    } catch (error) {
      this.setUsage({ ...this.usage, error: messageOf(error), updatedAt: Date.now() });
      throw error;
    }
  }

  /**
   * Loads and registers the current visible model catalog with VS Code.
   *
   * @example
   * ```ts
   * const models = await provider.provideLanguageModelChatInformation(options, token);
   * console.log(models.map((model) => model.id));
   * ```
   *
   * @see {@link parseCodexModelsPayload}
   * @see {@link expandCodexModelVariants}
   */
  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<CodexModel[]> {
    if (token.isCancellationRequested) return [];
    // Each refresh can change capabilities, defaults, and the available Speed Mode toggle.
    const models = expandCodexModelVariants(await this.fetchModels(token));
    return models.map((model) => {
      const optionSpec = modelOptionSpec(model);
      const defaults = resolveRequestOptions(optionSpec, model.speedMode, undefined);
      return {
        id: model.registrationId,
        rawModelId: model.rawModelId,
        name: model.name,
        family: model.rawModelId,
        version: model.version,
        detail: model.detail,
        tooltip: model.description,
        maxInputTokens: model.input,
        maxOutputTokens: model.output,
        isUserSelectable: true,
        configurationSchema: buildModelConfigurationSchema(optionSpec, defaults),
        capabilities: { imageInput: model.image, toolCalling: model.toolCalling },
        speedMode: model.speedMode,
        optionSpec,
        supportsParallelToolCalls: model.supportsParallelToolCalls,
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
    const requestOptions = resolveRequestOptions(model.optionSpec, model.speedMode, options.modelConfiguration);
    const body = buildRequest(
      model.rawModelId,
      messages,
      options,
      requestOptions,
      model.supportsParallelToolCalls,
      model.optionSpec.supportsReasoningSummaryParameter,
    );
    const response = await this.sendWithAuthRetry((credentials) => this.sendRequest(credentials, body, token));
    if (!response.ok) throw await responseError(`OpenAI Codex request failed for ${model.rawModelId}`, response);
    if (!response.body) throw new Error("OpenAI Codex returned an empty response stream");

    if (configuration().get("debugLogging", false)) {
      this.output.appendLine(`[request] model=${model.rawModelId} speed=${requestOptions.speedMode} effort=${requestOptions.reasoningEffort} summary=${requestOptions.reasoningSummary} initiator=${options.requestInitiator ?? "unknown"}`);
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

  async testConnection(): Promise<{ model: string; text: string; speedMode: string; reasoningEffort: string; reasoningSummary: string }> {
    const cancellation = new vscode.CancellationTokenSource();
    try {
      const model = (await this.fetchModels(cancellation.token))[0];
      const requestOptions = resolveRequestOptions(modelOptionSpec(model), "normal", undefined);
      const body = applyModelRequestOptions({
        model: model.id,
        instructions: "Follow the user's instruction exactly.",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Reply with exactly: OpenAI Codex connection verified" }] }],
        store: false,
        stream: true,
        include: ["reasoning.encrypted_content"],
      }, requestOptions, model.supportsReasoningSummaryParameter);
      const response = await this.sendWithAuthRetry((credentials) => this.sendRequest(credentials, body, cancellation.token));
      if (!response.ok) throw await responseError("OpenAI Codex connection test failed", response);
      if (!response.body) throw new Error("OpenAI Codex returned an empty response stream");
      const text: string[] = [];
      await consumeStream(response.body, { report: (part) => {
        if (part instanceof vscode.LanguageModelTextPart) text.push(part.value);
      } }, cancellation.token, (usage) => this.captureRequestUsage(usage, model.id));
      return { model: model.id, text: text.join("").trim() || "(empty response)", ...requestOptions };
    } finally {
      cancellation.dispose();
    }
  }

  private async fetchModels(cancellation: vscode.CancellationToken): Promise<CodexModelMetadata[]> {
    const response = await this.sendWithAuthRetry((credentials) => this.sendModelsRequest(credentials, cancellation));
    if (!response.ok) throw await responseError("Unable to load OpenAI Codex models", response);
    return parseCodexModelsPayload(await response.json());
  }

  private sendModelsRequest(
    credentials: OAuthCredentials,
    cancellation: vscode.CancellationToken,
  ): Promise<Response> {
    return this.fetchWithCancellation(chatgptCodexModelsUrl(CODEX_MODELS_CLIENT_VERSION), {
      headers: {
        ...this.authHeaders(credentials, "application/json"),
        Originator: OAUTH_ORIGINATOR,
        Version: CODEX_MODELS_CLIENT_VERSION,
      },
    }, cancellation);
  }

  private sendUsageRequest(credentials: OAuthCredentials): Promise<Response> {
    return this.fetcher(CHATGPT_CODEX_USAGE_URL, {
      headers: this.authHeaders(credentials, "application/json"),
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

  private sendRequest(
    credentials: OAuthCredentials,
    body: Record<string, unknown>,
    cancellation: vscode.CancellationToken,
  ): Promise<Response> {
    const promptCacheKey = typeof body.prompt_cache_key === "string" ? body.prompt_cache_key : undefined;
    // Cache-aware requests share routing affinity; requests without a key still get isolated transport IDs.
    const transportHeaders = promptCacheKey
      ? createPromptCacheTransportHeaders(promptCacheKey)
      : { "session-id": randomUUID(), "thread-id": randomUUID() };
    return this.fetchWithCancellation(CHATGPT_CODEX_RESPONSES_URL, {
      method: "POST",
      headers: {
        ...this.authHeaders(credentials, "text/event-stream"),
        "Content-Type": "application/json",
        Originator: OAUTH_ORIGINATOR,
        ...transportHeaders,
      },
      body: JSON.stringify(body),
    }, cancellation);
  }

  private async sendWithAuthRetry(
    request: (credentials: OAuthCredentials) => Promise<Response>,
  ): Promise<Response> {
    let response = await request(await this.oauth.getAccessToken());
    if (response.status === 401) {
      // Refresh once for an expired token, but avoid retry loops on a persistent authorization failure.
      response = await request(await this.oauth.getAccessToken(true));
    }
    return response;
  }

  private authHeaders(credentials: OAuthCredentials, accept: string): Record<string, string> {
    return {
      Authorization: `Bearer ${credentials.token}`,
      Accept: accept,
      "User-Agent": this.userAgent,
      ...(credentials.accountId ? { "ChatGPT-Account-ID": credentials.accountId } : {}),
    };
  }

  private async fetchWithCancellation(
    url: string,
    init: RequestInit,
    cancellation: vscode.CancellationToken,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutSeconds = Math.max(10, configuration().get("requestTimeoutSeconds", 600));
    const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    const listener = cancellation.onCancellationRequested(() => controller.abort());
    if (cancellation.isCancellationRequested) controller.abort();
    try {
      // Timeout and VS Code cancellation share one signal so every network path tears down consistently.
      return await this.fetcher(url, { ...init, signal: controller.signal });
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
  spec: ModelOptionSpec,
  speedMode: SpeedMode,
  requestConfiguration: Readonly<Record<string, unknown>> | undefined,
): ModelRequestOptions {
  const config = configuration();
  // Keep legacy settings as fallbacks without overriding per-model picker configuration.
  const workspaceDefaults: Record<string, unknown> = {
    reasoningSummary: config.get("reasoningSummary", "auto"),
  };
  const legacyReasoningEffort = explicitConfigurationValue<string>(config, "reasoningEffort");
  if (legacyReasoningEffort !== undefined) workspaceDefaults.reasoningEffort = legacyReasoningEffort;
  const legacySpeedMode = explicitConfigurationValue<string>(config, "speedMode");
  if (legacySpeedMode !== undefined) workspaceDefaults.speedMode = legacySpeedMode;
  return resolveModelRequestOptions(spec, requestConfiguration, {
    ...workspaceDefaults,
  }, speedMode);
}

function explicitConfigurationValue<T>(config: vscode.WorkspaceConfiguration, key: string): T | undefined {
  const inspected = config.inspect<T>(key);
  // Prefer the most specific configured scope, matching VS Code's effective-value precedence.
  return inspected?.workspaceFolderLanguageValue
    ?? inspected?.workspaceLanguageValue
    ?? inspected?.workspaceFolderValue
    ?? inspected?.workspaceValue
    ?? inspected?.globalLanguageValue
    ?? inspected?.globalValue;
}

function buildRequest(
  model: string,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  requestOptions: ModelRequestOptions,
  supportsParallelToolCalls: boolean,
  supportsReasoningSummaryParameter: boolean,
): Record<string, unknown> {
  const tools = (options.tools ?? []).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} },
    strict: false,
  }));
  const convertedInput = messages.flatMap(convertMessage);
  const input = convertedInput.length
    ? convertedInput
    : [{ type: "message", role: "user", content: [{ type: "input_text", text: "" }] }];
  const promptCache = buildPromptCacheRequestFields({
    model,
    instructions: DEFAULT_INSTRUCTIONS,
    tools,
    input,
  });
  return applyModelRequestOptions({
    model,
    instructions: DEFAULT_INSTRUCTIONS,
    ...promptCache,
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
    ...(tools.length ? {
      tools,
      tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto",
      parallel_tool_calls: supportsParallelToolCalls,
    } : {}),
  }, requestOptions, supportsReasoningSummaryParameter);
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
