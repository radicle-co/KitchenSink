/**
 * The Clerk username at our boundary — the public byline (owner ruling 2026-10-13). Clerk is its authority: it
 * enforces uniqueness and the character rules, and we store and render exactly what it sends.
 *
 * Defined once here so the webhook payload, the handle-sync message and every consumer of the token claim apply the
 * same bound.
 *
 * @module
 */
import { z } from 'zod';

/**
 * The longest username accepted. Clerk documents usernames as "between 4 and 64 characters" by default, customisable
 * per instance (https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options, read 2026-10-15).
 * The minimum is NOT 4 here: an instance may lower it, and a username Clerk accepted must never be refused downstream.
 */
export const MAX_USERNAME_LENGTH = 64;

/**
 * A username as Clerk sends it. No trim and no case fold: Clerk owns the value, and whether it lowercases is not
 * documented, so a normalisation here would be a second opinion that could only make two systems disagree.
 */
export const usernameSchema = z.string().min(1).max(MAX_USERNAME_LENGTH);

/**
 * Parse an untrusted username (a token claim), dropping anything the boundary refuses. Pure.
 *
 * @param value - The claim, as verified but not shape-checked.
 * @returns The username, or `undefined` when absent or invalid.
 */
export function parseUsername(value: unknown): string | undefined {
    const parsed = usernameSchema.safeParse(value);

    return parsed.success ? parsed.data : undefined;
}
