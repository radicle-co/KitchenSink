/**
 * THE portion normalizer (KTD-3, plan U8) — raw `{ label, gramWeight }` becomes `{ unit, gramsPerUnit }`.
 *
 * ## Why this lives in the food service
 *
 * Returning raw portions was not sufficient for food to "own nutrition". Food stored
 * `{ label: '1 cup, chopped', gramWeight: 125 }`, while the consumer's `unitToGrams` needs
 * `{ unit: 'cup', gramsPerUnit: 125 }` — so the recipe service kept a HEURISTIC that interpreted food's
 * data. That heuristic is the second source of truth KTD-3 exists to delete: two services parsing the same
 * label can disagree about what a cup of this food weighs, and only one of them is the owner.
 *
 * Food now returns the already-normalized shape and recipe keeps no interpreter.
 *
 * ## How a label is read
 *
 * `parse-ingredient` reads the leading amount (`1 1/2`, `½`, `0.33`), so the amount grammar is the one recipe lines
 * are read with. The measure is the text after the amount, up to the first comma, parenthesis or pipe. It is a
 * unit when the whole measure is one recipe-core knows (`fl. oz.`), when it is one word (`large`, `thigh`), or when
 * its first word is one recipe-core knows (`cup drained`). Any other measure qualifies a count noun (`egg white`,
 * `Banana Peel`), and the weight it states is not one of that noun.
 *
 * The unit emitted is recipe-core's `normalizeUnit` of that text, so `1 ONZ` reads `oz` and the recipe side's
 * `unitToGrams` matches it. A unit `normalizeUnit` does not keep fixed (`glass` becomes `glas`, then `gla`) can
 * never match, so it is not emitted.
 *
 * ## What is deliberately NOT done here
 *
 * A label the rule cannot read reports that portion **absent** — it is never guessed at, and never
 * emitted with a fabricated unit. A wrong gram weight is worse than a missing one: a missing portion makes a
 * volumetric line unconvertible and visibly so, while a wrong one silently changes every quantity derived
 * from it.
 *
 * @module
 */
import { classifyUnit, normalizeUnit } from '@kitchensink/recipe-core';
import { parseIngredient } from 'parse-ingredient';

/** A portion normalized to grams per single unit. */
export interface NormalizedPortion {
    /** The canonical measure unit (`cup`, `tablespoon`, `oz`, `large`). */
    readonly unit: string;
    /** Grams in ONE of that unit. Strictly positive. */
    readonly gramsPerUnit: number;
}

/** The raw stored portion shape. */
export interface RawPortion {
    /** Human label, e.g. `1 cup, chopped`. */
    readonly label: string;
    /** Gram weight of the whole label amount. */
    readonly gramWeight: number;
}

/** A normalized portion with what {@link normalizePortions} ranks it by. */
interface ReadPortion extends NormalizedPortion {
    /** Whether text follows the unit (`1 cup, chopped`). */
    readonly qualified: boolean;
    /** The label's amount. */
    readonly amount: number;
    /** The label, for the last tiebreak. */
    readonly label: string;
}

