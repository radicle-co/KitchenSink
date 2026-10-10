/**
 * The details dialog's list plan (curated plan U14, R26; `docs/design/ingredientSpecialization.md` §S8.3 and §S8.5).
 *
 * Each grouping clause is tested at its boundary value and one past it, on synthetic rows. The six roots §S8.3 names
 * are tested on their real seed rows (`__fixtures__/seedVariants.ts`).
 */
import type { VariantView } from '@kitchensink/food-service-client';
import { describe, expect, it } from 'vitest';

import {
    BEEF_BRISKET,
    BEEF_CHUCK_ROAST,
    BEEF_RIBEYE_STEAK,
    BONELESS_SKINLESS_CHICKEN_BREASTS,
    BONELESS_SKINLESS_CHICKEN_THIGHS,
    GROUND_BEEF,
} from '../__fixtures__/seedVariants.js';
import {
    LONG_LIST_MIN_ROWS,
    type VariantListPlan,
    filterVariantList,
    planVariantList,
    rowsOfPlan as rowsOf,
} from '../groupVariants.js';

const LOCALE = 'en';

let nextId = 0;

/** A variant from `[attribute, text]` pairs, with optional calories. */
function variant(calories: number | undefined, ...parts: readonly (readonly [string, string])[]): VariantView {
    nextId += 1;

    return {
        id: `V${String(nextId)}`,
        parts: parts.map(([attribute, text]) => ({ attribute, text })),
        ...(calories === undefined ? {} : { caloriesPer100g: calories }),
    };
}

/** `count` variants with no part in common but a distinct `grade`, so nothing groups. */
function ungroupable(count: number): VariantView[] {
    return Array.from({ length: count }, (_, index) => variant(100 + index, ['grade', `grade ${String(index)}`]));
}

/** The groups of a long plan as `[key, size]`. */
function groupSizes(plan: VariantListPlan): readonly (readonly [string, number])[] {
    return plan.kind === 'long' ? plan.groups.map((group) => [group.key, group.rows.length] as const) : [];
}

describe('planVariantList — which list', () => {
    it('gives no list for a root with no live variants', () => {
        expect(planVariantList([], LOCALE)).toEqual({ kind: 'short', rows: [] });
    });

    it(`gives the short list below ${String(LONG_LIST_MIN_ROWS)} rows and the long list at it`, () => {
        expect(LONG_LIST_MIN_ROWS).toBe(8);
        expect(planVariantList(ungroupable(7), LOCALE).kind).toBe('short');
        expect(planVariantList(ungroupable(8), LOCALE).kind).toBe('long');
    });

    it('lists every row of the short list, ungrouped, even when its rows would group', () => {
        const rows = [
            variant(10, ['cut', 'flat'], ['grade', 'select']),
            variant(20, ['cut', 'flat'], ['grade', 'choice']),
            variant(30, ['cut', 'point'], ['grade', 'select']),
            variant(40, ['cut', 'point'], ['grade', 'choice']),
        ];
        const plan = planVariantList(rows, LOCALE);

        expect(plan.kind).toBe('short');
        expect(rowsOf(plan).map((row) => row.shownParts)).toEqual([
            ['flat', 'select'],
            ['flat', 'choice'],
            ['point', 'select'],
            ['point', 'choice'],
        ]);
    });

    it('drops a variant with no parts, because no row can name it (R25)', () => {
        const plan = planVariantList([variant(10), variant(20, ['cut', 'flat'])], LOCALE);

        expect(rowsOf(plan).map((row) => row.allParts)).toEqual([['flat']]);
    });
});

