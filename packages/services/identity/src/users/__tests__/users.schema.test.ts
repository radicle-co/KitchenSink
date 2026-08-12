/**
 * Tests for the AUTHORED identity wire contract.
 *
 * Two jobs, and the first is the important one.
 *
 * 1. **PIN THE WIRE LIFECYCLE TO THE DATABASE ENUM.** `userStatusSchema` restates the four values because the
 *    import restriction forbids an authored `*.schema.ts` from importing drizzle (it is copied into a package web
 *    and mobile depend on, and a drizzle import would drag `drizzle-orm` into a React Native bundle). The two
 *    representations are kept DELIBERATELY, not merged: the wire vocabulary and the storage column's domain change
 *    for different reasons — a migration is not a contract change, and vice versa. What must never happen is a
 *    SILENT divergence, so this is the test that fails when one moves without the other. Concretely: a migration
 *    adding a status the wire does not know would let the service persist a state it cannot describe, and every
 *    client's exhaustive switch over `UserStatus` would stop being exhaustive without a single compile error.
 *
 *    ⚠️ AND FOR ITS WHOLE LIFE IT COULD NOT FAIL. It imported `userStatusEnum` from
 *    `src/types/schema/users.ts` — a DRIFTED, DEAD copy of the real schema that nothing in production read
 *    (`id` was `varchar(255)` vs `text`, `email` `varchar(320)` vs case-insensitive `citext`, and it lacked
 *    `identity_id` and `external_id_synced_at` altogether), while its own comment claimed the two were "kept in
 *    lockstep". So this file asserted a relationship between the wire and a fiction: an `ALTER TYPE user_status
 *    ADD VALUE` on the real table could never have turned it red. It now imports from the package ENTRY POINT
 *    `@kitchensink/identity-db` — the schema `src/database/index.ts` actually re-exports to the DAOs — and the
 *    duplicate is deleted, so the old import cannot resolve and the drift cannot come back.
 *
 * 2. Assert `patchUserMeRequestSchema` enforces what the pipe, the published document, and the two suites that
 *    pin the `400` (`tests/app-validation.test.ts`, `tests/e2e/users-validation.e2e.test.ts`) all rely on — with
 *    the boundary values, not just the happy path.
 */
import { describe, expect, it } from 'vitest';

import { userStatusEnum } from '@kitchensink/identity-db';
import { accountTierSchema, patchUserMeRequestSchema, userProfileSchema, userStatusSchema } from '../users.schema.js';

describe('userStatusSchema', () => {
    // The load-bearing assertion of this file.
    it('carries EXACTLY the values of the user_status database enum', () => {
        expect([...userStatusSchema.options].sort()).toStrictEqual([...userStatusEnum.enumValues].sort());
    });

    it('accepts every value the database enum has', () => {
        for (const value of userStatusEnum.enumValues) {
            expect(userStatusSchema.safeParse(value).success).toBe(true);
        }
    });

    it('rejects a value the database enum does not have, and is case-sensitive', () => {
        expect(userStatusSchema.safeParse('deleted').success).toBe(false);
        expect(userStatusSchema.safeParse('Active').success).toBe(false);
    });

    // `tombstoned` (self-service closure) is RECOVERABLE by an admin; `erased` (GDPR) is terminal. Both must exist
    // on the wire or a client cannot tell a recoverable block from a permanent one.
    it('distinguishes the recoverable closure state from terminal erasure', () => {
        expect(userStatusSchema.options).toContain('tombstoned');
        expect(userStatusSchema.options).toContain('erased');
    });
});

describe('accountTierSchema', () => {
    it('admits exactly the two tiers', () => {
        expect([...accountTierSchema.options].sort()).toStrictEqual(['free', 'premium']);
    });

    it('rejects an unknown tier rather than defaulting it', () => {
        expect(accountTierSchema.safeParse('enterprise').success).toBe(false);
    });
});

