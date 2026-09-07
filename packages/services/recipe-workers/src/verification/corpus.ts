/**
 * THE BAKE-OFF CORPUS FILE FORMAT — one authoritative description of what a `--corpus` line is.
 *
 * DESIGN PATTERN: **parse, don't validate**, at a boundary the runner previously crossed with a cast. It is
 * the fourth such boundary in this unit, beside the SQS message schema, the raw `Converse` response and the
 * verdict.
 *
 * ## ⛔ WHY A CAST WAS NOT GOOD ENOUGH HERE
 *
 * The runner read the corpus as `JSON.parse(row) as CorpusLine`. That is an assertion, not a check: a file
 * whose key is `sourceline` yields an object whose every field is `undefined`, the prompt builder renders
 * `undefined` into the user turn without complaint, and the run bills roughly 9,700 calls asking two models
 * to judge the string "undefined" against the string "undefined". The failure is silent, it is expensive, and
 * the only symptom is a report full of plausible-looking rates. One `safeParse` per line removes the entire
 * failure mode, and it names the line number because a 2,432-line file is not searchable by eye.
 *
 * ## ⛔ `contrastClass` IS OPTIONAL, AND THAT IS THE POINT
 *
 * A real operator-supplied corpus (U11's original design: a hand-annotated slice of user and imported recipe
 * lines) has no synthetic classes and never will. A SYNTHETIC corpus does, and the residual slice is defined
 * in terms of them. Making the field required would refuse the very corpus this format was written for; making
 * it a free string would let a typo silently empty the residual slice, which is the slice the committed
 * thresholds come from. So it is an optional member of a closed set.
 */
import { z } from 'zod';

/**
 * The four constructed contrasts a synthetic corpus carries.
 *
 * ⚠️ These are CONSTRUCTED classes, not observed ones. Their mix is chosen by the generator, so a rate
 * computed over the whole corpus is a rate over a distribution we invented — which is exactly why the residual
 * slice exists and why the report states both.
 */
export const CORPUS_CONTRAST_CLASSES = [
    /** The candidate is the row the line was phrased from. Correct by construction. */
    'correct',
    /** A different row sharing the head term — the plausible wrong food the gate exists to catch. */
    'nearMissIdentity',
    /** The same substance in a state that changes nutrition: raw against cooked, dried against fresh. */
    'wrongFormIdentity',
    /** The right food, with the amount or the unit corrupted. */
    'quantityUnitError',
] as const;

/** Which constructed contrast a line represents. */
export type CorpusContrastClass = (typeof CORPUS_CONTRAST_CLASSES)[number];

/**
 * One labelled line.
 *
 * ⛔ THIS IS THE ONE DECLARATION. The runner imports it rather than re-declaring the shape, for the reason
 * ADR-0014 gives about wire types: two declarations of the same contract drift, and the drift is silent
 * because both halves stay plausible.
 */
export const corpusLineSchema = z.object({
    /** Stable id. Pairs the two swap variants of the same line in the scorer. */
    lineId: z.string().min(1),
    /** The line as a cook wrote it. UNTRUSTED by the prompt builder, which escapes it. */
    sourceLine: z.string().min(1),
    /** The catalog name of the food the cascade resolved to. */
    candidateFoodName: z.string().min(1),
    /** Our parsed amount, or the low end of a range. */
    quantityLow: z.number().nullable(),
    /** Our parsed high end, or `null` for an exact quantity. */
    quantityHigh: z.number().nullable(),
    /** Our parsed unit, SINGULAR, or `null` for a count. */
    unit: z.string().nullable(),
    /** GROUND TRUTH: was our parse actually right for this line? */
    parseIsCorrect: z.boolean(),
    /** Which constructed contrast this is. Absent on an operator-annotated corpus. */
    contrastClass: z.enum(CORPUS_CONTRAST_CLASSES).optional(),
    /**
     * The catalog row the line was PHRASED from — which is not the candidate except in the `correct` class.
     *
     * Carried so any line can be audited against the catalog by hand without re-running the generator.
     */
    sourceRowName: z.string().min(1).optional(),
});

/** One labelled line from the corpus. */
export type CorpusLine = z.infer<typeof corpusLineSchema>;

/** Raised when a corpus file cannot be read. Matching guard: {@link isCorpusFormatError}. */
export class CorpusFormatError extends Error {
    /** 1-based line number in the JSONL file. */
    public readonly lineNumber: number;

    public constructor(lineNumber: number, detail: string) {
        super(`corpus line ${lineNumber} is not a valid corpus line: ${detail}`);
        this.name = 'CorpusFormatError';
        this.lineNumber = lineNumber;
        Object.setPrototypeOf(this, CorpusFormatError.prototype);
    }
}

/** Type guard for {@link CorpusFormatError}. */
export function isCorpusFormatError(error: unknown): error is CorpusFormatError {
    return error instanceof CorpusFormatError;
}

/**
 * Read a JSONL corpus.
 *
 * @param text - The whole file.
 * @returns Every line, in file order.
 * @throws {CorpusFormatError} On the first line that is not a well-formed corpus line, naming its number.
 */
export function parseCorpusJsonl(text: string): CorpusLine[] {
    const lines: CorpusLine[] = [];

    text.split('\n').forEach((row, index) => {
        if (row.trim() === '') {
            return;
        }

        let document: unknown;

        try {
            document = JSON.parse(row);
        } catch {
            throw new CorpusFormatError(index + 1, 'not a JSON document');
        }

        const parsed = corpusLineSchema.safeParse(document);

        if (!parsed.success) {
            throw new CorpusFormatError(index + 1, parsed.error.issues.map((issue) => issue.message).join('; '));
        }

        lines.push(parsed.data);
    });

    return lines;
}

/**
 * Render a corpus as JSONL.
 *
 * The generator assembles every line with the same key order, so `JSON.stringify` emits byte-identical files
 * across runs — the property the seed is only half of.
 *
 * @param lines - The corpus.
 * @returns The file body, newline-terminated. Pure.
 */
export function renderCorpusJsonl(lines: readonly CorpusLine[]): string {
    return lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
}
