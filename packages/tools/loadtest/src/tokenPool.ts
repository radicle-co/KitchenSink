/**
 * The Clerk token-pool files the service k6 scenarios open at INIT.
 *
 * Three `deployed-capable` scenarios read a generated pool rather than minting their own: food's
 * `authFlood` and identity's `sessionHotPath` and `authRejection`. Their loaders run in the init context,
 * so a missing or wrongly-shaped file is not a failed assertion — the scenario never starts, and k6 exits
 * with a `GoError` naming a path.
 *
 * ⛔ THE TWO SHAPES ARE DIFFERENT AND BOTH ARE RIGHT. Food's loader validates `{ users: [...] }`;
 * identity's reads `TOKENS.warm` and `TOKENS.reject.<kind>`. They are not copies of one another, and
 * `packages/infra/global/__tests__/k6TokenPoolShape.test.ts` derives the required keys from the scenarios'
 * own source so neither can drift away from its consumer.
 */

/** The four invalid credentials `authRejection` presents, each exercising a different reject path. */
export interface RejectionTokens {
    /** A structurally valid token whose signature does not verify. */
    readonly badSignature: string;
    /** A real token past its expiry. */
    readonly expired: string;
    /** A real token minted against an origin this stage does not authorize. */
    readonly wrongAzp: string;
    /** Not a JWT at all. */
    readonly malformed: string;
}

/** The pool shape food's `loadTokens()` validates. */
export interface FoodTokenPool {
    /** The bearer tokens its scenarios rotate through. Never empty — its loader rejects that. */
    readonly users: readonly string[];
}

/** The pool shape identity's `TOKENS` exposes. */
export interface IdentityTokenPool {
    /** Warm principals — already provisioned, so a read measures the read and not a first-sight insert. */
    readonly warm: readonly string[];
    /** The invalid credentials the rejection storm presents. */
    readonly reject: RejectionTokens;
}

/**
 * Build the pool food's scenarios open.
 *
 * @param credentials - Live bearer tokens, one per pool identity.
 * @returns The food-shaped pool.
 * @throws {Error} when `credentials` is empty — an empty pool makes every request unauthenticated, which
 *   the scenario would measure as a fast 401 and report as a flattering percentile.
 */
export function buildFoodTokenPool(credentials: readonly string[]): FoodTokenPool {
    if (credentials.length === 0) {
        throw new Error('buildFoodTokenPool: no credentials — an empty pool measures an unauthenticated path');
    }

    return { users: [...credentials] };
}

/**
 * Build the pool identity's scenarios open.
 *
 * @param credentials - Live bearer tokens for the warm principals.
 * @param reject - The four invalid credentials the rejection storm presents.
 * @returns The identity-shaped pool.
 * @throws {Error} when `credentials` is empty, for the same reason as {@link buildFoodTokenPool}.
 */
export function buildIdentityTokenPool(credentials: readonly string[], reject: RejectionTokens): IdentityTokenPool {
    if (credentials.length === 0) {
        throw new Error('buildIdentityTokenPool: no credentials — an empty pool measures an unauthenticated path');
    }

    return { warm: [...credentials], reject };
}
