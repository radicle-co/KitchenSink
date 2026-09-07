/**
 * THE ERROR CONTRACT'S SCHEMA PROPERTIES — the envelope, the published code set, and the typed union's
 * relationship to both.
 *
 * ── HOW THIS FILE DIVIDES WORK WITH ITS TWO SIBLINGS ──
 *
 * Three suites cover the error contract and each owns a different question, so none of them is redundant:
 *
 *  - **THIS FILE — is the CONTRACT internally coherent?** Is every domain code publishable? Is the typed union a
 *    refinement of the envelope rather than a rival shape? Does an unknown code still parse permissively? These
 *    are properties of the zod alone, provable with no HTTP and no filter.
 *  - **`filters/__tests__/apiException.filter.test.ts` — does the FILTER write that contract?** Status mapping,
 *    the no-passthrough guarantee per input shape, the message-leak rule.
 *  - **`errorContractLockstep.test.ts` — do the SERVER and CLIENT agree?** The filter's real output replayed
 *    into the real client. That is the only one that fails when a change moves one half and not the other.
 *
 * ⚠️ AN EARLIER REVISION OF THIS FILE TESTED SOMETHING THAT NO LONGER EXISTS, and the history is worth keeping
 * because it records a decision reversed on purpose. It asserted a FOUR-MEMBER union — the envelope, Nest's
 * `{ statusCode, message, error? }`, `nestjs-zod`'s validation body, and a bare JSON string for the `429` —
 * because the filter passed `HttpException` bodies through and a document must describe what ships. Publishing
 * the inconsistency honestly was the right call for a documentation-only change and the wrong place to stop; the
 * filter is now the sole author, so those three shapes are gone from the wire and from here.
 */
import { RecipeErrorCode } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import {
    apiErrorSchema,
    recipeApiErrorSchema,
    recipeErrorCodeSchema,
    IDENTITY_SYNC_PENDING_CODE,
} from '../apiError.schema.js';
import { codeForStatus, RECIPE_ERROR_STATUS } from '../apiError.js';

/** Every code the contract publishes. */
const PUBLISHED: readonly string[] = recipeErrorCodeSchema.options;

/** A `details` value that satisfies the arm for each code that promises one. */
const DETAILS_BY_CODE: Readonly<Record<string, Record<string, unknown>>> = {
    VERSION_CONFLICT: {
        currentVersion: 7,
        conflictingVersion: 5,
        server: {
            versionNumber: 7,
            updatedAt: '2026-08-12T10:00:00.000Z',
            snapshot: {
                version: 7,
                title: 'T',
                description: '',
                steps: [],
                ingredients: [],
                servings: 1,
                prepTimeMinutes: 0,
                cookTimeMinutes: 0,
            },
        },
    },
    PULL_DRIFT: { diff: { added: [], removed: [], unchanged: [] } },
    VALIDATION_FAILED: { fields: ['title: Too small'] },
    COLLECTION_LIMIT_REACHED: { limit: 50 },
    MAX_PHOTOS_EXCEEDED: { limit: 10 },
};

/** A minimal valid body for a published code. */
function bodyFor(code: string): Record<string, unknown> {
    const details = DETAILS_BY_CODE[code];

    return details === undefined ? { code, message: 'a message' } : { code, message: 'a message', details };
}

describe('the published code set and the DOMAIN code set cannot disagree', () => {
    /**
     * THE SUBSET ASSERTION, discovered from `recipe-core` rather than from a hand-copied list.
     *
     * `RecipeErrorCode` is the DOMAIN's (what a thrown `RecipeError` may carry) and `recipeErrorCodeSchema` is the
     * WIRE's (a superset, including codes that are not domain errors at all). Neither is derivable from the other,
     * so both exist — but a domain code the wire does not publish is a body the filter WILL emit and no consumer
     * can narrow, which is silent degradation. Iterating `Object.values(RecipeErrorCode)` is what makes a code
     * added to the domain fail here instead.
     */
    it('publishes every recipe-domain code', () => {
        const unpublished = Object.values(RecipeErrorCode).filter((code) => !PUBLISHED.includes(code));

        expect(unpublished).toStrictEqual([]);
    });

    // Non-vacuity in the other direction, and the record of WHY the wire set is bigger: these are real failures
    // with no domain error behind them. If this ever became empty, the two sets would have collapsed into one and
    // the superset reasoning would need re-examining rather than silently holding.
    it('also publishes codes that are NOT domain errors, which is why it is a superset', () => {
        const domain: readonly string[] = Object.values(RecipeErrorCode);
        const wireOnly = PUBLISHED.filter((code) => !domain.includes(code));

        expect(wireOnly).toContain('VALIDATION_FAILED');
        expect(wireOnly).toContain('UNAUTHORIZED');
        expect(wireOnly).toContain('NOT_READY');
        expect(wireOnly.length).toBeGreaterThan(5);
    });

    // The middleware raises the sync-race 401 from `recipe-core`'s constant while the union spells it as a
    // literal. Two spellings of one string is exactly the drift this asserts away.
    it('spells IDENTITY_SYNC_PENDING identically in recipe-core and in the published enum', () => {
        expect(IDENTITY_SYNC_PENDING_CODE).toBe(recipeErrorCodeSchema.enum.IDENTITY_SYNC_PENDING);
    });

    // A code with no status cannot be served, so the table must be total over the published set. TypeScript
    // already enforces this at compile time; asserting it too catches a `Record` widened to `string`.
    it('assigns a status to every published code', () => {
        const unmapped = PUBLISHED.filter(
            (code) => typeof RECIPE_ERROR_STATUS[code as keyof typeof RECIPE_ERROR_STATUS] !== 'number',
        );

        expect(unmapped).toStrictEqual([]);
    });
});

