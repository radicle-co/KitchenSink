/**
 * THE PARSE JOB'S TEXT ADMISSION (plan U9, origin D9/R13) — one splitter, one set of bounds, shared by
 * the wire contract's `superRefine` (recipe-service `parseJobs.schema.ts`) and the producer's create path.
 *
 * ⛔ ONE splitter on purpose. R17's stale-landing rule guards every landing on the digest of the line AS
 * STORED, so "what is a line" must have exactly one answer: if the schema split one way and the service
 * another, a request could validate against lines the job never stored — and the digest guard would then
 * discard landings for phrases the cook really submitted. Trimming is the ONLY normalization; interior
 * whitespace is the cook's own text and passes verbatim (HAZ-041's spirit: the phrase is evidence).
 *
 * ⛔ Refusals are REJECTIONS, never truncations — ADR-0024's over-cap rule applied one contract over. A
 * truncated line would parse text the cook did not write; the refusal names the offending index so the
 * error is actionable instead of a mute 400.
 *
 * ⚠️ The line bound and `parseLineJobMessageSchema.sourceLine`'s bound are the SAME constant — the
 * splitter admits exactly what the queue contract accepts, or the producer manufactures poison messages
 * from input it already told the caller was fine. Asserted from both sides in `parseJobText.test.ts`.
 */

/**
 * Most lines one job may carry. A pasted ingredient block is at most a recipe or two — the recipe wire
 * itself caps at 100 ingredients (`MAX_RECIPE_INGREDIENTS`), so 200 admits a generous paste while keeping
 * one job's fan-out (one SQS message and one worker invocation per line) bounded.
 */
export const MAX_PARSE_JOB_LINES = 200;

/**
 * Longest admissible line — MUST equal `parseLineJobMessageSchema.sourceLine`'s max.
 *
 * ⚠️ UTF-16 CODE UNITS, not code points, and the two sides AGREE on that: the splitter measures
 * `line.length` and the wire schema `z.string().max(…)`, both of which count code units. (This said "code
 * points"; `verificationMessage.ts` documents the same zod behaviour and `verificationGatePolicy`'s cap is
 * the one that genuinely counts code points, with `[...value].length`.) An astral character therefore
 * spends two of these — a conservative direction, since the bound exists to keep one job's fan-out and one
 * SQS body bounded.
 */
export const PARSE_JOB_LINE_MAX_CHARS = 1_000;

/**
 * The raw text bound the wire schema applies BEFORE splitting — derived, never a third literal: the
 * largest text that could possibly split into an admissible job (every line at the cap plus its newline).
 */
export const PARSE_JOB_TEXT_MAX_CHARS = MAX_PARSE_JOB_LINES * (PARSE_JOB_LINE_MAX_CHARS + 1);

/** Why a split was refused. `lineIndex` is the offending line (0-based), or the first out-of-bound index. */
export interface ParseJobLineRefusal {
    readonly lineIndex: number;
    readonly reason: 'line_too_long' | 'too_many_lines' | 'no_lines';
}

/**
 * Split a pasted block into the lines a job would store: LF or CRLF boundaries, each line trimmed,
 * blanks dropped. Pure.
 */
export function splitParseJobLines(text: string): readonly string[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');
}

/**
 * Every reason the split is inadmissible, or an empty list when the job may be created. Pure.
 *
 * All refusals are reported (not just the first) so a 400 can name every offending line at once — a cook
 * fixing a paste should not discover problems one round-trip at a time.
 */
export function refuseParseJobLines(lines: readonly string[]): readonly ParseJobLineRefusal[] {
    if (lines.length === 0) {
        return [{ lineIndex: 0, reason: 'no_lines' }];
    }

    const refusals: ParseJobLineRefusal[] = [];

    for (const [index, line] of lines.entries()) {
        if (line.length > PARSE_JOB_LINE_MAX_CHARS) {
            refusals.push({ lineIndex: index, reason: 'line_too_long' });
        }
    }

    if (lines.length > MAX_PARSE_JOB_LINES) {
        refusals.push({ lineIndex: MAX_PARSE_JOB_LINES, reason: 'too_many_lines' });
    }

    return refusals;
}
