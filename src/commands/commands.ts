/** User-facing Codex Bridge command registration and workflows. */

import * as vscode from "vscode";
import { DEFAULT_OAUTH_PROFILE, normalizeProfileId, type AuthorizationFlow, OpenAIOAuth } from "../auth/auth";
import { messageOf } from "../errors";
import { OpenAICodexProvider } from "../provider";
import { EXTENSION_DISPLAY_NAME } from "../transport/protocol";
import { formatUsageRows, type UsageDisplayRow } from "../usage/presentation";

export function registerCodexCommands(
  oauth: OpenAIOAuth,
  provider: OpenAICodexProvider,
  output: vscode.OutputChannel,
  usageStatus: vscode.StatusBarItem,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("openaiCodex.manage", () => manage(oauth, provider, output, usageStatus)),
    vscode.commands.registerCommand("openaiCodex.addAccount", () => addAccount(oauth, provider, output)),
    vscode.commands.registerCommand("openaiCodex.selectProfile", () => selectProfile(oauth, provider)),
    vscode.commands.registerCommand("openaiCodex.signIn", () => browserSignIn(oauth, provider, output)),
    vscode.commands.registerCommand("openaiCodex.signInManual", () => manualSignIn(oauth, provider, output)),
    vscode.commands.registerCommand("openaiCodex.importCodexSession", () => importCodexSession(oauth, provider, output)),
    vscode.commands.registerCommand("openaiCodex.testConnection", () => testConnection(provider, output)),
    vscode.commands.registerCommand("openaiCodex.refreshModels", () => refreshModels(provider, output)),
    vscode.commands.registerCommand("openaiCodex.showUsage", () => showUsage(provider, output)),
    vscode.commands.registerCommand("openaiCodex.diagnostics", () => diagnostics(oauth, output)),
  ];
}

async function manage(
  oauth: OpenAIOAuth,
  provider: OpenAICodexProvider,
  output: vscode.OutputChannel,
  usageStatus: vscode.StatusBarItem,
): Promise<void> {
  const profile = provider.getActiveProfile();
  const session = await oauth.sessionInfo(profile);
  const picked = await vscode.window.showQuickPick(session ? [
    { label: "$(account) Switch profile", action: "switch" },
    { label: "$(add) Add ChatGPT account", action: "add" },
    { label: "$(pulse) Show Codex usage", action: "usage" },
    { label: "$(check) Test Codex connection", action: "test" },
    { label: "$(refresh) Refresh Codex models", action: "refresh" },
    { label: "$(output) Show Codex Bridge logs", action: "logs" },
    { label: "$(sign-out) Sign out of Codex Bridge", action: "signout" },
  ] : [
    { label: "$(globe) Sign in with ChatGPT", action: "signin", description: `Profile: ${profile}` },
    { label: "$(account) Switch profile", action: "switch" },
    { label: "$(add) Add ChatGPT account", action: "add" },
    { label: "$(link) Sign in manually", action: "manual", description: "Use if localhost:1455 is unavailable" },
    { label: "$(terminal) Import Codex CLI session (Advanced)", action: "import", description: "Copies OAuth credentials from ~/.codex/auth.json" },
    { label: "$(output) Show Codex Bridge logs", action: "logs" },
  ], { title: `Codex Bridge [${profile}] — ${session?.email ?? (session ? "signed in" : "not signed in")}` });
  if (!picked) return;
  if (picked.action === "signin") await browserSignIn(oauth, provider, output, profile);
  else if (picked.action === "switch") await selectProfile(oauth, provider);
  else if (picked.action === "add") await addAccount(oauth, provider, output);
  else if (picked.action === "manual") await manualSignIn(oauth, provider, output, profile);
  else if (picked.action === "import") await importCodexSession(oauth, provider, output, profile);
  else if (picked.action === "usage") await showUsage(provider, output);
  else if (picked.action === "test") await testConnection(provider, output);
  else if (picked.action === "refresh") await refreshModels(provider, output);
  else if (picked.action === "logs") output.show(true);
  else if (picked.action === "signout") {
    await oauth.signOut(profile);
    provider.clearModelCache(profile);
    provider.clearUsage(profile);
    usageStatus.hide();
    provider.fireDidChange();
    vscode.window.showInformationMessage(`Signed out of Codex Bridge profile “${profile}”.`);
  }
}

