/**
 * Recording what each LLM reader read, so a person can review it.
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * Shadow mode and live mode both used to print their readings to the console
 * of whichever process happened to run them, and nowhere else. Deciding whether
 * a reader should stay on needs a week of evidence, not a scrolled-away
 * terminal. Every reading that reaches the model now leaves a row in
 * `llm_readings`, shown on the dashboard's "AI readings" page.
 *
 * ---------------------------------------------------------------------------
 * HOW A READER KNOWS WHICH TENANT AND REQUEST IT IS READING FOR
 *
 * The readers are deliberately text in, answer out: `readHolder(text)` has no
 * idea which request the text came from, and threading ids through every
 * signature would make that contract worse to protect a log line. So the
 * callers that DO know — the ingest loop, `interpretRequest`, `applyAnswer`,
 * `generateDraft` — wrap their reads in `withReadingContext`, and
 * `recordReading` picks the ids up from there (AsyncLocalStorage).
 *
 * No context, no row: the pure test suites read without one and write nothing.
 *
 * ---------------------------------------------------------------------------
 * NEVER IN THE WAY
 *
 * The write is fired, not awaited, and a failure is a console warning. Losing a
 * log row is always better than slowing or failing the ingest of a real
 * request. It runs in its own short transaction, never inside a caller's.
 * ---------------------------------------------------------------------------
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { withTenant } from "@/lib/db/client";
import { llmReadings } from "@/db/schema";
import type { LlmMode, Reader } from "./config";

export interface ReadingContext {
  tenantId?: string;
  requestId?: string;
  messageId?: string;
}

const context = new AsyncLocalStorage<ReadingContext>();

/** Run `fn` with these ids attached to any reading it records. Nested contexts merge. */
export function withReadingContext<T>(ctx: ReadingContext, fn: () => Promise<T>): Promise<T> {
  return context.run({ ...context.getStore(), ...ctx }, fn);
}

/**
 *   used       the model's answer is what the system acted on
 *   agreed     the model read the same as the patterns
 *   not used   it read something else, but it was not acted on (shadow mode,
 *              or an answer that resolved to nothing / disagreed with the pattern)
 *   refused    its answer failed a safety guard and was thrown away
 */
export type ReadingOutcome = "used" | "agreed" | "not used" | "refused";

export interface ReadingEntry {
  reader: Reader;
  mode: LlmMode;
  pattern: string;
  model: string;
  outcome: ReadingOutcome;
  note?: string;
}

/** The same clock as the email body the reading was taken from. */
const RETENTION_DAYS = 30;

const pending = new Set<Promise<void>>();

const clip = (value: string, max = 300) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** Record one reading. Fire-and-forget; never throws. */
export function recordReading(entry: ReadingEntry): void {
  const ctx = context.getStore();
  if (!ctx?.tenantId || entry.mode === "off") return;
  const tenantId = ctx.tenantId;

  const write: Promise<void> = withTenant(tenantId, async (tx) => {
    await tx.insert(llmReadings).values({
      tenantId,
      reader: entry.reader,
      mode: entry.mode,
      requestId: ctx.requestId ?? null,
      messageId: ctx.messageId ?? null,
      pattern: clip(entry.pattern),
      model: clip(entry.model),
      outcome: entry.outcome,
      note: entry.note ? clip(entry.note, 200) : null,
      purgeAfter: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
    });
  })
    .catch((err) => console.warn(`[llm] could not record a ${entry.reader} reading: ${(err as Error).message}`))
    .finally(() => pending.delete(write));
  pending.add(write);
}

/** Writes still in flight. For tests, and for a script that must not exit mid-write. */
export function pendingReadings(): number {
  return pending.size;
}

export async function flushReadings(): Promise<void> {
  await Promise.all([...pending]);
}
