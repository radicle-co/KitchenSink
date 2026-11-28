/**
 * O4 (draft 3 addendum): `sourceLockOf` keeps its input type and its answers when the origin column lands (PR 3), so the
 * server and the editor keep agreeing. This pins today's answer for every class of source, from the documented rules
 * (ADR-0100 and the doc comment of `sourceLockOf`), as a literal table: not a recorded snapshot, so a changed answer
 * fails here whoever changed it. PR 3 adds the `origin` path and asserts it answers the same rows.
 *
 * "For every origin" is, before the column exists, every (label, kind, statement) class the CHECKs allow.
 */
import { describe, expect, it } from 'vitest';

import { RecipeSourceType } from '../recipe.types.js';
import { SOURCE_LOCK } from '../recipeState/recipeStateValues.js';
import { sourceLockOf, type CorrectableSourceFacts } from '../sourceRules.js';

const UC = RecipeSourceType.USER_CREATED;
const PUB = RecipeSourceType.IMPORTED_PUBLIC;
const BOOK = RecipeSourceType.IMPORTED_PHYSICAL;
const PAID = RecipeSourceType.IMPORTED_PAID;
const { SOURCE_LOCK_OPEN: OPEN, SOURCE_LOCK_DOWNGRADE_ONLY: DOWN, SOURCE_LOCK_LOCKED: LOCKED } = SOURCE_LOCK;

type Row = readonly [
    label: string,
    facts: Partial<CorrectableSourceFacts> & Pick<CorrectableSourceFacts, 'sourceType'>,
    expected: (typeof SOURCE_LOCK)[keyof typeof SOURCE_LOCK],
];

const ROWS: readonly Row[] = [
    // The cook's own recipe, no answer.
    ['own, nothing, unconfirmed', { sourceType: UC }, OPEN],
    ['own, nothing, confirmed', { sourceType: UC, sourceConfirmed: true }, OPEN],
    // "I wrote this".
    ['authored, unconfirmed', { sourceType: UC, statementKind: 'authored' }, OPEN],
    ['authored, confirmed', { sourceType: UC, statementKind: 'authored', sourceConfirmed: true }, DOWN],
    [
        'authored, confirmed, cloned',
        { sourceType: UC, statementKind: 'authored', sourceConfirmed: true, clonedFromId: 'r1' },
        DOWN,
    ],
    // "From a source" with a statement and no kind.
    ['source statement, unconfirmed', { sourceType: UC, statementKind: 'source' }, OPEN],
    ['source statement, confirmed', { sourceType: UC, statementKind: 'source', sourceConfirmed: true }, LOCKED],
    // From another person, stored or attested, or a statement this client cannot name: locked whatever is confirmed.
    ['from a person, unconfirmed', { sourceType: UC, statementKind: 'fromPerson' }, LOCKED],
    ['from a person, confirmed', { sourceType: UC, statementKind: 'fromPerson', sourceConfirmed: true }, LOCKED],
    ['attested a person, nothing stored', { sourceType: UC, attestedFromPerson: true }, LOCKED],
    ['attested a person, confirmed', { sourceType: UC, attestedFromPerson: true, sourceConfirmed: true }, LOCKED],
    [
        'attested a person, but a statement is stored',
        { sourceType: UC, statementKind: 'authored', attestedFromPerson: true },
        OPEN,
    ],
    ['unrecognised statement', { sourceType: UC, statementKind: 'unrecognised' }, LOCKED],
    ['unrecognised kind', { sourceType: UC, sourceKind: 'unrecognised' }, LOCKED],
    // A kind the cook stated in the editor.
    ['web page kind, unconfirmed', { sourceType: UC, sourceKind: 'public_web' }, OPEN],
    ['web page kind, confirmed', { sourceType: UC, sourceKind: 'public_web', sourceConfirmed: true }, LOCKED],
    ['book kind, unconfirmed', { sourceType: UC, sourceKind: 'book' }, OPEN],
    ['book kind, confirmed', { sourceType: UC, sourceKind: 'book', sourceConfirmed: true }, LOCKED],
    [
        'paid-site kind on an own recipe, unconfirmed (a user-created label counts as stated in the editor)',
        { sourceType: UC, sourceKind: 'paid_site' },
        OPEN,
    ],
    [
        'paid-site kind on an own recipe, confirmed',
        { sourceType: UC, sourceKind: 'paid_site', sourceConfirmed: true },
        LOCKED,
    ],
    // Inherited by a clone.
    ['clone with an inherited web kind', { sourceType: UC, sourceKind: 'public_web', clonedFromId: 'r1' }, LOCKED],
    ['clone with no kind, unconfirmed', { sourceType: UC, clonedFromId: 'r1' }, OPEN],
    ['clone, a null clone id is an original', { sourceType: UC, sourceKind: 'book', clonedFromId: null }, OPEN],
    // Labels an import or the curator wrote.
    ['imported public, no kind (curator text)', { sourceType: PUB }, LOCKED],
    ['imported public, web kind, unconfirmed', { sourceType: PUB, sourceKind: 'public_web' }, OPEN],
    [
        'imported public, web kind, confirmed',
        { sourceType: PUB, sourceKind: 'public_web', sourceConfirmed: true },
        LOCKED,
    ],
    ['imported book, book kind, unconfirmed', { sourceType: BOOK, sourceKind: 'book' }, OPEN],
    ['imported book, book kind, confirmed', { sourceType: BOOK, sourceKind: 'book', sourceConfirmed: true }, LOCKED],
    ['imported book, no kind', { sourceType: BOOK }, LOCKED],
    ['imported paid, paid kind, unconfirmed', { sourceType: PAID, sourceKind: 'paid_site' }, LOCKED],
    ['imported paid, no kind', { sourceType: PAID }, LOCKED],
];

describe('sourceLockOf parity (O4)', () => {
    it.each(ROWS)('%s', (_label, partial, expected) => {
        const facts: CorrectableSourceFacts = {
            sourceKind: null,
            statementKind: null,
            clonedFromId: undefined,
            sourceConfirmed: false,
            ...partial,
        };

        expect(sourceLockOf(facts)).toBe(expected);
    });

    it('keeps all three answers reachable', () => {
        expect(new Set(ROWS.map((row) => row[2]))).toEqual(new Set([OPEN, DOWN, LOCKED]));
    });
});