async function browserSignIn(
  oauth: OpenAIOAuth,
  provider: OpenAICodexProvider,
  output: vscode.OutputChannel,
  profile = DEFAULT_OAUTH_PROFILE,
): Promise<void> {
  let attempt: Awaited<ReturnType<OpenAIOAuth["startBrowserSignIn"]>> | undefined;
  try {
    attempt = await oauth.startBrowserSignIn(profile);
    if (!await vscode.env.openExternal(vscode.Uri.parse(attempt.url))) throw new Error("VS Code could not open the OpenAI authorization page");
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Waiting for OpenAI sign-in…", cancellable: true },
      async (_progress, cancellation) => {
        const listener = cancellation.onCancellationRequested(() => attempt?.cancel());
        try { await attempt?.completion; } finally { listener.dispose(); }
      },
    );
    provider.setActiveProfile(profile);
    provider.clearModelCache(profile);
    provider.fireDidChange();
    refreshUsageAfterAuth(provider, output, "post-sign-in", profile);
    vscode.window.showInformationMessage(`Signed in to Codex Bridge profile “${profile}” with ChatGPT.`);
  } catch (error) {
    attempt?.cancel();
    showError("ChatGPT sign-in failed", error, output);
  }
}

async function manualSignIn(
  oauth: OpenAIOAuth,
  provider: OpenAICodexProvider,
  output: vscode.OutputChannel,
  profile = DEFAULT_OAUTH_PROFILE,
): Promise<void> {
  const attempt = oauth.startManualSignIn(profile);
  const flow: AuthorizationFlow = attempt.flow;
  try {
    await vscode.env.clipboard.writeText(flow.url);
    await vscode.env.openExternal(vscode.Uri.parse(flow.url));
    const callback = await vscode.window.showInputBox({
      title: "Codex Bridge manual sign-in",
      prompt: "After signing in, paste the full localhost callback URL (or a query string containing both code and state)",
      ignoreFocusOut: true,
    });
    if (!callback) return;
    await attempt.complete(callback);
    provider.setActiveProfile(profile);
    provider.clearModelCache(profile);
    provider.fireDidChange();
    refreshUsageAfterAuth(provider, output, "post-sign-in", profile);
    vscode.window.showInformationMessage(`Signed in to Codex Bridge profile “${profile}” with ChatGPT.`);
  } catch (error) {
    showError("ChatGPT manual sign-in failed", error, output);
  }
}

async function importCodexSession(
  oauth: OpenAIOAuth,
  provider: OpenAICodexProvider,
  output: vscode.OutputChannel,
  profile = DEFAULT_OAUTH_PROFILE,
): Promise<void> {
  try {
    const confirmed = await vscode.window.showWarningMessage(
      "Importing a Codex CLI session copies its OAuth access and refresh credentials into VS Code Secret Storage. A fresh ChatGPT sign-in is recommended.",
      { modal: true, detail: "Continue only if you trust this extension and want both clients to use credentials derived from the same CLI session." },
      "Import session",
    );
    if (confirmed !== "Import session") return;
    const session = await oauth.importCodexCliSession(profile);
    provider.setActiveProfile(profile);
    provider.clearModelCache(profile);
    provider.fireDidChange();
    refreshUsageAfterAuth(provider, output, "post-import", profile);
    vscode.window.showInformationMessage(`Imported Codex CLI session${session.email ? ` for ${session.email}` : ""} into profile “${profile}”.`);
  } catch (error) {
    showError("Unable to import Codex CLI session", error, output);
  }
}

