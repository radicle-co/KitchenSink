/**
 * The per-recipe statement and the provenance it sets (ADR-0072 §9, ADR-0023's exception for this route only).
 *
 * The table is the owner's; each row is a mutation target: swapping `book` and `paid_site` hands a paid recipe the wrong
 * label, and swapping a citation into the wrong column loses the credit or the link.
 */
import { describe, expect, it } from 'vitest';
import { RecipeSourceType } from '@kitchensink/recipe-core';

import { columnsOfStatement, provenanceOfStatement, statementOfColumns } from '../importStatement.js';

const URL_CITATION = 'https://example.com/pancakes';

describe('provenanceOfStatement — the statement sets the label', () => {
    it.each([
        [
            'I wrote this',
            { kind: 'authored' },
            { sourceType: RecipeSourceType.USER_CREATED, sourceUrl: null, sourceAttribution: null },
        ],
        [
            'a public web page keeps its address',
            { kind: 'public_web', citation: URL_CITATION },
            { sourceType: RecipeSourceType.IMPORTED_PUBLIC, sourceUrl: URL_CITATION, sourceAttribution: null },
        ],
        [
            'a book keeps its citation as the credit',
            { kind: 'book', citation: 'The Joy of Cooking, p. 12' },
            {
                sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
                sourceUrl: null,
                sourceAttribution: 'The Joy of Cooking, p. 12',
            },
        ],
        [
            'a paid site keeps its citation as the credit',
            { kind: 'paid_site', citation: 'cooksillustrated.com / pancakes' },
            {
                sourceType: RecipeSourceType.IMPORTED_PAID,
                sourceUrl: null,
                sourceAttribution: 'cooksillustrated.com / pancakes',
            },
        ],
    ] as const)('%s', (_name, statement, expected) => {
        expect(provenanceOfStatement(statement)).toStrictEqual(expected);
    });
});

describe('the stored columns round-trip the statement', () => {
    it.each([
        [{ kind: 'authored' }, { statementKind: 'authored', citation: null, sourceKind: null }],
        [
            { kind: 'public_web', citation: URL_CITATION },
            { statementKind: 'source', citation: URL_CITATION, sourceKind: 'public_web' },
        ],
        [
            { kind: 'book', citation: 'Joy, p. 12' },
            { statementKind: 'source', citation: 'Joy, p. 12', sourceKind: 'book' },
        ],
        [
            { kind: 'paid_site', citation: 'site' },
            { statementKind: 'source', citation: 'site', sourceKind: 'paid_site' },
        ],
    ] as const)('%j', (statement, columns) => {
        expect(columnsOfStatement(statement)).toStrictEqual(columns);
        expect(statementOfColumns(columns)).toStrictEqual(statement);
    });

    it('reads no statement from empty columns (the cook has not said yet)', () => {
        expect(statementOfColumns({ statementKind: null, citation: null, sourceKind: null })).toBeUndefined();
    });

    it('⛔ throws on columns the table’s CHECKs would have refused, rather than inventing a label', () => {
        expect(() => statementOfColumns({ statementKind: 'source', citation: null, sourceKind: 'book' })).toThrow();
        expect(() => statementOfColumns({ statementKind: 'source', citation: 'x', sourceKind: null })).toThrow();
        expect(() => statementOfColumns({ statementKind: 'authored', citation: 'x', sourceKind: null })).toThrow();
        expect(() => statementOfColumns({ statementKind: 'wat', citation: null, sourceKind: null })).toThrow();
    });
});
