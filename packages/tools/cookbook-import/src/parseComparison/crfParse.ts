/**
 * THE CRF PARSER'S WIRE SHAPE — what `scripts/crfParse.py` prints, parsed at the boundary.
 *
 * DESIGN PATTERN: **parse, don't validate**, at an UNTRUSTED third-party boundary. `ingredient-parser-nlp`
 * is a tool we do not own and do not serve, so ADR-0014's inverse case applies: this package validates the
 * raw upstream shape with its own zod and declares its own type. There is no `packages/schemas/*` copy and
 * no OpenAPI document, and there must not be — we do not own that contract and cannot promise it.
 *
 * ## ⚠️ THE SIDECAR FLATTENS, AND THE FLATTENING IS PART OF THE MEASUREMENT
 *
 * `parse_ingredient` returns richer objects than this: `amount` is a list of `IngredientAmount` carrying a
 * `Fraction` quantity, a `pint` unit and a confidence; `name` is a list of `IngredientText`. The sidecar
 * prints the parser's OWN `text` for each, unaltered, because the comparison is between two readings of
 * the same line and re-deriving text from the structured fields would put our rendering in the middle of
 * it. `size`, `preparation` and `comment` are fields our answer shape has no slot for — they are carried
 * so a disagreement traceable to one of them can be NAMED rather than counted as a plain difference.
 *
 * ⛔ `strictObject`: a field appearing that is not listed here means the sidecar or the library moved, and
 * that must be loud. A silently ignored new field is how a measurement quietly stops measuring what its
 * report says it does.
 */
import { z } from 'zod';

export const crfParseSchema = z.strictObject({
    /** The line as it was submitted, echoed back so a row can be paired with its corpus line. */
    sentence: z.string(),
    /** The parser's own amount text, joined when it read several. Empty when it read none. */
    measure: z.string(),
    /** The parser's own name texts, in the order it produced them. */
    names: z.array(z.string()),
    /** The parser's `size` field — a descriptor our answer shape has nowhere to put. */
    size: z.string().nullable(),
    preparation: z.string().nullable(),
    /** The parser's `comment` field — trailing matter it declined to call a name or a preparation. */
    comment: z.string().nullable(),
});

export type CrfParse = z.infer<typeof crfParseSchema>;

/**
 * Read one JSONL row from the sidecar.
 *
 * ⛔ Throws rather than returning a refusal. Unlike a model response — which is EXPECTED to be malformed
 * sometimes and is therefore censused — a malformed row here means our own sidecar broke, and continuing
 * would silently drop lines from the denominator of every agreement rate in the report.
 *
 * @param row - One line of the sidecar's stdout.
 * @returns The parsed row. Pure.
 * @throws When the row is not JSON, or is JSON the sidecar would not have printed.
 */
export function readCrfParseLine(row: string): CrfParse {
    let value: unknown;

    try {
        value = JSON.parse(row) as unknown;
    } catch {
        throw new Error(`crfParse: row is not JSON: ${row.slice(0, 200)}`);
    }

    const parsed = crfParseSchema.safeParse(value);

    if (!parsed.success) {
        throw new Error(
            `crfParse: row is not the sidecar's shape (${parsed.error.issues
                .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
                .join('; ')}): ${row.slice(0, 200)}`,
        );
    }

    return parsed.data;
}
