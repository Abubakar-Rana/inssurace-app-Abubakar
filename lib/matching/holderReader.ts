/**
 * Which CERTIFICATE HOLDER did the requester state? Pattern reader plus model.
 *
 * The same shape as the insured reading in interpret.ts: the deterministic
 * reader (lib/matching/holder.ts) always runs; the model (lib/llm/
 * certificateHolder.ts) runs when LLM_READING enables `holder`, and may only
 * return a holder found word for word in the requester's own text. An outage
 * or a refused answer leaves the pattern reading exactly as it was.
 *
 * Null means nobody was named — the caller ASKS the requester. It never falls
 * back to the sender or the signature.
 */

import { llmMode, llmModel } from "@/lib/llm/config";
import { readHolderWithLlm } from "@/lib/llm/certificateHolder";
import { recordReading } from "@/lib/llm/readingLog";
import { readHolderFromText, type StatedHolder } from "./holder";

export interface HolderReadOptions {
  /** The text answers our holder question, and only that question. */
  answerToQuestion?: boolean;
  /** Names that are NOT the holder — the insured candidates asked about alongside. */
  exclude?: string[];
}

const alnum = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

export async function readHolder(
  text: string | null | undefined,
  options: HolderReadOptions = {}
): Promise<StatedHolder | null> {
  const pattern = readHolderFromText(text, { bareAnswer: options.answerToQuestion });
  let chosen = pattern;

  const mode = llmMode("holder");
  if (mode !== "off") {
    const reading = await readHolderWithLlm(text, { answerToQuestion: options.answerToQuestion });
    if (reading.reached) {
      const summary = pattern.name || "(no holder)";
      if (!reading.verdict.ok) {
        recordReading({ reader: "holder", mode, pattern: summary, model: llmModel(), outcome: "refused", note: reading.verdict.reason });
      } else {
        const model = reading.verdict.holder;
        const agreed = alnum(model.name) === alnum(pattern.name);
        // The model is used where it read a holder the pattern did not, or read
        // a different one. Where it read NOTHING but the pattern found an
        // explicit "certificate holder:" label, the label stands.
        const use = mode === "live" && Boolean(model.name) && !agreed;
        recordReading({
          reader: "holder",
          mode,
          pattern: summary,
          model: llmModel(),
          outcome: agreed ? "agreed" : use ? "used" : "not used",
          note: model.name || "(no holder)",
        });
        if (use) chosen = model;
        else if (agreed && !pattern.addressLines && model.addressLines) chosen = { ...pattern, addressLines: model.addressLines };
      }
    }
  }

  if (!chosen.name) return null;
  // The insured is never its own certificate holder by accident of phrasing.
  if ((options.exclude ?? []).some((name) => alnum(name) === alnum(chosen.name))) return null;
  return chosen;
}
