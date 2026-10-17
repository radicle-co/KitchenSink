/**
 * THE SYNTHETIC BAKE-OFF CORPUS (plan U11 / KTD-4; owner ruling, 2026-08-23).
 *
 * DESIGN PATTERN: **pure Builder over a seeded generator**, the sibling of `bakeOff.ts`. Deterministic in the
 * strong sense — the same seed and the same catalog produce a byte-identical file — so a result can be
 * reproduced, audited and re-scored without re-spending the run that produced it.
 *
 * ## ⛔⛔ READ THIS BEFORE QUOTING ANY NUMBER MEASURED ON THIS CORPUS
 *
 * U11 assumed a hand-annotated slice of 2,432 lines from public-domain cookbooks. **ADR-0023 forbids anything
 * in this repository from fetching that material** — Project Gutenberg's terms bar automated access whatever
 * its `robots.txt` allows — and no operator has supplied the file out of band. The owner ruled that a corpus
 * we can GENERATE is substituted, and that results measured on it are labelled **NOT COMPARABLE** to U1's
 * annotation protocol.
 *
 * That substitution is admissible for exactly one reason: **ground truth is known BY CONSTRUCTION.** We build
 * the (line, candidate) pair, so whether the pair matches is a fact about how it was built rather than a
 * judgement an annotator made — which is what U1's own measurement could not claim, since one annotator is
 * not a measurement.
 *
 * ⚠️ What it therefore does NOT measure: field accuracy. The mix of contrasts here is CHOSEN, not observed, so
 * a rate over the whole corpus is a rate over a distribution we invented. What it DOES measure is
 * discrimination — whether a model can tell a correct candidate from a plausibly wrong one — which is the
 * decision the gate actually makes.
 *
 * ## The four constructed contrasts
 *
 *  1. `correct` — the candidate is the row the phrasing came from.
 *  2. `nearMissIdentity` — a sibling row sharing the head term (`Flour, rice` against a wheat-flour line).
 *     **This is the class that matters**, and it is the one the residual slice is built from.
 *  3. `wrongFormIdentity` — the same substance in a state that changes nutrition (raw against cooked, dried
 *     against fresh, with salt against without).
 *  4. `quantityUnitError` — the right food, with the amount or the unit corrupted.
 *
 * Classes 1 and 2 are emitted as PAIRS from the same source row and the same phrasing, so the only thing that
 * varies between them is the candidate. That is what makes the residual slice a clean isolation of identity
 * discrimination rather than a mixture of that and phrasing difficulty.
 *
 * ## ⛔ THE SCARCEST CLASS IS ALLOCATED FIRST
 *
 * All four classes draw from the same invertible pool, and on the seeded 8,094-row catalog the wrong-form
 * pool is 311 rows against 2,153 invertible. Allocating the plentiful classes first would consume the handful
 * of rows that also have a form counterpart, and the wrong-form class would collapse for a reason that has
 * nothing to do with the catalog. A class that cannot be filled records a SHORTFALL rather than being padded:
 * re-using a pair with a different quantity would inflate the denominator without adding information.
 */
import { createHash } from 'node:crypto';

// ⛔ SUBPATH IMPORTS, because pure-rand 8 REMOVED its root export entirely — `from 'pure-rand'` no longer
// resolves at all. `unsafeUniformIntDistribution` went with it; `uniformInt` is the replacement, with the
// same semantics (returns a number, advances the generator in place) and the generator argument moved FIRST.
import { uniformInt } from 'pure-rand/distribution/uniformInt';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator';

import { cookNounPhrase, isInvertibleUsdaName, usdaSegments } from './cookPhrasing.js';
import { CORPUS_CONTRAST_CLASSES, type CorpusContrastClass, type CorpusLine } from './corpus.js';

/** Bumped when a change alters what the same seed produces. Recorded in the manifest. */
export const CORPUS_GENERATOR_VERSION = '1.1.0';

/** The classes that make up the residual slice — the distribution the gate actually sees. */
export const RESIDUAL_SLICE_CLASSES: readonly CorpusContrastClass[] = ['correct', 'nearMissIdentity'];

/** One row of the food catalog, as the generator needs it. */
export interface CatalogRow {
    readonly id: string;
    readonly name: string;
}

/** What to generate. */
export interface CorpusSynthesisRequest {
    /** Every catalog row. Order is irrelevant — the generator sorts by id before doing anything. */
    readonly rows: readonly CatalogRow[];
    /** The seed. The same seed and the same catalog produce a byte-identical corpus. */
    readonly seed: number;
    /** How many lines to aim for, split evenly across the four classes. */
    readonly targetSize: number;
}

