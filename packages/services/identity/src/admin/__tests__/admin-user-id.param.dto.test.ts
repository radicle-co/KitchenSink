/**
 * The `{userId}` path parameter of the five admin action routes — the SHAPE gate (§15.4(1): path params go
 * through the pipe, like bodies and query strings).
 *
 * ⚠️ WHAT THIS CLOSES. The controller read `@Param('userId') userId: string` and handed that string straight
 * to `eq(users.id, targetSub)` in five drizzle predicates, with no format check anywhere on the path. Drizzle
 * parameterises, so this was never SQL injection — but "not injectable" is not "validated": an arbitrary
 * string reached the database as a lookup key, the audit rows logged whatever was sent, and the published
 * contract described the parameter as a bare `z.string()`, which is a promise the API never intended.
 *
 * The behaviour asserted here is that a value the service could not possibly have MINTED is rejected at the
 * boundary with a `400`, before the handler runs. `tests/admin-param-validation.test.ts` proves the same over
 * HTTP and pins the `403`-before-`400` precedence.
 *
 * @module
 */
import 'reflect-metadata';

import { describe, it, expect } from 'vitest';
import { ZodValidationPipe } from 'nestjs-zod';
import type { ArgumentMetadata } from '@nestjs/common';
import { newUserId } from '@kitchensink/identity-db';

import { AdminUserIdParamDto } from '../dto/admin-user-id.param.dto.js';

const pipe = new ZodValidationPipe();
const paramMeta: ArgumentMetadata = { type: 'param', metatype: AdminUserIdParamDto, data: undefined };

/** Run the real global pipe over a route-params object, exactly as Nest does for `@Param()`. */
const transform = (params: unknown): unknown => pipe.transform(params, paramMeta);

describe('AdminUserIdParamDto', () => {
    // THE INVARIANT THAT MATTERS: the validator must accept precisely what the id GENERATOR produces. A
    // hand-written fixture proves the validator agrees with itself; the real generator proves it agrees with
    // the database. `newUserId()` is `ulidx.ulid()` — the only thing that ever writes `users.id`.
    it('accepts every id the app itself mints', () => {
        for (let i = 0; i < 64; i += 1) {
            const userId = newUserId();

            expect(transform({ userId })).toStrictEqual({ userId });
        }
    });

    it('rejects the non-ULID string the old e2e fixture used', () => {
        expect(() => transform({ userId: 'target' })).toThrow();
    });

    // Crockford base32 EXCLUDES I, L, O and U (they are confusable with 1, 1, 0 and V). Several fixtures in
    // this repo spelled a "ULID" with them — `01HZZE2EADMINAUTHZUSER0000` contains a `U` — so these are the
    // cases that decide whether the check is real or decorative.
    it.each(['I', 'L', 'O', 'U'])('rejects a 26-char id containing the excluded letter %s', (letter) => {
        expect(() => transform({ userId: `01ARZ3NDEKTSV4RRFFQ69G5FA${letter}` })).toThrow();
    });

    it.each([
        ['one char short', '01ARZ3NDEKTSV4RRFFQ69G5FA'],
        ['one char long', '01ARZ3NDEKTSV4RRFFQ69G5FAVV'],
        ['empty', ''],
    ])('rejects a %s id', (_label, userId) => {
        expect(() => transform({ userId })).toThrow();
    });

    // Not because drizzle would interpolate them — it parameterises — but because these are the shapes a
    // probe sends, and a `400` at the boundary is a cheaper, quieter answer than a database round-trip.
    it.each([
        "' OR 1=1 --",
        '%',
        '_',
        '01ARZ3NDEKTSV4RRFFQ69G5FAV%',
        '../../etc/passwd',
        '01ARZ3NDEKTSV4RRFFQ69G5FAV\n01ARZ3NDEKTSV4RRFFQ69G5FAW',
    ])('rejects the probe-shaped value %j', (userId) => {
        expect(() => transform({ userId })).toThrow();
    });

    it('rejects an absent userId', () => {
        expect(() => transform({})).toThrow();
    });

    it('rejects a non-string userId', () => {
        expect(() => transform({ userId: 42 })).toThrow();
    });

    // Deliberate, and documented at the schema: `z.ulid()` is case-INSENSITIVE, so a lowercase form parses.
    // It is not the same row — `users.id` is `VARCHAR COLLATE "C"` and every stored id is upper-case — so the
    // route answers `404`. That is the correct answer for "no such user", and it is asserted so nobody
    // "fixes" it into a silent `.toUpperCase()` that would make two distinct ids resolve to one user.
    it('accepts a lowercase ULID (which then resolves to no user, not to a different one)', () => {
        const lower = '01arz3ndektsv4rrffq69g5fav';

        expect(transform({ userId: lower })).toStrictEqual({ userId: lower });
    });
});
