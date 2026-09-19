/**
 * @module @kitchensink/sync — the outbox log: ordering, coalescing and supersession.
 *
 * ⛔ A LOG, NOT A MAP KEYED BY ENTITY. A keyed map forfeits ordering, and ordering is load-bearing: a recipe
 * embedding a not-yet-created freeform ingredient must not be sent first (the server rejects the WHOLE body
 * for one unknown id), and deleting a recipe must also remove a pending membership-add whose own key is
 * scoped to a COLLECTION rather than to that recipe.
 *
 * Every function here is pure: it takes a log and returns a new one. The store persists what these return.
 *
 * @pattern Transactional Outbox in its LOG form — an ordered, dependency-aware set of intents with
 *     at-most-once delivery, not a coalescing map.
 */
import { LOCAL_REF_PREFIX } from './references.js';
import type { Intent, OutboxRecord } from './record.js';

/** The queued intents, in append order. */
export interface OutboxLog {
    readonly records: readonly OutboxRecord[];
}

/** Coalescing is per intent KIND, because "replace the pending one" is only lossless for some of them. */
function coalesces(existing: OutboxRecord, incoming: Intent): boolean {
    if (existing.entity !== incoming.entity || existing.localId !== incoming.localId) {
        return false;
    }

    // ⛔ A PHOTO IS NEVER COALESCED — each upload is its own bytes with its own outcome, so replacing one
    // would silently discard a picture the cook took.
    if (incoming.entity === 'photo') {
        return false;
    }

    // ⛔ VISIBILITY IS A SEPARATE ENDPOINT WITH ITS OWN POLICY. Folded into a create, one C-004 refusal would
    // take the whole recipe down and tell the cook their recipe failed when only its privacy did.
    return existing.intentKind === incoming.intentKind;
}

/**
 * Add an intent, coalescing it into a compatible pending one where that is lossless.
 *
 * @param log - The current log.
 * @param incoming - The intent to queue.
 * @returns A new log. Pure.
 */
export function appendIntent(log: OutboxLog, incoming: Intent): OutboxLog {
    // ⛔ REFS ARE VALIDATED AT ENTRY, because a malformed one fails SILENTLY downstream. `substituteRefs`
    // only rewrites values carrying the `local:` prefix, so a bare `'ing:x'` would order the drain correctly
    // and then send the payload with the placeholder still in it — a server rejection hours later, blamed on
    // the cook's data instead of on the caller that built the intent. Refusing here keeps the stack trace
    // pointing at that caller.
    for (const ref of [...incoming.dependsOn, ...(incoming.produces === undefined ? [] : [incoming.produces])]) {
        // ⚠️ The prefix is tested DIRECTLY rather than through `isLocalRef`: `LocalRef` is an alias for
        // `string`, so a `value is LocalRef` guard narrows the negative branch to `never` and the compiler
        // reports the throw as unreachable — while the runtime case is entirely real, since a caller can
        // hand us any string and a record read off disk is untrusted.
        if (!ref.startsWith(LOCAL_REF_PREFIX)) {
            throw new Error(`outbox: ${ref} is not a local reference (expected a \`local:\` prefix)`);
        }
    }

    const record: OutboxRecord = { ...incoming, state: 'pending' };
    const index = log.records.findIndex((existing) => coalesces(existing, incoming));

    if (index === -1) {
        return { records: [...log.records, record] };
    }

    return { records: log.records.map((existing, at) => (at === index ? record : existing)) };
}

/**
 * The order in which intents may be sent: dependencies before dependents, append order otherwise.
 *
 * ⛔ THROWS ON A CYCLE rather than draining an arbitrary half of one. A cycle is a programming error in a
 * write definition, and half-sending it would leave the server holding a fragment nobody can reason about.
 *
 * @param log - The log to order.
 * @returns The records in a safe send order. Pure.
 */
export function drainOrder(log: OutboxLog): readonly OutboxRecord[] {
    const produced = new Map(
        log.records.flatMap((record) => (record.produces === undefined ? [] : [[record.produces, record] as const])),
    );
    const ordered: OutboxRecord[] = [];
    const visiting = new Set<OutboxRecord>();
    const done = new Set<OutboxRecord>();

    const visit = (record: OutboxRecord): void => {
        if (done.has(record)) {
            return;
        }

        if (visiting.has(record)) {
            throw new Error(`outbox: dependency cycle at ${record.entity}:${record.localId}`);
        }

        visiting.add(record);

        for (const ref of record.dependsOn) {
            const dependency = produced.get(ref);

            if (dependency !== undefined) {
                visit(dependency);
            }
        }

        visiting.delete(record);
        done.add(record);
        ordered.push(record);
    };

    for (const record of log.records) {
        visit(record);
    }

    return ordered;
}

/** Whether `record` is about the entity `incoming` deletes, directly or by depending on it. */
function belongsTo(record: OutboxRecord, incoming: Intent): boolean {
    return (
        (record.entity === incoming.entity && record.localId === incoming.localId) ||
        (record.concerns ?? []).includes(`${incoming.entity}:${incoming.localId}`)
    );
}

/**
 * Apply a delete, removing everything it makes moot — across scopes and transitively.
 *
 * ⛔ IT REFUSES TO REMOVE A PARKED RECORD SILENTLY. A parked intent is work the system told the cook was
 * safe; discarding it without a word is the data loss this whole layer exists to prevent. The caller must
 * confirm with the cook first.
 *
 * @param log - The current log.
 * @param incoming - The delete intent.
 * @returns A new log. Pure.
 * @throws If a record it would remove is parked.
 */
export function supersede(log: OutboxLog, incoming: Intent): OutboxLog {
    const doomed = log.records.filter((record) => belongsTo(record, incoming));
    const parked = doomed.find((record) => record.state === 'parked');

    if (parked !== undefined) {
        throw new Error(
            `outbox: refusing to supersede a parked ${parked.entity}:${parked.localId} — confirm with the user first`,
        );
    }

    const survivors = log.records.filter((record) => !belongsTo(record, incoming));

    // ⛔ A DELETE OF A NEVER-DRAINED CREATE ANNIHILATES BOTH: the row never reached the server, so `DELETE`
    // would 404 — and reporting that to the cook would be a lie about a recipe they correctly removed.
    const neverSynced = doomed.some(
        (record) => record.intentKind === 'create' || record.intentKind === 'createFreeform',
    );

    if (neverSynced) {
        return { records: survivors };
    }

    return { records: [...survivors, { ...incoming, state: 'pending' }] };
}
