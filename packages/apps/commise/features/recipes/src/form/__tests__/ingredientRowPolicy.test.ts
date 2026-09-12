/**
 * Unit tests for `ingredientRowPolicy.ts` — the ONE rule for what an editor ingredient row shows in each state
 * (`docs/design/ingredientStatusExplanation.md` SPECIFY.1 and §3a's column table).
 *
 * ⛔ A FIXTURE TABLE, NOT A REVERT-AND-CHECK. Each SPECIFY.1 row is stated once with every field the policy
 * answers, so a rule that moves one row's answer fails exactly that row. The negatives the spec marks ⛔ are
 * stated a second time as properties over EVERY row, because a table row can be edited to agree with a broken
 * rule while a property over the whole table cannot.
 *
 * Two facts beyond the line (`RowFacts`) are stated the same way: `hasVariants`, which gates Add details
 * (`docs/design/ingredientSpecialization.md` §S7, `docs/design/rowEditorOpenDecisions.md` item 9), and `changing`, a
 * row in Change food (system change 5).
 */
import { describe, expect, it } from 'vitest';

import { FoodResolutionStatus, type UnresolvedFoodReasonCode } from '@kitchensink/recipe-core';

import {
    detailsEntryOf,
    rowPresentationOf,
    rowVariantParts,
    type IngredientRowAction,
    type IngredientRowPresentation,
    type RowFacts,
    type RowPolicyLine,
    type RowFigures,
} from '../ingredientRowPolicy.js';

interface Case {
    readonly row: string;
    readonly line: RowPolicyLine;
    readonly figures?: RowFigures;
    readonly facts?: Partial<RowFacts>;
    readonly expected: IngredientRowPresentation;
}

/** The facts a case states, with the rest unknown and the row out of Change food. */
const factsOf = (figures: RowFigures | undefined, over: Partial<RowFacts> = {}): RowFacts => ({
    figures,
    hasVariants: undefined,
    changing: false,
    ...over,
});

const named = (over: Partial<RowPolicyLine>): RowPolicyLine => ({
    ingredientId: 'ing_1',
    name: 'Kale',
    isUserEntered: false,
    ...over,
});

/** A variant binding: the line is variant-bound. */
const BRISKET_FLAT = { id: 'var_flat', parts: [{ attribute: 'cut', text: 'flat half' }] };

const direct = (action: IngredientRowAction) => ({ kind: 'direct', action }) as const;
const menu = (...actions: IngredientRowAction[]) => ({ kind: 'menu', actions }) as const;