/** The provenance record. Written beside the corpus so nobody can mistake the file for the real thing. */
export interface CorpusManifest {
    readonly generator: 'generateBakeOffCorpus';
    readonly generatorVersion: string;
    /** ⛔ Always true. The field exists so a reader of the JSON cannot miss it. */
    readonly synthetic: true;
    readonly groundTruth: 'by-construction';
    /** In words, for the reader who opens the manifest and nothing else. */
    readonly notComparableTo: string;
    readonly seed: number;
    readonly targetSize: number;
    readonly catalogRowCount: number;
    /** How many rows could be phrased at all. The generator's real working set. */
    readonly invertibleRowCount: number;
    /** SHA-256 over the ordered `id\tname` rows. Ties a corpus to the catalog that produced it. */
    readonly catalogDigest: string;
    readonly classBalance: Readonly<Record<CorpusContrastClass, number>>;
    /** Lines a class could not supply. Non-zero is a fact to report, not a failure to hide. */
    readonly classShortfalls: Readonly<Record<CorpusContrastClass, number>>;
    /** The order classes claimed rows in. Scarcest first — see the file docstring. */
    readonly allocationOrder: readonly CorpusContrastClass[];
    readonly residualSliceClasses: readonly CorpusContrastClass[];
}

/** Both halves of a generated corpus. */
export interface CorpusSynthesisResult {
    readonly lines: readonly CorpusLine[];
    readonly manifest: CorpusManifest;
}

/** Raised when a catalog cannot produce a corpus at all. Matching guard: {@link isEmptyCatalogError}. */
export class EmptyCatalogError extends Error {
    public constructor(detail: string) {
        super(`cannot synthesize a bake-off corpus: ${detail}`);
        this.name = 'EmptyCatalogError';
        Object.setPrototypeOf(this, EmptyCatalogError.prototype);
    }
}

/** Type guard for {@link EmptyCatalogError}. */
export function isEmptyCatalogError(error: unknown): error is EmptyCatalogError {
    return error instanceof EmptyCatalogError;
}

/**
 * Segments whose presence or absence changes what the food IS nutritionally.
 *
 * ⚠️ Not a list of "cooking words" — `chopped` and `sliced` are absent on purpose, because chopping a carrot
 * does not change its nutrition per 100 g and a candidate differing only in knife work is not a wrong-form
 * contrast. Every member here moves water, fat or sodium.
 */
const FORM_SEGMENTS: ReadonlySet<string> = new Set([
    'baked',
    'boiled',
    'braised',
    'broiled',
    'canned',
    'cooked',
    'dehydrated',
    'dried',
    'fresh',
    'fried',
    'frozen',
    'grilled',
    'microwaved',
    'prepared',
    'raw',
    'roasted',
    'salted',
    'steamed',
    'stewed',
    'sweetened',
    'toasted',
    'uncooked',
    'unprepared',
    'unsalted',
    'unsweetened',
    'with salt',
    'with sugar',
    'without salt',
    'without sugar',
]);

/** A unit a cook writes, with the amounts that plausibly go with it. */
interface UnitChoice {
    /** The SINGULAR unit, which is what a parser emits. `null` for a bare count ("2 apples"). */
    readonly unit: string | null;
    readonly plural: string | null;
    readonly amounts: readonly number[];
}

/**
 * The quantities the generator draws from.
 *
 * ⚠️ Only halves and quarters appear as fractions. A third would be `0.333…` in the parse and `1/3` in the
 * line, and the corpus would then be measuring float rendering as well as the model.
 */
const UNIT_CHOICES: readonly UnitChoice[] = [
    { unit: 'cup', plural: 'cups', amounts: [0.25, 0.5, 0.75, 1, 2, 3] },
    { unit: 'tablespoon', plural: 'tablespoons', amounts: [1, 2, 3] },
    { unit: 'teaspoon', plural: 'teaspoons', amounts: [0.25, 0.5, 1, 2] },
    { unit: 'ounce', plural: 'ounces', amounts: [4, 6, 8, 12] },
    { unit: 'pound', plural: 'pounds', amounts: [0.5, 1, 2] },
    { unit: 'gram', plural: 'grams', amounts: [100, 200, 250] },
    { unit: null, plural: null, amounts: [1, 2, 3, 4, 6] },
];

/**
 * Preparation clauses a cook appends.
 *
 * ⛔ Every one is nutritionally NEUTRAL. `cooked`, `drained` and `toasted` are deliberately absent: appended
 * to a line whose candidate is a `raw` row, they would make a `correct` line arguably incorrect, and the
 * class's construction guarantee would quietly stop holding.
 */
