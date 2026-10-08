#!/usr/bin/env node
// Model-metadata resync helper for OpenAI OAuth Copilot Chat.
//
// The ChatGPT Codex model directory requires a signed-in OAuth profile and
// cannot be probed headlessly, so this script compares the bundled published
// pricing table against the public models.dev `openai` catalog and reports
// drift in the pinned Codex client version for manual review.
//
// Usage:
//   npm run refresh-models                              # report only
//   node scripts/refresh-models.mjs --apply             # refresh pricing rows
//   node scripts/refresh-models.mjs --pr                # --apply + branch/push/PR
//   node scripts/refresh-models.mjs --ci --report-file model-resync-report.md
//
// No API credentials are used; models.dev and the GitHub releases API are
// public.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRICING_FILE = path.join(ROOT, "src/models/pricing.ts");
const PROTOCOL_FILE = path.join(ROOT, "src/transport/protocol.ts");
const TABLE_START = "const OFFICIAL_MODEL_COSTS: Readonly<Record<string, ModelCost>> = {\n";
const TABLE_END = "};\n";
const CHANGESET_SUMMARY = "Resync OpenAI published pricing with the models.dev catalog.";
const MODELS_DEV_URL = "https://models.dev/api.json";
const CODEX_RELEASES_URL = "https://api.github.com/repos/openai/codex/releases/latest";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply") || argv.includes("--pr") || argv.includes("--ci");
const CREATE_PR = argv.includes("--pr");
const reportFileIdx = argv.indexOf("--report-file");
const reportPath = reportFileIdx >= 0 ? argv[reportFileIdx + 1] : undefined;
const require_ = createRequire(import.meta.url);

const report = [];
function log(line = "") {
  report.push(line);
  console.log(line);
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

function requireBundled() {
  const resolved = path.join(ROOT, "out", "models/pricing.js");
  if (!existsSync(resolved) || srcNewerThan(resolved)) {
    const compiled = spawnSync("npm", ["run", "compile"], { cwd: ROOT, encoding: "utf8" });
    if (compiled.status) {
      console.error(compiled.stderr);
      process.exit(compiled.status ?? 1);
    }
  }
  return require_(resolved);
}

/** True when any TypeScript source is newer than the compiled target. */
function srcNewerThan(target) {
  const compiled = statSync(target).mtimeMs;
  const stack = [path.join(ROOT, "src")];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(?:ts|mts)$/.test(entry.name) && statSync(full).mtimeMs > compiled) return true;
    }
  }
  return false;
}

/** Parses the bundled table rows: [key, input, cacheRead?, output]. */
function parseRows() {
  const source = readFileSync(PRICING_FILE, "utf8");
  const start = source.indexOf(TABLE_START);
  if (start < 0) throw new Error("pricing table not found in pricing.ts");
  const bodyStart = start + TABLE_START.length;
  const end = source.indexOf(TABLE_END, bodyStart);
  if (end < 0) throw new Error("pricing table terminator not found in pricing.ts");
  const rows = [...source.slice(bodyStart, end).matchAll(
    /"([^"]+)": \{ input: ([\d.]+)(?:, cacheRead: ([\d.]+))?, output: ([\d.]+) \}/g,
  )].map((m) => ({ key: m[1], input: Number(m[2]), cacheRead: m[3] === undefined ? undefined : Number(m[3]), output: Number(m[4]) }));
  return rows;
}

function sameRate(left, right) {
  const keys = left.cacheRead === undefined || right.cacheRead === undefined
    ? ["input", "output"]
    : ["input", "cacheRead", "output"];
  return keys.every((key) => Math.abs((left[key] ?? 0) - (right[key] ?? 0)) < 1e-9);
}

/** Reports the pinned Codex client models version against the latest release. */
async function reportCodexVersion() {
  const source = readFileSync(PROTOCOL_FILE, "utf8");
  const pinned = source.match(/CODEX_MODELS_CLIENT_VERSION = "([^"]+)"/)?.[1];
  if (!pinned) {
    log("CODEX_MODELS_CLIENT_VERSION not found in src/transport/protocol.ts.");
    return;
  }
  const release = await fetchJson(CODEX_RELEASES_URL, {
    headers: { accept: "application/vnd.github+json", "user-agent": "refresh-models-script" },
  });
  const latest = String(release.tag_name ?? "").replace(/^v/, "");
  if (latest && latest !== pinned) {
    log(`Drift (manual review): pinned Codex client version ${pinned}, latest upstream tag ${latest}; run \`npm run update-codex-version\`.`);
  } else {
    log(`Codex client version is current (${pinned}).`);
  }
}

