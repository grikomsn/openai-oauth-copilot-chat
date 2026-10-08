import assert from "node:assert/strict";
import test from "node:test";
import { observeProfile, readProfileJournal, reconcileProfiles } from "./provider-journal";
import type { MetadataCache } from "./models/metadata";

test("serializes observations without storing account details or credentials", async () => {
  const values = new Map<string, unknown>();
  const state: MetadataCache = { get: <T>(key: string) => values.get(key) as T | undefined,
    async update(key, value) { await new Promise((resolve) => setImmediate(resolve)); values.set(key, value); } };
  await Promise.all([observeProfile(state, "work", 2), observeProfile(state, "personal", 3)]);
  const journal = readProfileJournal(state);
  assert.deepEqual(Object.keys(journal).sort(), ["personal", "work"]);
  assert.deepEqual(Object.keys(journal.work).sort(), ["modelCount", "updatedAt"]);
  assert.deepEqual(reconcileProfiles(journal, ["work", "new"]), {
    entriesWithoutSessions: ["personal"], accountsWithoutObservedEntries: ["new"],
  });
});
