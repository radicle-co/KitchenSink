/**
 * The `GET /api/v1/admin/users` query contract — the schema that existed but was never wired up.
 *
 * WHAT THIS PINS, AND WHY IT IS A DATABASE-SAFETY TEST RATHER THAN A VALIDATION NICETY.
 * `adminListUsersQuerySchema` was already written, already exported, and reached by NOTHING: the controller took
 * five bare `@Query('…')` strings, and identity's global `ZodValidationPipe` is constructed with
 * `strictSchemaDeclaration: false`, which makes it pass through any parameter whose metatype is not a Zod DTO.
 * So the route had a schema in the repository and no validation in the request path — the failure mode that
 * looks correct in review.
 *
 * It reached the database. `limit` was read as `Number.parseInt(limit, 10)`, which answers `NaN` for
 * `?limit=abc`, and `AdminService`'s `filters.limit ?? 50` does NOT catch `NaN` — `??` tests only null and
 * undefined. So `query.limit(NaN).offset(NaN)` was handed to drizzle and `NaN` was echoed in the response body.
 *
 * The cases below therefore assert coercion AND rejection, and the `NaN` case is called out on its own because
 * it is the one a `??` default silently admits. Each reds if the field is loosened back to `z.string()`.
 */
import { describe, expect, it } from 'vitest';

import { adminListUsersQuerySchema, MAX_ADMIN_LIST_LIMIT } from '../admin.schema.js';
import { AdminListUsersQueryDto } from '../dto/adminListUsers.query.dto.js';

describe('adminListUsersQuerySchema', () => {
    it('coerces the decimal strings a query string actually delivers into integers', () => {
        const parsed = adminListUsersQuerySchema.parse({ limit: '25', offset: '50' });

        expect(parsed.limit).toBe(25);
        expect(parsed.offset).toBe(50);
    });

    it('omits limit/offset when absent, leaving the service to own its 50/0 defaults', () => {
        // Deliberately NOT defaulted here: a default in two places is a default that can disagree.
        const parsed = adminListUsersQuerySchema.parse({});

        expect(parsed.limit).toBeUndefined();
        expect(parsed.offset).toBeUndefined();
    });

    describe('the NaN path that reached drizzle', () => {
        it.each([
            ['a non-numeric limit', { limit: 'abc' }],
            ['a non-numeric offset', { offset: 'abc' }],
            ['a limit that is only a sign', { limit: '-' }],
            ['a whitespace-only limit', { limit: '   ' }],
            ['an empty limit', { limit: '' }],
        ])('rejects %s instead of yielding NaN', (_label, query) => {
            const result = adminListUsersQuerySchema.safeParse(query);

            expect(result.success).toBe(false);
            // The specific hazard, stated: `Number.parseInt('abc')` is NaN, and `NaN ?? 50` is NaN — so a
            // permissive schema here does not merely allow a bad request, it puts NaN into a SQL LIMIT.
            expect(Number.parseInt('abc', 10) ?? 50).toBeNaN();
        });
    });

    it.each([
        ['zero', { limit: '0' }],
        ['negative', { limit: '-1' }],
        ['fractional', { limit: '2.5' }],
        ['above the cap', { limit: String(MAX_ADMIN_LIST_LIMIT + 1) }],
    ])('rejects a limit that is %s', (_label, query) => {
        expect(adminListUsersQuerySchema.safeParse(query).success).toBe(false);
    });

    it('coerces with Number(), not parseInt — documented, because the two disagree', () => {
        // Recorded rather than "fixed", because the coercion is BOUNDED and the difference is benign:
        // `z.coerce.number()` is `Number(...)`, so `'0x10'` is 16 and `'1e3'` is 1000, where the old
        // `Number.parseInt(v, 10)` gave 0 and 1. Neither is a security question once `.int().min(1).max(200)`
        // applies — `'1e3'` exceeds the cap and is refused, `'0x10'` is a legal page size. Asserted so the
        // behaviour is a decision on record instead of a surprise for whoever next reads a hex page size in a log.
        expect(adminListUsersQuerySchema.parse({ limit: '0x10' }).limit).toBe(16);
        expect(adminListUsersQuerySchema.safeParse({ limit: '1e3' }).success).toBe(false);
    });

    it('accepts the cap itself, and a zero offset', () => {
        const parsed = adminListUsersQuerySchema.parse({ limit: String(MAX_ADMIN_LIST_LIMIT), offset: '0' });

        expect(parsed.limit).toBe(MAX_ADMIN_LIST_LIMIT);
        expect(parsed.offset).toBe(0);
    });

    it('rejects a negative offset (it becomes a SQL OFFSET)', () => {
        expect(adminListUsersQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
    });

    it('bounds the filter strings, which become LIKE patterns', () => {
        expect(adminListUsersQuerySchema.safeParse({ email: 'x'.repeat(321) }).success).toBe(false);
        expect(adminListUsersQuerySchema.safeParse({ name: 'x'.repeat(321) }).success).toBe(false);
    });

    it('STRIPS an unknown query parameter rather than rejecting the request', () => {
        // `z.object`, not `strictObject`: an unrecognised query parameter is far more often a stale link or a
        // tracking param than an attack, and rejecting the whole request would be a worse answer than ignoring
        // it. What matters is that nothing unvalidated reaches the service — and a stripped key cannot.
        const parsed = adminListUsersQuerySchema.parse({ limit: '10', utm_source: 'email' });

        expect(parsed).not.toHaveProperty('utm_source');
    });
});

describe('AdminListUsersQueryDto', () => {
    it('exposes the schema to nestjs-zod, so the global pipe actually validates the route', () => {
        // The wiring assertion. A `createZodDto` class carries no class-validator metadata, so this DTO is
        // validated ONLY by nestjs-zod's pipe — `tests/appValidation.test.ts` pins that the globally-bound pipe
        // is a `ZodValidationPipe` and not Nest's `ValidationPipe`. Together those two facts are what make this
        // route validated; either alone is not enough.
        expect(AdminListUsersQueryDto.schema).toBe(adminListUsersQuerySchema);
    });
});
