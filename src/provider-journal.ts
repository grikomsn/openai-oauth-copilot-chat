import type { MetadataCache } from "./models/metadata";

const JOURNAL_KEY = "openaiCodex.observedProfiles.v1";
export interface ProfileObservation { modelCount: number; updatedAt: number }
export type ProfileJournal = Readonly<Record<string, ProfileObservation>>;
const mutations = new WeakMap<MetadataCache, Promise<void>>();

/** Discovery history contains aliases and counts only; VS Code owns native entries. */
export function readProfileJournal(state: MetadataCache): ProfileJournal {
  return state.get<ProfileJournal>(JOURNAL_KEY) ?? {};
}

export async function observeProfile(state: MetadataCache, profile: string, modelCount: number): Promise<void> {
  const previous = mutations.get(state) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    await state.update(JOURNAL_KEY, { ...readProfileJournal(state), [profile]: { modelCount, updatedAt: Date.now() } });
  });
  mutations.set(state, current);
  try { await current; } finally { if (mutations.get(state) === current) mutations.delete(state); }
}

export function reconcileProfiles(journal: ProfileJournal, profiles: readonly string[]): {
  entriesWithoutSessions: string[]; accountsWithoutObservedEntries: string[];
} {
  return {
    entriesWithoutSessions: Object.keys(journal).filter((profile) => !profiles.includes(profile)),
    accountsWithoutObservedEntries: profiles.filter((profile) => !Object.hasOwn(journal, profile)),
  };
}
