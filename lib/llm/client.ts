/**
 * The one place this system talks to a language model.
 *
 * ---------------------------------------------------------------------------
 * ONE SHAPE, ONE CALL SITE
 *
 * Everything above this file describes what it wants as a JSON schema and gets
 * back either a parsed object or null. There is no streaming, no tool use, no
 * conversation and no state — a reader hands over some text and gets a small
 * structured answer. Keeping it to that shape is what makes swapping the
 * provider, or running a local model for a customer who will not have their
 * mail leave the building, a change to this file rather than a search.
 *
 * ---------------------------------------------------------------------------
 * IT NEVER THROWS
 *
 * A timeout, a rate limit, a refusal, a malformed response and a missing API
 * key all return null, and null means "use the heuristic". This is the same
 * trade the system already makes for drafting failures: losing a whole run of
 * incoming mail because an API was slow is the worse outcome by a distance.
 * ---------------------------------------------------------------------------
 */

import Anthropic from "@anthropic-ai/sdk";
import { llmConfigured, llmModel, llmTimeoutMs } from "./config";

export interface ReadRequest {
  /** Fixed instructions. Same for every call of a given reader. */
  system: string;
  /** The variable part — the email text being read. */
  user: string;
  /** JSON Schema the answer must satisfy. `additionalProperties: false` is required. */
  schema: Record<string, unknown>;
  /** These answers are a handful of fields; the default is generous. */
  maxTokens?: number;
  /** For the log line, so a disagreement can be traced to a reader. */
  label: string;
}

export interface ReadResult {
  /** Parsed against the schema by the API, then by us. */
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      timeout: llmTimeoutMs(),
      // One retry, not the SDK's default of two. A reader that has already
      // waited out one timeout has a heuristic answer sitting ready.
      maxRetries: 1,
    });
  }
  return client;
}

/** Exposed for tests, which change the environment between cases. */
export function resetClient(): void {
  client = null;
}

/**
 * Ask for one structured answer. Returns null on any failure.
 *
 * NOTE ON PROMPT CACHING: not used, deliberately. Haiku 4.5 will not cache a
 * prefix below 2048 tokens and these system prompts are a few hundred, so a
 * cache_control breakpoint here would be decoration. Revisit if a reader's
 * instructions ever grow past that.
 */
export async function readJson(req: ReadRequest): Promise<ReadResult | null> {
  if (!llmConfigured()) return null;

  const started = Date.now();

  try {
    const response = await getClient().messages.create({
      model: llmModel(),
      max_tokens: req.maxTokens ?? 512,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      // Structured outputs: the answer parses or the request fails loudly.
      // Never scrape prose for a number.
      output_config: { format: { type: "json_schema", schema: req.schema } },
    });

    // A refusal is not an error, but it is not an answer either.
    if (response.stop_reason === "refusal") {
      console.warn(`[llm] ${req.label}: model refused`);
      return null;
    }
    if (response.stop_reason === "max_tokens") {
      console.warn(`[llm] ${req.label}: truncated at max_tokens`);
      return null;
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    if (!text.trim()) {
      console.warn(`[llm] ${req.label}: empty response`);
      return null;
    }

    return {
      output: JSON.parse(text),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      ms: Date.now() - started,
    };
  } catch (err) {
    // Everything lands here: network, 429, 500, a schema the API rejected, a
    // body that would not parse. All of them mean the same thing to the caller.
    console.warn(`[llm] ${req.label}: ${(err as Error).message}`);
    return null;
  }
}
