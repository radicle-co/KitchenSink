/**
 * @module @kitchensink/sync — the drain: sending queued intents when connectivity returns.
 *
 * ⛔ THE RULE THAT REMOVES THE NEED FOR SERVER-SIDE IDEMPOTENCY — WHILE THE JOURNAL OUTLIVES THE WORK IT RECORDS. The
 * drainer auto-retries ONLY a request the server demonstrably did not process (429/502/503/504). A request whose
 * outcome is UNKNOWN — a timeout, a socket dropped mid-send, a process that died with it on the wire — may ALREADY have
 * been applied, so replaying it could write twice; it parks and the cook decides. That holds only while the parked
 * record lives at least as long as whatever could send the same write again: a journal that dies while the draft it
 * came from survives (an in-memory outbox under a reloaded page with a kept draft) forgets the record, and the draft's
 * next checkpoint sends it a second time. So every store an app gives the outbox lasts as long as its drafts do
 * (ADR-0057 §1: AsyncStorage on mobile, the tab's session storage on web). And the journal must have ONE owner: a
 * duplicated browser tab copies its session storage, journal included, and both tabs would send the same pending create.
 * The web store therefore tells the outbox when its journal may be a copy (`OutboxStore.isCopy`, a Web Lock per live
 * tab), and the copy's first read parks its pending creates for the cook (`recoverInterrupted`). Under those conditions
 * at-least-once delivery never happens behind the cook's back, and nothing needs to be idempotent that is not already:
 * no client-minted recipe id, no `ON CONFLICT` upsert, no unique index on a photo key. ⚠️ Two limits: without Web Locks
 * every first read on web parks pending creates, a reload included; and a copy's pending UPDATES stay queued in both
 * tabs, where the second to land meets a 409 (it names its version) and the conflict view, never a second write.
 *
 * ⛔ AND A TRANSIENT REFUSAL IS RE-SENT AFTER A WAIT, never immediately: full-jitter backoff under a doubling ceiling,
 * floored at the server's `Retry-After`. A wait too long to sleep through ends the drain and is handed back to the
 * caller to schedule.
 *
 * The rules here — the journal, the re-send rule, the backoff — are ADR-0057's, with the format they write.
 *
 * @pattern Command Processor — it owns the send loop, the classification, the backoff and the parking; it does not
 *     own WHICH client sends (that is injected), where the log is stored (the journal is), or what anything means to a
 *     user.
 */
import { classifyFailure, type SyncFailure } from './itemStatus.js';
import { drainOrder, markSending, settle, type OutboxLog, type Settlement } from './outboxLog.js';
import { substituteRefs } from './references.js';
import type { IntentKind, OutboxRecord, SyncEntity } from './record.js';

/**
 * What a send attempt produced.
 *
 * `answer` is the sender's own reading of the response — the recipe an update returned, a 409's two sides — opaque to
 * this package and handed to {@link DrainOptions.onSettled}. It is never stored.
 */
export type SendResult<A = unknown> =
    | { readonly outcome: 'ok'; readonly serverId: string; readonly answer?: A }
    | {
          readonly outcome: 'failed';
          readonly status?: number;
          /**
           * The seconds the server's `Retry-After` asked for, already parsed (`@kitchensink/retry-after` at the
           * sender, which owns the header). A floor under the backoff, never a replacement for it.
           */
          readonly retryAfterSeconds?: number;
          readonly answer?: A;
      };

/** Sends one record. Injected, so the domain never learns which client or which transport. */
export type Sender<A = unknown> = (record: OutboxRecord) => Promise<SendResult<A>>;

/**
 * One record's settlement, as the drain reports it to whoever queued it (slice 7: the editor learns the version its
 * update produced, or a 409's sides, by the record's sequence number).
 *
 * ⛔ IN MEMORY ONLY, NEVER PART OF THE LOG. The durable facts an answer carries are already stored where they belong —
 * a created id in the log's resolutions, a version in the editor's draft — and a second stored copy would drift.
 */
export interface SettlementEvent<A = unknown> {
    readonly seq: number;
    readonly entity: SyncEntity;
    readonly localId: string;
    readonly intentKind: IntentKind;
    readonly outcome: 'synced' | 'parked';
    readonly serverId?: string;
    /** The HTTP status a parked record was refused with; absent for an unknown outcome. */
    readonly status?: number;
    readonly answer?: A;
}

/**
 * Where the drain writes down each step AS IT HAPPENS. The outbox mutator implements it; a test may record it.
 *
 * ⛔ `claim` IS AWAITED BEFORE THE REQUEST LEAVES and `settle` right after the answer, so storage is never behind the
 * wire by more than one record: a crash leaves a synced record gone and an interrupted one `sending`.
 */
