import * as vscode from "vscode";
import { messageOf } from "./errors";
import { DEFAULT_OAUTH_PROFILE, OpenAIOAuth } from "./auth/auth";
import { registerCodexCommands } from "./commands/commands";
import { OpenAICodexProvider } from "./provider";
import { EXTENSION_DISPLAY_NAME, extensionUserAgent } from "./transport/protocol";
import { formatUsageStatusBar, formatUsageTooltip } from "./usage/presentation";
import { usageSnapshotForPersistence, type CodexUsageSnapshot } from "./usage/domain";

const LEGACY_USAGE_STATE_KEY = "openaiCodex.usageSnapshot.v1";
const USAGE_STATE_KEY = "openaiCodex.usageSnapshots.v2";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Codex Bridge");
  const oauth = new OpenAIOAuth(context.secrets);
  const version = context.extension.packageJSON.version as string;
  const storedUsage = context.globalState.get<Readonly<Record<string, CodexUsageSnapshot>>>(USAGE_STATE_KEY)
    ?? { [DEFAULT_OAUTH_PROFILE]: context.globalState.get<CodexUsageSnapshot>(LEGACY_USAGE_STATE_KEY) ?? {} };
  const provider = new OpenAICodexProvider(
    oauth,
    output,
    extensionUserAgent(version, vscode.version),
    storedUsage,
    context.globalState,
  );
  const usageStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 91);
  usageStatus.name = "Codex Bridge usage";
  usageStatus.command = "openaiCodex.showUsage";
  renderUsageStatus(usageStatus, provider.getUsageSnapshot());
  updateUsageStatusVisibility(usageStatus);
  context.subscriptions.push(
    output,
    usageStatus,
    provider.onDidChangeUsage(({ profile, usage }) => {
      if (profile === provider.getActiveProfile()) renderUsageStatus(usageStatus, usage);
      updateUsageStatusVisibility(usageStatus);
      const persisted = Object.fromEntries(Object.entries(provider.getUsageSnapshots()).map(([key, value]) => [key, usageSnapshotForPersistence(value)]));
      void context.globalState.update(USAGE_STATE_KEY, persisted);
    }),
    vscode.lm.registerLanguageModelChatProvider("openai-codex", provider),
    ...registerCodexCommands(oauth, provider, output, usageStatus),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("openaiCodex.reasoningSummary")
        || event.affectsConfiguration("openaiCodex.reasoningEffort")
        || event.affectsConfiguration("openaiCodex.speedMode")
        || event.affectsConfiguration("openaiCodex.catalogCacheMinutes")) {
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

function renderUsageStatus(item: vscode.StatusBarItem, snapshot: CodexUsageSnapshot): void {
  item.text = formatUsageStatusBar(snapshot);
  item.tooltip = formatUsageTooltip(snapshot);
}

function updateUsageStatusVisibility(item: vscode.StatusBarItem): void {
  if (vscode.workspace.getConfiguration("openaiCodex").get("showUsageStatusBar", true)) item.show();
  else item.hide();
}
