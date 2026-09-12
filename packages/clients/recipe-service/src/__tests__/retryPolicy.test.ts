/**
 * Unit tests for `shouldRetryRecipeServiceFailure` — this client's half of the shared query retry policy.
 *
 * Three properties are proved here, and the third is the one that keeps the policy honest as the error
 * hierarchy grows:
 *
 *  1. every failure that CANNOT succeed on a repeat is refused a retry (the 4xx family, plus the
 *     client-side `InvalidRequestError` where no request was ever sent);
 *  2. every failure that CAN — 5xx, a transport timeout, a rate refusal, and anything this module does not
 *     own — is still retried, so the fix does not become "retries off";
 *  3. the classification is EXHAUSTIVE over `errors.ts`. The table below is keyed by class name and its key
 *     set is asserted equal to the set of error classes the module actually exports, so adding a class
 *     without deciding its retryability is a test failure rather than a silent fall-through to the default.
 *     Enumerating the classes by hand in the predicate is what a copy-of-a-list cannot detect; discovering
 *     them from the module's own exports is what makes the assertion self-updating.
 */
import { describe, expect, it } from 'vitest';

import * as errorsModule from '../errors.js';
import {
    BadRequestError,
    FetchUnavailableError,
    ForbiddenError,
    GoneError,
    InvalidRequestError,
    NotFoundError,
    ParseJobExpiredError,
    PullDriftError,
    RecipeServiceClientError,
    SourceBusyError,
    SourceUnavailableError,
    UnauthorizedError,
    UnexpectedResponseError,
    VersionConflictError,
} from '../errors.js';
import { shouldRetryRecipeServiceFailure } from '../retryPolicy.js';

/** An empty pull diff — `PullDriftError`'s constructor takes one and never reads it here. */
const NO_DIFF = { added: [], removed: [], unchanged: [] } as unknown as ConstructorParameters<typeof PullDriftError>[0];

/**
 * One real instance of EVERY error class the module exports, paired with whether a retry is worth issuing.
 * Real instances, not `Object.create(prototype)` stand-ins: `UnexpectedResponseError`'s answer depends on
 * the `status` its CONSTRUCTOR sets, so a prototype-only double would assert against a state the class can
 * never actually be in.
 */
const CLASSIFICATION: Readonly<Record<string, { readonly error: RecipeServiceClientError; readonly retry: boolean }>> =
    {
        // The base class itself, carrying no status — a transport/parse failure. Nothing says it is terminal.
        RecipeServiceClientError: { error: new RecipeServiceClientError('boom'), retry: true },
        BadRequestError: { error: new BadRequestError(), retry: false },
        // ⛔ THE CARVE-OUT, and it is deliberate. See the module docstring: two live token sources still send
        // an EMPTY bearer during the Clerk hydration window, so a 401 is not proof the caller is rejected —
        // it is often proof the credential had not been minted yet, and the credential is re-minted between
        // attempts. Flipping this to `false` re-creates the production defect `recipeAuthNotReady.ts` records.
        UnauthorizedError: { error: new UnauthorizedError(), retry: true },
        ForbiddenError: { error: new ForbiddenError(), retry: false },
        NotFoundError: { error: new NotFoundError(), retry: false },
        VersionConflictError: { error: new VersionConflictError(3, 2), retry: false },
        PullDriftError: { error: new PullDriftError(NO_DIFF), retry: false },
        GoneError: { error: new GoneError(), retry: false },
        ParseJobExpiredError: { error: new ParseJobExpiredError(), retry: false },
        // No status at all, and the opposite answer to `InvalidRequestError`'s absent status — which is
        // exactly why the policy dispatches on the TYPE and not on a status range.
        FetchUnavailableError: { error: new FetchUnavailableError(), retry: true },
        SourceBusyError: { error: new SourceBusyError(30), retry: true },
        SourceUnavailableError: { error: new SourceUnavailableError(), retry: true },
        InvalidRequestError: { error: new InvalidRequestError('createRecipe', new Error('bad')), retry: false },
        // The unmapped-status class is the ONE place a status range is legitimate, because "a status I have
        // no dedicated class for" is the whole of its contract. `500` stands for it in the table; the 4xx/429
        // edges get their own assertions below.
        UnexpectedResponseError: { error: new UnexpectedResponseError(500), retry: true },
    };

