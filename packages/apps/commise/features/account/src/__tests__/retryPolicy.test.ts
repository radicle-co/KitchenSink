/**
 * Unit tests for `shouldRetryProfileServiceFailure` — the profile client's half of the shared query retry
 * policy, and the mirror of `@kitchensink/recipe-service-client`'s `retryPolicy.test.ts`.
 *
 * Both hierarchies reach the ONE `QueryClient` each app mounts, so a policy that only understood recipe
 * errors would leave a profile `404` retrying three times with backoff — the same defect, one client over.
 *
 * As on the recipe side, the classification table's key set is asserted equal to the error classes the module
 * actually exports, so a new class cannot land unclassified and inherit "retry" by falling through.
 */
import { describe, expect, it } from 'vitest';

import * as errorsModule from '../errors.js';
import {
    BadRequestError,
    ForbiddenError,
    InvalidRequestError,
    NotFoundError,
    ProfileServiceClientError,
    UnauthorizedError,
    UnexpectedResponseError,
} from '../errors.js';
import { shouldRetryProfileServiceFailure } from '../retryPolicy.js';

/** One real instance of EVERY exported error class, paired with whether a retry is worth issuing. */
const CLASSIFICATION: Readonly<Record<string, { readonly error: ProfileServiceClientError; readonly retry: boolean }>> =
    {
        // No status — a transport or parse failure. Nothing here says the request is the problem.
        ProfileServiceClientError: { error: new ProfileServiceClientError('boom'), retry: true },
        BadRequestError: { error: new BadRequestError(), retry: false },
        // ⛔ The same deliberate carve-out the recipe client makes, and it binds HARDER here: this client's
        // own web caller (`web/src/hooks/useUserProfile.ts`) resolves `(await getToken()) ?? ''` and is gated
        // on `isSignedIn`, which `@clerk/nextjs` reports true during the pre-hydration window. The empty
        // bearer is answered `401`, and the query backoff is the only thing that outlasts the window.
        UnauthorizedError: { error: new UnauthorizedError(), retry: true },
        ForbiddenError: { error: new ForbiddenError(), retry: false },
        NotFoundError: { error: new NotFoundError(), retry: false },
        InvalidRequestError: { error: new InvalidRequestError('patchUserMe', new Error('zod')), retry: false },
        UnexpectedResponseError: { error: new UnexpectedResponseError(500), retry: true },
    };

/** Every `Error` subclass the module exports, discovered from the module rather than listed. */
function exportedErrorClassNames(): readonly string[] {
    return Object.entries(errorsModule)
        .filter(([, value]) => typeof value === 'function' && value.prototype instanceof Error)
        .map(([name]) => name)
        .sort();
}

describe('shouldRetryProfileServiceFailure — exhaustiveness over the error hierarchy', () => {
    it('classifies EVERY error class the module exports, with none left to the default', () => {
        expect(Object.keys(CLASSIFICATION).sort()).toEqual(exportedErrorClassNames());
    });

    it.each(Object.entries(CLASSIFICATION))('classifies %s', (_name, { error, retry }) => {
        expect(shouldRetryProfileServiceFailure(error)).toBe(retry);
    });
});

describe('shouldRetryProfileServiceFailure — a 4xx is not a transient failure', () => {
    it('refuses to retry a 404', () => {
        expect(shouldRetryProfileServiceFailure(new NotFoundError())).toBe(false);
    });

    it('refuses to retry a body that was never SENT', () => {
        expect(shouldRetryProfileServiceFailure(new InvalidRequestError('patchUserMe', new Error('zod')))).toBe(false);
    });

    it.each([400, 403, 404, 409, 410, 422])('refuses an unmapped %i', (status) => {
        expect(shouldRetryProfileServiceFailure(new UnexpectedResponseError(status))).toBe(false);
    });
});

describe('shouldRetryProfileServiceFailure — transient failures KEEP retrying', () => {
    it.each([500, 502, 503, 504])('retries the 5xx %i', (status) => {
        // ⛔ The assertion a blanket `retry: false` could not pass.
        expect(shouldRetryProfileServiceFailure(new UnexpectedResponseError(status))).toBe(true);
    });

    it.each([408, 425, 429])('retries the transient 4xx %i, which a status RANGE would refuse', (status) => {
        expect(shouldRetryProfileServiceFailure(new UnexpectedResponseError(status))).toBe(true);
    });

    it('retries a failure that carries no status at all', () => {
        expect(shouldRetryProfileServiceFailure(new UnexpectedResponseError())).toBe(true);
    });
});

describe('shouldRetryProfileServiceFailure — it ABSTAINS on errors it does not own', () => {
    // Abstention is what lets this predicate and the recipe client's compose by conjunction while neither
    // package knows the other exists — and what keeps a foreign "auth not ready" error retrying.
    it.each([
        ['a recipe-service error', Object.assign(new Error('nope'), { name: 'NotFoundError', status: 404 })],
        ['a plain Error', new Error('boom')],
        ['a thrown string', 'boom'],
        ['null', null],
        ['undefined', undefined],
        ['an unrelated object carrying a status', { status: 404 }],
    ])('abstains on %s', (_label, value) => {
        expect(shouldRetryProfileServiceFailure(value)).toBe(true);
    });
});
