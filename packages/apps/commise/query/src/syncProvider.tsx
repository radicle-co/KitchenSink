/**
 * @module @commise/query/sync — where the pure sync domain becomes a running queue.
 *
 * ⛔ THE HORIZONTAL LAYER THE OWNER ASKED FOR. A feature calls `submit` and awaits a promise; it never learns
 * whether the network was there. Offline is a PAUSE — the intent is durable, the write resolves optimistically,
 * and the queue drains when connectivity returns. No consumer branches on connectivity, and only the USER is
 * told about it.
 *
 * ⛔ THE DOMAIN IS IN A LEAF PACKAGE AND MUST STAY THERE. `@kitchensink/sync` depends on neither TanStack nor
 * any service client, which is what keeps `@commise/query` (which DOES depend on the recipe client) free of a
 * cycle when the recipe hooks reach the queue.
 *
 * @pattern Command Processor composed with an Observer subscription — the drainer is the processor, and
 *     `onlineManager` is the trigger; both are injected, so this file owns wiring and nothing else.
 */
import {
    EMPTY_OUTBOX,
    appendExclusive,
    appendIntent,
    claimForSending,
    createMemoryOutboxStore,
    drain,
    outboxMutatorFor,
    settle,
    supersede,
    withdraw as withdrawRecord,
    type DrainJournal,
    type Intent,
    type LocalRef,
    type OutboxLog,
    type OutboxStore,
    type Sender,
    type SettlementEvent,
    type SyncFailure,
} from '@kitchensink/sync';
import { onlineManager } from '@tanstack/react-query';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FC,
    type ReactNode,
} from 'react';

import type { SyncAnswer } from './syncAnswer.js';

/** One record's settlement, with a recipe write's answer. In memory only (`@kitchensink/sync`'s `SettlementEvent`). */
export type SyncSettlement = SettlementEvent<SyncAnswer>;

/** A parked write, with the sequence number that addresses it (`SyncQueue.withdraw`). */
export interface ParkedFailure extends SyncFailure {
    readonly seq: number;
}

/**
 * What {@link SyncQueue.submitExclusive} did: queued, which record of the same entity stood in the way, or — for a create
 * whose ref already resolved — the id the server made (`appendExclusive`).
 */
export type ExclusiveSubmit =
    | { readonly kind: 'queued'; readonly seq: number }
    | { readonly kind: 'inFlight'; readonly seq: number }
    | { readonly kind: 'parked'; readonly seq: number; readonly status?: number }
    | { readonly kind: 'resolved'; readonly serverId: string };

/** What a surface can see and do with the queue. */
export interface SyncQueue {
    /** Queue a write. Resolves whether or not the network is there. */
    readonly submit: (intent: Intent) => Promise<{ readonly queued: true }>;
    /**
     * Queue a write only while no other write of the same entity is on the wire or parked — the editor's one server
     * write per recipe (slice 7). A pending one of the same kind is replaced (whole drafts, so losslessly). Decided
     * inside the serialized mutation, so it cannot race the drain's claim. Resolves whether or not the network is there.
     */
    readonly submitExclusive: (intent: Intent) => Promise<ExclusiveSubmit>;
    /** Remove a parked write: the cook decided what happens to it. Rejects for a record that is not parked. */
    readonly withdraw: (seq: number) => Promise<void>;
    /**
     * Hear each record's settlement as the drain writes it. Returns the unsubscribe. ⛔ Events are not replayed: a
     * listener learns only what settles while it is subscribed, and the durable facts live in the stores.
     */
    readonly subscribe: (listener: (event: SyncSettlement) => void) => () => void;
    /** The server id a local ref resolved to, once its create synced. */
    readonly resolutionOf: (ref: LocalRef) => string | undefined;
    /** How many writes have not reached the server yet — the figure the notice reports. */
    readonly pendingCount: number;
    /** Failures, each carrying the item it belongs to so the UI can render it in place. */
    readonly failures: readonly ParkedFailure[];
}

const refuseUnmounted = async (): Promise<never> => {
    throw new Error('sync: submit called with no SyncProvider mounted');
};

const NOT_MOUNTED: SyncQueue = {
    submit: refuseUnmounted,
    submitExclusive: refuseUnmounted,
    withdraw: refuseUnmounted,
    subscribe: () => () => undefined,
    resolutionOf: () => undefined,
    pendingCount: 0,
    failures: [],
};