async function addAccount(oauth: OpenAIOAuth, provider: OpenAICodexProvider, output: vscode.OutputChannel): Promise<void> {
  const profile = await promptProfileId();
  if (!profile) return;
  if (await oauth.hasSession(profile)) {
    const replace = await vscode.window.showWarningMessage(
      `Replace the ChatGPT session stored for profile “${profile}”?`,
      { modal: true },
      "Replace",
    );
    if (replace !== "Replace") return;
  }
  await browserSignIn(oauth, provider, output, profile);
  if (await oauth.hasSession(profile)) {
    vscode.window.showInformationMessage(`Add Codex Bridge in Chat: Manage Language Models and enter profile “${profile}”.`);
  }
}

async function selectProfile(oauth: OpenAIOAuth, provider: OpenAICodexProvider): Promise<void> {
  const profiles = await oauth.listProfiles();
  if (!profiles.length) {
    vscode.window.showInformationMessage("No Codex Bridge profiles are signed in yet.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    await Promise.all(profiles.map(async (profile) => {
      const session = await oauth.sessionInfo(profile);
      return { label: profile, description: session?.email ?? "Signed in", profile };
    })),
    { title: "Select the active Codex Bridge profile" },
  );
  if (!picked) return;
  provider.setActiveProfile(picked.profile);
  vscode.window.showInformationMessage(`Codex Bridge profile “${picked.profile}” is now active for usage and management commands.`);
}

async function promptProfileId(): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: "Add ChatGPT account",
    prompt: "Choose the profile ID you will enter when adding Codex Bridge in Manage Language Models.",
    placeHolder: "personal or work",
    ignoreFocusOut: true,
    validateInput: (input) => {
      try { normalizeProfileId(input); return undefined; } catch (error) { return messageOf(error); }
    },
  });
  return value ? normalizeProfileId(value) : undefined;
}

async function testConnection(provider: OpenAICodexProvider, output: vscode.OutputChannel): Promise<void> {
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Testing Codex connection…" },
      () => provider.testConnection(),
    );
    output.appendLine(`[test] model=${result.model} speed=${result.speedMode} effort=${result.reasoningEffort} summary=${result.reasoningSummary} response=${result.text}`);
    vscode.window.showInformationMessage(`Codex connection verified with ${result.model} (${result.speedMode}, ${result.reasoningEffort}, ${result.reasoningSummary} summary): ${result.text}`);
  } catch (error) {
    showError("Codex connection test failed", error, output);
  }
}

async function refreshModels(provider: OpenAICodexProvider, output: vscode.OutputChannel): Promise<void> {
  try {
    const count = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Refreshing Codex models…" },
      () => provider.refreshModels(),
    );
    vscode.window.showInformationMessage(`Refreshed ${count} Codex models.`);
  } catch (error) {
    showError("Codex model refresh failed", error, output);
  }
}

