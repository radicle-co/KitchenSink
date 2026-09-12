/**
 * @module @kitchensink/sync — local references and their resolution at drain time.
 *
 * ⛔ WHY NOT A CLIENT-MINTED ID. For a recipe, the client could mint one: `recipes.id` is a plain uuid with a
 * random default. For a FREEFORM INGREDIENT it must not, and the reason is in the schema — `ingredients`
 * carries a unique index on `lower(name)` where `is_user_entered`, so freeform rows dedupe BY NAME, globally
 * across users. A client-minted id is therefore ignored the moment any user anywhere already holds that name:
 * the server answers with THEIR row's id.
 *
 * So the client mints a local REFERENCE, the drainer sends the create, and whatever id comes back — created
 * or deduped, possibly a stranger's row — is substituted into every intent that pointed at it. The dependency
 * edge carries a VALUE, not just an ordering constraint, and that one mechanism also covers
 * collection→membership and recipe→photo.
 *
 * @pattern Value Object (`LocalRef`) plus a pure substitution over an opaque payload.
 */
import type { LocalRef, SyncEntity } from './record.js';

/** Local ref → the server id that replaced it. */
export type ResolutionMap = Readonly<Record<string, string>>;

/** How many random characters a minted reference carries. Collision here is a local-only nuisance. */
const REF_ENTROPY = 12;

/**
 * The marker that distinguishes a local reference from a server id.
 *
 * ⛔ ONE SOURCE. Both the minting and the two validation sites read it, so the shape cannot drift — and a
 * drifted prefix is invisible: substitution would simply stop firing and the placeholder would ship.
 */
export const LOCAL_REF_PREFIX = 'local:';

/**
 * Mint a reference for a row that does not exist server-side yet.
 *
 * ⛔ IT IS DELIBERATELY NOT UUID-SHAPED. A ref that looked like a server id could be sent by a code path
 * that forgot to substitute, and the server would either reject it — blaming the cook's data for our bug —
 * or accept it as a real foreign key. The `local:` prefix makes that mistake visible and assertable.
 *
 * @param entity - The domain the row belongs to.
 * @returns A fresh reference. @sideEffect Reads a random source.
 */
export function mintLocalRef(entity: SyncEntity): LocalRef {
    const random = Math.random()
        .toString(36)
        .slice(2, 2 + REF_ENTROPY);

    return `local:${entity}:${random}`;
}

/**
 * Whether a value is a local reference rather than a server id.
 *
 * Exported because the outbox validates refs at entry — a malformed one is silent downstream.
 *
 * @param value - Any value.
 * @returns Whether it is a local reference. Pure.
 */
export function isLocalRef(value: unknown): value is LocalRef {
    return typeof value === 'string' && value.startsWith(LOCAL_REF_PREFIX);
}

/**
 * Record the server id a drained intent produced.
 *
 * @param map - The resolutions so far.
 * @param ref - The local reference.
 * @param serverId - The id the server answered with — which may belong to a deduped row it already had.
 * @returns A new map. Pure.
 */
export function resolveRef(map: ResolutionMap, ref: LocalRef, serverId: string): ResolutionMap {
    return { ...map, [ref]: serverId };
}

/**
 * Rewrite every local reference in a payload to its resolved server id.
 *
 * ⛔ AN UNRESOLVED REF THROWS. Sending a payload still carrying `local:…` produces a server rejection later,
 * attributed to the cook's data rather than to our bug — the worst possible failure attribution. Failing at
 * the drain keeps the blame where it belongs.
 *
 * @param payload - Any request body.
 * @param resolved - The resolutions recorded so far.
 * @returns The payload with refs replaced. Pure.
 * @throws If the payload embeds a reference that has not been resolved.
 */
export function substituteRefs(payload: unknown, resolved: ResolutionMap): unknown {
    if (isLocalRef(payload)) {
        const serverId = resolved[payload];

        if (serverId === undefined) {
            throw new Error(`sync: unresolved local reference ${payload} — its producer has not drained`);
        }

        return serverId;
    }

    if (Array.isArray(payload)) {
        return payload.map((item) => substituteRefs(item, resolved));
    }

    if (typeof payload === 'object' && payload !== null) {
        return Object.fromEntries(
            Object.entries(payload).map(([key, value]) => [key, substituteRefs(value, resolved)]),
        );
    }

    return payload;
}
