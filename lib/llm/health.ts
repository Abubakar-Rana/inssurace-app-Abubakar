/**
 * Is AI reading actually working right now?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * readJson() never throws: an invalid key, an exhausted balance or a retired
 * model all return null, and null means "use the heuristic". That is the right
 * trade for ingesting mail — and it is also why an expired API key once went
 * unnoticed for two weeks. The system kept working, quietly worse, and nothing
 * on screen said so.
 *
 * So the answer is checked, not assumed: a real one-token call (it catches a bad
 * key, a missing model AND an empty balance, which a free metadata call does
 * not), cached so the dashboard asking every couple of minutes costs next to
 * nothing. Readers also report every outcome here, so a failure seen while
 * reading real mail shows up at once without waiting for the next probe.
 * ---------------------------------------------------------------------------
 */

import Anthropic from "@anthropic-ai/sdk";
import { enabledReaderList, llmConfigured, llmModel } from "./config";

export type LlmHealthState = "ok" | "down" | "off";

export interface LlmHealth {
  state: LlmHealthState;
  /** Plain-language reason, safe to show to any signed-in user. Null when ok. */
  reason: string | null;
  model: string;
  readers: string[];
  checkedAt: string;
}

/** Healthy answers are trusted for a while; a failure is re-checked soon. */
const OK_TTL_MS = 5 * 60_000;
const DOWN_TTL_MS = 60_000;

let cached: { at: number; health: LlmHealth } | null = null;
let probing: Promise<LlmHealth> | null = null;

function result(state: LlmHealthState, reason: string | null): LlmHealth {
  return { state, reason, model: llmModel(), readers: enabledReaderList(), checkedAt: new Date().toISOString() };
}

/** Turn an SDK error into something an agency admin can act on. */
export function describeLlmError(err: unknown): string {
  const e = err as { status?: number; message?: string; error?: { error?: { message?: string } } };
  const detail = e?.error?.error?.message ?? e?.message ?? String(err);
  switch (e?.status) {
    case 401:
      return "The Anthropic API key is invalid or has expired. Replace ANTHROPIC_API_KEY.";
    case 403:
      return "The Anthropic API key is not permitted to use this model.";
    case 404:
      return `The model "${llmModel()}" is not available to this API key. Set LLM_MODEL to a current model.`;
    case 429:
      return "The Anthropic API is rate-limiting requests.";
    case 400:
      return /credit|balance|billing/i.test(detail)
        ? "The Anthropic account has run out of credit."
        : `The Anthropic API rejected the request: ${detail}`;
    default:
      if (typeof e?.status === "number" && e.status >= 500) return "The Anthropic API is having problems right now.";
      return `Could not reach the Anthropic API: ${detail}`;
  }
}

/**
 * Called by readJson() with every API outcome. Content outcomes (a refusal, an
 * unparseable answer) are not outages and are not reported.
 */
export function noteLlmOutcome(ok: boolean, err?: unknown): void {
  if (!enabledReaderList().length) return;
  cached = { at: Date.now(), health: ok ? result("ok", null) : result("down", describeLlmError(err)) };
}

async function probe(): Promise<LlmHealth> {
  try {
    await new Anthropic({ timeout: 10_000, maxRetries: 0 }).messages.create({
      model: llmModel(),
      max_tokens: 1,
      messages: [{ role: "user", content: "ok" }],
    });
    return result("ok", null);
  } catch (err) {
    return result("down", describeLlmError(err));
  }
}

/** The current state, probing only when the cached answer is stale (or `force`). */
export async function llmHealth(force = false): Promise<LlmHealth> {
  const readers = enabledReaderList();
  // Not switched on is a choice, not a fault.
  if (!readers.length) return result("off", "AI reading is not enabled (LLM_READING is empty).");
  // Switched on but no key: llmMode() quietly returns "off" for every reader,
  // which is exactly the silent failure this module exists to surface.
  if (!llmConfigured()) {
    return result("down", `AI reading is enabled (LLM_READING=${readers.join(",")}) but ANTHROPIC_API_KEY is not set.`);
  }

  if (!force && cached) {
    const ttl = cached.health.state === "ok" ? OK_TTL_MS : DOWN_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.health;
  }

  probing ??= probe().finally(() => {
    probing = null;
  });
  const health = await probing;
  cached = { at: Date.now(), health };
  return health;
}