/** Every `Error` subclass the module exports, discovered from the module rather than listed. */
function exportedErrorClassNames(): readonly string[] {
    return Object.entries(errorsModule)
        .filter(([, value]) => typeof value === 'function' && value.prototype instanceof Error)
        .map(([name]) => name)
        .sort();
}

describe('shouldRetryRecipeServiceFailure — exhaustiveness over the error hierarchy', () => {
    it('classifies EVERY error class the module exports, with none left to the default', () => {
        // ⛔ The forcing function. A new error class in `errors.ts` lands here as a key-set mismatch, so the
        // author has to decide its retryability instead of inheriting "retry" by falling through.
        expect(Object.keys(CLASSIFICATION).sort()).toEqual(exportedErrorClassNames());
    });

    it.each(Object.entries(CLASSIFICATION))('classifies %s', (_name, { error, retry }) => {
        expect(shouldRetryRecipeServiceFailure(error)).toBe(retry);
    });
});

describe('shouldRetryRecipeServiceFailure — a 4xx is not a transient failure', () => {
    it('refuses to retry a 404, which is what a dead recipe link costs a cook today', () => {
        // The reported defect: TanStack's default `retry: 3` turned one miss into four requests and ~7s of
        // pure backoff before the not-found copy appeared.
        expect(shouldRetryRecipeServiceFailure(new NotFoundError())).toBe(false);
    });

    it('refuses to retry a request that was never SENT', () => {
        // `InvalidRequestError` means the caller's own body is illegal per the published contract. Its own
        // docstring: "a retry with the same body cannot work."
        expect(shouldRetryRecipeServiceFailure(new InvalidRequestError('updateRecipe', new Error('zod')))).toBe(false);
    });

    it.each([400, 403, 404, 409, 410, 413, 422])('refuses an unmapped %i', (status) => {
        expect(shouldRetryRecipeServiceFailure(new UnexpectedResponseError(status))).toBe(false);
    });
});

describe('shouldRetryRecipeServiceFailure — transient failures KEEP retrying', () => {
    it('retries a 500 — the fix is a predicate, not "retries off"', () => {
        // ⛔ Load-bearing. A policy that refused everything would satisfy the 404 assertion above and be
        // completely wrong; this is the assertion that a blanket `retry: false` cannot pass.
        expect(shouldRetryRecipeServiceFailure(new UnexpectedResponseError(500))).toBe(true);
    });

    it.each([500, 502, 503, 504])('retries the 5xx %i', (status) => {
        expect(shouldRetryRecipeServiceFailure(new UnexpectedResponseError(status))).toBe(true);
    });

    it.each([408, 425, 429])('retries the transient 4xx %i, which a status RANGE would refuse', (status) => {
        // 429 is the case a "4xx is permanent" rule gets backwards: the service is telling the caller to come
        // back, and `UnexpectedResponseError`'s own docstring names `TOO_MANY_REQUESTS` among the codes it
        // carries. 408/425 are the same shape one status over.
        expect(shouldRetryRecipeServiceFailure(new UnexpectedResponseError(status))).toBe(true);
    });

    it('retries a transport failure, which carries no status at all', () => {
        expect(shouldRetryRecipeServiceFailure(new FetchUnavailableError('timed out', new Error('abort')))).toBe(true);
    });
});

describe('shouldRetryRecipeServiceFailure — it ABSTAINS on errors it does not own', () => {
    // The predicate can only ever VETO. That is what lets it compose by conjunction with the profile
    // client's predicate without either package knowing the other exists — and it is what preserves the
    // recovery `RecipeProviders` relies on: `RecipeAuthNotReadyError` (thrown by the token source during the
    // Clerk hydration window) belongs to neither hierarchy, so neither vetoes it and it still retries.
    it.each([
        ['a foreign typed error', Object.assign(new Error('not ready'), { name: 'RecipeAuthNotReadyError' })],
        ['a plain Error', new Error('boom')],
        ['a thrown string', 'boom'],
        ['null', null],
        ['undefined', undefined],
        // ⛔ Duck-typing defence: a bare object with a 4xx-looking `status` is NOT one of this client's
        // errors, and a policy that sniffed `error.status` would wrongly refuse to retry it.
        ['an unrelated object carrying a status', { status: 404 }],
    ])('abstains on %s', (_label, value) => {
        expect(shouldRetryRecipeServiceFailure(value)).toBe(true);
    });
});
