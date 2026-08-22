import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeProfileFromState, profileFromConfiguration, profileQualifiedModelId } from "./provider-profile";

test("declares optional native profile configuration without a management-command override", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { languageModelChatProviders: Array<Record<string, unknown>> };
  };
  const provider = manifest.contributes.languageModelChatProviders.find((item) => item.vendor === "openai-codex");
  assert.ok(provider);
  assert.equal(provider.managementCommand, undefined);
  assert.equal((provider.configuration as { required?: string[] }).required, undefined);
});

test("qualifies model IDs by profile and reports invalid native profile values", () => {
  assert.equal(profileQualifiedModelId("Work", "gpt-5.2"), "work::gpt-5.2");
  assert.equal(profileQualifiedModelId("default", "gpt-5.2"), "gpt-5.2");
  assert.throws(
    () => profileFromConfiguration({ profile: "work profile" }),
    /Update this provider entry in Manage Language Models/,
  );
});

test("restores only a valid persisted management profile", () => {
  assert.equal(activeProfileFromState("Work"), "work");
  assert.equal(activeProfileFromState("work profile"), "default");
  assert.equal(activeProfileFromState(undefined), "default");
});