const PREPARATIONS = [
    'chopped',
    'finely chopped',
    'roughly chopped',
    'thinly sliced',
    'sifted',
    'divided',
    'at room temperature',
    'plus more for serving',
    'packed',
] as const;

/** How the amounts that are not whole numbers are written in a recipe. */
const FRACTION_TEXT: Readonly<Record<string, string>> = Object.freeze({ '0.25': '1/4', '0.5': '1/2', '0.75': '3/4' });

/** One in this many lines carries a range ("2 to 3 tablespoons"). */
const RANGE_ODDS = 8;

/** One in this many lines carries a trailing preparation clause. */
const PREPARATION_ODDS = 3;

/** The short code each class contributes to a line id. */
const CLASS_CODES: Readonly<Record<CorpusContrastClass, string>> = Object.freeze({
    correct: 'cor',
    nearMissIdentity: 'nmi',
    wrongFormIdentity: 'wfi',
    quantityUnitError: 'que',
});

/** Scarcest first. See the file docstring — this ordering is what keeps the wrong-form class fillable. */
const ALLOCATION_ORDER: readonly CorpusContrastClass[] = [
    'wrongFormIdentity',
    'nearMissIdentity',
    'correct',
    'quantityUnitError',
];

/** Pick one member, uniformly. Advances `rng`. */
function pick<T>(items: readonly T[], rng: RandomGenerator): T {
    // `items` is never empty at any call site — every caller has already checked, because an empty pool is a
    // condition the allocator handles by recording a shortfall rather than by drawing from nothing.
    return items[uniformInt(rng, 0, items.length - 1)] as T;
}

/** A Fisher-Yates shuffle over a copy. Advances `rng`. */
function shuffled<T>(items: readonly T[], rng: RandomGenerator): T[] {
    const copy = [...items];

    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = uniformInt(rng, 0, index);
        const held = copy[index] as T;

        copy[index] = copy[swap] as T;
        copy[swap] = held;
    }

    return copy;
}

/** The lower-cased comma segments of a row's name. */
function segmentsOf(row: CatalogRow): string[] {
    return usdaSegments(row.name).map((segment) => segment.toLowerCase());
}

/** The segments that do NOT describe a nutritional state. Two rows agreeing here are the same substance. */
function substanceKey(row: CatalogRow): string {
    return segmentsOf(row)
        .filter((segment) => !FORM_SEGMENTS.has(segment))
        .join('|');
}

/** The nutritional state segments, as a stable string. */
function formKey(row: CatalogRow): string {
    return segmentsOf(row)
        .filter((segment) => FORM_SEGMENTS.has(segment))
        .sort()
        .join('|');
}

/** How an amount is written in a recipe. */
function amountText(amount: number): string {
    return FRACTION_TEXT[String(amount)] ?? String(amount);
}

/** The parsed quantity and the words the line uses to say it. */
interface Quantity {
    readonly quantityLow: number;
    readonly quantityHigh: number | null;
    readonly unit: string | null;
    readonly text: string;
}

/**
 * Draw a quantity and render the words for it.
 *
 * @param rng - The generator. Advanced.
 * @param allowRange - Whether a range may be drawn. The quantity-error class suppresses it.
 * @returns The parse and its rendering. Deterministic given `rng`'s state.
 */
function drawQuantity(rng: RandomGenerator, allowRange: boolean): Quantity {
    const choice = pick(UNIT_CHOICES, rng);
    const index = uniformInt(rng, 0, choice.amounts.length - 1);
    const low = choice.amounts[index] as number;
    const wantsRange = allowRange && uniformInt(rng, 1, RANGE_ODDS) === 1;
    const high = wantsRange ? (choice.amounts[index + 1] ?? null) : null;
    const shown = high ?? low;
    // ⚠️ `<= 1`, not `=== 1`. A cook writes "1/2 teaspoon", never "1/2 teaspoons", and a line that reads
    // wrong is a line the model is judging for the wrong reason.
    const unitWord = choice.unit === null ? '' : ` ${shown <= 1 ? choice.unit : (choice.plural ?? choice.unit)}`;
    const numberText = high === null ? amountText(low) : `${amountText(low)} to ${amountText(high)}`;

    return { quantityLow: low, quantityHigh: high, unit: choice.unit, text: `${numberText}${unitWord}` };
}

/**
 * Corrupt a parse the way a parser really gets one wrong.
 *
 * Two shapes, and the line itself is left telling the truth: a unit read as a different unit, or an amount
 * read as a different amount. A count-only line has no unit to corrupt, so it always takes the amount branch.
 *
 * @param quantity - The true parse.
 * @param rng - The generator. Advanced.
 * @returns The corrupted parse. Deterministic given `rng`'s state.
 */