/** A set of listeners to the drain's settlements. */
interface SettlementBus {
    readonly subscribe: (listener: (event: SyncSettlement) => void) => () => void;
    readonly publish: (event: SyncSettlement) => void;
}

/**
 * The provider's one settlement bus. Pure construction; the returned functions mutate the listener set.
 *
 * @returns A bus.
 */
function createSettlementBus(): SettlementBus {
    const listeners = new Set<(event: SyncSettlement) => void>();

    return {
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        publish: (event) => {
            for (const listener of [...listeners]) {
                listener(event);
            }
        },
    };
}

const SyncQueueContext = createContext<SyncQueue>(NOT_MOUNTED);

/** Props for {@link SyncProvider}. */
export interface SyncProviderProps {
    /**
     * The IdP subject, which namespaces this user's queue, or `undefined` when nobody is signed in.
     *
     * ⛔ NOT THE APP-USER ULID. That is minted server-side on the first authenticated request, so a client
     * that has never been online does not have one — precisely the offline case. A queue keyed by nothing is
     * a cross-account read the first time a second person signs in on one device.
     *
     * ⛔ `undefined` IS HANDLED HERE, ON PURPOSE, RATHER THAN BY THE CALLER. Both apps used to gate the mount
     * — `{userId ? <SyncProvider…> : <>…</>}` — and that CHANGES THE ELEMENT TYPE at that tree position, so
     * when the IdP resolved a user React unmounted and REMOUNTED everything below, wiping the recipe editor
     * mid-flow. Six Playwright shards caught it. Owning the absent case here is what lets both platforms
     * mount unconditionally, which is the only shape that cannot remount. With no subject the queue does not
     * read storage, does not drain, and refuses `submit` — the namespacing guarantee is unchanged.
     */
    readonly subject: string | undefined;
    /** Sends one record. Injected, so this file never learns which client or transport. */
    readonly send: Sender<SyncAnswer>;
    /** The platform storage adapter. Defaults to the volatile web one. */
    readonly store?: OutboxStore;
    readonly children: ReactNode;
}

/**
 * The failures a log holds: one per parked record, carrying the item it belongs to. Pure.
 *
 * ⛔ A PROJECTION OF THE STORED LOG, NOT A SECOND STATE. Failures used to be whatever the LAST drain reported, so a
 * write parked before a relaunch was invisible after it until something re-sent it.
 */
export function failuresOf(log: OutboxLog): readonly ParkedFailure[] {
    return log.records
        .filter((record) => record.state === 'parked')
        .map((record) => ({
            seq: record.seq,
            entity: record.entity,
            intentKind: record.intentKind,
            localId: record.localId,
            ...(record.lastStatus === undefined ? {} : { status: record.lastStatus }),
        }));
}

