/**
 * @module @kitchensink/sync — the drain: sending queued intents when connectivity returns.
 *
 * ⛔ THE RULE THAT REMOVES THE NEED FOR SERVER-SIDE IDEMPOTENCY. The drainer auto-retries ONLY a request the
 * server demonstrably did not process (429/502/503/504). A request whose outcome is UNKNOWN — a timeout, a
 * socket dropped mid-send — may ALREADY have been applied, so replaying it could write twice; it parks and
 * the cook decides. Because at-least-once delivery therefore never happens behind their back, nothing needs
 * to be idempotent that is not already: no client-minted recipe id, no `ON CONFLICT` upsert, no unique index
 * on a photo key. One rule, a large amount of server work deleted.
 *
 * @pattern Command Processor — it owns the send loop, the classification and the parking; it does not own
 *     WHICH client sends (that is injected) or what anything means to a user.
 */
import { classifyFailure, type SyncFailure } from './itemStatus.js';
import { drainOrder, type OutboxLog } from './outboxLog.js';
import { resolveRef, substituteRefs, type ResolutionMap } from './references.js';
import type { OutboxRecord } from './record.js';

/** What a send attempt produced. */
export type SendResult =
    { readonly outcome: 'ok'; readonly serverId: string } | { readonly outcome: 'failed'; readonly status?: number };

/** Sends one record. Injected, so the domain never learns which client or which transport. */
export type Sender = (record: OutboxRecord) => Promise<SendResult>;

/** What a drain produced. */
export interface DrainReport {
    readonly log: OutboxLog;
    readonly synced: readonly { readonly entity: string; readonly localId: string; readonly serverId: string }[];
    readonly failed: readonly SyncFailure[];
}

/**
 * How many times a transient refusal is re-sent before it parks.
 *
 * ⚠️ THESE THREE ATTEMPTS HAVE NO DELAY BETWEEN THEM — a 429 or 503 is re-sent immediately, three times.
 * That contradicts this module's own thundering-herd rationale for draining serially, and a 429 is the one
 * status where a delay is not optional. Owed: jittered backoff honouring `Retry-After`.
 */
const MAX_TRANSIENT_ATTEMPTS = 3;

/**
 * Drain the log.
 *
 * ⛔ SERIAL, AND THAT IS A DECISION. A recipe with three new freeform ingredients issues four writes, and a
 * fleet reconnecting after an outage would otherwise arrive as a thundering herd at one Fargate task. It is
 * also what makes the ordering observable rather than incidental.
 *
 * ⛔ A DEPENDENT OF A PARKED INTENT IS `blocked`, NOT FAILED. Its embedded id is unresolved, so it cannot be
 * sent — but the cook has ONE problem to fix, not two, and reporting both is how an error state becomes
 * noise.
 *
 * @param log - The queued intents.
 * @param send - The injected sender.
 * @returns The resulting log plus what synced and what failed. @sideEffect Calls `send`.
 */
export async function drain(log: OutboxLog, send: Sender): Promise<DrainReport> {
    const ordered = drainOrder(log);
    const synced: { entity: string; localId: string; serverId: string }[] = [];
    const failed: SyncFailure[] = [];
    const remaining: OutboxRecord[] = [];
    const parkedRefs = new Set<string>();
    let resolved: ResolutionMap = {};

    for (const record of ordered) {
        const blocked = record.dependsOn.some((ref) => parkedRefs.has(ref));

        if (blocked) {
            remaining.push({ ...record, state: 'blocked' });

            if (record.produces !== undefined) {
                parkedRefs.add(record.produces);
            }

            continue;
        }

        let result: SendResult | undefined;

        for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
            result = await send({ ...record, payload: substituteRefs(record.payload, resolved) });

            if (result.outcome === 'ok' || classifyFailure({ ...record, status: result.status }) !== 'transient') {
                break;
            }
        }

        if (result !== undefined && result.outcome === 'ok') {
            synced.push({ entity: record.entity, localId: record.localId, serverId: result.serverId });

            if (record.produces !== undefined) {
                resolved = resolveRef(resolved, record.produces, result.serverId);
            }

            continue;
        }

        const failure: SyncFailure = {
            entity: record.entity,
            intentKind: record.intentKind,
            localId: record.localId,
            ...(result?.status === undefined ? {} : { status: result.status }),
        };

        failed.push(failure);
        remaining.push({ ...record, state: 'parked' });

        if (record.produces !== undefined) {
            parkedRefs.add(record.produces);
        }
    }

    return { log: { records: remaining }, synced, failed };
}
