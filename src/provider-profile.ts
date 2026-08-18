import { DEFAULT_OAUTH_PROFILE, normalizeProfileId } from "./auth/auth";

export function profileFromConfiguration(configuration: Readonly<Record<string, unknown>> | undefined): string {
  try {
    return normalizeProfileId(typeof configuration?.profile === "string" ? configuration.profile : DEFAULT_OAUTH_PROFILE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Codex Bridge profile. Update this provider entry in Manage Language Models. ${message}`);
  }
}

export function profileQualifiedModelId(profile: string, modelId: string): string {
  const normalized = normalizeProfileId(profile);
  return normalized === DEFAULT_OAUTH_PROFILE ? modelId : `${normalized}::${modelId}`;
}
