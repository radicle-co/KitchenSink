/**
 * `foodNutritionAnswer` — the batch food nutrition read's answer, one entry per distinct ref (plan 002 U9, R31).
 *
 * Food decides what the caller may read. This service's binding data decides concealment, which is applied LAST
 * (R49): a root bound privately to ANOTHER user answers exactly what an unknown id answers in the same read (R46,
 * R50) — `absent` if food answered that id's request, `unavailable` if it did not — even when food returned numbers.
 */
import { describe, expect, it } from 'vitest';

import type { FoodNutritionEntry, FoodNutritionLookup } from '../../foodNutrition.gateway.js';
import { foodNutritionAnswer } from '../foodNutritionAnswer.js';

const CALLER = 'user-caller';
const STRANGER = 'user-stranger';

const CHICKEN: FoodNutritionEntry = {
    freshness: 'fresh',
    status: 'RESOLVED',
    caloriesPer100g: 165,
    proteinGPer100g: 31,
    portions: [{ unit: 'cup', gramsPerUnit: 140 }],
};

/** What food told the read: `found` ids with figures, and the ids food never answered. */
function reading(
    found: Readonly<Record<string, FoodNutritionEntry>>,
    unanswered: readonly string[] = [],
): Pick<FoodNutritionLookup, 'byFoodId' | 'unansweredIds'> {
    return { byFoodId: new Map(Object.entries(found)), unansweredIds: new Set(unanswered) };
}

const root = (id: string) => ({ kind: 'root', id }) as const;
const variant = (id: string) => ({ kind: 'variant', id }) as const;

describe('foodNutritionAnswer', () => {
    it('answers a food food returned as found, with its figures and freshness and no status', () => {
        expect(foodNutritionAnswer([root('f1')], CALLER, new Map(), reading({ f1: CHICKEN }))).toStrictEqual([
            {
                outcome: 'found',
                ref: root('f1'),
                freshness: 'fresh',
                caloriesPer100g: 165,
                proteinGPer100g: 31,
                portions: [{ unit: 'cup', gramsPerUnit: 140 }],
            },
        ]);
    });

    it('keeps a missing number missing, never zero', () => {
        const [entry] = foodNutritionAnswer(
            [root('f1')],
            CALLER,
            new Map(),
            reading({ f1: { freshness: 'fresh', portions: [] } }),
        );

        expect(entry).toStrictEqual({ outcome: 'found', ref: root('f1'), freshness: 'fresh', portions: [] });
    });

    it('carries a stale value as found and stale', () => {
        const [entry] = foodNutritionAnswer(
            [root('f1')],
            CALLER,
            new Map(),
            reading({ f1: { ...CHICKEN, freshness: 'stale' } }, ['f1']),
        );

        expect(entry).toMatchObject({ outcome: 'found', freshness: 'stale', caloriesPer100g: 165 });
    });

    it('answers an id food answered with nothing as absent, and an id food never answered as unavailable', () => {
        expect(
            foodNutritionAnswer([root('gone'), root('down')], CALLER, new Map(), reading({}, ['down'])),
        ).toStrictEqual([
            { outcome: 'absent', ref: root('gone') },
            { outcome: 'unavailable', ref: root('down') },
        ]);
    });

    it('answers a variant as absent until food serves variants, whatever food said about the same id', () => {
        expect(foodNutritionAnswer([variant('f1')], CALLER, new Map(), reading({ f1: CHICKEN }, ['f1']))).toStrictEqual(
            [{ outcome: 'absent', ref: variant('f1') }],
        );
    });

    it('answers one entry per distinct ref, in order of first appearance', () => {
        const entries = foodNutritionAnswer(
            [root('b'), root('a'), root('b'), variant('a'), root('a')],
            CALLER,
            new Map(),
            reading({ a: CHICKEN, b: CHICKEN }),
        );

        expect(entries.map((entry) => entry.ref)).toStrictEqual([root('b'), root('a'), variant('a')]);
    });

    describe('⛔ the concealment rule (R46, R50), applied last', () => {
        /** A read in which `mine`, `theirs` and `unknown` sit in the SAME request, answered or not. */
        function mixedBatch(answered: boolean): ReturnType<typeof foodNutritionAnswer> {
            return foodNutritionAnswer(
                [root('mine'), root('theirs'), root('unknown'), root('public')],
                CALLER,
                new Map([
                    ['mine', CALLER],
                    ['theirs', STRANGER],
                ]),
                answered
                    ? // Food wrongly returns numbers for the stranger's private food.
                      reading({ mine: CHICKEN, theirs: CHICKEN, public: CHICKEN })
                    : reading({ public: { ...CHICKEN, freshness: 'stale' } }, ['mine', 'theirs', 'unknown', 'public']),
            );
        }

        it('shows the caller their own private food, and answers a stranger’s exactly as an unknown id', () => {
            const [mine, theirs, unknown, shared] = mixedBatch(true);

            expect(mine).toMatchObject({ outcome: 'found', caloriesPer100g: 165 });
            expect(shared).toMatchObject({ outcome: 'found' });
            expect(theirs).toStrictEqual({ outcome: 'absent', ref: root('theirs') });
            expect(unknown).toStrictEqual({ outcome: 'absent', ref: root('unknown') });
        });

        it('answers a stranger’s private food as unavailable when the request failed, as an unknown id is', () => {
            const [, theirs, unknown, shared] = mixedBatch(false);

            expect(shared).toMatchObject({ outcome: 'found', freshness: 'stale' });
            expect(theirs).toStrictEqual({ outcome: 'unavailable', ref: root('theirs') });
            expect(unknown).toStrictEqual({ outcome: 'unavailable', ref: root('unknown') });
        });

        it('conceals a stale cached value for a stranger’s private food behind unavailable', () => {
            const entries = foodNutritionAnswer(
                [root('theirs')],
                CALLER,
                new Map([['theirs', STRANGER]]),
                reading({ theirs: { ...CHICKEN, freshness: 'stale' } }, ['theirs']),
            );

            expect(entries).toStrictEqual([{ outcome: 'unavailable', ref: root('theirs') }]);
        });

        it('conceals every private food from a read with no caller', () => {
            const entries = foodNutritionAnswer(
                [root('private')],
                undefined,
                new Map([['private', CALLER]]),
                reading({ private: CHICKEN }),
            );

            expect(entries).toStrictEqual([{ outcome: 'absent', ref: root('private') }]);
        });
    });
});
