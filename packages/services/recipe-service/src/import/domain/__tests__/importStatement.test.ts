/**
 * The per-recipe statement as the import stores it (ADR-0072 §9). The provenance a statement sets is read by the one
 * statement reader, `resolveStatementProvenance`, and tested there (`provenancePolicy.test.ts`).
 *
 * Each row is a mutation target: swapping a citation into the wrong column loses the credit or the link.
 */
import { describe, expect, it } from 'vitest';

import { columnsOfStatement, statementOfColumns } from '../importStatement.js';

const URL_CITATION = 'https://example.com/pancakes';

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
