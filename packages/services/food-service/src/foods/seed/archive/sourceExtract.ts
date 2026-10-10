/**
 * A cited source's extract (plan KTD-20, U23): one line per candidate entry of one source, with the entry's own key
 * and name, the basis its values are published on, and its values keyed by the INFOODS tag of their definition
 * (R53). A value is the source's own number as a plain decimal; an extractor translates columns into this shape and
 * never converts a value (KTD-24). A tag the table printed as a trace or a below-limit bound is listed apart from the
 * values; a "not known" mark leaves its tag absent.
 *
 * @pattern Parser — `parseSourceExtract` turns the committed bytes into typed lines, or refuses them
 * @pattern Canonical serializer — `renderSourceExtract` is the one authority over the file's bytes
 * @module
 */
import type { Buffer } from 'node:buffer';

import { z } from 'zod';

import { INFOODS, type InfoodsTag } from '../../nutrition/nutrientIdentity.js';
import { SourceExtractFormatError } from './sourceExtract.errors.js';

/** The basis an extract line's values are published on. Per 100 mL converts only with a cited density (R54). */
export type ExtractBasis = 'per100g' | 'per100mL';

/** One cited entry of a source. */
export interface ExtractLine {
    /** The source's own key for the entry: `fdc:<id>` for USDA, the table's code for the others. */
    readonly key: string;
    /** The entry's name in the source. */
    readonly name: string;
    /** The basis its values are published on. */
    readonly basis: ExtractBasis;
    /** Its values, as published, by the INFOODS tag of their definition. */
    readonly values: Readonly<Partial<Record<InfoodsTag, string>>>;
    /**
     * The tags the table printed as a trace or a below-limit bound. A trace is published information, unlike a "not
     * known" mark, and R53's total carbohydrate counts a trace of fibre as 0 (owner, 2026-10-01). None is also a value.
     */
    readonly traces?: readonly InfoodsTag[];
    /** Grams per millilitre, cited from the same source, for a line published per 100 mL. */
    readonly densityGramsPerMl?: string;
}

/**
 * The most places a committed value carries. No cited source prints an energy or macronutrient amount to more places,
 * so a longer one is a spreadsheet float tail, not the publisher's number, and is refused rather than stored as if it
 * were. A converted value is rounded to the same places.
 */
export const EXTRACT_DECIMAL_PLACES = 3;

/** A plain non-negative decimal of at most `EXTRACT_DECIMAL_PLACES` places, the only form a committed value takes. */
const DECIMAL = new RegExp(`^\\d+(\\.\\d{1,${String(EXTRACT_DECIMAL_PLACES)}})?$`, 'u');

const TAGS: readonly InfoodsTag[] = Object.values(INFOODS);

const decimalSchema = z.string().regex(DECIMAL, 'is not a plain decimal of at most three places');

/**
 * Order tags by code unit, the one order the file uses for both its values and its traces. Pure.
 *
 * @param left - A tag.
 * @param right - Another tag.
 * @returns A negative number when `left` sorts first, else a positive one.
 */
function byTag(left: string, right: string): number {
    return left < right ? -1 : 1;
}

/**
 * Whether a list is in strictly ascending tag order, so also free of repeats. Pure.
 *
 * @param tags - The list.
 * @returns True when each tag sorts after the one before it.
 */
function isStrictlyOrdered(tags: readonly string[]): boolean {
    return tags.every((tag, index) => index === 0 || byTag(tags[index - 1] ?? '', tag) < 0);
}

/**
 * Whether a text is a value an extract can hold. Pure.
 *
 * @param text - A candidate value.
 * @returns True for a plain non-negative decimal of at most three places.
 */
export function isExtractDecimal(text: string): boolean {
    return DECIMAL.test(text);
}

const lineSchema = z
    .strictObject({
        key: z.string().min(1),
        name: z.string().min(1),
        basis: z.enum(['per100g', 'per100mL']),
        values: z.partialRecord(z.enum(TAGS), decimalSchema),
        traces: z
            .array(z.enum(TAGS, { error: 'a trace is not an INFOODS tag' }))
            .min(1, 'an empty traces list is left out, not written')
            .refine(isStrictlyOrdered, 'the traces are not in strict tag order')
            .optional(),
        densityGramsPerMl: decimalSchema.optional(),
    })
    .refine((line) => (line.basis === 'per100mL') === (line.densityGramsPerMl !== undefined), {
        message: 'a per-100 mL line needs a density, and only such a line carries one',
    })
    .superRefine((line, context) => {
        for (const tag of line.traces ?? []) {
            if (line.values[tag] !== undefined) {
                context.addIssue({ code: 'custom', message: `${tag} is both a value and a trace` });
            }
        }
    });

/**
 * Render one line in its canonical form: fixed field order, values and traces sorted by tag, and no traces field when
 * there are none. Pure.
 *
 * @param line - The line.
 * @returns Its JSON text, without a newline.
 */
function renderLine(line: ExtractLine): string {
    const values = Object.fromEntries(
        Object.entries(line.values)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .sort(([left], [right]) => byTag(left, right)),
    );
    const traces = [...(line.traces ?? [])].sort(byTag);

    return JSON.stringify({
        key: line.key,
        name: line.name,
        basis: line.basis,
        values,
        ...(traces.length === 0 ? {} : { traces }),
        ...(line.densityGramsPerMl === undefined ? {} : { densityGramsPerMl: line.densityGramsPerMl }),
    });
}

/**
 * Render an extract: one line per entry, sorted by key, each ending in a newline. Pure.
 *
 * @param lines - The entries, in any order.
 * @returns The file's text.
 */
export function renderSourceExtract(lines: readonly ExtractLine[]): string {
    return [...lines]
        .sort((left, right) => (left.key < right.key ? -1 : 1))
        .map((line) => `${renderLine(line)}\n`)
        .join('');
}

/**
 * Parse a committed extract. The bytes must be exactly the canonical rendering of what they hold, so two writers can
 * never disagree about a file's contents. Pure.
 *
 * @param bytes - The committed file.
 * @returns The lines, keyed by the source's key.
 * @throws {SourceExtractFormatError} naming the first line that is not the format.
 */
export function parseSourceExtract(bytes: Buffer): ReadonlyMap<string, ExtractLine> {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);

    if (text !== '' && !text.endsWith('\n')) {
        throw new SourceExtractFormatError('end of file', 'does not end in a newline');
    }

    const lines = new Map<string, ExtractLine>();
    let previous = '';

    for (const [index, raw] of text.split('\n').slice(0, -1).entries()) {
        const where = `line ${String(index + 1)}`;
        let value: unknown;

        try {
            value = JSON.parse(raw);
        } catch {
            throw new SourceExtractFormatError(where, 'is not JSON');
        }

        const parsed = lineSchema.safeParse(value);

        if (!parsed.success) {
            throw new SourceExtractFormatError(where, parsed.error.issues.map((issue) => issue.message).join('; '));
        }

        const line: ExtractLine = parsed.data;

        if (renderLine(line) !== raw) {
            throw new SourceExtractFormatError(where, 'is not the canonical rendering of its contents');
        }

        if (lines.size > 0 && line.key <= previous) {
            throw new SourceExtractFormatError(where, `'${line.key}' is not after '${previous}' in key order`);
        }

        previous = line.key;
        lines.set(line.key, line);
    }

    return lines;
}
