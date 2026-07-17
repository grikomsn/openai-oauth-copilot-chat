import * as vscode from "vscode";
import { messageOf } from "./errors";
import { OpenAIOAuth, type AuthorizationFlow } from "./oauth";
import { OpenAICodexProvider } from "./provider";
import { EXTENSION_DISPLAY_NAME, extensionUserAgent } from "./protocol";
import {
  formatUsageRows,
  formatUsageStatusBar,
  formatUsageTooltip,
  type CodexUsageSnapshot,
  type UsageDisplayRow,
} from "./usage";

const USAGE_STATE_KEY = "openaiCodex.usageSnapshot.v1";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Codex Bridge");
  const oauth = new OpenAIOAuth(context.secrets);
  const version = context.extension.packageJSON.version as string;
  const provider = new OpenAICodexProvider(
    oauth,
    output,
    extensionUserAgent(version, vscode.version),
    context.globalState.get<CodexUsageSnapshot>(USAGE_STATE_KEY) ?? {},
  );
  const usageStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 91);
  usageStatus.name = "Codex Bridge usage";
  usageStatus.command = "openaiCodex.showUsage";
  renderUsageStatus(usageStatus, provider.getUsageSnapshot());
  context.subscriptions.push(
    output,
    usageStatus,
    provider.onDidChangeUsage((usage) => {
      renderUsageStatus(usageStatus, usage);
      updateUsageStatusVisibility(usageStatus);
      void context.globalState.update(USAGE_STATE_KEY, usage);
    }),
    vscode.lm.registerLanguageModelChatProvider("openai-codex", provider),
    vscode.commands.registerCommand("openaiCodex.manage", () => manage(oauth, provider, output, usageStatus)),
    vscode.commands.registerCommand("openaiCodex.signIn", () => browserSignIn(oauth, provider, output)),
    vscode.commands.registerCommand("openaiCodex.signInManual", () => manualSignIn(oauth, provider, output)),
    vscode.commands.registerCommand("openaiCodex.importCodexSession", () => importCodexSession(oauth, provider, output)),
    vscode.commands.registerCommand("openaiCodex.testConnection", () => testConnection(provider, output)),
    vscode.commands.registerCommand("openaiCodex.showUsage", () => showUsage(provider, output)),
    vscode.commands.registerCommand("openaiCodex.diagnostics", () => diagnostics(oauth, output)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("openaiCodex.speedMode") || event.affectsConfiguration("openaiCodex.reasoningEffort")) {
        provider.fireDidChange();
      }
      if (event.affectsConfiguration("openaiCodex.showUsageStatusBar")) updateUsageStatusVisibility(usageStatus);
    }),
  );
  output.appendLine(`[activate] ${EXTENSION_DISPLAY_NAME} ${version} on VS Code ${vscode.version}`);
  void oauth.hasSession().then((signedIn) => {
    if (!signedIn) return;
    updateUsageStatusVisibility(usageStatus);
    void provider.refreshUsage().catch((error) => output.appendLine(`[usage] initial refresh failed: ${messageOf(error)}`));
  });
}

async function manage(
  oauth: OpenAIOAuth,
  provider: OpenAICodexProvider,
  output: vscode.OutputChannel,
  usageStatus: vscode.StatusBarItem,
): Promise<void> {
  const session = await oauth.sessionInfo();
  const picked = await vscode.window.showQuickPick(session ? [
    { label: "$(pulse) Show Codex usage", action: "usage" },
    { label: "$(check) Test Codex connection", action: "test" },
    { label: "$(output) Show Codex Bridge logs", action: "logs" },
    { label: "$(sign-out) Sign out of Codex Bridge", action: "signout" },
  ] : [
    { label: "$(globe) Sign in with ChatGPT", action: "signin", description: "ChatGPT Plus or Pro" },
    { label: "$(link) Sign in manually", action: "manual", description: "Use if localhost:1455 is unavailable" },
    { label: "$(terminal) Import Codex CLI session (Advanced)", action: "import", description: "Copies OAuth credentials from ~/.codex/auth.json" },
    { label: "$(output) Show Codex Bridge logs", action: "logs" },
  ], { title: `Codex Bridge — ${session?.email ?? (session ? "signed in" : "not signed in")}` });
  if (!picked) return;
  if (picked.action === "signin") await browserSignIn(oauth, provider, output);
  else if (picked.action === "manual") await manualSignIn(oauth, provider, output);
  else if (picked.action === "import") await importCodexSession(oauth, provider, output);
  else if (picked.action === "usage") await showUsage(provider, output);
  else if (picked.action === "test") await testConnection(provider, output);
  else if (picked.action === "logs") output.show(true);
  else if (picked.action === "signout") {
    await oauth.signOut();
    provider.clearUsage();
    usageStatus.hide();
    provider.fireDidChange();
    vscode.window.showInformationMessage("Signed out of Codex Bridge.");
  }
}

async function browserSignIn(oauth: OpenAIOAuth, provider: OpenAICodexProvider, output: vscode.OutputChannel): Promise<void> {
  let attempt: Awaited<ReturnType<OpenAIOAuth["startBrowserSignIn"]>> | undefined;
  try {
    attempt = await oauth.startBrowserSignIn();
    if (!await vscode.env.openExternal(vscode.Uri.parse(attempt.url))) throw new Error("VS Code could not open the OpenAI authorization page");
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Waiting for OpenAI sign-in…", cancellable: true },
      async (_progress, cancellation) => {
        const listener = cancellation.onCancellationRequested(() => attempt?.cancel());
        try { await attempt?.completion; } finally { listener.dispose(); }
      },
    );
    provider.fireDidChange();
    void provider.refreshUsage().catch((error) => output.appendLine(`[usage] post-sign-in refresh failed: ${messageOf(error)}`));
    vscode.window.showInformationMessage("Signed in to Codex Bridge with ChatGPT.");
  } catch (error) {
    attempt?.cancel();
    showError("ChatGPT sign-in failed", error, output);
  }
}

