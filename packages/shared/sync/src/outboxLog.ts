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
import { LOCAL_REF_PREFIX, resolveRef, type ResolutionMap } from './references.js';
import type { Intent, LocalRef, OutboxRecord } from './record.js';

/** A user's outbox: the queued intents in append order, the record counter, and the ids drains have resolved. */
export interface OutboxLog {
    readonly records: readonly OutboxRecord[];
    /**
     * The sequence number the next record gets. ⛔ Persisted and only ever incremented: a counter derived from the
     * records still present would hand out a number a superseded in-flight record held, and that record's settlement
     * would then land on the new one.
     */
    readonly nextSeq: number;
    /**
     * Every local ref a drain has resolved, to its server id.
     *
     * ⛔ PERSISTED, NOT REBUILT PER DRAIN. An intent queued after its producer already synced has no producer left in
     * the log, so only this map can substitute its placeholder. It is cleared with the outbox at session end.
     */
    readonly resolutions: ResolutionMap;
    /**
     * Epoch milliseconds before which no record is sent: the server stated a wait (`Retry-After`) longer than a drain
     * sleeps through. ⛔ Persisted with the log, so the next `submit` or reconnect cannot re-send early.
     */
    readonly pausedUntil?: number;
}

/** The outbox of a device that has never queued a write. */
export const EMPTY_OUTBOX: OutboxLog = { records: [], nextSeq: 1, resolutions: {} };

/** What the drain reports about one record it handled, addressed by the record's sequence number. */
export type Settlement =
    | { readonly seq: number; readonly outcome: 'synced'; readonly serverId: string; readonly produces?: LocalRef }
    | { readonly seq: number; readonly outcome: 'parked'; readonly status?: number }
    | { readonly seq: number; readonly outcome: 'blocked' }
    | { readonly seq: number; readonly outcome: 'deferred'; readonly until: number };

