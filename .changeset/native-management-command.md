---
"openai-oauth-copilot-chat": minor
---

Simplify Codex Bridge auth setup

The native **Add Models → Codex Bridge** flow now fully works out of the box: it prompts for a group name and profile ID (prefilled) and creates the entry.

- **Codex Bridge: Add Provider Entry** (`openaiCodex.configureEntry`) provisions the entry group immediately with the typed profile, then runs ChatGPT sign-in only when that profile has no session — the entry appears in Manage Language Models even before signing in, and lists no models until then.
- **Codex Bridge: Add ChatGPT Account** now also provisions the matching entry after sign-in instead of ending with manual instructions.
- Signing into an already-signed-in profile no longer prompts to replace; it just activates that profile.
- **Adding an entry natively (Add Models → Codex Bridge) now offers to sign in** when the profile has no session yet, and every sign-in command (browser, manual, CLI import) provisions the matching entry automatically when none exists yet — no more pairing the two commands manually.
- Repeated offers are debounced, and deliberately removed entries are never resurrected by sign-ins they were removed for.
