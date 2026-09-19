/**
 * @module @kitchensink/sync — the durable shapes an outbox holds.
 *
 * An INTENT is a write the cook has made, independent of whether it has reached the server. Offline is a
 * pause, so an intent's lifetime is "from the moment it resolves optimistically until the server accepts or
 * refuses it" — which may be seconds or a day.
 */

/** The domains that can queue a write. */
export type SyncEntity = 'recipe' | 'ingredient' | 'photo' | 'collection';

/** What a queued write does. Distinct kinds coalesce differently, so this is not a free string. */
export type IntentKind = 'create' | 'update' | 'delete' | 'setVisibility' | 'createFreeform' | 'upload' | 'addMember';

/**
 * An opaque handle for a row that does not exist server-side yet.
 *
 * ⛔ NOT A SERVER ID. It is substituted for the real one at drain time — see `references.ts` — because the
 * server, not the client, decides the identity of a deduped freeform ingredient.
 */
export type LocalRef = string;

/** A write the cook has made, as the outbox holds it. */
export interface Intent {
    readonly entity: SyncEntity;
    readonly intentKind: IntentKind;
    /** Identifies the thing being written, within its entity. */
    readonly localId: string;
    /**
     * Local refs this payload EMBEDS — every one must drain first, and its resolved id is substituted in.
     *
     * ⛔ THIS IS NOT "WHAT THIS INTENT IS ABOUT" — see {@link Intent.concerns}. The two were ONE field in the
     * first draft and the overloading was a real defect: a validation that refs must be `local:`-prefixed
     * (needed, because a bare string silently skips substitution) then rejected a legitimate
     * "this membership-add is about recipe r1". Two facts, two fields.
     */
    readonly dependsOn: readonly LocalRef[];
    /**
     * The entities this intent is ABOUT, as `entity:localId`, for supersession.
     *
     * ⛔ THE CROSS-SCOPE CASE A KEYED MAP CANNOT SEE. A membership-add of recipe R into collection C is keyed
     * by C, so deleting R has to reach it through this field. Without it the drain sends a membership add for
     * a recipe that no longer exists.
     */
    readonly concerns?: readonly string[];
    /** The ref this intent RESOLVES when it drains, if it creates something others point at. */
    readonly produces?: LocalRef;
    /** The request body, opaque to the log. */
    readonly payload: unknown;
}

/** Where an intent is in its life. */
export type RecordState = 'pending' | 'blocked' | 'parked';

/** An intent plus the bookkeeping the drain needs. */
export interface OutboxRecord extends Intent {
    readonly state: RecordState;
}

/**
 * The on-disk format version.
 *
 * ⛔ HAND-BUMPED, and deliberately NOT derived from `CONTRACT_HASH`. That hash is taken over schema SOURCES,
 * so a comment-only edit moves it — which for a read cache is a harmless cold start, but for the outbox would
 * raise a data-loss prompt on every device because someone reworded a docstring. A bump here is a decision.
 */
export const LOCAL_SCHEMA_VERSION = 1;