export interface DrainJournal {
    /**
     * Mark the record `sending` in the log as stored now, if it is still there as the drain saw it
     * (`claimForSending`). Resolves `false` when it was replaced, deleted or is already on the wire: the drain then
     * neither sends nor settles it.
     */
    readonly claim: (seq: number) => Promise<boolean>;
    readonly settle: (settlement: Settlement) => Promise<void>;
}

/** The clock and the coin, injected so the backoff is testable without waiting. */
export interface DrainOptions<A = unknown> {
    readonly journal?: DrainJournal;
    /**
     * Told about each record that synced or parked, AFTER the journal wrote it, so a listener that reads the store
     * finds the settlement already there. A record skipped, blocked or deferred is not reported.
     */
    readonly onSettled?: (event: SettlementEvent<A>) => void;
    /** Resolves after `ms`. Defaults to `setTimeout`. */
    readonly sleep?: (ms: number) => Promise<void>;
    /** A uniform draw in [0, 1). Defaults to `Math.random` — the jitter needs no cryptographic strength. */
    readonly random?: () => number;
    /** The current time, epoch milliseconds. Defaults to `Date.now`. */
    readonly now?: () => number;
}

/** What a drain produced. */
export interface DrainReport {
    /** The log the drain was given, with every settlement applied — what a caller with no journal persists. */
    readonly log: OutboxLog;
    readonly synced: readonly { readonly entity: string; readonly localId: string; readonly serverId: string }[];
    readonly failed: readonly SyncFailure[];
    /**
     * Set when the drain stopped because the server asked for a wait longer than {@link MAX_INLINE_WAIT_MS}: how long
     * to wait before draining again. The records from there on are untouched and still pending.
     */
    readonly retryAfterMs?: number;
}

/** How many times a transient refusal is sent before it parks. */
const MAX_TRANSIENT_ATTEMPTS = 3;

/** The first backoff ceiling; it doubles per attempt. */
const BASE_BACKOFF_MS = 500;

/** The largest backoff ceiling. */
const MAX_BACKOFF_MS = 8_000;

/**
 * The longest wait the drain sleeps through. Beyond it the drain ends and the caller schedules the next one.
 *
 * ⛔ THE DRAIN IS SERIAL AND HOLDS THE QUEUE'S ONE DRAIN SLOT, so a minute's `Retry-After` slept inline would stall
 * every record behind it for a minute while the app looked stuck.
 */
export const MAX_INLINE_WAIT_MS = 10_000;

/**
 * Whether a record may be sent by this drain.
 *
 * ⛔ A PARKED RECORD IS RE-SENT ONLY WHEN THAT CANNOT WRITE TWICE: a transient refusal (the server did not process
 * it) or `401` (the sender refused before sending, because its cook was signed out). An unknown outcome, a conflict
 * and a terminal refusal wait for the cook — re-sending an unknown outcome on the next reconnect is the blind retry
 * this module's rule forbids, one trigger later.
 */
function sendable(record: OutboxRecord): boolean {
    // ⛔ Drains are serialized, so a record already `sending` is one whose answer was never written down: unknown.
    if (record.state === 'sending') {
        return false;
    }

    if (record.state !== 'parked') {
        return true;
    }

    if (record.lastStatus === 401) {
        return true;
    }

    return classifyFailure({ ...record, ...statusOf(record.lastStatus) }) === 'transient';
}

/** A status as an optional property. Pure. */
function statusOf(status: number | undefined): { readonly status?: number } {
    return status === undefined ? {} : { status };
}

/**
 * The wait before attempt `attempt + 1`: a uniform draw under a doubling ceiling ("full jitter"), floored at what the
 * server asked for.
 *
 * Hand-written rather than taken from `p-retry`, which the tools use: that library retries a function that THROWS,
 * while this sender never throws by contract (`recipeSender.ts`), and it cannot end a serial drain early and hand the
 * wait back to the caller. The formula is three lines; the policy around it is this module's.
 *
 * @param attempt - The attempt that just failed, from 1.
 * @param retryAfterSeconds - The server's stated wait, if any.
 * @param random - The coin.
 * @returns Milliseconds. Pure given `random`.
 */
function backoffMs(attempt: number, retryAfterSeconds: number | undefined, random: () => number): number {
    const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
    const jittered = Math.floor(random() * ceiling);
    const stated = retryAfterSeconds === undefined ? 0 : Math.max(0, retryAfterSeconds) * 1000;

    return Math.max(jittered, stated);
}

