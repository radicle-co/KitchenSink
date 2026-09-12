/**
 * THE portion normalizer (KTD-3, plan U8) — raw `{ label, gramWeight }` becomes `{ unit, gramsPerUnit }`.
 *
 * ## Why this moved into the food service
 *
 * Returning raw portions was not sufficient for food to "own nutrition". Food stored
 * `{ label: '1 cup chopped', gramWeight: 125 }`, while the consumer's `unitToGrams` needs
 * `{ unit: 'cup', gramsPerUnit: 125 }` — so the recipe service kept a HEURISTIC that interpreted food's
 * data. That heuristic is the second source of truth KTD-3 exists to delete: two services parsing the same
 * label can disagree about what a cup of this food weighs, and only one of them is the owner.
 *
 * Food now returns the already-normalized shape and recipe keeps no interpreter.
 *
 * ## What is deliberately NOT done here
 *
 * A label the parser cannot interpret reports that portion **absent** — it is never guessed at, and never
 * emitted with a fabricated unit. A wrong gram weight is worse than a missing one: a missing portion makes a
 * volumetric line unconvertible and visibly so, while a wrong one silently changes every quantity derived
 * from it.
 *
 * @module
 */

/** A portion normalized to grams per single unit. */
export interface NormalizedPortion {
    /** The lower-cased measure unit (`cup`, `tablespoon`, `clove`). */
    readonly unit: string;
    /** Grams in ONE of that unit. Strictly positive. */
    readonly gramsPerUnit: number;
}

/** The raw stored portion shape. */
export interface RawPortion {
    /** Human label, e.g. `1 cup chopped`. */
    readonly label: string;
    /** Gram weight of the whole label amount. */
    readonly gramWeight: number;
}

/**
 * Parse a label's leading amount — an integer, a decimal, or an `a/b` fraction. Pure, total.
 *
 * Fractions matter: USDA labels routinely read `1/2 cup`, and `Number('1/2')` is `NaN`, so a naive parse
 * drops exactly the portions a recipe is most likely to reference.
 *
 * @param raw - The first whitespace-separated token of a label.
 * @returns The amount, or `null` when it is not a positive finite number.
 */
function parseAmount(raw: string): number | null {
    const fraction = /^(\d+)\/(\d+)$/.exec(raw);

    if (fraction !== null) {
        const denominator = Number(fraction[2]);

        return denominator !== 0 ? Number(fraction[1]) / denominator : null;
    }

    const value = Number(raw);

    return Number.isFinite(value) ? value : null;
}

/** Lower-case and strip a trailing plural `s` so `cups` and `cup` are one unit. Pure. */
function normalizeUnitToken(token: string): string {
    const lower = token.trim().toLowerCase().replace(/[.,]$/, '');

    return lower.endsWith('s') && lower.length > 1 ? lower.slice(0, -1) : lower;
}

/**
 * Normalize one raw portion, or report it absent. Pure, total.
 *
 * @param portion - The stored `{ label, gramWeight }`.
 * @returns The normalized portion, or `null` when the label carries no usable amount + unit.
 */
export function normalizePortion(portion: RawPortion): NormalizedPortion | null {
    const tokens = portion.label.trim().split(/\s+/);

    if (tokens.length < 2 || portion.gramWeight <= 0) {
        return null;
    }

    const amount = parseAmount(tokens[0]!);

    if (amount === null || amount <= 0) {
        return null;
    }

    const unit = normalizeUnitToken(tokens[1]!);

    return unit.length > 0 ? { unit, gramsPerUnit: portion.gramWeight / amount } : null;
}

/**
 * Normalize a food's portions, de-duplicated by unit — first parseable wins. Pure, total.
 *
 * @param portions - The food's stored portions.
 * @returns The normalized portions, one per unit, in first-seen order.
 */
export function normalizePortions(portions: readonly RawPortion[]): NormalizedPortion[] {
    const byUnit = new Map<string, NormalizedPortion>();

    for (const portion of portions) {
        const parsed = normalizePortion(portion);

        if (parsed !== null && !byUnit.has(parsed.unit)) {
            byUnit.set(parsed.unit, parsed);
        }
    }

    return [...byUnit.values()];
}
