import assert from "node:assert/strict";
import test from "node:test";
import { activeProfileFromState, profileFromConfiguration, profileQualifiedModelId } from "./provider-profile";

test("normalizes native provider-entry profiles and falls back to the default profile", () => {
  assert.equal(profileFromConfiguration({ profile: "  Work-Team  " }), "work-team");
  assert.equal(profileFromConfiguration({ profile: "" }), "default");
  assert.equal(profileFromConfiguration({ profile: 7 }), "default");
  assert.equal(profileFromConfiguration({}), "default");
  assert.equal(profileFromConfiguration(undefined), "default");
});

test("wraps invalid provider-entry profiles with a Manage Language Models hint", () => {
  assert.throws(() => profileFromConfiguration({ profile: "not a valid profile!" }), (error: Error) => {
    assert.match(error.message, /^Invalid Codex Bridge profile\. Update this provider entry in Manage Language Models\. /);
    assert.match(error.message, /Profile IDs must use 1-64 lowercase letters, numbers, dots, underscores, or hyphens$/);
    return true;
  });
  assert.throws(() => profileFromConfiguration({ profile: "-".repeat(65) }));
});

test("qualifies model IDs per profile while keeping the default profile unqualified", () => {
  assert.equal(profileQualifiedModelId("default", "gpt-5.3-codex"), "gpt-5.3-codex");
  assert.equal(profileQualifiedModelId("work", "gpt-5.3-codex"), "work::gpt-5.3-codex");
  assert.equal(profileQualifiedModelId("  Personal  ", "gpt-5.3-codex"), "personal::gpt-5.3-codex");
});

test("restores command-management profiles without letting stale state block activation", () => {
  assert.equal(activeProfileFromState("  WORK  "), "work");
  assert.equal(activeProfileFromState("default"), "default");
  assert.equal(activeProfileFromState(42), "default");
  assert.equal(activeProfileFromState(null), "default");
  assert.equal(activeProfileFromState(undefined), "default");
  assert.equal(activeProfileFromState("not a valid profile!"), "default");
});