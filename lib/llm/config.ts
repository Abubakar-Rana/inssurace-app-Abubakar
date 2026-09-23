/**
 * Whether an LLM is allowed to read, and for which reader.
 *
 * ---------------------------------------------------------------------------
 * TWO GATES, BOTH REQUIRED
 *
 * A missing ANTHROPIC_API_KEY turns the LLM path off no matter what else is
 * set, and LLM_READING must name the reader by hand. The point is that a
 * half-configured deploy quietly keeps the heuristic rather than quietly
 * breaking — the same trade the OIDC config makes, where missing configuration
 * locks everyone out rather than letting anyone in.
 *
 * Everything unset means heuristic only, which is what every existing test
 * suite runs on.
 *
 * ---------------------------------------------------------------------------
 * LLM_READING IS A LIST, NOT A BOOLEAN
 *
 * Each reader — clarify, extract, classify, holder, vin — is a separate pure
 * function with its own test suite, so each is separately switchable. Enable
 * the one that has been graded and leave the rest on the heuristic. An
 * unrecognised name simply enables nothing, and `all` enables everything.
 *
 *   LLM_READING=clarify
 *   LLM_READING=clarify,extract
 *   LLM_READING=all
 *
 * ---------------------------------------------------------------------------
 * SHADOW MODE IS THE FIRST STEP, NOT AN AFTERTHOUGHT
 *
 * LLM_SHADOW=1 calls the model on every reply, compares its answer with the
 * heuristic, prints every disagreement, and then ACTS ON THE HEURISTIC ANYWAY.
 * Nothing about the system's behaviour changes; after a week there is evidence
 * instead of an opinion.
 *
 * Shadow is scoped by LLM_READING too, so the rollout is:
 *
 *   LLM_READING=clarify LLM_SHADOW=1     ->  read the disagreements
 *   LLM_READING=clarify                  ->  let it answer
 * ---------------------------------------------------------------------------
 */

/** The judgements an LLM may be given. Each has its own test suite. */
export type Reader = "clarify" | "extract" | "classify" | "holder" | "vin";

/** Fastest and cheapest model that supports structured outputs. */
const DEFAULT_MODEL = "claude-haiku-4-5";

export function llmModel(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

/** How long a single read may take before the heuristic answers instead. */
export function llmTimeoutMs(): number {
  const raw = Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
}

/** Gate one: is there a key at all. */
export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function enabledReaders(): Set<string> {
  return new Set(
    (process.env.LLM_READING ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * What the LLM is allowed to do for this reader.
 *
 *   off      do not call the model
 *   shadow   call it, log the comparison, act on the heuristic
 *   live     call it, and let it answer where the heuristic could not
 */
export type LlmMode = "off" | "shadow" | "live";

export function llmMode(reader: Reader): LlmMode {
  if (!llmConfigured()) return "off";

  const readers = enabledReaders();
  if (!readers.has("all") && !readers.has(reader)) return "off";

  return process.env.LLM_SHADOW === "1" ? "shadow" : "live";
}
