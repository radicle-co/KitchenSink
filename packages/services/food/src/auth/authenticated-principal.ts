/**
 * The authenticated principal the {@link FoodAuthGuard} attaches to every `/v1/foods/*` request, and
 * the request type augmented with it. Identity comes ONLY from the verified Clerk token (FR-038) —
 * no client-suppliable header is ever trusted.
 */
import type { Request } from 'express';

/** The verified principal driving enqueue provenance (FR-048) and scope checks (FR-039). */
export interface AuthenticatedPrincipal {
    /** The verified Clerk `sub` (the authenticated user or named service principal). */
    readonly sub: string;
    /** The authorized party the token was minted for (origin / service-client id), when present. */
    readonly azp?: string;
    /** Authorization scopes from the token's signed `public_metadata` (empty = no privilege). */
    readonly scopes: string[];
    /** Authorization permissions from the token's signed `public_metadata`. */
    readonly permissions: string[];
}

/** An Express request augmented by {@link FoodAuthGuard} with the verified principal. */
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