describe('the typed union REFINES the envelope, and is not a second shape', () => {
    /**
     * The property that makes the two-layer read safe: a consumer parses with the envelope first, then narrows.
     * If a narrowed body were not also a valid envelope body, that sequence would be incoherent — the second
     * parse could accept something the first rejected.
     */
    it.each(recipeErrorCodeSchema.options)('a valid %s body satisfies BOTH schemas', (code) => {
        const body = bodyFor(code);

        expect(recipeApiErrorSchema.safeParse(body).success, `typed: ${JSON.stringify(body)}`).toBe(true);
        expect(apiErrorSchema.safeParse(body).success, `envelope: ${JSON.stringify(body)}`).toBe(true);
    });

    /**
     * `details` is REQUIRED on the arms whose code promises one, and this is the assertion that keeps the promise
     * meaningful. A body that dropped `details.currentVersion` must FAIL the typed parse — surfacing at the
     * boundary, naming the field — rather than handing a caller an `undefined` that surfaces three layers deeper.
     */
    it.each(Object.keys(DETAILS_BY_CODE))('%s REJECTS a body with no details', (code) => {
        expect(recipeApiErrorSchema.safeParse({ code, message: 'a message' }).success).toBe(false);
    });

    it('VERSION_CONFLICT rejects details missing the 3-way-merge snapshot, not just missing details', () => {
        const body = { code: 'VERSION_CONFLICT', message: 'x', details: { currentVersion: 7, conflictingVersion: 5 } };

        expect(recipeApiErrorSchema.safeParse(body).success).toBe(false);
    });

    it('VERSION_CONFLICT’s details are recipe-core’s, so the snapshots arrive typed rather than as unknown', () => {
        const parsed = recipeApiErrorSchema.safeParse(bodyFor('VERSION_CONFLICT'));

        expect(parsed.success).toBe(true);

        if (parsed.success && parsed.data.code === 'VERSION_CONFLICT') {
            // Reached without a cast or optional chaining — which is the whole value of composing the real schema.
            expect(parsed.data.details.server.snapshot.title).toBe('T');
            expect(parsed.data.details.currentVersion).toBe(7);
        }
    });
});

describe('forward compatibility — a deployed service may run ahead of a released client', () => {
    it('the envelope accepts a code this build has never been taught', () => {
        expect(apiErrorSchema.safeParse({ code: 'A_CODE_FROM_A_LATER_DEPLOY', message: 'x' }).success).toBe(true);
    });

    it('the typed union REJECTS it, so a consumer degrades by status instead of inventing a meaning', () => {
        expect(recipeApiErrorSchema.safeParse({ code: 'A_CODE_FROM_A_LATER_DEPLOY', message: 'x' }).success).toBe(
            false,
        );
    });

    it('an unknown FIELD is passed through rather than stripped, on the envelope and on a typed arm', () => {
        expect(apiErrorSchema.parse({ code: 'X', message: 'y', addedLater: 1 })['addedLater']).toBe(1);

        const parsed = recipeApiErrorSchema.parse({ ...bodyFor('NOT_OWNER'), addedLater: 1 });

        expect((parsed as unknown as Record<string, unknown>)['addedLater']).toBe(1);
    });

    // Non-vacuity for the whole file: a schema loosened to `z.unknown()` would satisfy everything above.
    it('REJECTS bodies that are not the envelope at all', () => {
        for (const invalid of [{}, { code: 404 }, { message: 'no code' }, null, 42, 'a bare string', []]) {
            expect(apiErrorSchema.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
        }
    });
});

describe('codeForStatus — the code for a failure that arrived with none', () => {
    it.each([
        [401, 'UNAUTHORIZED'],
        [403, 'FORBIDDEN'],
        [404, 'NOT_FOUND'],
        [413, 'PAYLOAD_TOO_LARGE'],
        [429, 'TOO_MANY_REQUESTS'],
        [500, 'INTERNAL_ERROR'],
    ])('maps %i to the PUBLISHED code %s, so the body stays narrowable', (status, code) => {
        expect(codeForStatus(status)).toBe(code);
        expect(PUBLISHED).toContain(code);
    });

    /**
     * The deliberate other half: these statuses get a stable code that is NOT published, so the typed union
     * rejects it and a consumer maps by status — which is correct, because the status IS the whole signal. See
     * `apiError.ts`'s `STATUS_CODE` for the reasoning; pinned here so the boundary cannot move silently.
     */
    it.each([
        [400, 'BAD_REQUEST'],
        [409, 'CONFLICT'],
        [410, 'GONE'],
        [422, 'UNPROCESSABLE_ENTITY'],
        [423, 'LOCKED'],
        [503, 'SERVICE_UNAVAILABLE'],
    ])('maps %i to the UNPUBLISHED code %s, so a consumer falls back to the status', (status, code) => {
        expect(codeForStatus(status)).toBe(code);
        expect(PUBLISHED).not.toContain(code);
    });

    it('is deterministic and leaks nothing for a status it has never seen', () => {
        expect(codeForStatus(418)).toBe('HTTP_418');
        expect(codeForStatus(599)).toBe('HTTP_599');
    });
});