/** Coalescing is per intent KIND, because "replace the pending one" is only lossless for some of them. */
function coalesces(existing: OutboxRecord, incoming: Intent): boolean {
    if (existing.entity !== incoming.entity || existing.localId !== incoming.localId) {
        return false;
    }

    // ⛔ A RECORD ON THE WIRE IS NEVER REPLACED. Its answer would be filed against the newer body, and a create
    // coalesced while in flight would be sent a second time.
    // ⛔ NOR IS A PARKED ONE. It is work the cook was told about and has not decided on: a create parked with an unknown
    // outcome may exist on the server, and replacing its body would send a second create. It leaves only by `withdraw`.
    if (existing.state === 'sending' || existing.state === 'parked') {
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

    const record: OutboxRecord = { ...incoming, seq: log.nextSeq, state: 'pending' };
    const index = log.records.findIndex((existing) => coalesces(existing, incoming));
    const nextSeq = log.nextSeq + 1;

    if (index === -1) {
        return { ...log, records: [...log.records, record], nextSeq };
    }

    // ⚠️ The replacement takes a NEW sequence number: it is a different body, and the old number may still be
    // referenced by a drain that has not reported back.
    return { ...log, records: log.records.map((existing, at) => (at === index ? record : existing)), nextSeq };
}

/** What {@link appendExclusive} did. */
export type ExclusiveAppend =
    | { readonly kind: 'queued'; readonly seq: number; readonly log: OutboxLog }
    /** A record of the same entity is on the wire; nothing was queued. */
    | { readonly kind: 'inFlight'; readonly seq: number }
    /** A record of the same entity is parked and waits for the cook; nothing was queued. */
    | { readonly kind: 'parked'; readonly seq: number; readonly status?: number };

/**
 * Queue an intent only when no other record of the same entity is on the wire or parked: the editor's one server write
 * per recipe (slice 7). A pending record of the same kind is replaced, losslessly, because the editor sends whole drafts.
 *
 * ⛔ DECIDED INSIDE THE SERIALIZED MUTATION, never by the caller reading the log first: a caller's check races the
 * drain's claim, and the second write would then 409 against the cook's own first one.
 *
 * @param log - The current log.
 * @param incoming - The intent to queue.
 * @returns The new log and the record's number, or which record stood in the way. Pure.
 */
export function appendExclusive(log: OutboxLog, incoming: Intent): ExclusiveAppend {
    const blocking = log.records.find(
        (record) =>
            record.entity === incoming.entity &&
            record.localId === incoming.localId &&
            (record.state === 'sending' || record.state === 'parked'),
    );

    if (blocking?.state === 'sending') {
        return { kind: 'inFlight', seq: blocking.seq };
    }

    if (blocking !== undefined) {
        return {
            kind: 'parked',
            seq: blocking.seq,
            ...(blocking.lastStatus === undefined ? {} : { status: blocking.lastStatus }),
        };
    }

    return { kind: 'queued', seq: log.nextSeq, log: appendIntent(log, incoming) };
}

/**
 * Remove a PARKED record: the cook (or the editor acting on the cook's choice in a conflict) has decided what happens
 * to it. The only way a parked record leaves the log.
 *
 * @param log - The current log.
 * @param seq - The parked record's number.
 * @returns A new log; the same log when no record has that number. Pure.
 * @throws If the record is not parked — a pending one belongs to the drain, a sending one is on the wire.
 */
export function withdraw(log: OutboxLog, seq: number): OutboxLog {
    const record = log.records.find((candidate) => candidate.seq === seq);

    if (record === undefined) {
        return log;
    }

    if (record.state !== 'parked') {
        throw new Error(`outbox: refusing to withdraw record ${String(seq)}, which is ${record.state}, not parked`);
    }

    return { ...log, records: log.records.filter((candidate) => candidate.seq !== seq) };
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

    // ⛔ A RECORD ON THE WIRE SURVIVES. It may already exist on the server, so dropping it — or annihilating a create
    // with the delete — could leave a recipe the cook removed. The delete then waits behind it (see below).
    const inFlight = doomed.filter((record) => record.state === 'sending');
    const survivors = log.records.filter((record) => record.state === 'sending' || !belongsTo(record, incoming));
    const nextSeq = log.nextSeq + 1;

    // ⛔ A DELETE OF A NEVER-DRAINED CREATE ANNIHILATES BOTH: the row never reached the server, so `DELETE`
    // would 404 — and reporting that to the cook would be a lie about a recipe they correctly removed.
    const neverSynced =
        inFlight.length === 0 &&
        doomed.some((record) => record.intentKind === 'create' || record.intentKind === 'createFreeform');

    if (neverSynced) {
        return { ...log, records: survivors, nextSeq };
    }

    // An in-flight producer's ref is added to the delete's dependencies, so the delete drains after it and is sent
    // with the server id the create returns substituted for the ref in its payload.
    const produced = inFlight.flatMap((record) => (record.produces === undefined ? [] : [record.produces]));
    const dependsOn = [...incoming.dependsOn, ...produced.filter((ref) => !incoming.dependsOn.includes(ref))];

    return { ...log, records: [...survivors, { ...incoming, dependsOn, seq: log.nextSeq, state: 'pending' }], nextSeq };
}

/**
 * Mark a record as on the wire. The drain journals this BEFORE the request leaves (see {@link recoverInterrupted}).
 *
 * @param log - The current log.
 * @param seq - The record's sequence number.
 * @returns A new log; unchanged when no record has that number. Pure.
 */
export function markSending(log: OutboxLog, seq: number): OutboxLog {
    return withRecord(log, seq, (record) => ({ ...record, state: 'sending' }));
}

/**
 * Claim a record for sending: mark it `sending`, but only if it is still queued as the drain saw it.
 *
 * ⛔ THE DRAIN WALKS A SNAPSHOT OVER NETWORK TIME. By a record's turn, the cook may have replaced it with a newer edit
 * (a new sequence number) or deleted it with its entity. Sending the snapshot's body then writes what the cook took
 * back, so the claim is made against the log as stored now. Same sequence number means same body.
 *
 * @param log - The log as stored now.
 * @param seq - The record the drain wants to send.
 * @returns The log with the record marked `sending`, or `undefined` when it is gone or already on the wire. Pure.
 */
export function claimForSending(log: OutboxLog, seq: number): OutboxLog | undefined {
    const record = log.records.find((candidate) => candidate.seq === seq);

    return record === undefined || record.state === 'sending' ? undefined : markSending(log, seq);
}

/**
 * Apply what the drain learned about one record.
 *
 * ⛔ ADDRESSED BY SEQUENCE NUMBER, AND A MISS IS A NO-OP. The record may have been replaced or superseded while it
 * was on the wire; its answer then belongs to nothing still queued. A resolution is still recorded, because the id
 * the server minted exists whether or not the record that asked for it does.
 *
 * @param log - The current log.
 * @param settlement - What happened to the record.
 * @returns A new log. Pure.
 */
export function settle(log: OutboxLog, settlement: Settlement): OutboxLog {
    switch (settlement.outcome) {
        case 'synced': {
            const resolutions =
                settlement.produces === undefined
                    ? log.resolutions
                    : resolveRef(log.resolutions, settlement.produces, settlement.serverId);

            return { ...log, records: log.records.filter((record) => record.seq !== settlement.seq), resolutions };
        }

        case 'parked':
            return withRecord(log, settlement.seq, ({ lastStatus: _previous, ...record }) => ({
                ...record,
                state: 'parked',
                ...(settlement.status === undefined ? {} : { lastStatus: settlement.status }),
            }));

        case 'blocked':
            return withRecord(log, settlement.seq, (record) => ({ ...record, state: 'blocked' }));

        case 'deferred': {
            const pausedUntil = Math.max(log.pausedUntil ?? 0, settlement.until);

            return { ...withRecord(log, settlement.seq, (record) => ({ ...record, state: 'pending' })), pausedUntil };
        }

        default: {
            const unreachable: never = settlement;

            return unreachable;
        }
    }
}

/**
 * Park every record a previous process left on the wire, as an UNKNOWN outcome.
 *
 * ⛔ RUN ONCE, ON THE FIRST READ OF A PROCESS. The server may hold such a record, so re-sending it would be the blind
 * retry the drainer forbids. A record THIS process marked `sending` is a live request and is never touched.
 *
 * @param log - The log as storage holds it.
 * @returns A new log. Pure.
 */
export function recoverInterrupted(log: OutboxLog): OutboxLog {
    return {
        ...log,
        records: log.records.map((record) => {
            if (record.state !== 'sending') {
                return record;
            }

            const { lastStatus: _none, ...interrupted } = record;

            return { ...interrupted, state: 'parked' };
        }),
    };
}

/** Replace the record numbered `seq`, if present. Pure. */
function withRecord(log: OutboxLog, seq: number, change: (record: OutboxRecord) => OutboxRecord): OutboxLog {
    if (!log.records.some((record) => record.seq === seq)) {
        return log;
    }

    return { ...log, records: log.records.map((record) => (record.seq === seq ? change(record) : record)) };
}
