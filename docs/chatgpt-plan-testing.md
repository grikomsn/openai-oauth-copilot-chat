# Manual testing: ChatGPT plan connections

Use the locally sideloaded feature build after **Developer: Reload Window**. Keep an existing legacy entry available, and add a separate profile such as `plan-test` for this test.

1. Run **Codex Bridge: Add ChatGPT Account**, enter `plan-test`, and choose **Continue with ChatGPT**. Confirm the consent screen names Codex Bridge and offers plan usage. After approving, the browser should report success and the profile should appear in Manage Language Models.
2. Open ChatGPT Settings → Usage. Confirm the new connection appears and choose the weekly percentage cap you want. The extension's usage view should link there and show local tokens, without legacy quota/reset-credit controls.
3. Select a discovered model under the `plan-test` entry. Send a short message, ask a follow-up, and exercise a Copilot file-read tool. Confirm tool results and conversation context survive subsequent requests.
4. Choose an advertised reasoning effort, then change it for a later turn. Confirm the Image Generation control is absent. Test image input on a model that advertises it, and optional Web Search if your account allows it.
5. Cancel a streaming response. A new request should still work. Run **Test Connection** and **Refresh Models** for this profile.
6. Sign out through **Manage Connection**, then connect the same profile again. It should reuse its registration instead of creating another agent. Test a VS Code reload and confirm the profile still works. Token renewal can be checked after the token expires naturally.
7. Select the retained legacy model entry and verify its normal chat/usage behavior. Switching the management profile must not change the account attached to another model entry.

If you naturally encounter an app cap, the request should stop with a ChatGPT Usage instruction, including when text already started streaming. Do not deliberately exhaust your plan solely for this test. Confirm any reset time in ChatGPT itself.

Report the selected connection mode/model, VS Code version, and sanitized error code or request ID if available. Never attach tokens, callback URLs, account identifiers, private prompts, or captured response bodies.
