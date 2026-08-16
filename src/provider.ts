/** VS Code language-model adapter for the ChatGPT Codex backend. */

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
} from "./models/options";
import {
  expandCodexModelVariants,
  parseCodexModelsPayload,
  type CodexModelMetadata,
} from "./models/catalog";
import { OpenAIOAuth } from "./auth/auth";
import { partText } from "./provider/messages";
import { buildRequest } from "./provider/request";
import { consumeStream } from "./provider/response";
import {
  buildResetCreditConsumePayload,
  mergeQuotaPayload,
  mergeResetCreditsPayload,
  parseResetCreditConsumePayload,
  recordRequestUsage,
  toProviderUsagePayload,
  type CodexUsageSnapshot,
} from "./usage/domain";
import { CodexTransport } from "./transport/client";
import { CatalogCache } from "./models/catalog-cache";

/** Live model information registered with VS Code Chat. */
export interface CodexModel extends vscode.LanguageModelChatInformation {
  rawModelId: string;
  speedMode: SpeedMode;
  optionSpec: ModelOptionSpec;
  supportsParallelToolCalls: boolean;
}

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
  private readonly modelCache = new CatalogCache<CodexModelMetadata[]>();
  private modelCacheAccount: string | undefined;
  private readonly transport: CodexTransport;

  constructor(
    private readonly oauth: OpenAIOAuth,
    private readonly output: vscode.OutputChannel,
    userAgent: string,
    initialUsage: CodexUsageSnapshot = {},
    fetcher: typeof fetch = fetch,
  ) {
    this.usage = initialUsage;
    this.transport = new CodexTransport(
      oauth,
      userAgent,
      () => configuration().get("requestTimeoutSeconds", 600),
      fetcher,
    );
  }

  fireDidChange(): void {
    this.changeEmitter.fire();
  }

  clearModelCache(): void {
    this.modelCache.clear();
    this.modelCacheAccount = undefined;
  }

  getUsageSnapshot(): CodexUsageSnapshot {
    return this.usage;
  }

  clearUsage(): void {
    this.setUsage({});
  }

  async refreshUsage(): Promise<CodexUsageSnapshot> {
    try {
      const response = await this.transport.sendUsage();
      if (!response.ok) throw await responseError("Unable to refresh OpenAI Codex usage", response);
      const updatedAt = Date.now();
      this.lastQuotaFetchAt = updatedAt;
      let next = mergeQuotaPayload(this.usage, await response.json(), updatedAt);
      try {
        const resetCreditsResponse = await this.transport.sendResetCredits();
        if (!resetCreditsResponse.ok) {
          next = { ...next, resetCredits: undefined, resetCreditsError: "The Codex backend did not provide reset-credit details" };
        } else {
          next = mergeResetCreditsPayload(next, await resetCreditsResponse.json(), updatedAt);
        }
      } catch {
        // Reset-credit details are optional; quota refresh remains useful when this private endpoint changes.
        next = { ...next, resetCredits: undefined, resetCreditsError: "Reset-credit details could not be refreshed" };
      }
      this.setUsage(next);
      return this.usage;
    } catch (error) {
      this.setUsage({ ...this.usage, error: messageOf(error), updatedAt: Date.now() });
      throw error;
    }
  }

  async consumeResetCredit(creditId: string): Promise<{ outcome: string; windowsReset?: number }> {
    const redeemRequestId = randomUUID();
    const response = await this.transport.sendResetCreditConsume((accountId) => JSON.stringify(
      buildResetCreditConsumePayload(creditId, redeemRequestId, accountId),
    ));
    if (!response.ok) throw await responseError("Unable to redeem OpenAI Codex reset credit", response);
    const result = parseResetCreditConsumePayload(await response.json());
    try {
      await this.refreshUsage();
    } catch {
      // The redemption result is authoritative even if the follow-up snapshot is temporarily unavailable.
    }
    return result;
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
    const response = await this.transport.sendResponse(body, token);
    if (!response.ok) throw await responseError(`OpenAI Codex request failed for ${model.rawModelId}`, response);
    if (!response.body) throw new Error("OpenAI Codex returned an empty response stream");

    if (configuration().get("debugLogging", false)) {
      this.output.appendLine(`[request] model=${model.rawModelId} speed=${requestOptions.speedMode} effort=${requestOptions.reasoningEffort} summary=${requestOptions.reasoningSummary} webSearch=${requestOptions.webSearch} imageGeneration=${requestOptions.imageGeneration} initiator=${options.requestInitiator ?? "unknown"}`);
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
      const response = await this.transport.sendResponse(body, cancellation.token);
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
    const maxAge = Math.max(1, configuration().get("catalogCacheMinutes", 5)) * 60_000;
    const session = await this.oauth.sessionInfo();
    const account = session?.accountId ?? session?.email;
    if (!account || account !== this.modelCacheAccount) this.clearModelCache();
    const models = await this.modelCache.getOrRefresh(maxAge, async () => {
      const response = await this.transport.sendModels(cancellation);
      if (!response.ok) throw await responseError("Unable to load OpenAI Codex models", response);
      const parsed = parseCodexModelsPayload(await response.json());
      if (!parsed.length) throw new Error("OpenAI Codex returned no usable models");
      return parsed;
    }, () => cancellation.isCancellationRequested);
    this.modelCacheAccount = account;
    return models;
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
