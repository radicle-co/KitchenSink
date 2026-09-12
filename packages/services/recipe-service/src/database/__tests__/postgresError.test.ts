/**
 * `postgresErrorOf` — the one reader of the Postgres error behind what a Drizzle statement threw.
 *
 * Drizzle wraps the driver's error in a `DrizzleQueryError` whose `cause` is the `pg` `DatabaseError`. A DAL that
 * reads a SQLSTATE, constraint or detail must look through that wrapper, and must not mistake some other error that
 * happens to carry a `code` for a database refusal.
 */
import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

import { postgresErrorOf } from '../postgresError.js';

/** A driver error as `pg` raises it for a foreign-key refusal. */
function foreignKeyRefusal(): DatabaseError {
    return Object.assign(new DatabaseError('violates foreign key constraint', 0, 'error'), {
        code: '23503',
        constraint: 'ingredients_food_lookup_id_fkey',
    });
}

describe('postgresErrorOf', () => {
    it('reads the driver error through Drizzle’s wrapper', () => {
        const refusal = foreignKeyRefusal();

        expect(postgresErrorOf(new DrizzleQueryError('insert into "ingredients"', [], refusal))).toBe(refusal);
    });

    it('reads a driver error thrown bare', () => {
        const refusal = foreignKeyRefusal();

        expect(postgresErrorOf(refusal)).toBe(refusal);
    });

    it('⛔ answers undefined for another error that merely carries a code', () => {
        const lookalike = Object.assign(new Error('not a database refusal'), { code: '23503' });

        expect(postgresErrorOf(lookalike)).toBeUndefined();
        expect(postgresErrorOf(new DrizzleQueryError('select 1', [], lookalike))).toBeUndefined();
    });

    it('answers undefined for a wrapper with no cause, and for a thrown non-error', () => {
        expect(postgresErrorOf(new DrizzleQueryError('select 1', []))).toBeUndefined();
        expect(postgresErrorOf('boom')).toBeUndefined();
        expect(postgresErrorOf(null)).toBeUndefined();
    });
});
