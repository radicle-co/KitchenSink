/**
 * The seed function's event (curated catalog plan U2, KTD-4 and KTD-5), parsed at the JSON boundary.
 *
 * Two actions and no default. `apply` carries the digest of the bundle the pipeline built, so a function holding a
 * different bundle refuses rather than applying a seed nobody reviewed. `describe` carries nothing: the deploy gate
 * asks what a function holds and has no bundle of its own to digest.
 *
 * ⚠️ Deliberately NOT a shared parser with `migrateEvent.ts`. The two events change for different reasons (the
 * migrate runner has one action; the seed function has two), so the likeness is not duplicated knowledge.
 *
 * @pattern Parse, don't validate — a discriminated union the handler switches on exhaustively
 */
import { z } from 'zod';

import { isManifestSha } from './manifest.js';

/** What the pipeline asks of the seed function. */
export type SeedEvent = { readonly action: 'apply'; readonly expectSeedSha: string } | { readonly action: 'describe' };

/**
 * What `describe` answers: the digest of the asset the function holds, and the digest the database last recorded.
 *
 * `runSeed.sh describe` reads `current` only when both are well-formed and equal; anything else, a `null` ledger
 * included, reads stale, and the deploy gate deploys (KTD-5).
 */
export interface SeedDescription {
    readonly action: 'describe';
    /** The seed manifest digest of the function's own asset. */
    readonly assetSha: string;
    /** The newest `catalog_seed_ledger` digest, or `null` for a database never seeded. */
    readonly ledgerSha: string | null;
}

const SEED_EVENT = z.discriminatedUnion('action', [
    z
        .object({
            action: z.literal('apply'),
            expectSeedSha: z.string().refine(isManifestSha, 'must be a 64-character lowercase hex sha256'),
        })
        .strict(),
    z.object({ action: z.literal('describe') }).strict(),
]);

/** The seed function received an event that is not one of its two actions. */
export class MalformedSeedEventError extends Error {
    /** Each refused field as `path: reason`, `(root)` for the event itself. */
    public readonly issues: readonly string[];

    public constructor(issues: readonly string[]) {
        super(`seed function received a malformed event — ${issues.join(', ')}`);
        this.name = 'MalformedSeedEventError';
        this.issues = [...issues];
        Object.setPrototypeOf(this, MalformedSeedEventError.prototype);
    }
}

/**
 * Type guard for {@link MalformedSeedEventError}.
 *
 * @param value - The candidate.
 * @returns `true` when `value` is a malformed-event refusal.
 */
export function isMalformedSeedEventError(value: unknown): value is MalformedSeedEventError {
    return value instanceof MalformedSeedEventError;
}

/**
 * Parse the seed function's event.
 *
 * @param event - The raw invocation event.
 * @returns The action and its arguments.
 * @throws {MalformedSeedEventError} for anything that is not exactly one of the two actions. Pure.
 */
export function parseSeedEvent(event: unknown): SeedEvent {
    const parsed = SEED_EVENT.safeParse(event);

    if (!parsed.success) {
        throw new MalformedSeedEventError(
            parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
        );
    }

    return parsed.data;
}
