/**
 * `FoodServiceClients` — the **Factory** that mints a `FoodServiceClient` bound to ONE caller's credential
 * and to the ONE food-service origin this stage was configured with (issue #120).
 *
 * ## Why a factory, and why per request
 *
 * Recipe reads the food service **on the caller's behalf**: food's `FoodAuthGuard` verifies a *Clerk* token,
 * so the only credential that can satisfy it is the caller's own (short-lived, per request). The previous
 * wiring built two long-lived singleton clients around a static `FOOD_SERVICE_TOKEN` env string — a value
 * that was never set anywhere and could not have worked if it had been, since a Clerk session token expires
 * in ~60s. A per-request credential cannot live on a singleton, so the singleton becomes a factory and the
 * *client* becomes the per-request thing. `FoodServiceClient` holds no connection state (undici pools
 * sockets globally), so minting one is a plain object allocation — cheap enough for the per-keystroke path.
 *
 * A request-scoped Nest provider was the alternative and was rejected: `Scope.REQUEST` bubbles up the whole
 * injection chain (the gateway, the service, the controller all become per-request), which changes lifecycle
 * semantics well beyond this seam to buy an implicit version of a value we can simply pass. Threading the
 * credential explicitly also makes every food call *name* the authority it acts under, which is what makes
 * the confused-deputy risk reviewable instead of ambient.
 *
 * ## The confused-deputy boundary lives HERE
 *
 * With a forwarded user credential the danger is not holding it, it is **aiming** it. So:
 *
 *  - `baseUrl` is captured once from boot-validated config and is the ONLY origin any client this factory
 *    produces can talk to. Nothing in the recipe service constructs an HTTP client from request data, so
 *    there is no path that points the caller's token at a caller-chosen host.
 *  - The credential is only ever read here — {@link revealCallerToken} is import-restricted to this file by
 *    the package ESLint config — and only to build the `Authorization` header for that fixed origin.
 *  - No caller argument reaches the request TARGET: the client percent-encodes the query into `?query=`, so a
 *    URL-shaped search term stays a search term.
 *
 * ## The three deadlines are the callers' latency contracts (do NOT collapse them)
 *
 *  - {@link FoodServiceClients.standard} — the client's default 8s. Backs `addByName` / `getStatus` /
 *    `getCandidates` / `resolve`: user-initiated writes and polls where waiting seconds for a real answer
 *    beats failing.
 *  - {@link FoodServiceClients.typeahead} — a sub-second bound, for the Stage-2 blended suggest, which runs
 *    PER KEYSTROKE. Sharing the 8s budget there would let a degraded food service stall the typeahead for 8s
 *    a keystroke and pile up in-flight requests.
 *
 *  - {@link FoodServiceClients.postCommitNutrition} — a short bound for the nutrition a recipe response carries
 *    AFTER its write has committed (create, update, clone, visibility, restore, rating). That figure is extra
 *    information on a result that already succeeded, and a single-recipe lookup is at most two requests (one
 *    chunk, since `MAX_RECIPE_INGREDIENTS` ≤ `MAX_IDS_PER_REQUEST`, plus the authored call) — so at the 8s
 *    default a slow food service held a SUCCESSFUL write for up to 16s, past the recipe client's own 10s
 *    deadline, and the cook was told it failed. A fast failure is honest here because the detail now carries
 *    `nutrition.freshness`: cached figures come back marked `stale`, and nothing cached reads as incomplete.
 *
 * All bounds are enforced at the transport by a real `AbortSignal` inside the client, not by racing a timer
 * in the caller — a race returns early while leaving the request pending, leaking a socket per keystroke
 * during an outage.
 *
 * @implements FR-007 FR-047
 */
import { FoodServiceClient } from '@kitchensink/food-service-client';

import { revealCallerToken, type CallerToken } from '../auth/CallerToken.js';
import type { NutritionReadBudget } from './foodNutrition.gateway.js';

/** Construction options: the fixed food origin plus the two non-default deadlines. */
export interface FoodServiceClientsOptions {
    /** The food service origin for this stage (`FOOD_SERVICE_URL`), boot-validated — never request data. */
    readonly baseUrl: string;
    /** Per-keystroke bound (ms) applied to {@link FoodServiceClients.typeahead} clients. */
    readonly typeaheadTimeoutMs: number;
    /** Post-commit bound (ms) applied to {@link FoodServiceClients.postCommitNutrition} clients. */
    readonly postCommitNutritionTimeoutMs: number;
    /**
     * The READ nutrition lookup's deadline (ms): the bound on everything one GET detail or card batch waits on food,
     * across every chunk, wave and the authored call — and so also each {@link FoodServiceClients.nutrition}
     * request's own timeout, since no single request may outlive the lookup it belongs to.
     */
    readonly readNutritionDeadlineMs: number;
}

