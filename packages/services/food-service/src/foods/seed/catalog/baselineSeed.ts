/**
 * The USDA baseline: every SR Legacy and current Foundation item, one root per normalized description
 * (plan U1, R48, R51, KTD-16).
 *
 * @pattern Functional core — pure functions from USDA facts to the baseline; `seedSources.ts` is the I/O door
 *
 * The universe is every SR Legacy item plus the CURRENT Foundation items `foundation_food.csv` lists, in the
 * archives `sourcePins.json` pins. Exclusions (R51) are dropped first; the rest are grouped by
 * {@link normalizeUsdaDescription}, and each group elects the one item that supplies its numbers. The others
 * become that item's alias sources in the image (R48).
 */
import { z } from 'zod';

import type { CanonicalNutrient, CanonicalPortion } from '../../../sources/foodSourceAdapter.js';
import { mapBulkFoodToCanonical } from '../../../sources/usda/bulk/usdaBulk.parser.js';
import type { BulkFoodBundle, BulkLookups } from '../../../sources/usda/bulk/usdaBulk.types.js';
import { NUTRIENT_DEFINITIONS, USDA_NUTRIENT_ID_DEFINITIONS } from '../../nutrition/nutrientIdentity.js';
import { fdcIdOf, fdcKey, type FdcKey } from '../catalogKey.js';
import { SeedRefusedError, type SeedIssue } from './curatedSeedFormat.errors.js';

/** What the baseline needs to know about one USDA item. */
export interface UsdaItemFacts {
    /** The item's natural key, `fdc:<id>`. */
    readonly key: FdcKey;
    /** The USDA description, as published. The baseline root's name when the item supplies its group. */
    readonly description: string;
    /** `food.publication_date`, which must be an ISO calendar date. */
    readonly publicationDate: string;
    /** Whether the item is one of the current Foundation items `foundation_food.csv` lists. */
    readonly isFoundation: boolean;
    /** Whether the item carries an energy value: nutrient 1008, 2048 or 2047. */
    readonly hasEnergy: boolean;
    /** The item's portions, as the live parser maps them. */
    readonly portions: readonly CanonicalPortion[];
    /** The item's nutrient rows per 100 g, as the live parser maps them: the numbers a root or variant on it stores. */
    readonly nutrients: readonly CanonicalNutrient[];
}

/** One baseline root: the items that share a normalized description, and the one that supplies its numbers. */
export interface BaselineGroup {
    /** The root's name: its supplier's USDA description. */
    readonly name: string;
    /** The elected item. */
    readonly supplier: UsdaItemFacts;
    /** Every member, the supplier first, then in the order the election ranks them. */
    readonly members: readonly UsdaItemFacts[];
}

/** The baseline seed. */
export interface BaselineSeed {
    /** Every baseline root, keyed by its supplier's item key. */
    readonly groups: ReadonlyMap<FdcKey, BaselineGroup>;
    /** Every non-excluded item's group supplier. */
    readonly supplierOf: ReadonlyMap<FdcKey, FdcKey>;
    /** Every item of the universe, excluded ones included. */
    readonly universe: ReadonlyMap<FdcKey, UsdaItemFacts>;
}

/**
 * The energy nutrients, in the order KTD-21 reads them: Energy (1008), then Atwater Specific (2048), then
 * Atwater General (2047). The election only asks whether ANY is present.
 */
const ENERGY_NUTRIENT_IDS: ReadonlySet<string> = new Set(
    [...USDA_NUTRIENT_ID_DEFINITIONS]
        .filter(([, key]) => NUTRIENT_DEFINITIONS[key].unit === 'kcal')
        .map(([id]) => String(id)),
);

const isoDateSchema = z.iso.date();

/**
 * Normalize a USDA description for R48's one-root-per-name rule. Pure.
 *
 * Lowercase it, split it on commas, remove every character but `a-z0-9` inside each segment, drop empty
 * segments, and sort the segments. The words inside a segment are never sorted: doing so merges two different
 * foods (169423 and 170587, mixed nuts with and without peanuts and salt). U6's SQL restates this rule, and a
 * parity test holds the two together.
 *
 * @param description - A USDA description.
 * @returns The comma-joined sorted segments; `''` when nothing alphanumeric remains.
 */
export function normalizeUsdaDescription(description: string): string {
    return description
        .toLowerCase()
        .split(',')
        .map((segment) => segment.replace(/[^a-z0-9]/g, ''))
        .filter((segment) => segment !== '')
        .sort()
        .join(',');
}

/**
 * The election's order, best first: an item with energy, then a current Foundation item, then the latest
 * publication date, then the highest FDC id (R48, owner rulings 2026-09-22 and 2026-09-27). Pure.
 *
 * ⚠️ Dates compare as strings, which is exact only for ISO dates; {@link buildBaselineSeed} refuses any other.
 *
 * @param left - An item.
 * @param right - An item.
 * @returns Negative when `left` supplies before `right`.
 */
function supplyOrder(left: UsdaItemFacts, right: UsdaItemFacts): number {
    if (left.hasEnergy !== right.hasEnergy) {
        return left.hasEnergy ? -1 : 1;
    }

    if (left.isFoundation !== right.isFoundation) {
        return left.isFoundation ? -1 : 1;
    }

    if (left.publicationDate !== right.publicationDate) {
        return left.publicationDate > right.publicationDate ? -1 : 1;
    }

    return fdcIdOf(right.key) - fdcIdOf(left.key);
}

