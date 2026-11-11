/**
 * The seed's only direct database write, against a fake connection: what it sends, in what order, and that it always lets go.
 *
 * ⛔ The write is scoped to rows the seed itself wrote (`model_id` = the seed's marker), so it can never delete or replace a
 * verdict a worker wrote — the property that makes clean-up safe on a database holding real verdicts.
 */
import { describe, expect, it, vi } from 'vitest';

import { createVerdictStore, type VerdictConnection } from '../src/verdictStore.js';
import { NEEDS_REVIEW_SEED_MODEL_ID, needsReviewVerdictFor } from '../src/needsReviewProbe.js';

const row = needsReviewVerdictFor({
    sourceLine: '2 cups chicken stock',
    foodRefId: 'food_paprika',
    quantity: 2,
    unit: 'cup',
});

function fakeConnection(failAt?: RegExp) {
    const statements: { sql: string; params: readonly unknown[] | undefined }[] = [];
    const connection: VerdictConnection = {
        query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
            statements.push({ sql: sql.replace(/\s+/gu, ' ').trim(), params });

            if (failAt?.test(sql) === true) {
                throw new Error('boom');
            }

            return undefined;
        }),
        end: vi.fn(async () => undefined),
    };

    return { connection, statements };
}

describe('createVerdictStore.replaceSeedVerdict', () => {
    it('removes the seed’s previous rows and writes the new one, inside one transaction', async () => {
        const { connection, statements } = fakeConnection();

        await createVerdictStore(async () => connection).replaceSeedVerdict(row);

        expect(statements.map((statement) => statement.sql.split(' ')[0])).toEqual([
            'BEGIN',
            'DELETE',
            'INSERT',
            'COMMIT',
        ]);
    });

    it('⛔ deletes ONLY rows carrying the seed’s model marker, never a worker’s verdict', async () => {
        const { connection, statements } = fakeConnection();

        await createVerdictStore(async () => connection).replaceSeedVerdict(row);

        const remove = statements.find((statement) => statement.sql.startsWith('DELETE'));

        expect(remove?.sql).toMatch(/FROM recipe_ingredient_verifications WHERE model_id = \$1$/u);
        expect(remove?.params).toEqual([NEEDS_REVIEW_SEED_MODEL_ID]);
    });

    it('inserts every column the read needs, by parameter, and replaces a row already holding the key', async () => {
        const { connection, statements } = fakeConnection();

        await createVerdictStore(async () => connection).replaceSeedVerdict(row);

        const insert = statements.find((statement) => statement.sql.startsWith('INSERT'));

        expect(insert?.sql).toContain('ON CONFLICT (verification_key) DO UPDATE');
        expect(insert?.params).toEqual([
            row.verificationKey,
            'disagree',
            'high',
            'contradicted',
            ['quantity'],
            null,
            'disagree',
            NEEDS_REVIEW_SEED_MODEL_ID,
            'food_paprika',
            null,
        ]);
        // Values are never spliced into the statement text.
        expect(insert?.sql).not.toContain(row.verificationKey);
        expect(insert?.sql).not.toContain('food_paprika');
    });

    it('⛔ rolls back and rethrows when a statement fails, and still closes the connection', async () => {
        const { connection, statements } = fakeConnection(/^\s*INSERT/u);

        await expect(createVerdictStore(async () => connection).replaceSeedVerdict(row)).rejects.toThrow('boom');

        expect(statements.map((statement) => statement.sql.split(' ')[0])).toEqual([
            'BEGIN',
            'DELETE',
            'INSERT',
            'ROLLBACK',
        ]);
        expect(connection.end).toHaveBeenCalledTimes(1);
    });

    it('closes the connection after a success', async () => {
        const { connection } = fakeConnection();

        await createVerdictStore(async () => connection).replaceSeedVerdict(row);

        expect(connection.end).toHaveBeenCalledTimes(1);
    });
});