const main = async () => {
  requireBundled();
  const modelsDev = await fetchJson(MODELS_DEV_URL, { headers: { accept: "application/json" } });
  const openai = modelsDev.openai;
  if (!openai?.models) throw new Error("models.dev has no openai provider");
  const canonical = openai.models;
  log(`models.dev openai catalog: ${Object.keys(canonical).length} models`);
  await reportCodexVersion();

  const rows = parseRows();
  const drift = [];
  for (const row of rows) {
    const canonicalCost = canonical[row.key]?.cost;
    if (!canonicalCost || canonicalCost.input == null || canonicalCost.output == null) continue;
    const liveCost = {
      input: canonicalCost.input,
      output: canonicalCost.output,
      ...(canonicalCost.cache_read == null ? {} : { cacheRead: canonicalCost.cache_read }),
    };
    if (!sameRate(row, liveCost)) {
      drift.push({ ...row, liveCost });
      log(`Drift: ${row.key} ${JSON.stringify(row)} -> ${JSON.stringify(liveCost)}`);
    }
  }
  const missingCost = rows.filter((row) => {
    const cost = canonical[row.key]?.cost;
    return cost?.input == null || cost?.output == null;
  }).map((row) => row.key);
  if (missingCost.length) log(`Bundled ids without models.dev pricing (untouched): ${missingCost.join(", ")}`);
  const unlisted = Object.keys(canonical).filter((id) => /^gpt/i.test(id))
    .filter((id) => rows.every((row) => row.key !== id) && canonical[id].status !== "deprecated")
    .slice(0, 12);
  if (unlisted.length) log(`Upstream gpt ids without a bundled pricing row (manual review before adding): ${unlisted.join(", ")}`);
  if (!drift.length) log("No pricing drift; bundled rows already match models.dev.");

  const changedFiles = [];
  if (APPLY && drift.length) {
    const source = readFileSync(PRICING_FILE, "utf8");
    let updated = source;
    for (const { key, input, cacheRead, output, liveCost } of drift) {
      const cache = cacheRead === undefined ? "" : ` cacheRead: ${cacheRead},`;
      updated = updated.replace(
        `"${key}": { input: ${input},${cache} output: ${output} }`,
        `"${key}": { input: ${liveCost.input},${liveCost.cacheRead === undefined ? "" : ` cacheRead: ${liveCost.cacheRead},`} output: ${liveCost.output} }`,
      );
    }
    if (updated !== source) {
      writeFileSync(PRICING_FILE, updated);
      changedFiles.push("src/models/pricing.ts", writeChangeset());
      log(`Applied updates to: ${changedFiles.join(", ")}`);
    }
  }

  if (CREATE_PR) await createPullRequest(changedFiles);
};

function writeChangeset() {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(ROOT, ".changeset", `resync-model-metadata-${date}.md`);
  const body = `---\n"openai-oauth-copilot-chat": patch\n---\n\n${CHANGESET_SUMMARY}\n`;
  if (!existsSync(file) || readFileSync(file, "utf8") !== body) writeFileSync(file, body);
  return path.relative(ROOT, file);
}

async function createPullRequest(changedFiles) {
  if (!changedFiles.length) {
    log("No drift to commit; skipping PR.");
    return;
  }
  const run = (name, args) => {
    const result = spawnSync(name, args, { cwd: ROOT, encoding: "utf8" });
    if (result.status) throw new Error(`${name} ${args.join(" ")} failed:\n${result.stderr}`);
    return result.stdout.trim();
  };
  const date = new Date().toISOString().slice(0, 10);
  const branch = `resync/models-${date}`;
  if (run("git", ["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") {
    throw new Error("--pr must run from a clean checkout of main");
  }
  run("git", ["checkout", "-b", branch]);
  run("git", ["add", "--", ...changedFiles]);
  run("git", ["commit", "-m", "Resync model metadata"]);
  run("git", ["push", "-u", "origin", branch]);
  const bodyPath = path.join(process.env.TMPDIR ?? "/tmp", `${path.basename(ROOT)}-${process.pid}-resync-pr.md`);
  writeFileSync(bodyPath, `${report.join("\n")}\n`);
  const created = spawnSync(
    "gh",
    ["pr", "create", "--head", branch, "--base", "main", "--title", "Resync model metadata from live sources", "--body-file", bodyPath],
    { cwd: ROOT, encoding: "utf8" },
  );
  log(created.stdout.trim() || created.stderr.trim());
  run("git", ["checkout", "main"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

if (reportPath) {
  writeFileSync(reportPath, `${report.join("\n")}\n`);
}
