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
            {
                verificationKey: KEY_A,
                band: 'contradicted',
                certainty: 'high',
                identityVerdict: 'disagree',
                aspects: ['identity', 'quantity'],
            },
            {
                verificationKey: KEY_B,
                band: 'verified',
                certainty: 'medium',
                identityVerdict: null,
                aspects: ['quantity'],
            },
        ]);

        const bands = await new LineVerificationsDal(control.db).findBandsByKeys([KEY_A, KEY_B]);

        // Migration 0042: the row carries the per-aspect identity verdict beside the band, because the
        // U13 re-pick door (`identityContradictedOf`) reads all three fields off one row. ADR-0071 (item 7): and the
        // aspects asked, because a verdict that never asked identity says nothing about the food.
        expect(bands.get(KEY_A)).toEqual({
            band: 'contradicted',
            certainty: 'high',
            identityVerdict: 'disagree',
            aspects: ['identity', 'quantity'],
        });
        expect(bands.get(KEY_B)).toEqual({
            band: 'verified',
            certainty: 'medium',
            identityVerdict: null,
            aspects: ['quantity'],
        });
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

describe('LineVerificationsDal.findExistingKeys — the save path’s dedup read (ADR-0071)', () => {
    it('answers every key that has a verdict row, WHATEVER its band — a band this build cannot read is still on record', async () => {
        const control = createFakeDb();
        control.enqueue([
            { verificationKey: KEY_A, aspects: ['identity', 'quantity'] },
            { verificationKey: KEY_B, aspects: ['identity'] },
        ]);

        const existing = await new LineVerificationsDal(control.db).findExistingKeys([KEY_A, KEY_B, 'v2:cccc']);

        expect([...existing].sort()).toEqual([KEY_A, KEY_B]);
    });

    it('⛔ answers ONLY keys whose verdict asked IDENTITY — a quantity-only verdict leaves the food unjudged', async () => {
        // ADR-0071 (item 7): both producers always ask identity now. Counting a quantity-only verdict as on record would
        // skip the request, the gate would never judge the food, and the paste proposal would read `checking` forever.
        const control = createFakeDb();
        control.enqueue([
            { verificationKey: KEY_A, aspects: ['quantity'] },
            { verificationKey: KEY_B, aspects: ['identity', 'quantity'] },
        ]);

        const existing = await new LineVerificationsDal(control.db).findExistingKeys([KEY_A, KEY_B]);

        expect([...existing]).toEqual([KEY_B]);
    });

    it('issues NO query for an empty key list — `in ()` is a Postgres syntax error', async () => {
        const control = createFakeDb();

        const existing = await new LineVerificationsDal(control.db).findExistingKeys([]);

        expect(existing.size).toBe(0);
        expect(control.calls).toEqual([]);
    });

    it('binds each key once, however often the caller repeats it', async () => {
        const control = createFakeDb();
        control.enqueue([]);

        await new LineVerificationsDal(control.db).findExistingKeys([KEY_A, KEY_A, KEY_B]);

        expect(boundKeysOfWhere(control).sort()).toEqual([KEY_A, KEY_B]);
    });
});

describe('LineVerificationsDal.findExhaustedKeys — keys the gate gave up on (ADR-0071)', () => {
    it('answers the keys whose attempts row carries a failure code', async () => {
        const control = createFakeDb();
        control.enqueue([{ verificationKey: KEY_B }]);

        const exhausted = await new LineVerificationsDal(control.db).findExhaustedKeys([KEY_A, KEY_B]);

        expect([...exhausted]).toEqual([KEY_B]);
    });

    it('issues NO query for an empty key list', async () => {
        const control = createFakeDb();

        expect((await new LineVerificationsDal(control.db).findExhaustedKeys([])).size).toBe(0);
        expect(control.calls).toEqual([]);
    });

    it('binds each key once', async () => {
        const control = createFakeDb();
        control.enqueue([]);

        await new LineVerificationsDal(control.db).findExhaustedKeys([KEY_A, KEY_A]);

        expect(boundKeysOfWhere(control)).toEqual([KEY_A]);
    });
});
