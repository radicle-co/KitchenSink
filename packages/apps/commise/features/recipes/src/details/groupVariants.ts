/**
 * @module details/groupVariants — which list the details dialog shows for a root's live variants, how a long list
 * groups, and how search narrows it (curated plan U14, R26; `docs/design/ingredientSpecialization.md` §S8.3, §S8.5).
 *
 * @pattern Specification — the three R26 grouping conditions, each a predicate over the candidate attribute's keys
 * @pattern Policy — one pure function decides the list's shape; the leaves only draw it
 *
 * ⛔ The literal R26 reading: the candidate is the FIRST attribute, in contract order, whose key differs between
 * rows. If it fails a condition, the list is flat, and no later attribute is tried (§S8.3 step 3, E2).
 */
import { VARIANT_ATTRIBUTES, type VariantView } from '@kitchensink/food-service-client';

/** The fewest live variants that get the long list with search (R26). */
export const LONG_LIST_MIN_ROWS = 8;

/** One row of the dialog's list. */
export interface VariantRow {
    /** The wire variant, so a pick carries its id. */
    readonly variant: VariantView;
    /** Every part's text, in wire order. The spoken name and search read these. */
    readonly allParts: readonly [string, ...string[]];
    /** The parts the row shows: every part but its group's, or every part when that would leave none. */
    readonly shownParts: readonly [string, ...string[]];
    /** The group's part, for a row in a group (R27: a grouped row's spoken name ends with it). */
    readonly group: string | undefined;
    /** Calories per 100 g, or `undefined` when the variant states none (never 0). */
    readonly calories: number | undefined;
}

/** One group of a grouped long list: its header's part, and its rows. */
interface VariantGroup {
    readonly key: string;
    readonly rows: readonly VariantRow[];
}

/**
 * The list the dialog shows.
 *
 * - `short`: fewer than {@link LONG_LIST_MIN_ROWS} rows, flat, no search.
 * - `long`: search above the list. `headless` holds the rows without the group part, or every row of a flat list;
 *   `groups` is empty when the list is flat, and `attribute` names what it groups by.
 */
export type VariantListPlan =
    | { readonly kind: 'short'; readonly rows: readonly VariantRow[] }
    | {
          readonly kind: 'long';
          readonly attribute: string | undefined;
          readonly headless: readonly VariantRow[];
          readonly groups: readonly VariantGroup[];
      };

/** A long list, grouped or flat. */
export type LongVariantListPlan = Extract<VariantListPlan, { kind: 'long' }>;

/** The collator §S8.3 and §S8.5 use: base sensitivity (case and accents do not matter), numbers by value. */
function collatorFor(locale: string): Intl.Collator {
    return new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
}

/** A variant's parts as text, or `undefined` for a variant with none, which no row can name (R25). */
function partsOf(variant: VariantView): readonly [string, ...string[]] | undefined {
    const [first, ...rest] = variant.parts.map((part) => part.text);

    return first === undefined ? undefined : [first, ...rest];
}

/** A row's key for `attribute`: the text of its FIRST part with that attribute, or `undefined` (§S8.3 step 1). */
function keyOf(variant: VariantView, attribute: string): string | undefined {
    return variant.parts.find((part) => part.attribute === attribute)?.text;
}

/**
 * The attribute to group by, or `undefined` for a flat list (§S8.3 steps 1 to 3). Pure.
 *
 * @param variants - The listed variants (each with at least one part).
 * @returns The candidate, when it meets all three R26 conditions.
 */
function groupingAttribute(variants: readonly VariantView[]): string | undefined {
    const candidate = VARIANT_ATTRIBUTES.find(
        (attribute) => new Set(variants.map((variant) => keyOf(variant, attribute))).size > 1,
    );

    if (candidate === undefined) {
        return undefined;
    }

    const keys = variants.map((variant) => keyOf(variant, candidate));
    const distinct = new Set(keys.filter((key) => key !== undefined)).size;
    const keyed = keys.filter((key) => key !== undefined).length;
    const rows = variants.length;

    // Both halves are real numbers: with 9 rows, 4 keys pass and 5 fail; 5 keyed rows pass and 4 fail.
    const meetsAll = distinct >= 2 && distinct * 2 <= rows && keyed * 2 >= rows;

    return meetsAll ? candidate : undefined;
}

/** A row, showing every part but the first one of `attribute`, unless that is its only part (§S8.3 step 5). */
function rowOf(
    variant: VariantView,
    allParts: readonly [string, ...string[]],
    attribute: string | undefined,
): VariantRow {
    const index = attribute === undefined ? -1 : variant.parts.findIndex((part) => part.attribute === attribute);
    const group = index === -1 ? undefined : allParts[index];
    const [first, ...rest] = allParts.filter((_, position) => position !== index);

    return {
        variant,
        allParts,
        shownParts: first === undefined ? allParts : [first, ...rest],
        group,
        calories: variant.caloriesPer100g,
    };
}

