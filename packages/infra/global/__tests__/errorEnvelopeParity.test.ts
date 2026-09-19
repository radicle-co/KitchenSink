/**
 * ARCH-PS-2, ENFORCED: the error envelope really is the SAME shape across all three HTTP services.
 *
 * ── THE CLAIM THAT NOTHING CHECKED ──
 *
 * `packages/services/identity/src/common/apiError.schema.ts` says the envelope is "shared VERBATIM with the food
 * and recipe services (ARCH-PS-2) so one client-side handler covers all three". Recipe's and food's say the same.
 * Measured 2026-08-12: **no file in the repo imported two schema packages to check it.** It was three independent
 * assertions of a cross-service property, each made by one of the three parties, none verified — which is the exact
 * shape of claim that is true right up until someone edits one file.
 *
 * ⚠️ AND THE CLAIM MATTERS MORE THAN THE PROSE SUGGESTS. "One client-side handler covers all three" is not a
 * nicety: `packages/apps/commise/mobile/src/services/api.ts` parses identity errors with
 * `@kitchensink/schema-identity`'s `apiErrorSchema`, while the recipe and food clients parse theirs with their own
 * packages' — and the apps route all three through shared error UI. If one service's envelope grew a required
 * field or renamed one, the shared handling would break for that service alone, at runtime, in a released binary.
 *
 * ── WHY THIS IS A PARITY TEST AND NOT A SHARED SCHEMA ──
 *
 * ⛔ Do not "fix" the duplication by moving `apiErrorSchema` into a shared package. ADR-0014 requires each service
 * to AUTHOR its own wire contract, and the schema packages are literal copies of authored sources — a shared
 * envelope schema would make one service's file the authority for another's wire, which is the coupling ADR-0014
 * exists to forbid. Three authored copies plus one mechanical parity assertion is the correct shape: the copies stay
 * independent, and divergence becomes a failing test instead of a runtime surprise.
 *
 * What IS shared is the MECHANISM that fills the envelope — `@kitchensink/nest-error-envelope` — and this suite
 * also closes the loop on that: every service's published schema must accept a value the mechanism produces.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { apiErrorSchema as foodApiErrorSchema } from '@kitchensink/schema-food';
import { apiErrorSchema as identityApiErrorSchema } from '@kitchensink/schema-identity';
import { apiErrorSchema as recipeApiErrorSchema } from '@kitchensink/schema-recipe';
import { GENERIC_STATUS_CODES, normalizeHttpException } from '@kitchensink/nest-error-envelope';
import type { ApiErrorEnvelope } from '@kitchensink/nest-error-envelope';
import { HttpException, HttpStatus, ForbiddenException } from '@nestjs/common';

/** The three PUBLISHED envelope schemas, each authored independently by the service that serves it. */
const PUBLISHED = [
    ['identity', identityApiErrorSchema],
    ['food', foodApiErrorSchema],
    ['recipe', recipeApiErrorSchema],
] as const;

/**
 * Every envelope-shaped value a caller could receive, including the awkward ones.
 *
 * A body must round-trip through ALL THREE schemas identically, or "one client-side handler" is false for whichever
 * one disagrees.
 */
const ENVELOPES: readonly (readonly [string, unknown])[] = [
    ['the minimum: code + message', { code: 'UNAUTHORIZED', message: 'No token' }],
    ['with details', { code: 'VALIDATION_FAILED', message: 'a: too small', details: { fields: ['a: too small'] } }],
    ['details with a nested object', { code: 'VERSION_CONFLICT', message: 'stale', details: { server: { id: 'x' } } }],
    ['an empty details object', { code: 'X', message: 'm', details: {} }],
    // Forward compatibility: a code THIS build has never been taught must still parse. That is what lets a deployed
    // service add codes ahead of a released mobile binary — the case ADR-0014 names as motivating drift layer 3.
    ['an unknown code', { code: 'A_CODE_FROM_THE_FUTURE', message: 'm' }],
    ['the HTTP_<status> fallback', { code: 'HTTP_418', message: 'teapot' }],
    // `.loose()` on every arm: a response that grows a field must not crash a client that has not been taught it.
    ['an unknown extra top-level key', { code: 'X', message: 'm', somethingNew: true }],
];

/** Bodies that are NOT the envelope. Every schema must reject each one, or the shape check is vacuous. */
const NOT_ENVELOPES: readonly (readonly [string, unknown])[] = [
    ['no code', { message: 'm' }],
    ['no message', { code: 'X' }],
    ['a numeric code', { code: 7, message: 'm' }],
    ['a numeric message', { code: 'X', message: 7 }],
    ['an array details', { code: 'X', message: 'm', details: [] }],
    ['a bare string', 'nope'],
    ['null', null],
    ['an array', []],
];

