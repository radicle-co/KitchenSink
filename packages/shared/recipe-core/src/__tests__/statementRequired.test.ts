import { describe, expect, it } from 'vitest';

import { RecipeSourceType } from '../recipe.types.js';
import type { SourceEvidenceFacts } from '../sourceConflict.js';
import {
    RECIPE_STATEMENT_KINDS,
    UNRECOGNISED_STATEMENT_KIND,
    recipeStatementKindViewSchema,
    statementRequiredOf,
} from '../statementRequired.js';

/**
 * The statement rule (Option B): a cook-written recipe with no statement whose content was pasted, or that has any source
 * evidence, may not be left published and public until the cook says "I wrote this". Literal truth table: a mutant that drops
 * the sourceType clause, the statement clause, either arm of the OR, or the fail-closed arm fails at least one row.
 */
const ANY_EVIDENCE: SourceEvidenceFacts = { sourceDomain: null, sourceKind: null };
const OWN = RecipeSourceType.USER_CREATED;

describe('RECIPE_STATEMENT_KINDS', () => {
    it('is the closed vocabulary the database CHECK mirrors', () => {
        expect([...RECIPE_STATEMENT_KINDS]).toEqual(['authored', 'source']);
    });
});

describe('statementRequiredOf', () => {
    it.each([
        ['typed, no evidence, no statement', OWN, null, false, [], false],
        ['pasted, no statement', OWN, null, true, [], true],
        ['typed, but evidence exists, no statement', OWN, null, false, [ANY_EVIDENCE], true],
        ['pasted and evidence, no statement', OWN, null, true, [ANY_EVIDENCE], true],
        ['pasted, the cook said "I wrote this"', OWN, 'authored', true, [], false],
        ['evidence, the cook said "I wrote this"', OWN, 'authored', false, [ANY_EVIDENCE], false],
        ['pasted, a source statement is stored', OWN, 'source', true, [], false],
        ['pasted, a statement kind this reader does not know', OWN, UNRECOGNISED_STATEMENT_KIND, false, [], true],
        ['pasted, a web copy (it has a statement)', RecipeSourceType.IMPORTED_PUBLIC, null, true, [], false],
        ['pasted, the curator’s text', RecipeSourceType.IMPORTED_PUBLIC, null, true, [ANY_EVIDENCE], false],
        ['pasted, a book recipe', RecipeSourceType.IMPORTED_PHYSICAL, null, true, [ANY_EVIDENCE], false],
        ['pasted, a paid-site recipe', RecipeSourceType.IMPORTED_PAID, null, true, [ANY_EVIDENCE], false],
    ] as const)('%s', (_label, sourceType, statementKind, contentPasted, evidence, expected) => {
        expect(statementRequiredOf({ sourceType, statementKind, contentPasted, evidence })).toBe(expected);
    });
});

describe('recipeStatementKindViewSchema', () => {
    it('reads a known kind as itself and any other string as unrecognised, never failing the read', () => {
        expect(recipeStatementKindViewSchema.parse('authored')).toBe('authored');
        expect(recipeStatementKindViewSchema.parse('source')).toBe('source');
        expect(recipeStatementKindViewSchema.parse('family')).toBe(UNRECOGNISED_STATEMENT_KIND);
    });

    it('still fails a value that is not a string', () => {
        expect(recipeStatementKindViewSchema.safeParse(7).success).toBe(false);
    });
});
