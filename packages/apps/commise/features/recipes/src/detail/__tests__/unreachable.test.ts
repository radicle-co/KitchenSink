/**
 * The pure half of the FOOD_UNREACHABLE notice (plan 002 R2, R36; `docs/design/namelessLineCopy.md` §3c): which
 * lines food could not be asked about on this read, and the one sentence the recipe shows about them.
 *
 * ⛔ One notice per recipe, never one per line: the gateway asks food about every line in one batch, so one failure
 * usually hits several lines, and a retry button per line would all retry the same read.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import {
    detailNoticeState,
    isLineUnreachable,
    isUnreachableRecovery,
    unreachableLineCount,
    unreachableNotice,
} from '../model.js';
import { recipeMessages } from '../../messages.js';

const en = recipeMessages.en.detail;

const unreachable = (id: string) =>
    makeIngredientView({ ingredientId: id, name: undefined, resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE });

describe('isLineUnreachable', () => {
    it('is true only for FOOD_UNREACHABLE — never for the removed or private lines it must not be confused with', () => {
        for (const status of Object.values(FoodResolutionStatus)) {
            expect(isLineUnreachable(makeIngredientView({ resolutionStatus: status })), status).toBe(
                status === FoodResolutionStatus.FOOD_UNREACHABLE,
            );
        }

        expect(isLineUnreachable(makeIngredientView())).toBe(false);
    });
});

describe('unreachableLineCount', () => {
    it('counts only the unreachable lines', () => {
        expect(
            unreachableLineCount([
                unreachable('a'),
                makeIngredientView({ ingredientId: 'b', resolutionStatus: FoodResolutionStatus.FOOD_REMOVED }),
                unreachable('c'),
            ]),
        ).toBe(2);
    });
});

describe('unreachableNotice', () => {
    it('renders nothing when food answered for every line', () => {
        expect(unreachableNotice([makeIngredientView({ ingredientId: 'a' })], en)).toBeUndefined();
        expect(unreachableNotice([], en)).toBeUndefined();
    });

    it('uses the singular sentence for one line', () => {
        expect(unreachableNotice([unreachable('a'), makeIngredientView({ ingredientId: 'b' })], en)).toBe(
            en.unreachableNoticeOne,
        );
    });

    it('counts two or more', () => {
        const notice = unreachableNotice([unreachable('a'), unreachable('b'), unreachable('c')], en);

        expect(notice).toContain('3');
        expect(notice).not.toBe(en.unreachableNoticeOne);
    });

    it('⛔ reassures, and states no cause: a request with no credential reaches this state too', () => {
        for (const copy of [en.unreachableNoticeOne, en.unreachableNoticeMany]) {
            expect(copy).toMatch(/hasn’t changed/);
            expect(copy).not.toMatch(/removed|missing|deleted|server|outage/i);
        }
    });
});

describe('isUnreachableRecovery', () => {
    it('is true only for a recipe whose every line food answered for — the test a retry must pass to move focus', () => {
        expect(isUnreachableRecovery(makeRecipeDetail({ ingredients: [makeIngredientView()] }))).toBe(true);
        expect(isUnreachableRecovery(makeRecipeDetail({ ingredients: [unreachable('a'), makeIngredientView()] }))).toBe(
            false,
        );
    });

    it('is false when the retry settled with no recipe', () => {
        expect(isUnreachableRecovery(undefined)).toBe(false);
    });
});

describe('detailNoticeState — one Try again for one cause, and a recovery said only when it happened', () => {
    const lines = { none: [makeIngredientView({ ingredientId: 'a' })], some: [unreachable('a')] };
    const page = (failed: boolean) => ({ failed, refreshing: false, recoveries: 0, onRetry: () => undefined });
    const retry = (recoveries: number) => ({ refreshing: false, recoveries, onRetry: () => undefined });

    it('lets the page-level notice show its failure when every line is named', () => {
        expect(detailNoticeState(lines.none, en, page(true), retry(0))).toMatchObject({
            unreachable: undefined,
            pageRefreshFailed: true,
        });
    });

    it('⛔ makes the page-level notice yield while a line is unreachable, so only the lines’ Try again shows', () => {
        expect(detailNoticeState(lines.some, en, page(true), retry(0))).toMatchObject({
            unreachable: en.unreachableNoticeOne,
            pageRefreshFailed: false,
        });
    });

    it('shows no page-level failure when the page did not fail, or has no notice at all', () => {
        expect(detailNoticeState(lines.none, en, page(false), retry(0)).pageRefreshFailed).toBe(false);
        expect(detailNoticeState(lines.none, en, undefined, retry(0)).pageRefreshFailed).toBe(false);
    });

    it('says the lines recovered only after a counted recovery with no line still unreachable', () => {
        expect(detailNoticeState(lines.none, en, undefined, retry(1)).saysRecovered).toBe(true);
        expect(detailNoticeState(lines.some, en, undefined, retry(1)).saysRecovered).toBe(false);
        expect(detailNoticeState(lines.none, en, undefined, retry(0)).saysRecovered).toBe(false);
    });
});
