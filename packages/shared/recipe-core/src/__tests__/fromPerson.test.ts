import { describe, expect, it } from 'vitest';

import { UNRECOGNISED_STATEMENT_KIND } from '../recipe.types.js';
import { fromPersonOf } from '../fromPerson.js';

/**
 * The "from another person" rule: the stored statement says the recipe is not the cook's to publish, OR there is no stored
 * statement and the cook once attested it. The SQL twin is `recipe_is_from_person` (migrations 0087 and 0090), and a LOCAL e2e
 * test holds the pair together over the same table.
 */
describe('fromPersonOf', () => {
    it.each([
        ['no statement, never attested', null, false, false],
        ['no statement, once attested "from another person"', null, true, true],
        ['"I wrote this", though once attested "from another person"', 'authored', true, false],
        ['"I wrote this"', 'authored', false, false],
        ['a stated source, though once attested "from another person"', 'source', true, false],
        ['a stated source', 'source', false, false],
        ['"from another person"', 'fromPerson', false, true],
        ['"from another person", attested as well', 'fromPerson', true, true],
        ['a statement kind this reader does not know', UNRECOGNISED_STATEMENT_KIND, false, false],
        ['a statement kind this reader does not know, once attested', UNRECOGNISED_STATEMENT_KIND, true, false],
    ] as const)('%s', (_label, statementKind, attestedFromPerson, expected) => {
        expect(fromPersonOf({ statementKind, attestedFromPerson })).toBe(expected);
    });
});