async function manualSignIn(oauth: OpenAIOAuth, provider: OpenAICodexProvider, output: vscode.OutputChannel): Promise<void> {
  const flow: AuthorizationFlow = oauth.createAuthorizationFlow();
  try {
    await vscode.env.clipboard.writeText(flow.url);
    await vscode.env.openExternal(vscode.Uri.parse(flow.url));
    const callback = await vscode.window.showInputBox({
      title: "Codex Bridge manual sign-in",
      prompt: "After signing in, paste the full localhost callback URL (or a query string containing both code and state)",
      ignoreFocusOut: true,
    });
    if (!callback) return;
    await oauth.completeAuthorization(callback, flow);
    provider.fireDidChange();
    void provider.refreshUsage().catch((error) => output.appendLine(`[usage] post-sign-in refresh failed: ${messageOf(error)}`));
    vscode.window.showInformationMessage("Signed in to Codex Bridge with ChatGPT.");
  } catch (error) {
    showError("ChatGPT manual sign-in failed", error, output);
  }
}

async function importCodexSession(oauth: OpenAIOAuth, provider: OpenAICodexProvider, output: vscode.OutputChannel): Promise<void> {
  try {
    const confirmed = await vscode.window.showWarningMessage(
      "Importing a Codex CLI session copies its OAuth access and refresh credentials into VS Code Secret Storage. A fresh ChatGPT sign-in is recommended.",
      { modal: true, detail: "Continue only if you trust this extension and want both clients to use credentials derived from the same CLI session." },
      "Import session",
    );
    if (confirmed !== "Import session") return;
    const session = await oauth.importCodexCliSession();
    provider.fireDidChange();
    void provider.refreshUsage().catch((error) => output.appendLine(`[usage] post-import refresh failed: ${messageOf(error)}`));
    vscode.window.showInformationMessage(`Imported Codex CLI session${session.email ? ` for ${session.email}` : ""}.`);
  } catch (error) {
    showError("Unable to import Codex CLI session", error, output);
  }
}

async function testConnection(provider: OpenAICodexProvider, output: vscode.OutputChannel): Promise<void> {
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Testing Codex connection…" },
      () => provider.testConnection(),
    );
    output.appendLine(`[test] model=${result.model} speed=${result.speedMode} effort=${result.reasoningEffort} response=${result.text}`);
    vscode.window.showInformationMessage(`Codex connection verified with ${result.model} (${result.speedMode}, ${result.reasoningEffort}): ${result.text}`);
  } catch (error) {
    showError("Codex connection test failed", error, output);
  }
}

async function showUsage(provider: OpenAICodexProvider, output: vscode.OutputChannel): Promise<void> {
  let snapshot = provider.getUsageSnapshot();
  try {
    snapshot = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Refreshing Codex usage…" },
      () => provider.refreshUsage(),
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
    title: snapshot.updatedAt
      ? `Codex usage — updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}`
      : "Codex usage",
    placeHolder: "Subscription quota and locally tracked inference tokens",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked?.action === "refresh") await showUsage(provider, output);
  else if (picked?.action === "open") await vscode.env.openExternal(vscode.Uri.parse("https://chatgpt.com/codex"));
}

function renderUsageStatus(item: vscode.StatusBarItem, snapshot: CodexUsageSnapshot): void {
  item.text = formatUsageStatusBar(snapshot);
  item.tooltip = formatUsageTooltip(snapshot);
}

function updateUsageStatusVisibility(item: vscode.StatusBarItem): void {
  if (vscode.workspace.getConfiguration("openaiCodex").get("showUsageStatusBar", true)) item.show();
  else item.hide();
}

interface UsageQuickPickItem extends vscode.QuickPickItem {
  action?: "refresh" | "open";
}

function toUsageQuickPickItem(row: UsageDisplayRow): UsageQuickPickItem {
  const icon = {
    quota: "$(pulse)",
    tokens: "$(symbol-numeric)",
    tracked: "$(history)",
    credits: "$(credit-card)",
    warning: "$(warning)",
    empty: "$(circle-slash)",
  }[row.kind];
  return { label: `${icon} ${row.label}`, description: row.description, detail: row.detail, alwaysShow: true };
}

async function diagnostics(oauth: OpenAIOAuth, output: vscode.OutputChannel): Promise<void> {
  const models = await vscode.lm.selectChatModels({ vendor: "openai-codex" });
  const session = await oauth.sessionInfo();
  const content = [
    `# ${EXTENSION_DISPLAY_NAME} diagnostics`, "",
    `- VS Code: ${vscode.version}`,
    `- OAuth session: ${session ? "present" : "missing"}`,
    `- Account: ${session?.email ?? "unknown"}`,
    `- Registered models: ${models.length}`, "",
    ...models.map((model) => `- ${model.id} (${model.maxInputTokens} input tokens)`),
  ].join("\n");
  output.appendLine(`[diagnostics] session=${Boolean(session)} models=${models.length}`);
  const document = await vscode.workspace.openTextDocument({ content, language: "markdown" });
  await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}

function showError(prefix: string, error: unknown, output: vscode.OutputChannel): void {
  const message = messageOf(error);
  output.appendLine(`[error] ${prefix}: ${message}`);
  vscode.window.showErrorMessage(`${prefix}: ${message}`);
}
