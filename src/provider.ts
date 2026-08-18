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
  enrichCodexModel,
  expandCodexModelVariants,
  parseCodexModelsPayload,
  type CodexModelMetadata,
} from "./models/catalog";
import { DEFAULT_OAUTH_PROFILE, normalizeProfileId, OpenAIOAuth } from "./auth/auth";
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
import { ModelsDevMetadata, type MetadataCache } from "./models/metadata";
import { profileFromConfiguration, profileQualifiedModelId } from "./provider-profile";

/** Live model information registered with VS Code Chat. */
export interface CodexModel extends vscode.LanguageModelChatInformation {
  rawModelId: string;
  profile: string;
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
  private readonly usageEmitter = new vscode.EventEmitter<{ profile: string; usage: CodexUsageSnapshot }>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  readonly onDidChangeUsage = this.usageEmitter.event;
  private readonly usageByProfile = new Map<string, CodexUsageSnapshot>();
  private readonly lastQuotaFetchAt = new Map<string, number>();
  private readonly modelCaches = new Map<string, CatalogCache<CodexModelMetadata[]>>();
  private readonly modelCacheAccounts = new Map<string, string>();
  private activeProfile = DEFAULT_OAUTH_PROFILE;
  private readonly transport: CodexTransport;
  private readonly metadata: ModelsDevMetadata;

  constructor(
    private readonly oauth: OpenAIOAuth,
    private readonly output: vscode.OutputChannel,
    userAgent: string,
    initialUsage: Readonly<Record<string, CodexUsageSnapshot>> = {},
    metadataCache: MetadataCache = memoryMetadataCache(),
    fetcher: typeof fetch = fetch,
  ) {
    for (const [profile, usage] of Object.entries(initialUsage)) this.usageByProfile.set(profile, usage);
    this.transport = new CodexTransport(
      oauth,
      userAgent,
      () => configuration().get("requestTimeoutSeconds", 600),
      fetcher,
    );
    this.metadata = new ModelsDevMetadata(metadataCache, fetcher);
  }

  fireDidChange(): void {
    this.changeEmitter.fire();
  }

  clearModelCache(profile?: string): void {
    if (profile) {
      this.modelCaches.get(profile)?.clear();
      this.modelCacheAccounts.delete(profile);
      return;
    }
    for (const cache of this.modelCaches.values()) cache.clear();
    this.modelCacheAccounts.clear();
  }

  async refreshModels(profile = this.activeProfile): Promise<number> {
    this.clearModelCache(profile);
    const cancellation = new vscode.CancellationTokenSource();
    try {
      const models = await this.fetchModels(cancellation.token, profile);
      this.fireDidChange();
      return expandCodexModelVariants(models).length;
    } finally {
      cancellation.dispose();
    }
  }

  getActiveProfile(): string {
    return this.activeProfile;
  }

  setActiveProfile(profile: string): void {
    this.activeProfile = normalizeProfileId(profile);
    this.usageEmitter.fire({ profile: this.activeProfile, usage: this.getUsageSnapshot() });
  }

  getUsageSnapshot(profile = this.activeProfile): CodexUsageSnapshot {
    return this.usageByProfile.get(profile) ?? {};
  }

  getUsageSnapshots(): Readonly<Record<string, CodexUsageSnapshot>> {
    return Object.fromEntries(this.usageByProfile);
  }

  clearUsage(profile = this.activeProfile): void {
    this.setUsage(profile, {});
  }

  async refreshUsage(profile = this.activeProfile): Promise<CodexUsageSnapshot> {
    try {
      const response = await this.transport.sendUsage(profile);
      if (!response.ok) throw await responseError("Unable to refresh OpenAI Codex usage", response);
      const updatedAt = Date.now();
      this.lastQuotaFetchAt.set(profile, updatedAt);
      let next = mergeQuotaPayload(this.getUsageSnapshot(profile), await response.json(), updatedAt);
      try {
        const resetCreditsResponse = await this.transport.sendResetCredits(profile);
        if (!resetCreditsResponse.ok) {
          next = { ...next, resetCredits: undefined, resetCreditsError: "The Codex backend did not provide reset-credit details" };
        } else {
          next = mergeResetCreditsPayload(next, await resetCreditsResponse.json(), updatedAt);
        }
      } catch {
        // Reset-credit details are optional; quota refresh remains useful when this private endpoint changes.
        next = { ...next, resetCredits: undefined, resetCreditsError: "Reset-credit details could not be refreshed" };
      }
      this.setUsage(profile, next);
      return next;
    } catch (error) {
      this.setUsage(profile, { ...this.getUsageSnapshot(profile), error: messageOf(error), updatedAt: Date.now() });
      throw error;
    }
  }