function corruptQuantity(quantity: Quantity, rng: RandomGenerator): Pick<Quantity, 'quantityLow' | 'unit'> {
    const canSwapUnit = quantity.unit !== null;

    if (canSwapUnit && uniformInt(rng, 0, 1) === 0) {
        const others = UNIT_CHOICES.filter((choice) => choice.unit !== null && choice.unit !== quantity.unit);

        return { quantityLow: quantity.quantityLow, unit: pick(others, rng).unit };
    }

    // x4 is always a different number for every amount in the table, and it reads like a real misparse
    // ("1/2" read as "2") rather than an arbitrary value.
    return { quantityLow: quantity.quantityLow * 4, unit: quantity.unit };
}

/**
 * Build the line a cook would have written.
 *
 * @param row - The catalog row the line is phrased from.
 * @param quantity - The drawn quantity.
 * @param rng - The generator. Advanced.
 * @returns The source line. Deterministic given `rng`'s state.
 */
function sourceLineFor(row: CatalogRow, quantity: Quantity, rng: RandomGenerator): string {
    const wantsPreparation = uniformInt(rng, 1, PREPARATION_ODDS) === 1;
    const preparation = wantsPreparation ? `, ${pick(PREPARATIONS, rng)}` : '';

    return `${quantity.text} ${cookNounPhrase(row.name)}${preparation}`;
}

/** Assemble a corpus line with a FIXED key order, which is what makes the JSONL byte-reproducible. */
function lineOf(
    contrastClass: CorpusContrastClass,
    seed: number,
    index: number,
    row: CatalogRow,
    candidate: CatalogRow,
    sourceLine: string,
    quantity: Pick<Quantity, 'quantityLow' | 'quantityHigh' | 'unit'>,
    parseIsCorrect: boolean,
): CorpusLine {
    return {
        lineId: `synthetic-${String(seed)}-${CLASS_CODES[contrastClass]}-${String(index).padStart(4, '0')}`,
        sourceLine,
        candidateFoodName: candidate.name,
        quantityLow: quantity.quantityLow,
        quantityHigh: quantity.quantityHigh,
        unit: quantity.unit,
        parseIsCorrect,
        contrastClass,
        sourceRowName: row.name,
    };
}

/**
 * The rows the generator can phrase from.
 *
 * @param rows - Every catalog row.
 * @returns The invertible subset, sorted by id. Pure.
 */
export function usableCatalogRows(rows: readonly CatalogRow[]): CatalogRow[] {
    return [...rows]
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
        .filter((row) => isInvertibleUsdaName(row.name));
}

/**
 * The SHA-256 of a catalog, over its ordered rows.
 *
 * @param rows - The rows, already sorted.
 * @returns The hex digest. Pure — a hash is a computation, not I/O.
 */
function digestOf(rows: readonly CatalogRow[]): string {
    return createHash('sha256')
        .update(rows.map((row) => `${row.id}\t${row.name}`).join('\n'))
        .digest('hex');
}

/** Index the pool by head term and by substance, once, rather than scanning it per row. */
function indexPool(pool: readonly CatalogRow[]): {
    readonly byHead: ReadonlyMap<string, CatalogRow[]>;
    readonly bySubstance: ReadonlyMap<string, CatalogRow[]>;
} {
    const byHead = new Map<string, CatalogRow[]>();
    const bySubstance = new Map<string, CatalogRow[]>();

    for (const row of pool) {
        const head = segmentsOf(row)[0] ?? '';
        const substance = substanceKey(row);

        byHead.set(head, [...(byHead.get(head) ?? []), row]);
        bySubstance.set(substance, [...(bySubstance.get(substance) ?? []), row]);
    }

    return { byHead, bySubstance };
}

/**
 * Generate the corpus.
 *
 * Pure: same `rows`, `seed` and `targetSize` produce byte-identical `lines` and an identical `manifest`. It
 * mutates a locally-created generator, which is state that never escapes the call.
 *
 * @param request - The catalog, the seed and the target size.
 * @returns The lines and the provenance manifest.
 * @throws {EmptyCatalogError} When the catalog can phrase nothing, or the target is too small to split.
 */