/**
 * Rank items in the election's order, best first. Pure.
 *
 * @param members - Items (not mutated).
 * @returns A new array, the supplier first.
 */
export function rankBySupply(members: readonly UsdaItemFacts[]): UsdaItemFacts[] {
    return [...members].sort(supplyOrder);
}

/**
 * Elect the item that supplies a group's numbers (R48). Pure.
 *
 * @param members - A group's items; its dates must be ISO.
 * @returns The supplier.
 * @throws {RangeError} for an empty group.
 */
export function electSupplier(members: readonly UsdaItemFacts[]): UsdaItemFacts {
    const [supplier] = rankBySupply(members);

    if (supplier === undefined) {
        throw new RangeError('A group with no members has no supplier.');
    }

    return supplier;
}

/**
 * Build the baseline seed from the USDA universe. Pure.
 *
 * @param items - Every SR Legacy and current Foundation item.
 * @param exclusions - The items R51 excludes; dropped before grouping, so one never supplies a group.
 * @returns The baseline.
 * @throws {SeedRefusedError} for an item listed twice, a blank description, or a date that is not ISO.
 */
export function buildBaselineSeed(items: readonly UsdaItemFacts[], exclusions: ReadonlySet<FdcKey>): BaselineSeed {
    const issues: SeedIssue[] = [];
    const universe = new Map<FdcKey, UsdaItemFacts>();

    for (const item of items) {
        if (universe.has(item.key)) {
            issues.push({ where: item.key, rule: 'usdaItemRepeated', detail: 'appears twice in the USDA archives' });
            continue;
        }

        universe.set(item.key, item);

        if (normalizeUsdaDescription(item.description) === '') {
            issues.push({ where: item.key, rule: 'descriptionBlank', detail: `description '${item.description}'` });
        }

        if (!isoDateSchema.safeParse(item.publicationDate).success) {
            issues.push({ where: item.key, rule: 'publicationDateNotIso', detail: `'${item.publicationDate}'` });
        }
    }

    if (issues.length > 0) {
        throw new SeedRefusedError(issues);
    }

    const byDescription = new Map<string, UsdaItemFacts[]>();

    for (const item of universe.values()) {
        if (exclusions.has(item.key)) {
            continue;
        }

        const description = normalizeUsdaDescription(item.description);
        const members = byDescription.get(description) ?? [];

        members.push(item);
        byDescription.set(description, members);
    }

    const groups = new Map<FdcKey, BaselineGroup>();
    const supplierOf = new Map<FdcKey, FdcKey>();

    for (const members of byDescription.values()) {
        const ranked = rankBySupply(members);
        const supplier = electSupplier(ranked);

        groups.set(supplier.key, { name: supplier.description.trim(), supplier, members: ranked });

        for (const member of ranked) {
            supplierOf.set(member.key, supplier.key);
        }
    }

    return { groups, supplierOf, universe };
}

/**
 * Whether a USDA item's or product's nutrient rows state an energy value: nutrient 1008, 2048 or 2047 (KTD-21). Pure.
 *
 * @param nutrients - The rows, each with its FDC nutrient id and raw amount.
 * @returns `true` when any energy row states a value.
 */
export function statesEnergy(
    nutrients: readonly { readonly nutrientId: number | string; readonly amount: string }[],
): boolean {
    return nutrients.some((row) => ENERGY_NUTRIENT_IDS.has(String(row.nutrientId)) && statesValue(row.amount));
}

/**
 * Whether a raw CSV amount states a value. The owner's election measured "has energy" with Python's
 * `float(amount)`; this is not the same predicate in general (`Number('0x10')` is finite, `float('inf')`
 * succeeds), but the two agree on every energy row of the pinned archives (measured 2026-09-30). Pure.
 *
 * @param amount - The raw field.
 * @returns `true` for a finite number.
 */
function statesValue(amount: string): boolean {
    const trimmed = amount.trim();

    return trimmed !== '' && Number.isFinite(Number(trimmed));
}

/**
 * Read the baseline's facts off one USDA bulk bundle. Pure.
 *
 * Portions and nutrients come from the live parser (`mapBulkFoodToCanonical`), which stays the one authority on units
 * and FDC's known bad rows (a blank Foundation amount, an unknown nutrient id, an orphan portion).
 *
 * @param bundle - The bulk food and its rows.
 * @param lookups - Its archive's `nutrient.csv` and `measure_unit.csv`.
 * @param isFoundation - Whether `foundation_food.csv` lists the item.
 * @returns The item's facts.
 * @throws {RangeError} when the bundle's `fdc_id` is not an FDC id.
 */
export function usdaItemFactsOf(bundle: BulkFoodBundle, lookups: BulkLookups, isFoundation: boolean): UsdaItemFacts {
    const candidate = mapBulkFoodToCanonical(bundle, lookups);

    return {
        key: fdcKey(/^[1-9][0-9]*$/.test(bundle.fdcId) ? Number(bundle.fdcId) : Number.NaN),
        description: bundle.description,
        publicationDate: bundle.publicationDate,
        isFoundation,
        hasEnergy: statesEnergy(bundle.nutrients),
        portions: candidate?.portions ?? [],
        nutrients: candidate?.nutrients ?? [],
    };
}
