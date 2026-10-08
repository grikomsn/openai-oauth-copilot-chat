import { DEFAULT_OAUTH_PROFILE, normalizeProfileId } from "./auth/auth";

export function profileFromConfiguration(configuration: Readonly<Record<string, unknown>> | undefined): string {
  try {
    if (configuration?.profile !== undefined && typeof configuration.profile !== "string") throw new Error("Profile must be a string");
    return normalizeProfileId(typeof configuration?.profile === "string" ? configuration.profile : DEFAULT_OAUTH_PROFILE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Codex Bridge profile. Update this provider entry in Manage Language Models. ${message}`);
  }
}

export function profileQualifiedModelId(profile: string, modelId: string): string {
  const normalized = normalizeProfileId(profile);
  return `${normalized}::${modelId}`;
}

/** Restores a command-management profile without allowing stale state to prevent activation. */
export function activeProfileFromState(value: unknown): string {
  try {
    return typeof value === "string" ? normalizeProfileId(value) : DEFAULT_OAUTH_PROFILE;
  } catch {
    return DEFAULT_OAUTH_PROFILE;
  }
}
