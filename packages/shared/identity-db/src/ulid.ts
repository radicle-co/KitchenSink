import { isValid, ulid } from 'ulidx';

/**
 * An application user id: a ULID, branded so it cannot be confused with a Clerk `sub` or any other string.
 *
 * ⚠️ The brand is the point. Both identifiers are opaque strings at runtime, and this service maps between
 * them constantly — `resolveOrCreateFromClaims` takes a Clerk `sub` and returns one of these — so an
 * unbranded alias would let the two swap silently at every boundary.
 */
export type UserId = string & { __brand: 'UserId' };

/**
 * Mint a new user id.
 *
 * @returns A fresh ULID, branded. Lexicographically sortable by creation time, which is why this is a ULID
 *   rather than a UUID: it gives the primary key a useful index order for free.
 * @sideEffect Reads the clock and a randomness source.
 */
export const newUserId = (): UserId => ulid() as UserId;

/**
 * Whether a string is a well-formed user id.
 *
 * @param s - The candidate.
 * @returns A type predicate narrowing to {@link UserId}. Pure — it validates SHAPE only, and says nothing
 *   about whether such a user exists.
 */
export const isUserId = (s: string): s is UserId => isValid(s);