describe('planVariantList — the grouping rule (§S8.3)', () => {
    it('groups by the first attribute in contract order whose key differs', () => {
        const rows = [
            ...Array.from({ length: 4 }, (_, index) => variant(index, ['cut', 'flat'], ['grade', `g${String(index)}`])),
            ...Array.from({ length: 4 }, (_, index) =>
                variant(index, ['cut', 'point'], ['grade', `h${String(index)}`]),
            ),
        ];
        const plan = planVariantList(rows, LOCALE);

        expect(plan.kind === 'long' && plan.attribute).toBe('cut');
        expect(groupSizes(plan)).toEqual([
            ['flat', 4],
            ['point', 4],
        ]);
    });

    it('skips an attribute every row shares, and takes the next one that differs', () => {
        const rows = [
            ...Array.from({ length: 4 }, (_, index) => variant(index, ['cut', 'flat'], ['fat', 'lean only'])),
            ...Array.from({ length: 4 }, (_, index) => variant(index, ['cut', 'flat'], ['fat', 'lean and fat'])),
        ];
        const plan = planVariantList(rows, LOCALE);

        expect(plan.kind === 'long' && plan.attribute).toBe('fat');
    });

    it('never walks an attribute outside the contract order, so it is never a candidate', () => {
        const rows = [
            ...Array.from({ length: 4 }, (_, index) => variant(index, ['futureThing', 'a'], ['grade', 'x'])),
            ...Array.from({ length: 4 }, (_, index) => variant(index, ['futureThing', 'b'], ['grade', 'y'])),
        ];
        const plan = planVariantList(rows, LOCALE);

        expect(plan.kind === 'long' && plan.attribute).toBe('grade');
    });

    it('keys a row by its FIRST part of the attribute when it has two', () => {
        const rows = [
            ...Array.from({ length: 4 }, (_, index) =>
                variant(index, ['addedNutrients', 'protein-fortified'], ['addedNutrients', `v${String(index)}`]),
            ),
            ...Array.from({ length: 4 }, (_, index) =>
                variant(index, ['addedNutrients', 'plain'], ['addedNutrients', `w${String(index)}`]),
            ),
        ];
        const plan = planVariantList(rows, LOCALE);

        expect(groupSizes(plan)).toEqual([
            ['plain', 4],
            ['protein-fortified', 4],
        ]);
        // The second part of the same attribute stays on the row.
        expect(plan.kind === 'long' && plan.groups[0]?.rows[0]?.shownParts).toEqual(['w0']);
    });

    it('counts a missing part as a value, so a sparse attribute is the candidate', () => {
        const rows = [
            ...Array.from({ length: 3 }, (_, index) => variant(index, ['grade', `x${String(index)}`])),
            ...Array.from({ length: 3 }, (_, index) =>
                variant(index, ['pack', 'family pack'], ['grade', `y${String(index)}`]),
            ),
            ...Array.from({ length: 3 }, (_, index) =>
                variant(index, ['pack', 'single'], ['grade', `z${String(index)}`]),
            ),
        ];
        const plan = planVariantList(rows, LOCALE);

        expect(plan.kind === 'long' && plan.attribute).toBe('pack');
    });

    describe('condition 1: at least 2 keys', () => {
        it('groups with 2 keys', () => {
            const rows = [
                ...Array.from({ length: 4 }, (_, index) => variant(index, ['cut', 'a'], ['grade', `${String(index)}`])),
                ...Array.from({ length: 4 }, (_, index) => variant(index, ['cut', 'b'], ['grade', `${String(index)}`])),
            ];

            expect(groupSizes(planVariantList(rows, LOCALE))).toHaveLength(2);
        });

        it('stays flat with 1 key, even though every row carries it', () => {
            // `cut` differs only between "a" and none; the one key cannot make two groups.
            const rows = [
                ...Array.from({ length: 4 }, (_, index) => variant(index, ['cut', 'a'], ['grade', `${String(index)}`])),
                ...Array.from({ length: 4 }, (_, index) => variant(index, ['grade', `${String(index)}`])),
            ];
            const plan = planVariantList(rows, LOCALE);

            expect(plan.kind === 'long' && plan.attribute).toBeUndefined();
            expect(groupSizes(plan)).toEqual([]);
        });
    });

    describe('condition 2: no more keys than half the rows (a real half, not an integer one)', () => {
        /** `rows` rows spread over `keys` distinct cuts, every row keyed. */
        function spread(rows: number, keys: number): VariantView[] {
            return Array.from({ length: rows }, (_, index) =>
                variant(index, ['cut', `cut ${String(index % keys)}`], ['grade', `${String(index)}`]),
            );
        }

        it('groups 9 rows into 4 keys (4 ≤ 4.5)', () => {
            expect(groupSizes(planVariantList(spread(9, 4), LOCALE))).toHaveLength(4);
        });

        it('stays flat for 9 rows in 5 keys (5 > 4.5)', () => {
            expect(groupSizes(planVariantList(spread(9, 5), LOCALE))).toEqual([]);
        });

        it('groups 8 rows into 4 keys (exactly half)', () => {
            expect(groupSizes(planVariantList(spread(8, 4), LOCALE))).toHaveLength(4);
        });
    });

    describe('condition 3: at least half the rows carry the part (a real half)', () => {
        /** `rows` rows, the first `keyed` of them split over two cuts. */
        function keyedOf(rows: number, keyed: number): VariantView[] {
            return Array.from({ length: rows }, (_, index) =>
                index < keyed
                    ? variant(index, ['cut', index % 2 === 0 ? 'a' : 'b'], ['grade', `${String(index)}`])
                    : variant(index, ['grade', `${String(index)}`]),
            );
        }

        it('groups 9 rows when 5 carry the part (5 ≥ 4.5)', () => {
            const plan = planVariantList(keyedOf(9, 5), LOCALE);

            expect(plan.kind === 'long' && plan.headless).toHaveLength(4);
            expect(groupSizes(plan)).toEqual([
                ['a', 3],
                ['b', 2],
            ]);
        });

        it('stays flat for 9 rows when 4 carry the part (4 < 4.5)', () => {
            expect(groupSizes(planVariantList(keyedOf(9, 4), LOCALE))).toEqual([]);
        });
    });

    it('stays flat when the candidate fails, and never tries the next attribute (the literal reading)', () => {
        // `cut` is the candidate and fails condition 1. `grade` would pass every condition, and must not be used.
        const rows = [
            ...Array.from({ length: 4 }, (_, index) => variant(index, ['cut', 'a'], ['grade', index < 2 ? 'x' : 'y'])),
            ...Array.from({ length: 4 }, (_, index) => variant(index, ['grade', index < 2 ? 'x' : 'y'])),
        ];
        const plan = planVariantList(rows, LOCALE);

        expect(plan.kind).toBe('long');
        expect(plan.kind === 'long' && plan.attribute).toBeUndefined();
        expect(groupSizes(plan)).toEqual([]);
    });
});

