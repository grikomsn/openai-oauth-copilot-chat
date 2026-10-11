import type { MetadataCache } from "./models/metadata";

const JOURNAL_KEY = "openaiCodex.observedProfiles.v1";
export interface ProfileObservation { modelCount: number; updatedAt: number }
export type ProfileJournal = Readonly<Record<string, ProfileObservation>>;
const mutations = new WeakMap<MetadataCache, Promise<void>>();

/** Discovery history contains aliases and counts only; VS Code owns native entries. */
export function readProfileJournal(state: MetadataCache): ProfileJournal {
  const value = state.get<unknown>(JOURNAL_KEY);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([profile, raw]) => {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(profile) || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const record = raw as Partial<ProfileObservation>;
    if (typeof record.modelCount !== "number" || !Number.isInteger(record.modelCount) || record.modelCount < 0
      || typeof record.updatedAt !== "number" || !Number.isFinite(record.updatedAt)) return [];
    return [[profile, { modelCount: record.modelCount, updatedAt: record.updatedAt }]];
  }));
}

/** Whether the host has ever resolved this profile through a configured entry. */
export function hasObservedProfile(state: MetadataCache, profile: string): boolean {
  return Object.hasOwn(readProfileJournal(state), profile);
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
