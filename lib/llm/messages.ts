/**
 * Reducing a request body to the requester OWN words, message by message.
 *
 * Lifted out of the holder reader so the VIN reader can share it: both must be
 * shown exactly the text their guards check an answer against, and neither may
 * see our own quoted mail. Re-merge with lib/llm/certificateHolder.ts when that
 * readers newer dependencies land.
 */

/**
 * How lib/gmail/ingest.ts joins a follow-up onto the request it amends. One
 * definition, imported by both, so the readers split the body exactly where
 * ingestion joined it.
 */
export const FOLLOW_UP_SEPARATOR = "\n\n---\n\n";

const WROTE = /\bon\s[^\n]{1,200}?\bwrote:/i;
const ORIGINAL = /-{3,}\s*original\s+message|_{5,}/i;
const FROM_HEADER = /^[ \t]*from:\s/im;

/**
 * The part of one message that is the requester's own words.
 *
 * Exported because the model is shown exactly this text, and the guards check
 * its answer against exactly this text. What it never sees it cannot copy.
 */
export function ownWords(message: string): string {
  let cut = message.length;

  const wrote = message.search(WROTE);
  if (wrote >= 0) cut = Math.min(cut, wrote);

  const original = message.search(ORIGINAL);
  if (original >= 0) cut = Math.min(cut, original);

  // A "From:" block at the very top is a client that quotes ABOVE the reply;
  // cutting there would remove the reply itself. The same rule as holder.ts.
  const from = message.search(FROM_HEADER);
  if (from > 0) cut = Math.min(cut, from);

  return message
    .slice(0, cut)
    .split(/\r?\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .trim();
}

/** Every message in a request body, oldest first, reduced to the requester's own words. */
export function messagesOf(text: string | null | undefined): string[] {
  return (text ?? "").split(FOLLOW_UP_SEPARATOR).map(ownWords);
}

