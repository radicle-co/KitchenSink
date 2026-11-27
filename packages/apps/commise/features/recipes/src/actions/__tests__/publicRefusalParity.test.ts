/**
 * PR 2 pins `refusalOf` (recipe-core, the model's one refusal function) to what the recipe page answers today, without
 * moving a consumer: for every combination of source label, kind, statement and held, the client's `publicRefusalOf`
 * and `refusalOf` name the same refusal. The pairs come from the model's reason-to-name table.
 */
import {
    RECIPE_SOURCE_KINDS,
    RECIPE_STATEMENT_KINDS,
    REFUSALS_OF_SOURCE,
    RecipeSourceType,
    UNRECOGNISED_SOURCE_KIND,
    UNRECOGNISED_STATEMENT_KIND,
    refusalOf,
} from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { publicRefusalOf, type PublicRefusalFacts } from '../publicRefusal.js';

const nameOfReason = (reason: string): string | undefined =>
    REFUSALS_OF_SOURCE.find(([, candidate]) => candidate === reason)?.[0];

const kinds = [null, ...RECIPE_SOURCE_KINDS, UNRECOGNISED_SOURCE_KIND] as const;
const statements = [null, ...RECIPE_STATEMENT_KINDS, UNRECOGNISED_STATEMENT_KIND] as const;

describe('refusalOf parity with publicRefusalOf', () => {
    it('answers the same name for every source label, kind, statement and held fact', () => {
        let compared = 0;

        for (const sourceType of Object.values(RecipeSourceType)) {
            for (const sourceKind of kinds) {
                for (const statementKind of statements) {
                    for (const held of [false, true]) {
                        const facts: PublicRefusalFacts = { sourceType, sourceKind, statementKind, held };

                        expect(refusalOf(facts), JSON.stringify(facts)).toBe(nameOfReason(publicRefusalOf(facts)));
                        compared += 1;
                    }
                }
            }
        }

        expect(compared).toBe(4 * 5 * 5 * 2);
    });

    it('maps every reason the client can show to a name', () => {
        expect(REFUSALS_OF_SOURCE.map(([, reason]) => reason).sort()).toEqual(
            [
                'fromPerson',
                'none',
                'policy.book',
                'policy.paidSite',
                'policy.webPage',
                'sourceConflict',
                'unrecognised',
            ].sort(),
        );
    });
});
