/**
 * The cross-service erasure **fan-out gateway** (CR-002 / U4b — R7/R9/R11).
 *
 * Pattern: an Adapter / anti-corruption Gateway. It translates one domain erasure event (an app-user
 * `userId`) into the two verified service-principal HTTP calls that erase that user's footprint outside
 * identity:
 *
 *  1. **recipe FIRST** — `POST {recipeBaseUrl}/v1/internal/account/erasure` (U4a). Recipe-first so the
 *     election-bearing job exists before the Clerk `user.deleted` echo can land (R9). Recipe enforces
 *     R9 authoritatively via its `idx_erasure_jobs_active_owner` partial-unique index, so a second call
 *     for the same owner is an idempotent no-op — this gateway simply calls it.
 *  2. **food** — `POST {foodBaseUrl}/v1/internal/account/erasure` (R11). Removes the user's
 *     `fetch_requesters` rows (`eraseUser`), keyed by the same app ULID (U1's re-key). Idempotent
 *     (deleting already-gone rows removes 0).
 *
 * Each leg presents a short-lived, single-target EdDSA bearer minted by {@link mintServiceErasureToken}
 * with the target service's pinned audience — so a token captured on one leg cannot be replayed against
 * the other. The verifiers hold only the PUBLIC key (networkless), exactly like the Clerk path.
 *
 * **It never throws on a leg failure.** Each leg is reduced to an {@link ErasureLegResult}; the CALLER
 * decides what a failure means: the deletion-worker rethrows so SQS retries (at-least-once, both legs
 * idempotent), while the erasure-reconciliation sweep records an "incomplete" metric and moves on. Food is
 * attempted even when the recipe leg failed — they erase independent data, and a stuck recipe leg must not
 * strand the food leg.
 *
 * `fetch` (Node 24 global) is the HTTP client — no hand-rolled client, no axios; injected for tests.
 */
import { SERVICE_ERASURE_TOKEN_AUDIENCE, SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD } from '@kitchensink/recipe-core';

import { mintServiceErasureToken } from './service-erasure-token.js';

/** The internal-erasure path both services mount (recipe U4a; food U4b mirror). */
const INTERNAL_ERASURE_PATH = '/v1/internal/account/erasure';

/** Per-leg request timeout — the internal erasure enqueue is a fast durable-write + return. */
const REQUEST_TIMEOUT_MS = 10_000;

/** The signing key + the two target base URLs the fan-out needs. */
export interface ErasureFanoutConfig {
    /** The EdDSA PRIVATE signing key (PKCS#8 PEM) — held only by the worker/reconciliation Lambda. */
    readonly signingKeyPem: string;
    /** The recipe-service origin (scheme + host), e.g. `https://recipe.identity.commise.app`. */
    readonly recipeBaseUrl: string;
    /** The food-service origin (scheme + host). */
    readonly foodBaseUrl: string;
}

/** The bound target of one erasure fan-out. */
export interface ErasureFanoutTarget {
    /** The app-user ULID (identity `users.id`) — the correlation key across both downstream services. */
    readonly userId: string;
    /** The correlation/event id bound into each token (single-event binding). */
    readonly eventId: string;
    /** The machine actor label recorded on each downstream job (R8). */
    readonly actor: string;
}

/** The outcome of one erasure leg. `ok` is true only on a 2xx response. */
export interface ErasureLegResult {
    readonly service: 'recipe' | 'food';
    /** True on a 2xx response; false on a non-2xx status OR a transport error. */
    readonly ok: boolean;
    /** The HTTP status, when a response was received (absent on a transport error). */
    readonly httpStatus?: number;
    /** A short failure detail (non-2xx body snippet or the thrown error message). */
    readonly detail?: string;
    /** recipe: the returned job status (`queued`/`running`/`completed`). */
    readonly jobStatus?: string;
    /** food: the number of `fetch_requesters` rows removed — the reconciliation residue signal. */
    readonly deletedRequesterRows?: number;
}

/** The result of a full fan-out: both legs, always present. */
export interface ErasureFanoutResult {
    readonly recipe: ErasureLegResult;
    readonly food: ErasureLegResult;
}

/** Injectable `fetch` (defaults to the Node 24 global). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Fan-out dependencies (test seam). */
export interface ErasureFanoutDeps {
    readonly fetchImpl?: FetchLike;
}

/**
 * Fan an erasure out to recipe (first) then food, returning a per-leg result for each.
 *
 * @param target - The bound owner + event id + actor.
 * @param config - The signing key and the two service base URLs.
 * @param deps - Optional injected `fetch` (tests).
 * @returns Both legs' {@link ErasureLegResult}. Never rejects on a leg failure — the caller decides.
 * @sideEffect Mints two JWTs and performs up to two HTTP POSTs.
 */
export async function runErasureFanout(
    target: ErasureFanoutTarget,
    config: ErasureFanoutConfig,
    deps: ErasureFanoutDeps = {},
): Promise<ErasureFanoutResult> {
    const fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));

    // Recipe FIRST (R9): the election-bearing job must exist before the Clerk echo lands.
    const recipe = await callLeg(
        'recipe',
        config.recipeBaseUrl,
        SERVICE_ERASURE_TOKEN_AUDIENCE,
        target,
        config,
        fetchImpl,
    );
    const food = await callLeg(
        'food',
        config.foodBaseUrl,
        SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD,
        target,
        config,
        fetchImpl,
    );

    return { recipe, food };
}

/**
 * Call one internal-erasure leg: mint the single-target token for `audience`, POST it, and reduce the
 * outcome to an {@link ErasureLegResult}. Any transport error or non-2xx is captured as `ok:false` — this
 * function never throws.
 *
 * @sideEffect Mints a JWT and performs one HTTP POST.
 */
async function callLeg(
    service: 'recipe' | 'food',
    baseUrl: string,
    audience: string,
    target: ErasureFanoutTarget,
    config: ErasureFanoutConfig,
    fetchImpl: FetchLike,
): Promise<ErasureLegResult> {
    try {
        const token = await mintServiceErasureToken({
            privateKeyPem: config.signingKeyPem,
            audience,
            ownerId: target.userId,
            eventId: target.eventId,
            actor: target.actor,
        });

        const response = await fetchImpl(`${baseUrl}${INTERNAL_ERASURE_PATH}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
            return { service, ok: false, httpStatus: response.status, detail: await safeSnippet(response) };
        }

        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

        return service === 'recipe'
            ? { service, ok: true, httpStatus: response.status, jobStatus: asString(body['status']) }
            : {
                  service,
                  ok: true,
                  httpStatus: response.status,
                  deletedRequesterRows: asNumber(body['deletedRequesterRows']),
              };
    } catch (error) {
        return { service, ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
}

/** Read a short body snippet for a failure detail without letting a body-read error mask the HTTP error. */
async function safeSnippet(response: Response): Promise<string> {
    try {
        return (await response.text()).slice(0, 200);
    } catch {
        return '';
    }
}

/** Narrow an unknown JSON field to a string, or undefined. Pure. */
function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

/** Narrow an unknown JSON field to a number, or undefined. Pure. */
function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}