/** Where a label's measure ends and its qualifier begins. */
const QUALIFIER_START = /[,(|]/;

/**
 * A label leads with its amount: a digit, a decimal point or a vulgar fraction. `parse-ingredient` finds an amount
 * anywhere in the text and reads `-1 cup` as one cup, so the lead is checked before it reads.
 */
const LEADS_WITH_AN_AMOUNT = /^(?:\d|\.\d|\p{No})/u;

/** A decimal comma (`1,5`), which `parse-ingredient` reads as fifteen. */
const DECIMAL_COMMA = /^\d+,\d/;

/**
 * Units that name a regulatory reference amount, not a household measure. Live Foundation records state FDA's
 * reference serving as the measure unit `RACC`; no recipe measures by it.
 */
const REFERENCE_SERVINGS: ReadonlySet<string> = new Set(['racc']);

/** A unit starts with a letter; punctuation in its place (`1 . oz`) is not a unit. */
const STARTS_WITH_A_LETTER = /^\p{L}/u;

/**
 * The unit a measure names, and the text it was read from. Pure.
 *
 * @param measure - The text after the amount, up to the first qualifier.
 * @returns The unit and its text, or `null` when the measure qualifies a count noun or names nothing.
 */
function unitOf(measure: string): { readonly unit: string; readonly text: string } | null {
    const words = measure.split(' ');
    const text =
        classifyUnit(measure) === 'canonical' || words.length === 1
            ? measure
            : classifyUnit(words[0]!) === 'canonical'
              ? words[0]!
              : null;

    if (text === null || !STARTS_WITH_A_LETTER.test(text)) {
        return null;
    }

    const unit = normalizeUnit(text);

    return unit !== '' && normalizeUnit(unit) === unit && !REFERENCE_SERVINGS.has(unit) ? { unit, text } : null;
}

/**
 * Read one raw portion, keeping what the ranking needs. Pure.
 *
 * @param portion - The stored `{ label, gramWeight }`.
 * @returns The read portion, or `null` when the label carries no usable amount and unit.
 */
function readPortion(portion: RawPortion): ReadPortion | null {
    const label = portion.label.trim();

    if (
        !(portion.gramWeight > 0) ||
        !Number.isFinite(portion.gramWeight) ||
        !LEADS_WITH_AN_AMOUNT.test(label) ||
        DECIMAL_COMMA.test(label)
    ) {
        return null;
    }

    const lines = parseIngredient(label);
    const line = lines.length === 1 ? lines[0]! : null;

    if (line === null || line.isGroupHeader || line.quantity2 !== null) {
        return null;
    }

    const amount = line.quantity;

    if (amount === null || !Number.isFinite(amount) || amount <= 0) {
        return null;
    }

    const rest = `${line.unitOfMeasure ?? ''} ${line.description}`.replace(/\s+/g, ' ').trim();
    const read = unitOf(rest.split(QUALIFIER_START)[0]!.trim());

    return read === null
        ? null
        : {
              unit: read.unit,
              gramsPerUnit: portion.gramWeight / amount,
              qualified: read.text !== rest,
              amount,
              label: portion.label,
          };
}

/**
 * Normalize one raw portion, or report it absent. Pure, total.
 *
 * @param portion - The stored `{ label, gramWeight }`.
 * @returns The normalized portion, or `null` when the label carries no usable amount + unit.
 */
export function normalizePortion(portion: RawPortion): NormalizedPortion | null {
    const read = readPortion(portion);

    return read === null ? null : { unit: read.unit, gramsPerUnit: read.gramsPerUnit };
}

/**
 * Order two portions of one unit, the one to keep first: a label with no qualifier, then an amount of exactly one,
 * then the label in code-point order. Pure.
 *
 * @param left - One portion.
 * @param right - The other.
 * @returns Negative when `left` is kept.
 */
function keepFirst(left: ReadPortion, right: ReadPortion): number {
    if (left.qualified !== right.qualified) {
        return left.qualified ? 1 : -1;
    }

    if ((left.amount === 1) !== (right.amount === 1)) {
        return left.amount === 1 ? -1 : 1;
    }

    return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
}

/**
 * Normalize a food's portions to one per unit. Pure, total.
 *
 * The result depends only on the set of portions, never on their order. The nutrition read returns rows in
 * insertion order, which a reseed or a re-ingest can change, and the edge caches the response.
 *
 * @param portions - The food's stored portions.
 * @returns One normalized portion per unit, in code-point order of unit.
 */
export function normalizePortions(portions: readonly RawPortion[]): NormalizedPortion[] {
    const byUnit = new Map<string, ReadPortion>();

    for (const portion of portions) {
        const read = readPortion(portion);
        const kept = read === null ? undefined : byUnit.get(read.unit);

        if (read !== null && (kept === undefined || keepFirst(read, kept) < 0)) {
            byUnit.set(read.unit, read);
        }
    }

    return [...byUnit.values()]
        .sort((left, right) => (left.unit < right.unit ? -1 : left.unit > right.unit ? 1 : 0))
        .map(({ unit, gramsPerUnit }) => ({ unit, gramsPerUnit }));
}
