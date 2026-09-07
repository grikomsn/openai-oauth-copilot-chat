/** Token estimation and oldest-turn trimming for opted-in context caps. */

/** A converted Responses API input item. */
export type TrimItem = Record<string, unknown>;

/** Result of trimming a converted input list against a context cap. */
export interface HistoryTrimResult {
  readonly items: readonly TrimItem[];
  readonly removedItems: number;
  readonly estimatedTokens: number;
}

/** Fixed estimate for an image part, whose base64 payload is not token-shaped. */
const IMAGE_TOKEN_ESTIMATE = 1024;
/** Modest estimate for encrypted reasoning payloads, whose content is opaque. */
const REASONING_TOKEN_ESTIMATE = 128;
/** Matches the extension's `provideTokenCount` chars-per-token heuristic. */
const CHARS_PER_TOKEN = 4;

interface ItemUnit {
  readonly start: number;
  readonly end: number;
  readonly tokens: number;
}

/**
 * Estimates the token weight of one converted input item. Text uses the same
 * chars-per-token heuristic as `provideTokenCount`; images and encrypted
 * reasoning payloads use fixed estimates.
 */
export function estimateInputItemTokens(item: TrimItem): number {
  const type = typeof item.type === "string" ? item.type : "";
  if (type === "reasoning") return REASONING_TOKEN_ESTIMATE;
  if (type === "function_call") {
    return Math.max(1, textTokens(`${stringOf(item.name)}${stringOf(item.arguments)}`));
  }
  if (type === "function_call_output") {
    return Math.max(1, textTokens(stringOf(item.output)));
  }
  if (type === "message") {
    const content = item.content;
    if (typeof content === "string") return Math.max(1, textTokens(content));
    if (Array.isArray(content)) {
      return Math.max(1, content.reduce((sum, part) => sum + contentPartTokens(part), 0));
    }
    return 1;
  }
  return Math.max(1, textTokens(safeJson(item)));
}

/**
 * Drops the oldest conversation turns from a converted input list so the
 * estimated payload fits an opted-in context cap. Units are bounded by user
 * messages with no outstanding tool calls, so function-call and reasoning
 * adjacency is never split, and the anchor plus the current turn always
 * survive. Uncapped or already-fitting input is returned unchanged.
 *
 * @example
 * ```ts
 * const result = trimHistoryToFitContext(input, contextCapTokens);
 * console.log(result.removedItems, result.estimatedTokens);
 * ```
 */
export function trimHistoryToFitContext(items: readonly TrimItem[], budgetTokens: number): HistoryTrimResult {
  const units = buildItemUnits(items);
  const total = units.reduce((sum, unit) => sum + unit.tokens, 0);
  if (budgetTokens <= 0 || units.length < 3 || total <= budgetTokens) {
    return { items, removedItems: 0, estimatedTokens: total };
  }
  // Drop the smallest prefix of middle units that fits, keeping the newest history.
  let droppedTokens = 0;
  let dropUpToUnit = 1;
  for (let unit = 1; unit <= units.length - 2; unit++) {
    droppedTokens += units[unit].tokens;
    dropUpToUnit = unit;
    if (total - droppedTokens <= budgetTokens) break;
  }
  const dropStart = units[1].start;
  const dropEnd = units[dropUpToUnit].end;
  return {
    items: [...items.slice(0, dropStart), ...items.slice(dropEnd + 1)],
    removedItems: dropEnd - dropStart + 1,
    estimatedTokens: total - droppedTokens,
  };
}

/** Groups items into turn units bounded by user messages with settled tool calls. */
function buildItemUnits(items: readonly TrimItem[]): ItemUnit[] {
  const itemTokens = items.map((item) => estimateInputItemTokens(item));
  const units: ItemUnit[] = [];
  let start = 0;
  const pendingCalls = new Set<string>();
  for (let index = 0; index <= items.length; index++) {
    const atEnd = index === items.length;
    // A boundary before a user message is only safe when every earlier tool
    // call already has its result, keeping call/output pairs in one unit.
    const boundary = !atEnd && index > start && pendingCalls.size === 0 && isUserMessage(items[index]);
    if (atEnd || boundary) {
      units.push({
        start,
        end: index - 1,
        tokens: itemTokens.slice(start, index).reduce((sum, tokens) => sum + tokens, 0),
      });
      start = index;
    }
    if (!atEnd) {
      const callId = items[index].call_id;
      if (typeof callId !== "string") continue;
      if (items[index].type === "function_call") pendingCalls.add(callId);
      if (items[index].type === "function_call_output") pendingCalls.delete(callId);
    }
  }
  return units;
}

function isUserMessage(item: TrimItem): boolean {
  return item.type === "message" && item.role === "user";
}

function contentPartTokens(part: unknown): number {
  if (typeof part !== "object" || part === null) return textTokens(String(part ?? ""));
  const record = part as Record<string, unknown>;
  if (record.type === "input_image" || record.type === "image_url") return IMAGE_TOKEN_ESTIMATE;
  if (typeof record.text === "string") return textTokens(record.text);
  return textTokens(safeJson(record));
}

function textTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