async function showUsage(
  provider: OpenAICodexProvider,
  output: vscode.OutputChannel,
  profile = provider.getActiveProfile(),
): Promise<void> {
  let snapshot = provider.getUsageSnapshot(profile);
  try {
    snapshot = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Refreshing Codex usage…" },
      () => provider.refreshUsage(profile),
    );
  } catch (error) {
    output.appendLine(`[usage] refresh failed: ${messageOf(error)}`);
  }
  const picked = await vscode.window.showQuickPick<UsageQuickPickItem>([
    ...formatUsageRows(snapshot).map(toUsageQuickPickItem),
    { label: "Actions", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(refresh) Refresh usage", action: "refresh", alwaysShow: true },
    { label: "$(link-external) Open ChatGPT Codex", action: "open", alwaysShow: true },
  ], {
    title: snapshot.updatedAt ? `Codex usage [${profile}] — updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}` : `Codex usage [${profile}]`,
    placeHolder: "Subscription quota and locally tracked inference tokens",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked?.action === "refresh") await showUsage(provider, output, profile);
  else if (picked?.action === "open") await vscode.env.openExternal(vscode.Uri.parse("https://chatgpt.com/codex"));
  else if (picked?.action === "redeemReset" && picked.resetCreditId) await redeemReset(provider, output, picked.resetCreditId, profile);
}

async function redeemReset(
  provider: OpenAICodexProvider,
  output: vscode.OutputChannel,
  creditId: string,
  profile: string,
): Promise<void> {
  const confirmation = await vscode.window.showWarningMessage(
    "Redeem this Codex reset credit? It resets both the 5-hour and weekly usage windows and consumes one banked reset.",
    { modal: true },
    "Redeem reset",
  );
  if (confirmation !== "Redeem reset") return;
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Redeeming Codex reset credit…" },
      () => provider.consumeResetCredit(creditId, profile),
    );
    const messages: Record<string, string> = {
      alreadyRedeemed: "This Codex reset request was already redeemed.",
      noCredit: "No Codex reset credit is currently available.",
      nothingToReset: "There is no Codex usage window eligible for an immediate reset.",
    };
    if (result.outcome === "reset") {
      const windowText = result.windowsReset ? ` (${result.windowsReset} windows reset)` : "";
      vscode.window.showInformationMessage(`Codex reset credit redeemed${windowText}.`);
    } else if (result.outcome === "alreadyRedeemed") vscode.window.showInformationMessage(messages[result.outcome]);
    else if (messages[result.outcome]) vscode.window.showWarningMessage(messages[result.outcome]);
    else vscode.window.showWarningMessage(`Codex reset response: ${result.outcome}`);
    await showUsage(provider, output, profile);
  } catch (error) {
    showError("Codex reset credit redemption failed", error, output);
  }
}

interface UsageQuickPickItem extends vscode.QuickPickItem {
  action?: "refresh" | "open" | "redeemReset";
  resetCreditId?: string;
}

function toUsageQuickPickItem(row: UsageDisplayRow): UsageQuickPickItem {
  const icon = {
    quota: "$(pulse)", reset: "$(refresh)", tokens: "$(symbol-numeric)", tracked: "$(history)",
    credits: "$(credit-card)", warning: "$(warning)", empty: "$(circle-slash)",
  }[row.kind];
  return { label: `${icon} ${row.label}`, description: row.description, detail: row.detail, alwaysShow: true, action: row.action, resetCreditId: row.actionId };
}

async function diagnostics(oauth: OpenAIOAuth, output: vscode.OutputChannel): Promise<void> {
  const models = await vscode.lm.selectChatModels({ vendor: "openai-codex" });
  const profiles = await oauth.listProfiles();
  const content = [
    `# ${EXTENSION_DISPLAY_NAME} diagnostics`, "", `- VS Code: ${vscode.version}`,
    `- OAuth profiles: ${profiles.length}`, `- Account identities: ${profiles.length ? "redacted" : "unavailable"}`,
    `- Registered models: ${models.length}`, "", ...models.map((model) => `- ${model.id} (${model.maxInputTokens} input tokens)`),
  ].join("\n");
  output.appendLine(`[diagnostics] profiles=${profiles.length} models=${models.length}`);
  const document = await vscode.workspace.openTextDocument({ content, language: "markdown" });
  await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}

function refreshUsageAfterAuth(provider: OpenAICodexProvider, output: vscode.OutputChannel, source: string, profile: string): void {
  void provider.refreshUsage(profile).catch((error) => output.appendLine(`[usage] ${source} refresh failed: ${messageOf(error)}`));
}

function showError(prefix: string, error: unknown, output: vscode.OutputChannel): void {
  const message = messageOf(error);
  output.appendLine(`[error] ${prefix}: ${message}`);
  vscode.window.showErrorMessage(`${prefix}: ${message}`);
}