/** Calories, lowest first; a row with no figure after every row with one; then the visible text (§S8.3 step 4). */
function byCaloriesThenText(collator: Intl.Collator): (left: VariantRow, right: VariantRow) => number {
    return (left, right) => {
        if (left.calories !== right.calories) {
            if (left.calories === undefined) {
                return 1;
            }

            if (right.calories === undefined) {
                return -1;
            }

            return left.calories - right.calories;
        }

        return collator.compare(left.shownParts.join(' '), right.shownParts.join(' '));
    };
}

/**
 * Plan the dialog's list for a root's live variants (R26). Pure.
 *
 * @param variants - The root's live variants, as food sends them. A variant with no parts is not listed.
 * @param locale - The viewer's locale, for the collator.
 * @returns The short list, or the long list, grouped or flat.
 */
export function planVariantList(variants: readonly VariantView[], locale: string): VariantListPlan {
    const collator = collatorFor(locale);
    const order = byCaloriesThenText(collator);
    const named = variants.flatMap((variant) => {
        const allParts = partsOf(variant);

        return allParts === undefined ? [] : [{ variant, allParts }];
    });

    if (named.length < LONG_LIST_MIN_ROWS) {
        return {
            kind: 'short',
            rows: named.map(({ variant, allParts }) => rowOf(variant, allParts, undefined)).sort(order),
        };
    }

    const attribute = groupingAttribute(named.map(({ variant }) => variant));
    const rows = named.map(({ variant, allParts }) => rowOf(variant, allParts, attribute));
    const headless = rows.filter((row) => row.group === undefined).sort(order);
    const byKey = new Map<string, VariantRow[]>();

    for (const row of rows) {
        if (row.group !== undefined) {
            byKey.set(row.group, [...(byKey.get(row.group) ?? []), row]);
        }
    }

    const groups = [...byKey.entries()]
        .sort(([left], [right]) => collator.compare(left, right))
        .map(([key, members]) => ({ key, rows: members.sort(order) }));

    return { kind: 'long', attribute, headless, groups };
}

/** The words of a text: split on white space and hyphens, so `0-inch` is `0` and `inch` (§S8.5). */
function wordsOf(text: string): readonly string[] {
    return text
        .normalize('NFC')
        .split(/[\s-]+/u)
        .filter((word) => word !== '');
}

/** Whether `word` starts `target`, ignoring case and accents. */
function startsWith(collator: Intl.Collator, target: string, word: string): boolean {
    return target.length >= word.length && collator.compare(target.slice(0, word.length), word) === 0;
}

/**
 * Narrow a planned list to the rows a query matches (§S8.5). Pure.
 *
 * Every typed word must match the start of a word in one of the row's parts, the group's part included; word order
 * does not matter. Rows are hidden, never regrouped: a group with no match disappears with its header, and the
 * order of the full list stays.
 *
 * @param plan - The full list, planned once.
 * @param query - The search text.
 * @param locale - The viewer's locale, for the collator.
 * @returns `plan` itself for a blank query; otherwise the same shape with only matching rows.
 */
export function filterVariantList(plan: LongVariantListPlan, query: string, locale: string): LongVariantListPlan;
export function filterVariantList(plan: VariantListPlan, query: string, locale: string): VariantListPlan;

export function filterVariantList(plan: VariantListPlan, query: string, locale: string): VariantListPlan {
    const queryWords = wordsOf(query);

    if (queryWords.length === 0) {
        return plan;
    }

    const collator = collatorFor(locale);

    const matches = (row: VariantRow): boolean => {
        const rowWords = row.allParts.flatMap(wordsOf);

        return queryWords.every((word) => rowWords.some((target) => startsWith(collator, target, word)));
    };

    if (plan.kind === 'short') {
        return { kind: 'short', rows: plan.rows.filter(matches) };
    }

    return {
        ...plan,
        headless: plan.headless.filter(matches),
        groups: plan.groups.flatMap((group) => {
            const rows = group.rows.filter(matches);

            return rows.length === 0 ? [] : [{ key: group.key, rows }];
        }),
    };
}

/**
 * Every row of a plan, in display order. Pure.
 *
 * @param plan - A planned or filtered list.
 * @returns The rows: the short list, or the headless rows and then each group's.
 */
export function rowsOfPlan(plan: VariantListPlan): readonly VariantRow[] {
    return plan.kind === 'short' ? plan.rows : [...plan.headless, ...plan.groups.flatMap((group) => group.rows)];
}
