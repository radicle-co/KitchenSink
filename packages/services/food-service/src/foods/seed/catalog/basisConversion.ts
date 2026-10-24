/**
 * The one place a cited value changes (plan R54, KTD-20, KTD-24). An extractor translates a source's columns and never
 * converts; this module turns an extract line, a manufacturer's label or a Branded product into per-100 g values and
 * says what it did, because CC BY 4.0 §3(a)(1)(B) requires stating that the material was changed.
 *
 * ⛔ A printed zero on a label, and a Branded zero, is ABSENT, never 0 (owner ruling on OQ-2, 2026-09-30; 21 CFR
 * 101.9(c) lets a label print 0 for anything below a threshold, so a printed 0 is not a measurement of 0). A printed
 * non-zero value that rounds to 0.000 per 100 g is a measurement and is kept as 0; the verifier must agree.
 *
 * ⚠️ Order is part of the result. A per-100 mL line divides by its density first and rounds to three places; a kcal
 * value derived from kJ then divides the ROUNDED per-100 g kJ. The SQL verifier (U6) must round in the same two
 * steps, or a value that is right here reads as a mismatch there.
 *
 * @pattern Policy — a pure function from a line to its per-100 g values and the conversions applied
 * @module
 */
import Decimal from 'decimal.js';

import { canonicalizeBulkUnit } from '../../../sources/usda/bulk/usdaBulk.parser.js';
import { canonicalizeNutrientName } from '../../../sources/usda/usda.adapter.js';
import { INFOODS, type InfoodsTag } from '../../nutrition/nutrientIdentity.js';
import type { BrandedProduct } from '../archive/brandedExtract.js';
import { EXTRACT_DECIMAL_PLACES, type ExtractLine } from '../archive/sourceExtract.js';
import type { ManufacturerLabel } from './curatedSeedFormat.js';

/** A plain non-negative decimal, the only amount a Branded row may carry here. */
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/u;

/** Kilojoules per kilocalorie. */
const KJ_PER_KCAL = '4.184';

/** One conversion applied to a line. */
export type BasisConversion =
    | { readonly kind: 'volumeToMass'; readonly densityGramsPerMl: string }
    | { readonly kind: 'kilojoulesToKilocalories' };

/** A line's values per 100 g, its trace marks, and the conversions that produced the values. */
export interface Per100gValues {
    readonly values: Readonly<Partial<Record<InfoodsTag, string>>>;
    /** The tags the source printed as a trace, carried unchanged: a trace is 0 on any basis (R53). */
    readonly traces?: readonly InfoodsTag[];
    readonly conversions: readonly BasisConversion[];
}

/** One value per 100 g under its `nutrient` dictionary entry, for a source that names nutrients rather than tags. */
export interface NamedAmount {
    readonly name: string;
    readonly unit: string;
    /** A plain decimal string. */
    readonly amount: string;
}

/**
 * Divide a decimal string by another, rounded to the stored places half away from zero, as SQL's `round()` does. Pure.
 *
 * @param amount - The dividend.
 * @param divisor - The divisor.
 * @returns The quotient as a plain decimal string.
 */
function divide(amount: string, divisor: string): string {
    return new Decimal(amount)
        .dividedBy(divisor)
        .toDecimalPlaces(EXTRACT_DECIMAL_PLACES, Decimal.ROUND_HALF_UP)
        .toString();
}

/**
 * A line's values per 100 g. Pure.
 *
 * @param line - An extract line.
 * @returns Its values per 100 g, with kcal derived from kJ when the source gives no kcal, and every conversion made.
 */
export function toPer100g(line: ExtractLine): Per100gValues {
    const conversions: BasisConversion[] = [];
    const density = line.basis === 'per100mL' ? line.densityGramsPerMl : undefined;
    // Built from entries, never a literal accumulator, so no key can reach the inherited `__proto__` setter.
    const values: Partial<Record<InfoodsTag, string>> = Object.fromEntries(
        Object.values(INFOODS).flatMap((tag) => {
            const amount = line.values[tag];

            return amount === undefined ? [] : [[tag, density === undefined ? amount : divide(amount, density)]];
        }),
    );

    if (density !== undefined) {
        conversions.push({ kind: 'volumeToMass', densityGramsPerMl: density });
    }

    const kilojoules = values[INFOODS.energyKj];

    if (values[INFOODS.energyKcal] === undefined && kilojoules !== undefined) {
        values[INFOODS.energyKcal] = divide(kilojoules, KJ_PER_KCAL);
        conversions.push({ kind: 'kilojoulesToKilocalories' });
    }

    return line.traces === undefined ? { values, conversions } : { values, traces: line.traces, conversions };
}

/**
 * A label's printed per-serving values per 100 g: `round(printed × 100 ÷ servingGrams, 3)`, half away from zero
 * (KTD-20). A printed zero is dropped (OQ-2). Pure.
 *
 * @param label - The committed label; its values are named by `LABEL_NUTRIENT_MAP`'s pairs, which the format checks.
 * @returns Its non-zero printed values per 100 g, in printed order.
 */
export function labelPer100g(label: ManufacturerLabel): NamedAmount[] {
    return label.perServing.flatMap((value) =>
        new Decimal(value.amount).isZero()
            ? []
            : [
                  {
                      name: value.name,
                      unit: value.unit,
                      amount: divide(new Decimal(value.amount).times(100).toFixed(), label.serving.grams),
                  },
              ],
    );
}

/**
 * A gram-served Branded product's values per 100 g: its rows as FDC wrote them, which are already per 100 g, named as
 * the live parser names them. A zero is dropped (OQ-2), as is a row whose nutrient id `nutrient.csv` does not define,
 * and a repeated `(name, unit)` keeps its first row, as the bulk parser does. Pure.
 *
 * @param product - A cited product served in grams; the image refuses any other serving unit.
 * @returns Its non-zero values, in row order.
 * @throws {RangeError} for an amount that is not a plain non-negative decimal, naming the product and nutrient id.
 */
export function brandedPer100g(product: BrandedProduct): NamedAmount[] {
    const byKey = new Map<string, NamedAmount>();

    for (const row of product.nutrients) {
        const name = canonicalizeNutrientName(row.name);
        const unit = canonicalizeBulkUnit(row.unitName);
        const key = `${name}\u0000${unit}`;

        if (!PLAIN_DECIMAL.test(row.amount)) {
            throw new RangeError(
                `Branded product ${String(product.fdcId)} nutrient ${String(row.nutrientId)}: '${row.amount}' is not a plain decimal.`,
            );
        }

        if (name === '' || unit === '' || new Decimal(row.amount).isZero() || byKey.has(key)) {
            continue;
        }

        byKey.set(key, { name, unit, amount: row.amount });
    }

    return [...byKey.values()];
}
