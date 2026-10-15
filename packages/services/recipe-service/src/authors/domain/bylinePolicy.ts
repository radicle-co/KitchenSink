/**
 * Which byline a recipe write stores — the precedence between the recipe database's read model and the caller's
 * token (plan 2026-10-15-010 D8).
 *
 * The READ MODEL wins. `author_handles` holds identity's latest byline snapshot, applied by the handle-sync consumer
 * and seeded when the cook is created, while a token can be up to a minute stale. Read-model-first is what makes
 * every ordering converge: a snapshot applied BEFORE this write is read here; one applied AFTER fans out to this row.
 * Claim-first leaves a recipe written with a stale token after the snapshot landed stale for good. The token is only
 * the fallback for a cook the read model has not seen yet.
 *
 * ⚠️ When a row exists it answers BOTH halves, including "no username": the row is a newer statement of the same
 * Clerk fact the token carries.
 *
 * @pattern Policy — a pure decision module, the sibling of `visibilityPolicy` and `provenancePolicy`
 * @module
 */
import { deriveDisplayName, parseUsername, type DisplayNameClaims } from '@kitchensink/identity-core';

/** The byline a recipe or version row stores. A missing half is stored as NULL, never as `''`. */
export interface Byline {
    /** The display name, or absent when neither source knows one. */
    readonly displayName?: string;
    /** The Clerk username, or absent when the cook has none (or neither source says). */
    readonly username?: string;
}

/** One `author_handles` row's byline. */
export interface BylineReadModel {
    readonly displayName: string;
    readonly username: string | null;
}

/** The token claims the fallback reads. */
export interface BylineClaims extends DisplayNameClaims {
    readonly username?: string;
}

/**
 * Resolve the byline to store. Pure.
 *
 * @param readModel - The cook's `author_handles` row, or `undefined` when there is none.
 * @param claims - The caller's verified token claims.
 * @returns The byline; each half absent when unknown.
 */
export function resolveByline(readModel: BylineReadModel | undefined, claims: BylineClaims): Byline {
    const displayName = readModel !== undefined ? readModel.displayName : deriveDisplayName(claims);
    const username = readModel !== undefined ? (readModel.username ?? undefined) : parseUsername(claims.username);

    return {
        ...(displayName !== '' ? { displayName } : {}),
        ...(username !== undefined ? { username } : {}),
    };
}
