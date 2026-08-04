import { readFile, writeFile } from "node:fs/promises";

const CODEX_RELEASES_API_URL = "https://api.github.com/repos/openai/codex/releases/latest";
const PROTOCOL_PATH = new URL("../src/protocol.ts", import.meta.url);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function parseCodexReleaseVersion(payload) {
  const tagName = payload?.tag_name;
  if (typeof tagName !== "string" || !tagName.trim()) throw new Error("Codex release response is missing a tag name");
  const version = tagName.trim().replace(/^rust-v/, "").replace(/^v/, "");
  if (!VERSION_PATTERN.test(version)) throw new Error(`Codex release tag is not a supported version: ${tagName}`);
  return version;
}

const response = await fetch(CODEX_RELEASES_API_URL, {
  headers: {
    Accept: "application/vnd.github+json",
    "User-Agent": "openai-oauth-copilot-chat-version-updater",
  },
});
if (!response.ok) throw new Error(`Unable to load the latest OpenAI Codex release: HTTP ${response.status}`);

const version = parseCodexReleaseVersion(await response.json());
const source = await readFile(PROTOCOL_PATH, "utf8");
const declaration = /(export const CODEX_MODELS_CLIENT_VERSION = )"[^"]+";/;
if (!declaration.test(source)) throw new Error(`Could not find CODEX_MODELS_CLIENT_VERSION in ${PROTOCOL_PATH}`);

const updated = source.replace(declaration, `$1${JSON.stringify(version)};`);
if (updated !== source) await writeFile(PROTOCOL_PATH, updated);
console.log(`Codex client version is ${version}`);
