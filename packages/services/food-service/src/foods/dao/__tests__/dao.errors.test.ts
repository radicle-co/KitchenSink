/**
 * The SQLSTATE readers the DAOs recover on: `isUniqueViolation` (a lost insert race, `23505`) and `isLockNotAvailable`
 * (admission's lock not granted within `lock_timeout`, `55P03`, which answers `contended` — ADR-0053 §5).
 *
 * Drizzle wraps the pg error in `DrizzleQueryError` with the original as `.cause`, so each reader must find the code
 * on the thrown value or beneath it, and must not read a code it was not asked for.
 */
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { isLockNotAvailable, isUniqueViolation } from '../dao.errors.js';

/** A pg-shaped error carrying a SQLSTATE. */
function pgError(code: string): Error {
    return Object.assign(new Error(`sqlstate ${code}`), { code });
}

/** Wrap an error the way drizzle does, `times` deep. */
function wrapped(error: unknown, times: number): unknown {
    let current = error;

    for (let depth = 0; depth < times; depth += 1) {
        current = new DrizzleQueryError('select 1', [], current instanceof Error ? current : undefined);
    }

    return current;
}

describe('SQLSTATE readers', () => {
    it.each([
        ['a bare 55P03', pgError('55P03'), true, false],
        ['a 55P03 wrapped once by drizzle', wrapped(pgError('55P03'), 1), true, false],
        ['a 55P03 wrapped twice', wrapped(pgError('55P03'), 2), true, false],
        ['a bare 23505', pgError('23505'), false, true],
        ['a 23505 wrapped once by drizzle', wrapped(pgError('23505'), 1), false, true],
        ['another SQLSTATE', pgError('57014'), false, false],
        ['an error with no code', new Error('boom'), false, false],
        ['a string', '55P03', false, false],
        ['null', null, false, false],
        ['undefined', undefined, false, false],
    ])('%s', (_, error, lockNotAvailable, uniqueViolation) => {
        expect(isLockNotAvailable(error)).toBe(lockNotAvailable);
        expect(isUniqueViolation(error)).toBe(uniqueViolation);
    });

    it('stops walking after five causes, so a cyclic chain cannot hang it', () => {
        const cyclic: { cause?: unknown } = {};
        cyclic.cause = cyclic;

        expect(isLockNotAvailable(cyclic)).toBe(false);
    });
});
