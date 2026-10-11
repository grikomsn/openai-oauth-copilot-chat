import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_SIGN_IN_COOLDOWN_MS, AutoSignInGate } from "./auto-signin";

test("triggers sign-in for a fresh per-group resolution", () => {
  let time = 1_000;
  const gate = new AutoSignInGate(() => time);
  assert.equal(gate.shouldStartSignIn("work"), true);
  assert.equal(gate.shouldStartSignIn("default"), true);
});

test("suppresses exactly one resolution after our own provisioning", () => {
  const gate = new AutoSignInGate();
  gate.suppressNext("work");
  assert.equal(gate.shouldStartSignIn("work"), false);
  assert.equal(gate.shouldStartSignIn("work"), true, "suppression must be one-shot");
});

test("cooldown blocks repeated prompts for the same profile only", () => {
  let time = 1_000;
  const gate = new AutoSignInGate(() => time);
  assert.equal(gate.shouldStartSignIn("work"), true);
  time += 1_000;
  assert.equal(gate.shouldStartSignIn("work"), false, "within cooldown");
  assert.equal(gate.shouldStartSignIn("personal"), true, "other profiles are independent");
  time += AUTO_SIGN_IN_COOLDOWN_MS;
  assert.equal(gate.shouldStartSignIn("work"), true, "cooldown expired");
});

test("cooldown expiry re-arms the trigger", () => {
  let time = 0;
  const gate = new AutoSignInGate(() => time);
  assert.equal(gate.shouldStartSignIn("work"), true);
  gate.suppressNext("work");
  time += AUTO_SIGN_IN_COOLDOWN_MS - 1;
  assert.equal(gate.shouldStartSignIn("work"), false);
  time += 1;
  assert.equal(gate.shouldStartSignIn("work"), true);
});
