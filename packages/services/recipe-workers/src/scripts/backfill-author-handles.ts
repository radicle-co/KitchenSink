/**
 * W8-a.2 — one-off operational BACKFILL for the author/editor handle read model.
 *
 * Ongoing renames are kept current by the handle-sync producers + consumer; this seeds the state that
 * predates the feature. For every identity `profiles` row it applies a synthetic rename to the recipe DB
 * via the SAME `applyHandleRename` the live consumer uses — which seeds `author_handles` AND fans the
 * name out to the user's existing `recipes.author_handle` + `recipe_versions.editor_handle`. Idempotent by
 * construction (the monotonic guard): re-running it, or running it after some renames have already synced,
 * only applies rows that are strictly newer, so it never clobbers a fresher live value.
 *
 * It is a SCRIPT, not a migration — the schema-migration runner cannot read the identity logical database
 * (D2: identity + recipe are separate logical DBs). The CLI entrypoint at the bottom wires the two real
 * connections; {@link backfillAuthorHandles} is the pure, testable core (a reader + an applier).
 *
 * @module
 */
import type { HandleSyncMessage } from '../handlers/handle-sync-worker.js';

/** One identity profile the backfill seeds from. */
export interface IdentityProfile {
    readonly userId: string;
    readonly displayName: string;
    /** `profiles.updatedAt` — becomes the read model's `source_timestamp` (the monotonic clock). */
    readonly updatedAt: Date;
}

/** The outcome of a backfill run. */
export interface BackfillResult {
    readonly seen: number;
    readonly applied: number;
    readonly skipped: number;
}

/**
 * Backfill the recipe DB's handle read model from an identity-profiles source. Applies each profile through
 * `apply` (the live `applyHandleRename` semantics: monotonic upsert + fan-out); a profile with a blank
 * displayName is skipped (nothing to attribute). Pure over its injected reader + applier — no DB coupling.
 *
 * @param readProfiles - Yields the identity profiles to seed from (an async iterable, so it can stream).
 * @param apply - Applies one synthetic rename to the recipe DB, returning whether it was applied.
 * @returns Counts of profiles seen / applied / skipped.
 */
export async function backfillAuthorHandles(
    readProfiles: AsyncIterable<IdentityProfile>,
    apply: (message: HandleSyncMessage) => Promise<boolean>,
): Promise<BackfillResult> {
    let seen = 0;
    let applied = 0;
    let skipped = 0;

    for await (const profile of readProfiles) {
        seen += 1;

        if (profile.displayName.trim() === '') {
            skipped += 1;
            continue;
        }

        const wasApplied = await apply({
            userId: profile.userId,
            displayName: profile.displayName,
            sourceTimestamp: profile.updatedAt.toISOString(),
        });

        if (wasApplied) {
            applied += 1;
        } else {
            skipped += 1;
        }
    }

    return { seen, applied, skipped };
}
