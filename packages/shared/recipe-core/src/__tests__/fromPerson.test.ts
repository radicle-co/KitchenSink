import { describe, expect, it } from 'vitest';

import { UNRECOGNISED_STATEMENT_KIND } from '../recipe.types.js';
import { fromPersonOf } from '../fromPerson.js';

/**
 * The "from another person" rule: the stored statement says the recipe is not the cook's to publish. The SQL twin is
 * `recipe_is_from_person` (migration 0087), and a LOCAL e2e test holds the pair together over the same table.
 */
describe('fromPersonOf', () => {
    it.each([
        ['no statement', null, false],
        ['"I wrote this"', 'authored', false],
        ['a stated source', 'source', false],
        ['"from another person"', 'fromPerson', true],
        ['a statement kind this reader does not know', UNRECOGNISED_STATEMENT_KIND, false],
    ] as const)('%s', (_label, statementKind, expected) => {
        expect(fromPersonOf(statementKind)).toBe(expected);
    });
});