describe('planVariantList — order and row text (§S8.3 steps 4 and 5)', () => {
    const grouped = [
        variant(300, ['cut', 'point'], ['grade', 'choice']),
        variant(100, ['cut', 'point'], ['grade', 'select']),
        variant(50, ['grade', 'prime']),
        variant(undefined, ['cut', 'Flat'], ['grade', 'select']),
        variant(200, ['cut', 'Flat'], ['grade', 'choice']),
        variant(200, ['cut', 'Flat'], ['grade', 'all grades']),
        variant(10, ['grade', 'utility']),
        variant(90, ['cut', 'point'], ['grade', 'standard']),
    ];

    it('puts rows without the part first, with no header, then the groups in collator order', () => {
        const plan = planVariantList(grouped, LOCALE);

        expect(plan.kind === 'long' && plan.headless.map((row) => row.shownParts)).toEqual([['utility'], ['prime']]);
        // `Flat` sorts before `point` with base sensitivity, whatever its case.
        expect(groupSizes(plan)).toEqual([
            ['Flat', 3],
            ['point', 3],
        ]);
    });

    it('orders each group by calories, lowest first; a row with no figure last; ties by visible text', () => {
        const plan = planVariantList(grouped, LOCALE);

        expect(plan.kind === 'long' && plan.groups.map((group) => group.rows.map((row) => row.shownParts))).toEqual([
            [['all grades'], ['choice'], ['select']],
            [['standard'], ['select'], ['choice']],
        ]);
        expect(plan.kind === 'long' && plan.groups[0]?.rows.map((row) => row.calories)).toEqual([200, 200, undefined]);
    });

    it('orders a flat list as one list, by the same rule', () => {
        const plan = planVariantList(
            [
                variant(undefined, ['grade', 'b']),
                variant(5, ['grade', 'z']),
                variant(undefined, ['grade', 'a']),
                variant(5, ['grade', 'y']),
            ],
            LOCALE,
        );

        expect(rowsOf(plan).map((row) => row.shownParts)).toEqual([['y'], ['z'], ['a'], ['b']]);
    });

    it('drops the group part from a grouped row, but keeps every part for the spoken name and search', () => {
        const plan = planVariantList(grouped, LOCALE);
        const first = plan.kind === 'long' ? plan.groups[1]?.rows[0] : undefined;

        expect(first?.shownParts).toEqual(['standard']);
        expect(first?.allParts).toEqual(['point', 'standard']);
        expect(first?.group).toBe('point');
    });

    it('shows the full parts when the group part is the row only part, so no row is blank', () => {
        const rows = [
            variant(1, ['cut', 'a']),
            ...Array.from({ length: 3 }, (_, index) => variant(index + 2, ['cut', 'a'], ['grade', `${String(index)}`])),
            ...Array.from({ length: 4 }, (_, index) => variant(index + 2, ['cut', 'b'], ['grade', `${String(index)}`])),
        ];
        const plan = planVariantList(rows, LOCALE);

        expect(plan.kind === 'long' && plan.groups[0]?.rows[0]?.shownParts).toEqual(['a']);
    });

    it('keeps the wire variant on each row, so a pick carries its id', () => {
        const plan = planVariantList(BONELESS_SKINLESS_CHICKEN_THIGHS, LOCALE);

        expect(new Set(rowsOf(plan).map((row) => row.variant.id))).toEqual(
            new Set(BONELESS_SKINLESS_CHICKEN_THIGHS.map((entry) => entry.id)),
        );
    });
});