describe('the three published error envelopes are ONE shape', () => {
    it('imports three DISTINCT schema objects, so the parity below is not comparing a thing to itself', () => {
        const identities = new Set(PUBLISHED.map(([, schema]) => schema));

        expect(identities.size).toBe(3);
        expect(PUBLISHED).toHaveLength(3);
    });

    describe.each(ENVELOPES)('%s', (_label, body) => {
        it.each(PUBLISHED)('is accepted by %s, identically', (_service, schema) => {
            const parsed = schema.safeParse(body);

            expect(parsed.success).toBe(true);
            // Not just "accepted" — the PARSED value must be the same, so one schema stripping a field the others
            // keep (the difference between `z.object` and `.loose()`) is a failure rather than a silent asymmetry.
            expect(parsed.data).toEqual(body);
        });
    });

    describe.each(NOT_ENVELOPES)('%s', (_label, body) => {
        it.each(PUBLISHED)('is rejected by %s', (_service, schema) => {
            expect(schema.safeParse(body).success).toBe(false);
        });
    });

    /*
     * The strongest form of the property, and the one that catches a change none of the cases above enumerate: the
     * three schemas' JSON Schema projections must be IDENTICAL. A new optional field, a changed `details` value
     * type, or one service tightening `code` to an enum all fail here even though the examples above would pass.
     *
     * ⚠️ `code` must stay `z.string()` in all three — deliberately NOT each service's code enum. Narrowing it would
     * make every code a service adds a breaking change for a client that only branches on the few it knows, and it
     * is the reason each service ALSO publishes a typed union applied second and allowed to fail.
     */
    it('projects to byte-identical JSON Schema, so no field can diverge unnoticed', () => {
        const [first, ...rest] = PUBLISHED.map(([service, schema]) => ({
            service,
            json: JSON.stringify(z.toJSONSchema(schema, { io: 'output' }), null, 2),
        }));

        expect(first).toBeDefined();

        for (const other of rest) {
            expect(other.json, `${other.service}'s envelope differs from ${first?.service}'s`).toBe(first?.json);
        }

        // Non-vacuity: the projection must actually describe the envelope, not an empty object.
        expect(first?.json).toContain('"code"');
        expect(first?.json).toContain('"message"');
        expect(first?.json).toContain('"details"');
    });
});

/*
 * ── THE MECHANISM'S OUTPUT IS A VALID BODY FOR ALL THREE ──
 *
 * `@kitchensink/nest-error-envelope` declares its own structural `ApiErrorEnvelope` for the normalization's return
 * type. That is NOT a fourth wire-contract declaration — it is server-only and never published — but the claim
 * "it is structurally what all three schemas accept" has to be checked rather than asserted in a docstring, since
 * it is the reason each filter can hand its output straight to `response.json()`.
 */
describe('every service’s published schema accepts what the shared mechanism produces', () => {
    const VOCABULARY = { validationFailedCode: 'VALIDATION_FAILED', statusCode: GENERIC_STATUS_CODES };

    const NORMALIZED: readonly (readonly [string, HttpException])[] = [
        ['an explicit-code body', new HttpException({ code: 'NOT_READY', message: 'Database not reachable' }, 503)],
        [
            'a validation body',
            new HttpException(
                { statusCode: 400, message: 'Validation failed', errors: [{ path: ['a'], message: 'x' }] },
                400,
            ),
        ],
        ['a framework object body', new ForbiddenException('nope')],
        ['an argument-less exception', new ForbiddenException()],
        ['a bare-string body', new HttpException('teapot', 418)],
        ['an empty-string body', new HttpException('', HttpStatus.BAD_REQUEST)],
        ['a body with extras to lift', new HttpException({ statusCode: 503, message: 'down', service: 'food' }, 503)],
    ];

    describe.each(NORMALIZED)('%s', (_label, exception) => {
        const { body } = normalizeHttpException(exception, VOCABULARY);

        it.each(PUBLISHED)('normalizes to a body %s accepts', (_service, schema) => {
            expect(schema.safeParse(body).success).toBe(true);
        });

        // The floor the schemas cannot express: `message` is `z.string()`, which accepts `''`. A blank message is a
        // body whose only human-readable field says nothing, so the MECHANISM guarantees non-emptiness.
        it('never publishes an empty code or message', () => {
            const envelope: ApiErrorEnvelope = body;

            expect(envelope.code.length).toBeGreaterThan(0);
            expect(envelope.message.length).toBeGreaterThan(0);
        });
    });
});