export class FoodServiceClients {
    /** @param options - The fixed origin + the typeahead and post-commit deadlines (see the class doc). */
    public constructor(private readonly options: FoodServiceClientsOptions) {}

    /**
     * A client on the DEFAULT (8s) budget, authenticated as `caller`, for the user-initiated
     * add/poll/candidates/resolve paths.
     *
     * @param caller - The caller's credential, or `undefined` (no bearer — e.g. the dev-auth bypass), in
     *   which case the client sends no `Authorization` and food will fail it closed. There is deliberately no
     *   fallback credential.
     * @returns A client bound to this caller and to the configured food origin.
     */
    public standard(caller: CallerToken | undefined): FoodServiceClient {
        return this.forCaller(caller, undefined);
    }

    /**
     * A client on the SHORT per-keystroke budget, authenticated as `caller`, for the Stage-2 blended
     * typeahead.
     *
     * @param caller - The caller's credential, or `undefined` (see {@link FoodServiceClients.standard}).
     * @returns A client bound to this caller, to the configured food origin, and to the typeahead deadline.
     */
    public typeahead(caller: CallerToken | undefined): FoodServiceClient {
        return this.forCaller(caller, this.options.typeaheadTimeoutMs);
    }

    /**
     * A client for the NUTRITION READ (plan U10) — the GET detail and the card batch — authenticated as `caller`.
     *
     * Takes the READ deadline, not the typeahead one: this call is on the recipe detail/list read path, not the
     * per-keystroke path, and it is the only source of a recipe's calories now that the duplicated columns are
     * gone. Cutting it to a sub-second budget would turn an ordinarily slow food response into "this recipe has no
     * nutrition" — a wrong answer where a slightly slower right one was available. ⛔ It is NOT the client's 8 s
     * default any more: that default, twice in series, is what let a read wait 16 s on food.
     *
     * ⚠️ That reasoning is about a READ. The response to a committed WRITE uses
     * {@link FoodServiceClients.postCommitNutrition} instead — see the class doc for why the trade flips there.
     *
     * @param caller - The caller's credential, forwarded so food's own auth decides what they may read.
     * @returns A client bound to this caller, the configured food origin, and the standard deadline.
     */
    public nutrition(caller: CallerToken | undefined): FoodServiceClient {
        return this.forCaller(caller, this.options.readNutritionDeadlineMs);
    }

    /**
     * A client for the nutrition a response carries AFTER its write has committed, on the short post-commit
     * budget, authenticated as `caller`. See the class doc for why this is a separate contract from
     * {@link FoodServiceClients.nutrition}.
     *
     * @param caller - The caller's credential, forwarded so food's own auth decides what they may read.
     * @returns A client bound to this caller, the configured food origin, and the post-commit deadline.
     */
    public postCommitNutrition(caller: CallerToken | undefined): FoodServiceClient {
        return this.forCaller(caller, this.options.postCommitNutritionTimeoutMs);
    }

    /**
     * The call-level deadline for one nutrition gateway lookup under `budget` — the bound over every request that
     * lookup issues, enforced by a signal the gateway hands each of them.
     *
     * - `'read'` — {@link FoodServiceClientsOptions.readNutritionDeadlineMs}.
     * - `'postCommit'` — twice the post-commit per-request timeout: a single recipe's lookup is at most two requests
     *   (one chunk, since `MAX_RECIPE_INGREDIENTS` ≤ `MAX_IDS_PER_REQUEST`, plus the authored call), which is the
     *   bound `MAX_POST_COMMIT_NUTRITION_TIMEOUT_MS` was derived against. Enforcing it as ONE deadline changes no
     *   healthy response and makes the derivation a guarantee rather than an argument.
     *
     * @param budget - The latency contract the lookup runs under.
     * @returns The deadline in milliseconds. Pure.
     */
    public nutritionLookupDeadlineMs(budget: NutritionReadBudget): number {
        switch (budget) {
            case 'read':
                return this.options.readNutritionDeadlineMs;
            case 'postCommit':
                return 2 * this.options.postCommitNutritionTimeoutMs;
        }
    }

    /**
     * Build the client. The ONE place the caller's bytes are read, and they are attached to the configured
     * origin only. The token is supplied as a callback rather than a literal so it is read at request time
     * (matching the client's `getToken` contract) and never sits in a captured string.
     *
     * @param caller - The caller's credential, or `undefined` for an unauthenticated client.
     * @param timeoutMs - Explicit transport deadline, or `undefined` to take the client's 8s default.
     * @returns The bound client.
     */
    private forCaller(caller: CallerToken | undefined, timeoutMs: number | undefined): FoodServiceClient {
        return new FoodServiceClient({
            baseUrl: this.options.baseUrl,
            ...(caller === undefined ? {} : { token: (): string => revealCallerToken(caller) }),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
        });
    }
}
