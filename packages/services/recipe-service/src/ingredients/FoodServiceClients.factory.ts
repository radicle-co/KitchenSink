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
 * ## The two deadlines are the two callers' latency contracts (do NOT collapse them)
 *
 *  - {@link FoodServiceClients.standard} — the client's default 8s. Backs `addByName` / `getStatus` /
 *    `getCandidates` / `resolve`: user-initiated writes and polls where waiting seconds for a real answer
 *    beats failing.
 *  - {@link FoodServiceClients.typeahead} — a sub-second bound, for the Stage-2 blended suggest, which runs
 *    PER KEYSTROKE. Sharing the 8s budget there would let a degraded food service stall the typeahead for 8s
 *    a keystroke and pile up in-flight requests.
 *
 * Both bounds are enforced at the transport by a real `AbortSignal` inside the client, not by racing a timer
 * in the caller — a race returns early while leaving the request pending, leaking a socket per keystroke
 * during an outage.
 *
 * @implements FR-007 FR-047
 */
import { FoodServiceClient } from '@kitchensink/food-service-client';

import { revealCallerToken, type CallerToken } from '../auth/CallerToken.js';

/** Construction options: the fixed food origin plus the per-keystroke deadline. */
export interface FoodServiceClientsOptions {
    /** The food service origin for this stage (`FOOD_SERVICE_URL`), boot-validated — never request data. */
    readonly baseUrl: string;
    /** Per-keystroke bound (ms) applied to {@link FoodServiceClients.typeahead} clients. */
    readonly typeaheadTimeoutMs: number;
}

export class FoodServiceClients {
    /** @param options - The fixed origin + the typeahead deadline (see the class doc). */
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
