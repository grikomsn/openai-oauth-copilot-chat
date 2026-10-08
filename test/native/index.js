const assert = require("node:assert/strict");
const vscode = require("vscode");
const { consumeStream } = require("../../out/provider/response");
const { CodexTransport } = require("../../out/transport/client");
const { OpenAICodexProvider } = require("../../out/provider");
const { OpenAIOAuth } = require("../../out/auth/auth");

const sse = (events) => events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("");
const state = () => {
  const values = new Map();
  return { get: (key) => values.get(key), update: async (key, value) => { values.set(key, value); } };
};

async function run() {
  const source = new vscode.CancellationTokenSource();
  const reported = [];
  const wire = sse([
    { type: "response.reasoning_text.delta", delta: "synthetic plan" },
    ...[0, 1, 2].flatMap((output_index) => [
      { type: "response.function_call_arguments.delta", output_index, delta: '{"value":' },
      { type: "response.output_item.added", output_index, item: { type: "function_call", id: `item-${output_index}`, call_id: `call-${output_index}`, name: "probe" } },
    ]),
    ...[2, 0, 1].flatMap((output_index) => [
      { type: "response.function_call_arguments.delta", item_id: `item-${output_index}`, delta: `${output_index}}` },
      { type: "response.output_item.done", output_index, item: { type: "function_call", id: `item-${output_index}`, call_id: `call-${output_index}`, name: "probe" } },
    ]),
    { type: "response.completed" },
  ]).trimEnd();
  const body = new ReadableStream({ start(controller) {
    for (const character of wire) controller.enqueue(new TextEncoder().encode(character));
    controller.close();
  } });
  await consumeStream(body, { report: (part) => reported.push(part) }, source.token, vscode);
  const calls = reported.filter((part) => part instanceof vscode.LanguageModelToolCallPart);
  assert.deepEqual(calls.map((part) => part.input.value).sort(), [0, 1, 2]);
  assert.equal(reported[1].metadata.vscode_reasoning_done, true);
  assert.equal(body.locked, false);
  for (const ending of [[], [{ type: "response.incomplete" }]]) {
    await assert.rejects(consumeStream(new Response(sse([{ type: "response.reasoning_text.delta", delta: "plan" }, ...ending])).body,
      { report() {} }, source.token, vscode), /ended before|incomplete/);
  }

  const cancel = new vscode.CancellationTokenSource();
  let released = false;
  const transport = new CodexTransport({ getAccessToken: async () => ({ token: "synthetic" }) }, "native-test", () => 10, () => "1",
    async () => new Response(new ReadableStream({ cancel() { released = true; } })));
  const response = await transport.sendResponse({}, cancel.token);
  const reading = response.text();
  cancel.cancel();
  await assert.rejects(reading, /abort/i);
  assert.equal(released, true);

  const values = new Map(["work", "personal"].map((profile) => [`openaiCodex.oauthSession.v2.${profile}`,
    JSON.stringify({ accessToken: `synthetic-${profile}`, refreshToken: "synthetic-refresh", accountId: `synthetic-account-${profile}`, expiresAt: Date.now() + 3600000 })]));
  const oauth = new OpenAIOAuth({ keys: async () => [...values.keys()], get: async (key) => values.get(key),
    store: async (key, value) => { values.set(key, value); }, delete: async (key) => { values.delete(key); } });
  assert.deepEqual(await oauth.listProfiles(), ["personal", "work"]);
  const requests = [];
  const fetcher = async (url, init) => {
    if (String(url).includes("/models?")) return Response.json({ models: [{ slug: "native-probe", display_name: "Native probe", visibility: "list",
      context_window: 10000, input_modalities: ["text"], priority: 1, description: "Synthetic model", supports_parallel_tool_calls: true, supports_reasoning_summary_parameter: true, default_reasoning_summary: "auto", service_tiers: [], additional_speed_tiers: [], default_reasoning_level: "low", supported_reasoning_levels: [{ effort: "low", description: "low" }] }] });
    if (String(url).includes("models.dev")) return Response.json({});
    const body = JSON.parse(init.body);
    requests.push({ token: new Headers(init.headers).get("Authorization"), body });
    return new Response(sse([{ type: "response.output_text.delta", delta: "synthetic answer" }, { type: "response.completed" }]));
  };
  const provider = new OpenAICodexProvider(oauth, { appendLine() {} }, "native-test", {}, state(), fetcher);
  for (const profile of ["work", "personal"]) {
    const models = await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile } }, source.token);
    assert.ok(models.length);
    const history = [vscode.LanguageModelChatMessage.User("synthetic prompt"), vscode.LanguageModelChatMessage.Assistant([
      new vscode.LanguageModelThinkingPart([], "opaque", { encrypted_content: "synthetic-encrypted" }), ...calls,
    ]), vscode.LanguageModelChatMessage.User(calls.map((call) => new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart("synthetic result")])) )];
    await provider.provideLanguageModelChatResponse(models[0], history, { requestInitiator: "native-test" }, { report() {} }, source.token);
    const sent = requests.at(-1);
    assert.equal(sent.token, `Bearer synthetic-${profile}`);
    assert.equal(sent.body.store, false);
    assert.ok(sent.body.input.some((item) => item.encrypted_content === "synthetic-encrypted"));
    assert.equal(sent.body.input.filter((item) => item.type === "function_call_output").length, 3);
  }
  await oauth.signOut("work");
  assert.deepEqual(await oauth.listProfiles(), ["personal"]);
  assert.equal((await provider.provideLanguageModelChatInformation({ configuration: { profile: "work" } }, source.token)).length, 0);
  source.dispose(); cancel.dispose();
  console.log(JSON.stringify({ provider: "openai", nativeChecks: "parallel calls, reasoning closure, EOF/incomplete, cancellation, two profiles, encrypted follow-up, sign-out", passed: true }));
}
module.exports = { run };