describe('patchUserMeRequestSchema', () => {
    it('accepts an empty body — both fields are optional', () => {
        expect(patchUserMeRequestSchema.parse({})).toStrictEqual({});
    });

    it('accepts a displayName at the 100-character boundary and rejects one past it', () => {
        expect(patchUserMeRequestSchema.safeParse({ displayName: 'x'.repeat(100) }).success).toBe(true);
        expect(patchUserMeRequestSchema.safeParse({ displayName: 'x'.repeat(101) }).success).toBe(false);
    });

    it('accepts an absolute URL for avatarUrl', () => {
        expect(patchUserMeRequestSchema.safeParse({ avatarUrl: 'https://img.example/x.png' }).success).toBe(true);
    });

    // `null` is how the avatar is CLEARED — the closure/erasure scrub path relies on it, so admitting it is not
    // laxity but a required capability.
    it('accepts null for avatarUrl, which is how the avatar is cleared', () => {
        expect(patchUserMeRequestSchema.safeParse({ avatarUrl: null }).success).toBe(true);
    });

    it('rejects a non-URL avatarUrl', () => {
        expect(patchUserMeRequestSchema.safeParse({ avatarUrl: 'not-a-url' }).success).toBe(false);
    });

    // A deliberate TIGHTENING over the `class-validator` `@IsUrl()` this replaced, which accepted a scheme-less
    // host. The value is rendered as an image source.
    it('rejects a scheme-less URL, which the previous @IsUrl() accepted', () => {
        expect(patchUserMeRequestSchema.safeParse({ avatarUrl: 'img.example/x.png' }).success).toBe(false);
    });

    // THE STRICTNESS ASSERTION. zod's plain `z.object()` STRIPS unknown keys silently; the pipe this schema
    // replaced ran with `forbidNonWhitelisted: true` and REJECTED them. Using `z.object` here would have quietly
    // downgraded a rejecting boundary to a permissive one on a route that writes user data.
    it('REJECTS an unknown field rather than silently stripping it', () => {
        const result = patchUserMeRequestSchema.safeParse({ displayName: 'Morgan', hacker: 'x' });

        expect(result.success).toBe(false);
    });

    it('rejects a non-string displayName', () => {
        expect(patchUserMeRequestSchema.safeParse({ displayName: 42 }).success).toBe(false);
    });
});

describe('userProfileSchema', () => {
    const profile = {
        user: {
            id: '01JVXXXXXXXXXXXXXXXXXXXXXX',
            email: 'viewer@example.com',
            displayName: '',
            avatarUrl: null,
            status: 'active',
            createdAt: '2026-08-11T00:00:00.000Z',
            updatedAt: '2026-08-11T00:00:00.000Z',
        },
        account: {
            id: '01JVYYYYYYYYYYYYYYYYYYYYYY',
            userId: '01JVXXXXXXXXXXXXXXXXXXXXXX',
            subscriptionTier: 'free',
            createdAt: '2026-08-11T00:00:00.000Z',
            updatedAt: '2026-08-11T00:00:00.000Z',
        },
    };

    it('accepts the shape the service actually returns, including an empty displayName', () => {
        expect(userProfileSchema.safeParse(profile).success).toBe(true);
    });

    // `avatarUrl` is null for a brand-new profile AND after a closure scrub, so a non-nullable field here would
    // reject the majority of real responses.
    it('requires avatarUrl to be nullable, not absent', () => {
        expect(
            userProfileSchema.safeParse({ ...profile, user: { ...profile.user, avatarUrl: undefined } }).success,
        ).toBe(false);
    });

    it('rejects a profile missing the account half', () => {
        expect(userProfileSchema.safeParse({ user: profile.user }).success).toBe(false);
    });

    it('rejects a status outside the lifecycle vocabulary', () => {
        expect(userProfileSchema.safeParse({ ...profile, user: { ...profile.user, status: 'banned' } }).success).toBe(
            false,
        );
    });
});