/** A record's identity, as a settlement event names it. Pure. */
function identityOf(record: OutboxRecord): Pick<SettlementEvent, 'seq' | 'entity' | 'localId' | 'intentKind'> {
    return { seq: record.seq, entity: record.entity, localId: record.localId, intentKind: record.intentKind };
}

/** A sender's answer as an optional property. Pure. */
function answerOf<A>(result: SendResult<A>): { readonly answer?: A } {
    return result.answer === undefined ? {} : { answer: result.answer };
}

/** The default sleep. @sideEffect Arms a timer. */
const sleepFor = async (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

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
 * @param log - The queued intents, with the resolutions earlier drains made.
 * @param send - The injected sender.
 * @param options - The journal, the clock and the coin.
 * @returns The resulting log plus what synced and what failed. @sideEffect Calls `send`, the journal and `sleep`.
 */
export async function drain<A = unknown>(
    log: OutboxLog,
    send: Sender<A>,
    options: DrainOptions<A> = {},
): Promise<DrainReport> {
    const sleep = options.sleep ?? sleepFor;
    const random = options.random ?? Math.random;
    const now = options.now ?? Date.now;
    const synced: { entity: string; localId: string; serverId: string }[] = [];
    const failed: SyncFailure[] = [];
    const parkedRefs = new Set<string>();
    let current = log;

    // ⛔ A WAIT THE SERVER STATED HOLDS FOR THE WHOLE OUTBOX: a `429` is per cook, a `503` per service, so nothing else
    // would fare better. The remaining wait goes back to the caller to schedule.
    if (log.pausedUntil !== undefined && log.pausedUntil > now()) {
        return { log, synced, failed, retryAfterMs: log.pausedUntil - now() };
    }

    const record = async (settlement: Settlement): Promise<void> => {
        current = settle(current, settlement);
        await options.journal?.settle(settlement);
    };

    for (const queued of drainOrder(log)) {
        if (!sendable(queued) || queued.dependsOn.some((ref) => parkedRefs.has(ref))) {
            if (queued.state === 'pending' || queued.state === 'blocked') {
                await record({ seq: queued.seq, outcome: 'blocked' });
            }

            if (queued.produces !== undefined) {
                parkedRefs.add(queued.produces);
            }

            continue;
        }

        // ⛔ NEVER SEND A PLACEHOLDER. A dependency still unresolved here was not synced by this drain (its producer was
        // skipped, or queued after the snapshot was read). The record waits, pending, for a later drain.
        if (queued.dependsOn.some((ref) => current.resolutions[ref] === undefined)) {
            continue;
        }

        const claimed = options.journal === undefined ? true : await options.journal.claim(queued.seq);

        if (!claimed) {
            continue;
        }

        current = markSending(current, queued.seq);

        let result: SendResult<A> | undefined;
        let deferMs: number | undefined;

        for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
            result = await send({ ...queued, payload: substituteRefs(queued.payload, current.resolutions) });

            if (result.outcome === 'ok' || classifyFailure({ ...queued, ...statusOf(result.status) }) !== 'transient') {
                break;
            }

            if (attempt === MAX_TRANSIENT_ATTEMPTS) {
                break;
            }

            const wait = backoffMs(attempt, result.retryAfterSeconds, random);

            if (wait > MAX_INLINE_WAIT_MS) {
                deferMs = wait;

                break;
            }

            await sleep(wait);
        }

        if (deferMs !== undefined) {
            await record({ seq: queued.seq, outcome: 'deferred', until: now() + deferMs });

            return { log: current, synced, failed, retryAfterMs: deferMs };
        }

        if (result !== undefined && result.outcome === 'ok') {
            synced.push({ entity: queued.entity, localId: queued.localId, serverId: result.serverId });
            await record({
                seq: queued.seq,
                outcome: 'synced',
                serverId: result.serverId,
                ...(queued.produces === undefined ? {} : { produces: queued.produces }),
            });
            options.onSettled?.({
                ...identityOf(queued),
                outcome: 'synced',
                serverId: result.serverId,
                ...answerOf(result),
            });

            continue;
        }

        const status = result?.outcome === 'failed' ? result.status : undefined;

        failed.push({
            entity: queued.entity,
            intentKind: queued.intentKind,
            localId: queued.localId,
            ...statusOf(status),
        });
        await record({ seq: queued.seq, outcome: 'parked', ...statusOf(status) });
        options.onSettled?.({
            ...identityOf(queued),
            outcome: 'parked',
            ...statusOf(status),
            ...(result === undefined ? {} : answerOf(result)),
        });

        if (queued.produces !== undefined) {
            parkedRefs.add(queued.produces);
        }
    }

    return { log: current, synced, failed };
}
