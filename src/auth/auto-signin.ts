/**
 * Gates for the auto sign-in bridge between native entry creation and the
 * OAuth sign-in flows.
 *
 * Both entry-creation paths (the native Add Models gear flow and the
 * extension's own provisioning command) deliver a per-group resolve to the
 * provider. When that resolve names a profile with no session, the extension
 * should offer sign-in. A cooldown debounces the host's repeated re-resolves;
 * a suppression latch marks resolutions that belong to the extension's own
 * provisioning command so they do not double-trigger.
 */

/** Cooldown between two auto sign-in prompts for the same profile. */
export const AUTO_SIGN_IN_COOLDOWN_MS = 60_000;

/**
 * Decides whether a per-group resolution of an unsigned-in profile should
 * trigger the sign-in flow.
 *
 * The latch suppresses the resolution that is part of our own provisioning
 * command (`lm.migrateLanguageModelsProviderGroup` re-resolves the freshly
 * created group); a cooldown avoids nagging when the host re-resolves
 * repeatedly (e.g. model picker refreshes).
 */
export class AutoSignInGate {
  private readonly suppressed = new Set<string>();
  private readonly promptedAt = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Suppresses the next per-group resolution of `profile` (our own provisioning). */
  suppressNext(profile: string): void {
    this.suppressed.add(profile);
  }

  /**
   * Consumes one per-group resolution for `profile`.
   *
   * @returns whether the extension should start sign-in for this profile.
   */
  shouldStartSignIn(profile: string): boolean {
    if (this.suppressed.delete(profile)) return false;
    const last = this.promptedAt.get(profile);
    if (last !== undefined && this.now() - last < AUTO_SIGN_IN_COOLDOWN_MS) return false;
    this.promptedAt.set(profile, this.now());
    return true;
  }

  /** Test helper: forgets all suppression latches and cooldowns. */
  reset(): void {
    this.suppressed.clear();
    this.promptedAt.clear();
  }
}
