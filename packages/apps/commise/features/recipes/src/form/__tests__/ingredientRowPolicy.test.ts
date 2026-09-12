/**
 * Unit tests for `ingredientRowPolicy.ts` — the ONE rule for what an editor ingredient row shows in each state
 * (`docs/design/ingredientStatusExplanation.md` SPECIFY.1 and §3a's column table).
 *
 * ⛔ A FIXTURE TABLE, NOT A REVERT-AND-CHECK. Each SPECIFY.1 row is stated once with every field the policy
 * answers, so a rule that moves one row's answer fails exactly that row. The negatives the spec marks ⛔ are
 * stated a second time as properties over EVERY row, because a table row can be edited to agree with a broken
 * rule while a property over the whole table cannot.
 */
import { describe, expect, it } from 'vitest';

import { FoodResolutionStatus, type UnresolvedFoodReasonCode } from '@kitchensink/recipe-core';

import {
    rowPresentationOf,
    type IngredientRowAction,
    type IngredientRowPresentation,
    type RowPolicyLine,
    type RowFigures,
} from '../ingredientRowPolicy.js';

interface Case {
    readonly row: string;
    readonly line: RowPolicyLine;
    readonly figures?: RowFigures;
    readonly expected: IngredientRowPresentation;
}

const named = (over: Partial<RowPolicyLine>): RowPolicyLine => ({
    ingredientId: 'ing_1',
    name: 'Kale',
    isUserEntered: false,
    ...over,
});

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
];

describe('rowPresentationOf — SPECIFY.1 × §3a, one row at a time', () => {
    it.each(CASES)('$row', ({ line, figures, expected }) => {
        expect(rowPresentationOf(line, figures)).toEqual(expected);
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

/** The whole input space the policy is total over: status × reason × declared × named × bound × figures. */
const EVERY_LINE = EVERY_STATUS.flatMap((resolutionStatus) =>
    EVERY_REASON.flatMap((unresolvedReason) =>
        [true, false].flatMap((isUserEntered) =>
            [true, false].flatMap((hasName) =>
                [true, false].flatMap((bound) =>
                    EVERY_FIGURES.map((figures) => ({
                        figures,
                        line: {
                            ingredientId: bound ? 'ing_1' : null,
                            isUserEntered,
                            ...(hasName ? { name: 'Kale' } : {}),
                            ...(resolutionStatus === undefined ? {} : { resolutionStatus }),
                            ...(unresolvedReason === undefined ? {} : { unresolvedReason }),
                        } satisfies RowPolicyLine,
                    })),
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

        for (const { line, figures } of failed) {
            expect(actionsOf(rowPresentationOf(line, figures))).not.toContain('createOwnFood');
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

        for (const { line, figures } of pickRows) {
            expect(actionsOf(rowPresentationOf(line, figures))).not.toContain('changeFood');
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

        for (const { line, figures } of quiet) {
            expect(rowPresentationOf(line, figures).slot2).toEqual({ kind: 'direct', action: 'remove' });
        }
    });

    it('a menu always holds at least two actions, and a single action is always direct (§3a)', () => {
        for (const { line, figures } of EVERY_LINE) {
            const { slot2 } = rowPresentationOf(line, figures);

            if (slot2.kind === 'menu') {
                expect(slot2.actions.length).toBeGreaterThanOrEqual(2);
            }
        }
    });

    it('every row can be removed, Remove is LAST, and no action appears twice', () => {
        for (const { line, figures } of EVERY_LINE) {
            const actions = actionsOf(rowPresentationOf(line, figures));

            expect(actions.at(-1)).toBe('remove');
            expect(new Set(actions).size).toBe(actions.length);
        }
    });

    it('a stand-in row never carries a status word (namelessLineCopy §2c)', () => {
        for (const { line, figures } of EVERY_LINE) {
            const presentation = rowPresentationOf(line, figures);

            if (presentation.standIn) {
                expect(presentation.statusWord).toBeUndefined();
            }
        }
    });

    it('caution is reserved for NEEDS_REVIEW, FOOD_REMOVED and the no-food line (namelessLineCopy §2c)', () => {
        for (const { line, figures } of EVERY_LINE) {
            const loud =
                line.ingredientId === null ||
                (!line.isUserEntered &&
                    (line.resolutionStatus === FoodResolutionStatus.NEEDS_REVIEW ||
                        line.resolutionStatus === FoodResolutionStatus.FOOD_REMOVED));

            expect(rowPresentationOf(line, figures).tone).toBe(loud ? 'caution' : 'neutral');
        }
    });

    it('⛔ the tone is NOT the glyph: some alert rows are calm (positive control for the rule above)', () => {
        const failed = rowPresentationOf({
            ingredientId: 'ing_1',
            isUserEntered: false,
            name: 'Kale',
            resolutionStatus: FoodResolutionStatus.FAILED,
        });

        expect(failed.glyph).toBe('alert');
        expect(failed.tone).toBe('neutral');
    });

    it('a declared line is row 1 whatever status accompanies it — a declaration never settles into a food', () => {
        for (const { line, figures } of EVERY_LINE.filter(
            ({ line: l }) => l.isUserEntered && l.ingredientId !== null,
        )) {
            expect(rowPresentationOf(line, figures).panel).toBe('noData');
        }
    });

    it('a line with no food is row 2 whatever else it carries', () => {
        for (const { line, figures } of EVERY_LINE.filter(({ line: l }) => l.ingredientId === null)) {
            expect(rowPresentationOf(line, figures).panel).toBe('twoPaths');
        }
    });
});
