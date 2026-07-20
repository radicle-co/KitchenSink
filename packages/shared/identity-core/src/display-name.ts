/**
 * The single, shared derivation of a user's display name from their identity claims (W8-a.2 / decision 6).
 *
 * `profiles.displayName` IS the "@handle" the recipe surfaces render, and it is derived from the Clerk
 * first/last-name claims by ONE rule. This function is that rule, extracted into `@kitchensink/identity-core`
 * (dependency-light, mirroring `recipe-core`) so BOTH the identity service (`resolveOrCreateFromClaims`) and
 * the recipe service's write-time handle fallback compute it identically — no divergence, one place to change.
 *
 * @module
 */

/** The identity claims the display name is derived from (a subset of the verified Clerk token claims). */
export interface DisplayNameClaims {
    /** The user's first name, when present on the token. */
    readonly firstName?: string;
    /** The user's last name, when present on the token. */
    readonly lastName?: string;
}

/**
 * Derive a display name from first/last-name claims: the two joined by a space, each trimmed of surrounding
 * whitespace and skipped when blank. Returns an empty string when neither is present (the caller decides
 * whether to persist `undefined` vs the empty string — identity stores `displayName || undefined`). Pure.
 *
 * @param claims - The user's first/last-name claims.
 * @returns The derived display name, or `''` when nothing is derivable.
 */
export function deriveDisplayName(claims: DisplayNameClaims): string {
    return [claims.firstName, claims.lastName]
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
        .join(' ');
}