describe('planVariantList — the committed seed fixtures (§S8.3 table)', () => {
    it('boneless skinless chicken thighs: 7 rows, the short list in calorie order', () => {
        const plan = planVariantList(BONELESS_SKINLESS_CHICKEN_THIGHS, LOCALE);

        expect(plan.kind).toBe('short');
        expect(rowsOf(plan).map((row) => row.calories)).toEqual([110, 164, 164, 176, 179, 195, 218]);
    });

    it('boneless skinless chicken breasts: 8 rows, the long list, flat (1 key)', () => {
        const plan = planVariantList(BONELESS_SKINLESS_CHICKEN_BREASTS, LOCALE);

        expect(plan.kind).toBe('long');
        expect(groupSizes(plan)).toEqual([]);
        expect(rowsOf(plan)).toHaveLength(8);
    });

    it('beef brisket (AE8): grouped by cut, never by a later attribute', () => {
        const plan = planVariantList(BEEF_BRISKET, LOCALE);

        expect(plan.kind === 'long' && plan.attribute).toBe('cut');
        expect(plan.kind === 'long' && plan.headless).toEqual([]);
        expect(groupSizes(plan)).toEqual([
            ['flat half', 23],
            ['navel end', 4],
            ['point end', 4],
            ['point half', 4],
            ['whole', 5],
        ]);
    });

    it('beef brisket (AE8): Flat half opens with lean only · 0-inch trim · select, 124 cal', () => {
        const plan = planVariantList(BEEF_BRISKET, LOCALE);
        const first = plan.kind === 'long' ? plan.groups[0]?.rows[0] : undefined;

        expect(first?.shownParts).toEqual(['lean only', '0-inch trim', 'select']);
        expect(first?.calories).toBe(124);
    });

    it('ground beef: 8 rows with no header, then four formOrVariety groups', () => {
        const plan = planVariantList(GROUND_BEEF, LOCALE);

        expect(plan.kind === 'long' && plan.attribute).toBe('formOrVariety');
        expect(plan.kind === 'long' && plan.headless).toHaveLength(8);
        expect(groupSizes(plan).map(([, size]) => size)).toEqual([8, 2, 8, 16]);
    });

    it('beef chuck roast: grouped by cut over 11 keys, with 1 row that has no header', () => {
        const plan = planVariantList(BEEF_CHUCK_ROAST, LOCALE);

        expect(plan.kind === 'long' && plan.attribute).toBe('cut');
        expect(plan.kind === 'long' && plan.headless).toHaveLength(1);
        expect(groupSizes(plan)).toHaveLength(11);
    });

    it('beef ribeye steak: flat, because only 16 of 75 rows carry the cut (E2)', () => {
        const plan = planVariantList(BEEF_RIBEYE_STEAK, LOCALE);

        expect(plan.kind === 'long' && plan.attribute).toBeUndefined();
        expect(rowsOf(plan)).toHaveLength(75);
    });
});

describe('filterVariantList — search (§S8.5)', () => {
    const plan = planVariantList(BEEF_BRISKET, LOCALE);

    it('keeps everything for an empty or blank query', () => {
        expect(filterVariantList(plan, '   ', LOCALE)).toBe(plan);
    });

    it('matches every word against the start of a word in some part, the group part included', () => {
        const filtered = filterVariantList(plan, 'only point', LOCALE);

        expect(rowsOf(filtered).map((row) => row.allParts.slice(0, 2))).toEqual([
            ['point end', 'lean only'],
            ['point end', 'lean only'],
            ['point half', 'lean only'],
        ]);
    });

    it('ignores case, accents and word order', () => {
        const accented = planVariantList([variant(1, ['formOrVariety', 'Crème fraîche']), ...ungroupable(8)], LOCALE);

        expect(rowsOf(filterVariantList(accented, 'FRAICHE creme', LOCALE)).map((row) => row.allParts)).toEqual([
            ['Crème fraîche'],
        ]);
    });

    it('does not match inside a word', () => {
        expect(rowsOf(filterVariantList(plan, 'oint', LOCALE))).toEqual([]);
    });

    it('matches either side of a hyphen, and the hyphenated token itself', () => {
        expect(rowsOf(filterVariantList(plan, 'inch', LOCALE)).length).toBeGreaterThan(0);
        expect(rowsOf(filterVariantList(plan, '0-inch', LOCALE)).length).toBeGreaterThan(0);
    });

    it('hides rows and never regroups; a group with no match disappears with its header', () => {
        const filtered = filterVariantList(plan, 'navel', LOCALE);

        expect(filtered.kind === 'long' && filtered.attribute).toBe('cut');
        expect(groupSizes(filtered)).toEqual([['navel end', 4]]);
    });

    it('keeps the full list order among the rows it keeps', () => {
        const filtered = filterVariantList(plan, 'select', LOCALE);
        const order = rowsOf(plan).map((row) => row.variant.id);
        const kept = rowsOf(filtered).map((row) => row.variant.id);

        expect(kept).toEqual(order.filter((id) => kept.includes(id)));
    });
});