/** Runs the queue for the signed-in user. */
export const SyncProvider: FC<SyncProviderProps> = ({ subject, send, store, children }) => {
    // ⛔ A PROJECTION OF WHAT THE MUTATOR WROTE, NEVER WRITTEN BACK. The store is the one authority and the
    // mutator its one writer (`@kitchensink/sync`'s `outboxMutator.ts`); this state only mirrors it for render.
    const [log, setLog] = useState<OutboxLog>(EMPTY_OUTBOX);
    // Set when the server asked for a wait too long to sleep through inside a drain; the effect below re-drains.
    const [retryInMs, setRetryInMs] = useState<number | undefined>(undefined);
    const storeRef = useRef<OutboxStore>(store ?? createMemoryOutboxStore());
    // ⚠️ A drain in flight must not be re-entered by a second trigger (a reconnect while already draining),
    // or the same record is sent twice — the one duplicate this design cannot blame on the network.
    const draining = useRef(false);
    // Set when a drain is requested while one is already running; consumed by that drain as it finishes.
    const needsDrain = useRef(false);
    const flushRef = useRef<() => Promise<void>>(async () => undefined);
    // One bus for the provider's life: created once by the initializer, never re-created by a render.
    const [bus] = useState(createSettlementBus);

    useEffect(() => {
        if (subject === undefined) {
            return undefined;
        }

        let cancelled = false;
        const mutator = outboxMutatorFor(storeRef.current, subject);
        const unsubscribe = mutator.subscribe((next) => {
            if (!cancelled) {
                setLog(next);
            }
        });

        // ⛔ THE REJECTION HANDLER IS NOT OPTIONAL. A store whose read REJECTS (AsyncStorage can) would otherwise be
        // an UNHANDLED REJECTION — a redbox in React Native dev and a silently dead effect in production. Nothing is
        // written on a failed read, so the stored outbox is intact for the next attempt.
        void mutator.read().then(
            (loaded) => {
                if (!cancelled) {
                    setLog(loaded);
                }
            },
            () => {
                // Nothing to show yet; `submit` reports its own storage failure, and the next drain re-reads.
            },
        );

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [subject]);

    const flush = useCallback(async (): Promise<void> => {
        // No signed-in subject means no queue to drain — and no key to read it under.
        if (subject === undefined || !onlineManager.isOnline()) {
            return;
        }

        // ⛔ A REFUSED DRAIN RE-ARMS; IT IS NOT DROPPED. The first version returned early while a drain was in
        // flight, so a reconnect — or a `submit` — landing inside that window was SILENTLY DISCARDED, and the
        // queue then sat until some unrelated connectivity transition. The failure was not a double-send; it
        // was a write that never left, which is the exact silence this layer exists to remove.
        if (draining.current) {
            needsDrain.current = true;

            return;
        }

        draining.current = true;

        const mutator = outboxMutatorFor(storeRef.current, subject);
        // ⛔ EVERY STEP OF THE DRAIN IS ONE SMALL CHANGE THROUGH THE MUTATOR, addressed by sequence number, never a
        // write-back of the snapshot the drain loaded — so a record a `submit` appended meanwhile is never touched.
        const journal: DrainJournal = {
            claim: async (seq) => {
                let claimed = false;

                await mutator.mutate((current) => {
                    const next = claimForSending(current, seq);

                    claimed = next !== undefined;

                    return next ?? current;
                });

                return claimed;
            },
            settle: async (settlement) => {
                await mutator.mutate((current) => settle(current, settlement));
            },
        };

        // ⛔ A `do/while`, NOT A RE-ENTRANT CALL AFTER THE `try`. The first version consumed `needsDrain`
        // AFTER the try/finally, so the empty-log `break` below — and any throw from `drain` or the store —
        // skipped it entirely, leaving the flag latched `true` forever and the re-arm unconsumed on every
        // path except the happy one. Looping here covers every exit.
        try {
            do {
                needsDrain.current = false;

                const current = await mutator.read();

                if (current.records.length === 0) {
                    break;
                }

                const report = await drain(current, send, { journal, onSettled: bus.publish });

                // ⛔ A STATED WAIT ENDS THIS FLUSH. The pause is stored with the log, so a drain started before it is
                // over sends nothing; the timer below drains again when it is.
                if (report.retryAfterMs !== undefined) {
                    setRetryInMs(report.retryAfterMs);

                    break;
                }
            } while (needsDrain.current);
        } catch {
            // ⛔ `flush` MUST NOT REJECT, and this is a rejection handler rather than three. Every caller
            // invokes it as `void flush()` — the mount drain, the `onlineManager` reconnect subscription,
            // `submit` and the retry timer — so a throw would be an UNHANDLED REJECTION at each.
            //
            // Swallowing is safe now in a way it was not before the mutator: the journal writes each step as it
            // happens, so a failed read leaves the outbox intact, a failed claim happens BEFORE the
            // request leaves, and a failed `settle` leaves the record `sending`, which no drain re-sends and the
            // next process start parks as an unknown outcome. Nothing the server accepted is re-sent behind the
            // cook's back.
            //
            // ⚠️ OWED: a drain that fails REPEATEDLY is invisible to the user, and a `drainOrder` cycle — a
            // programming error, not a network one — is swallowed with everything else. Both want an error
            // channel on the context.
        } finally {
            draining.current = false;
        }
    }, [bus, send, subject]);

    // ⛔ ASSIGNED IN AN EFFECT, NEVER IN THE RENDER BODY. A ref written during render is advanced by a
    // DISCARDED pass too, so the committed tree can end up holding a handle from a render that never
    // happened — the precise defect `useRecipeEditor`'s `submitDraftRef` shipped and was rewritten for. An
    // effect runs only for a render that committed. This effect is declared BEFORE the mount drain below, so
    // the handle is current by the time that one fires.
    useEffect(() => {
        flushRef.current = flush;
    }, [flush]);

    // ⛔ DRAIN ON MOUNT, NOT ONLY ON RECONNECT. `onlineManager.subscribe` fires on TRANSITIONS, so an app
    // relaunched while already online with a persisted outbox would never drain it — and surviving a restart
    // is the entire reason mobile persists at all. Without this, the queue waits for connectivity to drop
    // and return before it sends work the cook was told was saved.
    useEffect(() => {
        void flushRef.current();
    }, [subject]);

    // ⛔ THE RECONNECT DRAIN IS WHAT MAKES OFFLINE "JUST A DELAY". Without it the cook would have to trigger
    // a sync, which is a ritual the owner's model explicitly does not have.
    useEffect(() => onlineManager.subscribe(() => void flush()), [flush]);

    // ⛔ A WAIT THE SERVER STATED IS KEPT BY A TIMER, NOT BY A DRAIN ASLEEP. `drain` hands back any wait longer than
    // it will sleep through; this drains again when that wait is over, with no connectivity change to prompt it.
    useEffect(() => {
        if (retryInMs === undefined) {
            return undefined;
        }

        const timer = setTimeout(() => {
            setRetryInMs(undefined);
            void flush();
        }, retryInMs);

        return () => {
            clearTimeout(timer);
        };
    }, [flush, retryInMs]);

    const submit = useCallback(
        async (intent: Intent): Promise<{ readonly queued: true }> => {
            if (subject === undefined) {
                // ⛔ REFUSED, NOT QUEUED ANONYMOUSLY. An outbox namespaced by a placeholder is a
                // cross-account read the first time a second person signs in on one device, and a silently
                // dropped write is the failure this whole layer exists to prevent.
                throw new Error('sync: submit called with no signed-in subject');
            }

            // ⛔ RESOLVES ONLY ONCE THE STORE HOLDS IT. A storage failure rejects: nothing durable happened, so
            // `{queued: true}` would tell the cook their edit is safe when no disk holds it.
            // A delete SUPERSEDES what it makes moot rather than queueing beside it (`supersede`). It refuses to drop a
            // parked record silently, so that case rejects here and the caller confirms with the cook.
            await outboxMutatorFor(storeRef.current, subject).mutate((current) =>
                intent.intentKind === 'delete' ? supersede(current, intent) : appendIntent(current, intent),
            );
            void flush();

            return { queued: true };
        },
        [flush, subject],
    );

    const submitExclusive = useCallback(
        async (intent: Intent): Promise<ExclusiveSubmit> => {
            if (subject === undefined) {
                throw new Error('sync: submit called with no signed-in subject');
            }

            let outcome: ExclusiveSubmit | undefined;

            // ⛔ The check and the append are ONE mutation, so they cannot interleave with the drain's claim.
            await outboxMutatorFor(storeRef.current, subject).mutate((current) => {
                const result = appendExclusive(current, intent);

                if (result.kind === 'queued') {
                    outcome = { kind: 'queued', seq: result.seq };

                    return result.log;
                }

                outcome = result;

                return current;
            });

            if (outcome === undefined) {
                throw new Error('sync: the outbox mutation did not run');
            }

            if (outcome.kind === 'queued') {
                void flush();
            }

            return outcome;
        },
        [flush, subject],
    );

    const withdraw = useCallback(
        async (seq: number): Promise<void> => {
            if (subject === undefined) {
                throw new Error('sync: withdraw called with no signed-in subject');
            }

            await outboxMutatorFor(storeRef.current, subject).mutate((current) => withdrawRecord(current, seq));
        },
        [subject],
    );

    const value = useMemo<SyncQueue>(
        () => ({
            submit,
            submitExclusive,
            withdraw,
            subscribe: bus.subscribe,
            resolutionOf: (ref) => log.resolutions[ref],
            pendingCount: log.records.length,
            failures: failuresOf(log),
        }),
        [bus, log, submit, submitExclusive, withdraw],
    );

    return <SyncQueueContext.Provider value={value}>{children}</SyncQueueContext.Provider>;
};

/**
 * The queue.
 *
 * @returns The queue's surface. Throws from `submit` if no provider is mounted, rather than silently
 *     dropping a write — a dropped write is the failure this whole layer exists to prevent.
 */
export function useSyncQueue(): SyncQueue {
    return useContext(SyncQueueContext);
}