  async consumeResetCredit(creditId: string, profile = this.activeProfile): Promise<{ outcome: string; windowsReset?: number }> {
    const redeemRequestId = randomUUID();
    const response = await this.transport.sendResetCreditConsume((accountId) => JSON.stringify(
      buildResetCreditConsumePayload(creditId, redeemRequestId, accountId),
    ), profile);
    if (!response.ok) throw await responseError("Unable to redeem OpenAI Codex reset credit", response);
    const result = parseResetCreditConsumePayload(await response.json());
    try {
      await this.refreshUsage(profile);
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
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<CodexModel[]> {
    if (token.isCancellationRequested) return [];
    if (!options.configuration) return [];
    const profile = profileFromConfiguration(options.configuration);
    if (!await this.oauth.hasSession(profile)) return [];
    const models = expandCodexModelVariants(await this.fetchModels(token, profile));
    return models.map((model) => {
      const optionSpec = modelOptionSpec(model);
      const defaults = resolveRequestOptions(optionSpec, model.speedMode, undefined);
      return {
        id: profileQualifiedModelId(profile, model.registrationId),
        rawModelId: model.rawModelId,
        profile,
        name: model.name,
        family: model.rawModelId,
        version: model.version,
        detail: `${model.detail} · ${profile}`,
        tooltip: model.description,
        maxInputTokens: model.input,
        maxOutputTokens: model.output,
        isUserSelectable: true,
        isBYOK: true,
        requiresAuthorization: { label: `Codex Bridge (${profile})` },
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
    const response = await this.transport.sendResponse(body, token, model.profile);
    if (!response.ok) throw await responseError(`OpenAI Codex request failed for ${model.rawModelId}`, response);
    if (!response.body) throw new Error("OpenAI Codex returned an empty response stream");

    if (configuration().get("debugLogging", false)) {
      this.output.appendLine(`[request] model=${model.rawModelId} speed=${requestOptions.speedMode} effort=${requestOptions.reasoningEffort} summary=${requestOptions.reasoningSummary} webSearch=${requestOptions.webSearch} imageGeneration=${requestOptions.imageGeneration} initiator=${options.requestInitiator ?? "unknown"}`);
    }
    await consumeStream(response.body, progress, token, (usage) => this.captureRequestUsage(usage, model.rawModelId, model.profile));
    if (Date.now() - (this.lastQuotaFetchAt.get(model.profile) ?? 0) > 60_000) {
      void this.refreshUsage(model.profile).catch((error) => this.output.appendLine(`[usage] refresh failed: ${messageOf(error)}`));
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

  async testConnection(profile = this.activeProfile): Promise<{ model: string; text: string; speedMode: string; reasoningEffort: string; reasoningSummary: string }> {
    const cancellation = new vscode.CancellationTokenSource();
    try {
      const model = (await this.fetchModels(cancellation.token, profile))[0];
      const requestOptions = resolveRequestOptions(modelOptionSpec(model), "normal", undefined);
      const body = applyModelRequestOptions({
        model: model.id,
        instructions: "Follow the user's instruction exactly.",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Reply with exactly: OpenAI Codex connection verified" }] }],
        store: false,
        stream: true,
        include: ["reasoning.encrypted_content"],
      }, requestOptions, model.supportsReasoningSummaryParameter);
      const response = await this.transport.sendResponse(body, cancellation.token, profile);
      if (!response.ok) throw await responseError("OpenAI Codex connection test failed", response);
      if (!response.body) throw new Error("OpenAI Codex returned an empty response stream");
      const text: string[] = [];
      await consumeStream(response.body, { report: (part) => {
        if (part instanceof vscode.LanguageModelTextPart) text.push(part.value);
      } }, cancellation.token, (usage) => this.captureRequestUsage(usage, model.id, profile));
      return { model: model.id, text: text.join("").trim() || "(empty response)", ...requestOptions };
    } finally {
      cancellation.dispose();
    }
  }

  private async fetchModels(cancellation: vscode.CancellationToken, profile: string): Promise<CodexModelMetadata[]> {
    const maxAge = Math.max(1, configuration().get("catalogCacheMinutes", 5)) * 60_000;
    const session = await this.oauth.sessionInfo(profile);
    const account = session?.accountId ?? session?.email;
    if (!account) throw new Error(`Sign in to OpenAI Codex profile “${profile}” first`);
    if (account !== this.modelCacheAccounts.get(profile)) this.clearModelCache(profile);
    const cache = this.modelCaches.get(profile) ?? new CatalogCache<CodexModelMetadata[]>();
    this.modelCaches.set(profile, cache);
    const models = await cache.getOrRefresh(maxAge, async () => {
      const response = await this.transport.sendModels(cancellation, profile);
      if (!response.ok) throw await responseError("Unable to load OpenAI Codex models", response);
      const parsed = parseCodexModelsPayload(await response.json());
      if (!parsed.length) throw new Error("OpenAI Codex returned no usable models");
      const metadata = await this.metadata.getOrRefresh();
      return parsed.map((model) => enrichCodexModel(model, metadata.models[model.id]));
    }, () => cancellation.isCancellationRequested);
    this.modelCacheAccounts.set(profile, account);
    return models;
  }

  private captureRequestUsage(raw: Record<string, unknown>, modelId: string, profile: string): void {
    const payload = toProviderUsagePayload(raw);
    if (!payload) return;
    if (configuration().get("debugLogging", false)) {
      this.output.appendLine(`[usage] model=${modelId} ${JSON.stringify(payload)}`);
    }
    this.setUsage(profile, recordRequestUsage(this.getUsageSnapshot(profile), raw, modelId));
  }

  private setUsage(profile: string, usage: CodexUsageSnapshot): void {
    this.usageByProfile.set(profile, usage);
    this.usageEmitter.fire({ profile, usage });
  }

}

function memoryMetadataCache(): MetadataCache {
  const values = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined { return values.get(key) as T | undefined; },
    async update(key: string, value: unknown): Promise<void> { values.set(key, value); },
  };
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
