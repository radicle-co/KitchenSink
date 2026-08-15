/**
 * The authenticated principal the `FoodAuthGuard` attaches to every `/api/v1/foods/*` request, and
 * the request type augmented with it. Identity comes ONLY from the verified Clerk token (FR-038) —
 * no client-suppliable header is ever trusted.
 */
import type { Request } from 'express';

/** The verified principal driving enqueue provenance (FR-048) and scope checks (FR-039). */
export interface AuthenticatedPrincipal {
    /**
     * The verified Clerk `sub` (the authenticated user or named service principal). For a **user**
     * principal this is trace/audit only and is NEVER the requester key (CR-002/U1 — see {@link userId}
     * and {@link resolveRequesterId}); for a **service** principal (`svc_*`) it IS the requester key.
     */
    readonly sub: string;
    /**
     * The app-user ULID (identity's `users.id`), surfaced from the token's `external_id` claim by
     * `@kitchensink/clerk-verify`. THE user requester key (CR-002/U1/R5). Optional: absent until
     * identity backfills `external_id` to Clerk (the first-token sync race) — the fetch pipeline DEFERS
     * rather than record the raw `sub`. Service (`svc_*`) principals never carry it.
     */
    readonly userId?: string;
    /** The authorized party the token was minted for (origin / service-client id), when present. */
    readonly azp?: string;
    /** Authorization scopes from the token's signed `public_metadata` (empty = no privilege). */
    readonly scopes: string[];
    /** Authorization permissions from the token's signed `public_metadata`. */
    readonly permissions: string[];
}

/**
 * Wire/error code signalling that a verified user token carries no `external_id` (app-user ULID) yet —
 * the first-token sync race. Mirrors recipe-service's `IDENTITY_SYNC_PENDING` contract so a client keys
 * on the SAME code across services to refresh its token and retry with backoff. Deliberately NOT
 * imported from `@kitchensink/recipe-core` — food does not depend on the recipe domain; the shared
 * value is the coupling, not a shared module.
 */
export const IDENTITY_SYNC_PENDING_CODE = 'IDENTITY_SYNC_PENDING';

/** Prefix marking an allowlisted named service principal (M2M / internal job) — mirrors provenance. */
const SERVICE_PRINCIPAL_PREFIX = 'svc_';

/**
 * The outcome of resolving a principal to its `fetch_requesters` key (CR-002/U1). Either a concrete
 * requester id (an app ULID for a user, or a `svc_*` id for a service), or a DEFER signal when a user
 * token's `external_id` has not synced yet.
 */
export type RequesterKeyResolution =
    | { readonly status: 'resolved'; readonly requesterId: string }
    | { readonly status: typeof IDENTITY_SYNC_PENDING_CODE };

/**
 * Resolve the id to record in `fetch_requesters` for a verified principal (CR-002/U1/R5). Pure.
 *
 * - A **service** principal (`svc_*` sub) keys on its own `svc_*` id (unchanged from pre-U1).
 * - A **user** principal keys on the app-user ULID ({@link AuthenticatedPrincipal.userId}, from the
 *   token's `external_id`) — NEVER the Clerk `sub`.
 * - A user principal whose `external_id` has not synced yet (`userId` absent/empty) resolves to
 *   `IDENTITY_SYNC_PENDING`: the caller MUST defer (never fall back to the raw `sub`, which would
 *   re-introduce the exact keying this unit removes and would fail provenance downstream anyway).
 *
 * @param principal - The verified principal from `FoodAuthGuard`.
 * @returns A resolved requester id, or the sync-pending defer signal.
 */
export function resolveRequesterId(principal: AuthenticatedPrincipal): RequesterKeyResolution {
    if (principal.sub.startsWith(SERVICE_PRINCIPAL_PREFIX)) {
        return { status: 'resolved', requesterId: principal.sub };
    }

    if (principal.userId !== undefined && principal.userId.length > 0) {
        return { status: 'resolved', requesterId: principal.userId };
    }

    return { status: IDENTITY_SYNC_PENDING_CODE };
}

/** An Express request augmented by `FoodAuthGuard` with the verified principal. */
export interface AuthenticatedRequest extends Request {
    /** Present only after the guard has verified the token. */
    user?: AuthenticatedPrincipal;
}

/** The elevated scope required by operational endpoints (manual re-fetch, FR-039). */
export const FOOD_ADMIN_SCOPE = 'food:admin';

/**
 * Whether a principal holds a scope (authorization check, FR-039). Pure.
 *
 * @param principal - The verified principal (or `undefined` — treated as no privilege).
 * @param scope - The required scope.
 * @returns `true` when the principal carries `scope`.
 */
export function hasScope(principal: AuthenticatedPrincipal | undefined, scope: string): boolean {
    return principal?.scopes.includes(scope) ?? false;
}