const CASES: readonly Case[] = [
    {
        row: '1 freeform (declared, no status)',
        line: named({ isUserEntered: true }),
        expected: {
            nameMode: 'entry',
            standIn: false,
            glyph: 'info',
            panel: 'noData',
            slot2: menu('findFood', 'remove'),
            statusWord: 'statusFreeform',
            tone: 'neutral',
        },
    },
    {
        row: '1 freeform, as plan 002 reports a declaration (UNRESOLVED + author_declared)',
        line: named({
            isUserEntered: true,
            resolutionStatus: FoodResolutionStatus.UNRESOLVED,
            unresolvedReason: 'author_declared',
        }),
        expected: {
            nameMode: 'entry',
            standIn: false,
            glyph: 'info',
            panel: 'noData',
            slot2: menu('findFood', 'remove'),
            statusWord: 'statusFreeform',
            tone: 'neutral',
        },
    },
    {
        row: '2 no food chosen',
        line: named({ ingredientId: null }),
        expected: {
            nameMode: 'entry',
            standIn: false,
            glyph: 'alert',
            panel: 'twoPaths',
            slot2: menu('createOwnFood', 'remove'),
            statusWord: undefined,
            tone: 'caution',
        },
    },
    {
        row: '2 an EMPTY-string id is no food too (the predicate validateRecipeForm blocks on)',
        line: named({ ingredientId: '', resolutionStatus: FoodResolutionStatus.RESOLVED }),
        expected: {
            nameMode: 'entry',
            standIn: false,
            glyph: 'alert',
            panel: 'twoPaths',
            slot2: menu('createOwnFood', 'remove'),
            statusWord: undefined,
            tone: 'caution',
        },
    },
    {
        row: '3 RESOLVED, figures published',
        line: named({ resolutionStatus: FoodResolutionStatus.RESOLVED }),
        figures: 'published',
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'info',
            panel: 'nutrition',
            slot2: menu('changeFood', 'remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: '3 RESOLVED, figures not yet known — no create until we KNOW none are published',
        line: named({ resolutionStatus: FoodResolutionStatus.RESOLVED }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'info',
            panel: 'nutrition',
            slot2: menu('changeFood', 'remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: '4 RESOLVED, no figures published',
        line: named({ resolutionStatus: FoodResolutionStatus.RESOLVED }),
        figures: 'unpublished',
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'info',
            panel: 'nutrition',
            slot2: menu('changeFood', 'createOwnFood', 'remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: '5 PENDING',
        line: named({ resolutionStatus: FoodResolutionStatus.PENDING, unresolvedReason: 'awaiting_source' }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'info',
            panel: 'working',
            slot2: direct('remove'),
            statusWord: 'statusPending',
            tone: 'neutral',
        },
    },
    {
        row: '5 PENDING_VERIFICATION',
        line: named({ resolutionStatus: FoodResolutionStatus.PENDING_VERIFICATION }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'info',
            panel: 'working',
            slot2: direct('remove'),
            statusWord: 'statusPendingVerification',
            tone: 'neutral',
        },
    },
    {
        row: '6 UNRESOLVED',
        line: named({ resolutionStatus: FoodResolutionStatus.UNRESOLVED, unresolvedReason: 'several_candidates' }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'alert',
            panel: 'candidates',
            slot2: direct('remove'),
            statusWord: 'statusUnresolved',
            tone: 'neutral',
        },
    },
    {
        row: '7 AMBIGUOUS',
        line: named({ resolutionStatus: FoodResolutionStatus.AMBIGUOUS }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'alert',
            panel: 'shortlist',
            slot2: direct('remove'),
            statusWord: 'statusAmbiguous',
            tone: 'neutral',
        },
    },
    {
        row: '8 NEEDS_REVIEW',
        line: named({ resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'alert',
            panel: 'needsReview',
            slot2: menu('changeFood', 'remove'),
            statusWord: 'statusNeedsReview',
            tone: 'caution',
        },
    },
    {
        row: '9 NOT_FOUND (no_source_has_it)',
        line: named({ resolutionStatus: FoodResolutionStatus.NOT_FOUND, unresolvedReason: 'no_source_has_it' }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'alert',
            panel: 'notFound',
            slot2: menu('createOwnFood', 'changeFood', 'remove'),
            statusWord: 'statusNotFound',
            tone: 'neutral',
        },
    },
    {
        row: '9 NOT_FOUND (cascade_exhausted) behaves as no_source_has_it',
        line: named({ resolutionStatus: FoodResolutionStatus.NOT_FOUND, unresolvedReason: 'cascade_exhausted' }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'alert',
            panel: 'notFound',
            slot2: menu('createOwnFood', 'changeFood', 'remove'),
            statusWord: 'statusNotFound',
            tone: 'neutral',
        },
    },
    {
        row: '9 NOT_FOUND (phrase_unusable) offers no create — an unreadable phrase is not a substance to author',
        line: named({ resolutionStatus: FoodResolutionStatus.NOT_FOUND, unresolvedReason: 'phrase_unusable' }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'alert',
            panel: 'notFound',
            slot2: menu('changeFood', 'remove'),
            statusWord: 'statusNotFound',
            tone: 'neutral',
        },
    },
    {
        row: '10 FAILED (sources_errored)',
        line: named({ resolutionStatus: FoodResolutionStatus.FAILED, unresolvedReason: 'sources_errored' }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'alert',
            panel: 'failed',
            // V1 sign-off item 4: Try again is a PANEL action now, so slot 2 is Remove, direct.
            slot2: direct('remove'),
            statusWord: 'statusFailed',
            tone: 'neutral',
        },
    },
    {
        row: '10 FAILED (cascade_unavailable)',
        line: named({ resolutionStatus: FoodResolutionStatus.FAILED, unresolvedReason: 'cascade_unavailable' }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'alert',
            panel: 'failed',
            // V1 sign-off item 4: Try again is a PANEL action now, so slot 2 is Remove, direct.
            slot2: direct('remove'),
            statusWord: 'statusFailed',
            tone: 'neutral',
        },
    },
    {
        row: '11 RESOLVED_UNAVAILABLE, nameless',
        line: named({ name: undefined, resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE }),
        expected: {
            nameMode: 'record',
            standIn: true,
            glyph: 'info',
            panel: 'privateFood',
            slot2: direct('remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: '12 FOOD_REMOVED, named',
        line: named({ resolutionStatus: FoodResolutionStatus.FOOD_REMOVED }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'alert',
            panel: 'foodRemoved',
            slot2: menu('changeFood', 'createOwnFood', 'remove'),
            statusWord: 'statusFoodRemoved',
            tone: 'caution',
        },
    },
    {
        row: '12 FOOD_REMOVED, nameless — the stand-in takes the name’s place and there is no status word',
        line: named({ name: undefined, resolutionStatus: FoodResolutionStatus.FOOD_REMOVED }),
        expected: {
            nameMode: 'record',
            standIn: true,
            glyph: 'alert',
            panel: 'foodRemoved',
            slot2: menu('changeFood', 'createOwnFood', 'remove'),
            statusWord: undefined,
            tone: 'caution',
        },
    },
    {
        row: '13 FOOD_UNREACHABLE, nameless',
        line: named({ name: undefined, resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE }),
        expected: {
            nameMode: 'record',
            standIn: true,
            glyph: 'info',
            panel: 'foodUnreachable',
            slot2: direct('remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: 'a bound line the read said nothing about is treated as RESOLVED (the seed’s own default)',
        line: named({}),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'info',
            panel: 'nutrition',
            slot2: menu('changeFood', 'remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    // Curated U15, §S7: the details items join the menus of rows 3, 4 and 8, second after Change food.
    {
        row: '3 RESOLVED, root-bound, the root has live variants: Add details second',
        line: named({ resolutionStatus: FoodResolutionStatus.RESOLVED }),
        figures: 'published',
        facts: { hasVariants: true },
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'info',
            panel: 'nutrition',
            slot2: menu('changeFood', 'addDetails', 'remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: '4 RESOLVED, root-bound with live variants, no figures: Add details before Create my own food',
        line: named({ resolutionStatus: FoodResolutionStatus.RESOLVED }),
        figures: 'unpublished',
        facts: { hasVariants: true },
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'info',
            panel: 'nutrition',
            slot2: menu('changeFood', 'addDetails', 'createOwnFood', 'remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: '3 RESOLVED, root-bound, the root has no live variant: no Add details',
        line: named({ resolutionStatus: FoodResolutionStatus.RESOLVED }),
        figures: 'published',
        facts: { hasVariants: false },
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'info',
            panel: 'nutrition',
            slot2: menu('changeFood', 'remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: '3 RESOLVED, variant-bound: Edit details, whatever the read knows',
        line: named({ resolutionStatus: FoodResolutionStatus.RESOLVED, variant: BRISKET_FLAT }),
        figures: 'published',
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'info',
            panel: 'nutrition',
            slot2: menu('changeFood', 'editDetails', 'remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: '4 RESOLVED, variant-bound, no figures',
        line: named({ resolutionStatus: FoodResolutionStatus.RESOLVED, variant: BRISKET_FLAT }),
        figures: 'unpublished',
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'info',
            panel: 'nutrition',
            slot2: menu('changeFood', 'editDetails', 'createOwnFood', 'remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: '8 NEEDS_REVIEW, variant-bound: Edit details',
        line: named({ resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW, variant: BRISKET_FLAT }),
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'alert',
            panel: 'needsReview',
            slot2: menu('changeFood', 'editDetails', 'remove'),
            statusWord: 'statusNeedsReview',
            tone: 'caution',
        },
    },
    {
        // ⚠️ OWNER QUESTION O4 (`docs/design/rowEditorOpenDecisions.md`): plan U12 names no row exception; item 9's
        // default keeps Add details off row 8. If the owner keeps U12 as written, this row gains Add details.
        row: '8 NEEDS_REVIEW, root-bound with live variants: no Add details (item 9, O4 open)',
        line: named({ resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
        facts: { hasVariants: true },
        expected: {
            nameMode: 'record',
            standIn: false,
            glyph: 'alert',
            panel: 'needsReview',
            slot2: menu('changeFood', 'remove'),
            statusWord: 'statusNeedsReview',
            tone: 'caution',
        },
    },
    // System change 5: in Change food the name is an entry field, and Change food and the details items go.
    {
        row: '3 in Change food: the name is an entry field and slot 2 is Remove, direct',
        line: named({ resolutionStatus: FoodResolutionStatus.RESOLVED, variant: BRISKET_FLAT }),
        figures: 'published',
        facts: { hasVariants: true, changing: true },
        expected: {
            nameMode: 'entry',
            standIn: false,
            glyph: 'info',
            panel: 'nutrition',
            slot2: direct('remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: '4 in Change food keeps Create my own food',
        line: named({ resolutionStatus: FoodResolutionStatus.RESOLVED }),
        figures: 'unpublished',
        facts: { hasVariants: true, changing: true },
        expected: {
            nameMode: 'entry',
            standIn: false,
            glyph: 'info',
            panel: 'nutrition',
            slot2: menu('createOwnFood', 'remove'),
            statusWord: undefined,
            tone: 'neutral',
        },
    },
    {
        row: '6 UNRESOLVED after None of these: an entry field, the candidates glyph stays',
        line: named({ resolutionStatus: FoodResolutionStatus.UNRESOLVED }),
        facts: { changing: true },
        expected: {
            nameMode: 'entry',
            standIn: false,
            glyph: 'alert',
            panel: 'candidates',
            slot2: direct('remove'),
            statusWord: 'statusUnresolved',
            tone: 'neutral',
        },
    },
];

describe('rowPresentationOf — SPECIFY.1 × §3a, one row at a time', () => {
    it.each(CASES)('$row', ({ line, figures, facts, expected }) => {
        expect(rowPresentationOf(line, factsOf(figures, facts))).toEqual(expected);
    });
});

/** Every action a row may offer, flattened out of its slot. */
const actionsOf = (presentation: IngredientRowPresentation): readonly IngredientRowAction[] =>
    presentation.slot2.kind === 'direct' ? [presentation.slot2.action] : presentation.slot2.actions;

const EVERY_STATUS: readonly (FoodResolutionStatus | undefined)[] = [undefined, ...Object.values(FoodResolutionStatus)];
const EVERY_REASON: readonly (UnresolvedFoodReasonCode | undefined)[] = [
    undefined,
    'author_declared',
    'awaiting_source',
    'no_source_has_it',
    'sources_errored',
    'several_candidates',
    'cascade_exhausted',
    'cascade_unavailable',
    'phrase_unusable',
];
const EVERY_FIGURES: readonly (RowFigures | undefined)[] = [undefined, 'published', 'unpublished'];
const EVERY_HAS_VARIANTS: readonly (boolean | undefined)[] = [undefined, true, false];

/**
 * The whole input space the policy is total over: status × reason × declared × named × bound × variant × figures ×
 * hasVariants × changing.
 */
const EVERY_LINE = EVERY_STATUS.flatMap((resolutionStatus) =>
    EVERY_REASON.flatMap((unresolvedReason) =>
        [true, false].flatMap((isUserEntered) =>
            [true, false].flatMap((hasName) =>
                [true, false].flatMap((bound) =>
                    [true, false].flatMap((variantBound) =>
                        EVERY_FIGURES.flatMap((figures) =>
                            EVERY_HAS_VARIANTS.flatMap((hasVariants) =>
                                [true, false].map((changing) => ({
                                    facts: { figures, hasVariants, changing } satisfies RowFacts,
                                    line: {
                                        ingredientId: bound ? 'ing_1' : null,
                                        isUserEntered,
                                        ...(hasName ? { name: 'Kale' } : {}),
                                        ...(variantBound ? { variant: BRISKET_FLAT } : {}),
                                        ...(resolutionStatus === undefined ? {} : { resolutionStatus }),
                                        ...(unresolvedReason === undefined ? {} : { unresolvedReason }),
                                    } satisfies RowPolicyLine,
                                })),
                            ),
                        ),
                    ),
                ),
            ),
        ),
    ),
);

describe('rowPresentationOf — the ⛔ negatives, as properties over the WHOLE input space', () => {
    it('covers a non-trivial space (positive control for the properties below)', () => {
        expect(EVERY_LINE.length).toBeGreaterThan(1000);
    });

    it('FAILED never offers create — authoring on a transport failure splits one substance in two', () => {
        const failed = EVERY_LINE.filter(
            ({ line }) =>
                line.resolutionStatus === FoodResolutionStatus.FAILED &&
                !line.isUserEntered &&
                line.ingredientId !== null,
        );

        expect(failed.length).toBeGreaterThan(0);

        for (const { line, facts } of failed) {
            expect(actionsOf(rowPresentationOf(line, facts))).not.toContain('createOwnFood');
        }
    });

    it('rows 6 and 7 never offer Change food (the candidate list IS the resolution)', () => {
        const pickRows = EVERY_LINE.filter(
            ({ line }) =>
                (line.resolutionStatus === FoodResolutionStatus.UNRESOLVED ||
                    line.resolutionStatus === FoodResolutionStatus.AMBIGUOUS) &&
                !line.isUserEntered &&
                line.ingredientId !== null,
        );

        expect(pickRows.length).toBeGreaterThan(0);

        for (const { line, facts } of pickRows) {
            expect(actionsOf(rowPresentationOf(line, facts))).not.toContain('changeFood');
        }
    });

    it('RESOLVED_UNAVAILABLE and FOOD_UNREACHABLE show Remove directly, and offer neither create nor Change food', () => {
        const quiet = EVERY_LINE.filter(
            ({ line }) =>
                (line.resolutionStatus === FoodResolutionStatus.RESOLVED_UNAVAILABLE ||
                    line.resolutionStatus === FoodResolutionStatus.FOOD_UNREACHABLE) &&
                !line.isUserEntered &&
                line.ingredientId !== null,
        );

        expect(quiet.length).toBeGreaterThan(0);

        for (const { line, facts } of quiet) {
            expect(rowPresentationOf(line, facts).slot2).toEqual({ kind: 'direct', action: 'remove' });
        }
    });

    it('a menu always holds at least two actions, and a single action is always direct (§3a)', () => {
        for (const { line, facts } of EVERY_LINE) {
            const { slot2 } = rowPresentationOf(line, facts);

            if (slot2.kind === 'menu') {
                expect(slot2.actions.length).toBeGreaterThanOrEqual(2);
            }
        }
    });

    it('every row can be removed, Remove is LAST, and no action appears twice', () => {
        for (const { line, facts } of EVERY_LINE) {
            const actions = actionsOf(rowPresentationOf(line, facts));

            expect(actions.at(-1)).toBe('remove');
            expect(new Set(actions).size).toBe(actions.length);
        }
    });

    it('a stand-in row never carries a status word (namelessLineCopy §2c)', () => {
        for (const { line, facts } of EVERY_LINE) {
            const presentation = rowPresentationOf(line, facts);

            if (presentation.standIn) {
                expect(presentation.statusWord).toBeUndefined();
            }
        }
    });

    it('caution is reserved for NEEDS_REVIEW, FOOD_REMOVED and the no-food line (namelessLineCopy §2c)', () => {
        for (const { line, facts } of EVERY_LINE) {
            const loud =
                line.ingredientId === null ||
                (!line.isUserEntered &&
                    (line.resolutionStatus === FoodResolutionStatus.NEEDS_REVIEW ||
                        line.resolutionStatus === FoodResolutionStatus.FOOD_REMOVED));

            expect(rowPresentationOf(line, facts).tone).toBe(loud ? 'caution' : 'neutral');
        }
    });

    it('⛔ the tone is NOT the glyph: some alert rows are calm (positive control for the rule above)', () => {
        const failed = rowPresentationOf(
            {
                ingredientId: 'ing_1',
                isUserEntered: false,
                name: 'Kale',
                resolutionStatus: FoodResolutionStatus.FAILED,
            },
            factsOf(undefined),
        );

        expect(failed.glyph).toBe('alert');
        expect(failed.tone).toBe('neutral');
    });

    it('a declared line is row 1 whatever status accompanies it — a declaration never settles into a food', () => {
        for (const { line, facts } of EVERY_LINE.filter(({ line: l }) => l.isUserEntered && l.ingredientId !== null)) {
            expect(rowPresentationOf(line, facts).panel).toBe('noData');
        }
    });

    it('a line with no food is row 2 whatever else it carries', () => {
        for (const { line, facts } of EVERY_LINE.filter(({ line: l }) => l.ingredientId === null)) {
            expect(rowPresentationOf(line, facts).panel).toBe('twoPaths');
        }
    });

    it('offers Add details only on a root-bound RESOLVED row whose root is KNOWN to have a live variant (§S7, item 9)', () => {
        let offered = 0;

        for (const { line, facts } of EVERY_LINE) {
            const named = !line.isUserEntered && line.ingredientId !== null;
            const eligible =
                named &&
                line.variant === undefined &&
                (line.resolutionStatus ?? FoodResolutionStatus.RESOLVED) === FoodResolutionStatus.RESOLVED &&
                facts.hasVariants === true &&
                !facts.changing;
            const has = actionsOf(rowPresentationOf(line, facts)).includes('addDetails');

            expect(has).toBe(eligible);
            offered += has ? 1 : 0;
        }

        expect(offered).toBeGreaterThan(0);
    });

    it('offers Edit details on every variant-bound row that names its food (rows 3, 4, 8), whatever the read knows', () => {
        let offered = 0;

        for (const { line, facts } of EVERY_LINE) {
            const status = line.resolutionStatus ?? FoodResolutionStatus.RESOLVED;
            const eligible =
                !line.isUserEntered &&
                line.ingredientId !== null &&
                line.variant !== undefined &&
                (status === FoodResolutionStatus.RESOLVED || status === FoodResolutionStatus.NEEDS_REVIEW) &&
                !facts.changing;
            const has = actionsOf(rowPresentationOf(line, facts)).includes('editDetails');

            expect(has).toBe(eligible);
            offered += has ? 1 : 0;
        }

        expect(offered).toBeGreaterThan(0);
    });

    it('a details item, when offered, comes straight after Change food', () => {
        for (const { line, facts } of EVERY_LINE) {
            const actions = actionsOf(rowPresentationOf(line, facts));
            const details = actions.findIndex((action) => action === 'addDetails' || action === 'editDetails');

            if (details !== -1) {
                expect(actions[details - 1]).toBe('changeFood');
            }
        }
    });

    it('in Change food a row offers neither Change food nor a details item, and its name is an entry field', () => {
        const changing = EVERY_LINE.filter(({ facts }) => facts.changing);

        expect(changing.length).toBeGreaterThan(0);

        for (const { line, facts } of changing) {
            const presentation = rowPresentationOf(line, facts);

            expect(presentation.nameMode).toBe('entry');
            expect(actionsOf(presentation)).not.toContain('changeFood');
            expect(actionsOf(presentation)).not.toContain('addDetails');
            expect(actionsOf(presentation)).not.toContain('editDetails');
        }
    });

    it('Change food changes nothing about slot 1, the status word or the tone: the line holds its food until a pick', () => {
        for (const { line, facts } of EVERY_LINE.filter(({ facts: f }) => f.changing)) {
            const entry = rowPresentationOf(line, facts);
            const record = rowPresentationOf(line, { ...facts, changing: false });

            expect({ glyph: entry.glyph, panel: entry.panel, word: entry.statusWord, tone: entry.tone }).toEqual({
                glyph: record.glyph,
                panel: record.panel,
                word: record.statusWord,
                tone: record.tone,
            });
        }
    });
});

/**
 * Curated U15, `docs/design/ingredientSpecialization.md` §S1: a variant-bound line shows its dotted line under the
 * name, and only on the rows where the line names its food (`RESOLVED`, `NEEDS_REVIEW`; rows 3, 4 and 8). The parts
 * come from the line's own binding, so a retired variant still shows them (R29).
 */
describe('rowVariantParts — which rows show the dotted line', () => {
    const FLAT = {
        id: 'var_flat',
        parts: [
            { attribute: 'cut', text: 'flat half' },
            { attribute: 'grade', text: 'choice' },
        ],
    };

    it.each([
        { status: undefined, shows: true },
        { status: FoodResolutionStatus.RESOLVED, shows: true },
        { status: FoodResolutionStatus.NEEDS_REVIEW, shows: true },
        { status: FoodResolutionStatus.PENDING, shows: false },
        { status: FoodResolutionStatus.AMBIGUOUS, shows: false },
        { status: FoodResolutionStatus.FOOD_REMOVED, shows: false },
        { status: FoodResolutionStatus.FOOD_UNREACHABLE, shows: false },
        { status: FoodResolutionStatus.FAILED, shows: false },
    ])('a variant-bound line in $status → shows: $shows', ({ status, shows }) => {
        const line = named({ variant: FLAT, ...(status === undefined ? {} : { resolutionStatus: status }) });

        expect(rowVariantParts(line)).toEqual(shows ? ['flat half', 'choice'] : undefined);
    });

    it('a root-bound line shows the name only (R28)', () => {
        expect(rowVariantParts(named({ resolutionStatus: FoodResolutionStatus.RESOLVED }))).toBeUndefined();
    });

    it('a declared line or a line with no food shows none, whatever it carries', () => {
        expect(rowVariantParts(named({ variant: FLAT, isUserEntered: true }))).toBeUndefined();
        expect(rowVariantParts(named({ variant: FLAT, ingredientId: null }))).toBeUndefined();
    });
});

describe('detailsEntryOf (the mode the details dialog opens in, §S7)', () => {
    const variant = { id: 'var_point', parts: [{ attribute: 'cut', text: 'point half' }] };

    it('Add details opens in add mode', () => {
        expect(detailsEntryOf('addDetails', variant)).toEqual({ mode: 'add' });
    });

    it('Edit details opens on the line’s current variant', () => {
        expect(detailsEntryOf('editDetails', variant)).toEqual({ mode: 'edit', current: variant });
    });

    it('Edit details on a line with no variant falls back to add', () => {
        expect(detailsEntryOf('editDetails', undefined)).toEqual({ mode: 'add' });
    });
});
