/**
 * U14 — unit tests for {@link LineVerificationsDal}, the FIRST reader `recipe_ingredient_verifications` has
 * ever had.
 *
 * The gate has been write-only since migration 0023 shipped: `recipe-workers` records a verdict and no
 * service selects one, so a disagreement was durably stored and structurally unable to reach a cook. These
 * cases pin the read's own logic — the empty-keys short circuit that must not issue a query, the projection
 * into a key→band map, and the deduplication a batch read depends on. The SQL itself (that the table exists,
 * that the band CHECK still admits exactly three values) is the integration tier's job; a fake client cannot
 * observe a migration.
 */
import { describe, expect, it } from 'vitest';

import { LineVerificationsDal } from '../lineVerifications.dal.js';
import type { RecipeDrizzle } from '../../../database/client.js';
import { makeFakeDrizzle, type FakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';

type FakeControl = FakeDrizzle<RecipeDrizzle>;

const createFakeDb = (): FakeControl => makeFakeDrizzle<RecipeDrizzle>();

const KEY_A = 'v1:aaaa';
const KEY_B = 'v1:bbbb';

/**
 * The string values BOUND into the recorded `where` predicate.
 *
 * Drizzle's `inArray` builds an `SQL` whose `queryChunks` interleave literals with one `Param` per value, so
 * the bound keys are recoverable without a database — and reading them is what proves the deduplication
 * actually reached the query rather than merely happening in a local variable. The chunk objects are
 * self-referential, so this walks them instead of serializing.
 */
const boundKeysOfWhere = (control: FakeControl): string[] => {
    const where = control.calls.find((call) => call.method === 'where');
    const bound: string[] = [];

    const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const child of node) {
                walk(child);
            }

            return;
        }

        if (node === null || typeof node !== 'object') {
            return;
        }

        const chunks = (node as { queryChunks?: unknown }).queryChunks;

        if (chunks !== undefined) {
            walk(chunks);
        }

        const value = (node as { value?: unknown }).value;

        if (typeof value === 'string') {
            bound.push(value);
        }
    };

    walk(where?.args[0]);

    return bound;
};

describe('LineVerificationsDal.findBandsByKeys', () => {
    it('projects the rows into a key → band map', async () => {
        const control = createFakeDb();
        control.enqueue([
            { verificationKey: KEY_A, band: 'contradicted' },
            { verificationKey: KEY_B, band: 'verified' },
        ]);

        const bands = await new LineVerificationsDal(control.db).findBandsByKeys([KEY_A, KEY_B]);

        expect(bands.get(KEY_A)).toBe('contradicted');
        expect(bands.get(KEY_B)).toBe('verified');
    });

    it('⛔ issues NO query for an empty key set', async () => {
        const control = createFakeDb();

        const bands = await new LineVerificationsDal(control.db).findBandsByKeys([]);

        expect(bands.size).toBe(0);
        // The short circuit is not an optimisation: `inArray(column, [])` generates `in ()`, which is a
        // syntax error in Postgres. Every sibling DAL in this service guards the same way.
        expect(control.calls).toStrictEqual([]);
    });

    it('DEDUPLICATES the keys it asks about — one line shared by two recipes is one lookup', async () => {
        const control = createFakeDb();
        control.enqueue([{ verificationKey: KEY_A, band: 'contradicted' }]);

        await new LineVerificationsDal(control.db).findBandsByKeys([KEY_A, KEY_A, KEY_A]);

        // The verdict table is content-keyed precisely so a line appearing in two of the corpus's 448
        // recipes is verified — and read — once. A batch that forwarded duplicates would undo that, so the
        // assertion reads the PARAMETERS the predicate carries rather than trusting the call count.
        expect(boundKeysOfWhere(control)).toStrictEqual([KEY_A]);
    });

    it('returns an EMPTY map when the gate has judged none of these lines — absence means publish', async () => {
        const control = createFakeDb();
        control.enqueue([]);

        const bands = await new LineVerificationsDal(control.db).findBandsByKeys([KEY_A]);

        expect(bands.size).toBe(0);
    });

    it('⛔ IGNORES a band the reader does not recognise rather than guessing at it', async () => {
        // The database CHECK is the floor, but this service and the writer are different deployables on
        // different release cadences. A band this build cannot interpret has NO defined publish behaviour,
        // and the only safe reading is the one the table's own header names: absence of a verdict means
        // publish. Coercing it to `contradicted` would withhold nutrition on a value nobody defined.
        const control = createFakeDb();
        control.enqueue([{ verificationKey: KEY_A, band: 'gravely-uncertain' }]);

        const bands = await new LineVerificationsDal(control.db).findBandsByKeys([KEY_A]);

        expect(bands.has(KEY_A)).toBe(false);
    });
});