export function synthesizeBakeOffCorpus(request: CorpusSynthesisRequest): CorpusSynthesisResult {
    const sorted = [...request.rows].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const pool = usableCatalogRows(sorted);

    if (pool.length === 0) {
        throw new EmptyCatalogError(`none of the ${String(sorted.length)} catalog rows can be phrased as a cook line`);
    }

    const perClass = Math.floor(request.targetSize / CORPUS_CONTRAST_CLASSES.length);

    if (perClass < 1) {
        throw new EmptyCatalogError(
            `a target size of ${String(request.targetSize)} cannot be split across ${String(CORPUS_CONTRAST_CLASSES.length)} classes`,
        );
    }

    const { byHead, bySubstance } = indexPool(pool);

    const siblingsOf = (row: CatalogRow): CatalogRow[] => {
        const segments = segmentsOf(row);

        return (byHead.get(segments[0] ?? '') ?? []).filter(
            (other) => other.id !== row.id && segmentsOf(other)[1] !== segments[1],
        );
    };

    const counterpartsOf = (row: CatalogRow): CatalogRow[] =>
        (bySubstance.get(substanceKey(row)) ?? []).filter(
            (other) => other.id !== row.id && formKey(other) !== formKey(row),
        );

    const rng = xoroshiro128plus(request.seed);
    const claimed = new Set<string>();

    /** Take up to `perClass` rows that satisfy `admits`, skipping rows another class already claimed. */
    const claim = (admits: (row: CatalogRow) => boolean): CatalogRow[] => {
        const available = shuffled(
            pool.filter((row) => !claimed.has(row.id) && admits(row)),
            rng,
        ).slice(0, perClass);

        for (const row of available) {
            claimed.add(row.id);
        }

        return available;
    };

    const formRows = claim((row) => counterpartsOf(row).length > 0);
    const identityRows = claim((row) => siblingsOf(row).length > 0);
    const quantityRows = claim(() => true);

    const lines: CorpusLine[] = [];

    formRows.forEach((row, index) => {
        const quantity = drawQuantity(rng, true);
        const sourceLine = sourceLineFor(row, quantity, rng);

        lines.push(
            lineOf(
                'wrongFormIdentity',
                request.seed,
                index,
                row,
                pick(counterpartsOf(row), rng),
                sourceLine,
                quantity,
                false,
            ),
        );
    });

    identityRows.forEach((row, index) => {
        const quantity = drawQuantity(rng, true);
        const sourceLine = sourceLineFor(row, quantity, rng);
        const sibling = pick(siblingsOf(row), rng);

        // The pair. Same row, same phrasing, same quantity — only the candidate differs, which is what makes
        // the residual slice an isolation of identity discrimination.
        lines.push(lineOf('correct', request.seed, index, row, row, sourceLine, quantity, true));
        lines.push(lineOf('nearMissIdentity', request.seed, index, row, sibling, sourceLine, quantity, false));
    });

    quantityRows.forEach((row, index) => {
        const quantity = drawQuantity(rng, false);
        const sourceLine = sourceLineFor(row, quantity, rng);
        const corrupted = corruptQuantity(quantity, rng);

        lines.push(
            lineOf(
                'quantityUnitError',
                request.seed,
                index,
                row,
                row,
                sourceLine,
                {
                    quantityLow: corrupted.quantityLow,
                    quantityHigh: null,
                    unit: corrupted.unit,
                },
                false,
            ),
        );
    });

    const classBalance = {
        correct: identityRows.length,
        nearMissIdentity: identityRows.length,
        wrongFormIdentity: formRows.length,
        quantityUnitError: quantityRows.length,
    } as const;

    return {
        // ⛔ SHUFFLED. Emitted in class order, `--limit 20` would smoke-test one class and report a rate that
        // is not a rate. The shuffle uses the same generator, so it is part of what the seed reproduces.
        lines: shuffled(lines, rng),
        manifest: {
            generator: 'generateBakeOffCorpus',
            generatorVersion: CORPUS_GENERATOR_VERSION,
            synthetic: true,
            groundTruth: 'by-construction',
            notComparableTo:
                'U1 annotation protocol — this corpus is synthetic phrasing over real catalog rows with ground truth by construction, and measures discrimination on constructed contrasts rather than field accuracy',
            seed: request.seed,
            targetSize: request.targetSize,
            catalogRowCount: sorted.length,
            invertibleRowCount: pool.length,
            catalogDigest: digestOf(sorted),
            classBalance,
            classShortfalls: {
                correct: perClass - classBalance.correct,
                nearMissIdentity: perClass - classBalance.nearMissIdentity,
                wrongFormIdentity: perClass - classBalance.wrongFormIdentity,
                quantityUnitError: perClass - classBalance.quantityUnitError,
            },
            allocationOrder: ALLOCATION_ORDER,
            residualSliceClasses: RESIDUAL_SLICE_CLASSES,
        },
    };
}
