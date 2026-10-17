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
 * @pattern Coalescing single-flight per cook — each pass runs in that cook's `drainLaneFor` lane, gated by the
 *     provider's session gate so a drain that outlives its cook claims, announces and schedules nothing more.
 */
import {
    EMPTY_OUTBOX,
    appendExclusive,
    appendIntent,
    applyDiscard,
    claimForSending,
    createFanout,
    createMemoryOutboxStore,
    drain,
    drainLaneFor,
    outboxMutatorFor,
    settle,
    supersede,
    unreadableLedgerFor,
    withdraw as withdrawRecord,
    type DiscardOutcome,
    type DiscardRequest,
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
     * The cook's confirmed Discard, as ONE change decided from the log as stored when it runs (`applyDiscard`): an
     * entity's delete withdraws every parked record it makes moot and queues the delete; a published recipe's parked
     * write is withdrawn only if it is still parked. It never rejects for a record's state — the Discard is the consent
     * `submit`'s delete refuses to assume — and cannot lose a race with a drain. It answers whether what was discarded
     * may still stand on the server. It rejects only when storage refuses the write.
     */
    readonly discard: (request: DiscardRequest) => Promise<DiscardOutcome>;
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
    /**
     * How many times this session set the signed-in cook's unreadable work aside (ADR-0057): the outbox's load and the
     * editor's draft store. A count of events, never a reading of the quarantine key (which lives until sign-out), and
     * never a count of records (unknowable when the bytes do not parse). Zero for no cook.
     */
    readonly unreadableCount: number;
}

const refuseUnmounted = async (): Promise<never> => {
    throw new Error('sync: submit called with no SyncProvider mounted');
};

const NOT_MOUNTED: SyncQueue = {
    submit: refuseUnmounted,
    submitExclusive: refuseUnmounted,
    withdraw: refuseUnmounted,
    discard: refuseUnmounted,
    subscribe: () => () => undefined,
    resolutionOf: () => undefined,
    pendingCount: 0,
    failures: [],
    unreadableCount: 0,
};

/** A set of listeners to the drain's settlements. */
interface SettlementBus {
    readonly subscribe: (listener: (event: SyncSettlement) => void) => () => void;
    readonly publish: (event: SyncSettlement) => void;
}

/** Where a failure the provider isolated is reported: the app's error reporter, with what failed as context. */
type FaultReporter = (error: unknown, context: Record<string, unknown>) => void;

/**
 * The provider's one settlement bus. Pure construction; the returned functions mutate the listener set.
 *
 * ⛔ ONE LISTENER'S BUG MUST NOT REACH THE DRAIN OR THE OTHER LISTENERS (a throw would reject the pass mid-queue, the rest
 * unsent), AND IT MUST BE REPORTED: a listener that throws (the write-cache or draft-answer observer) silently loses a
 * create's server id for the editor's draft. The shared `createFanout` does the isolating; each failure goes to `report`.
 *
 * @param report - Receives each listener failure. Stable for the provider's life.
 * @returns A bus.
 */
function createSettlementBus(report: FaultReporter): SettlementBus {
    const fanout = createFanout<SyncSettlement>();

    return {
        subscribe: (listener) =>
            fanout.subscribe(listener, (error) => {
                report(error, { source: 'syncSettlementListener' });
            }),
        publish: fanout.publish,
    };
}

/** Which cook the provider is serving now. */
interface SessionGate {
    /** Open `subject`'s session. Returns the function that closes it. */
    readonly begin: (subject: string) => () => void;
    /** Whether `subject` is the cook signed in now. */
    readonly isCurrent: (subject: string) => boolean;
}

/**
 * The provider's one session gate. Pure construction; the returned functions read and replace the open session.
 *
 * @returns A gate with no session open.
 */
function createSessionGate(): SessionGate {
    let open: string | undefined;

    return {
        begin: (subject) => {
            open = subject;

            return () => {
                open = undefined;
            };
        },
        isCurrent: (subject) => open === subject,
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
    /**
     * Receives a failure this provider isolates rather than lets through: a settlement or ledger listener that threw,
     * a sender that broke its contract by throwing, a drain pass that rejected. The app binds its error reporter;
     * omitted, they are isolated and unreported.
     */
    readonly onFault?: FaultReporter;
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
export const SyncProvider: FC<SyncProviderProps> = ({ subject, send, store, onFault, children }) => {
    // ⛔ A PROJECTION OF WHAT THE MUTATOR WROTE, NEVER WRITTEN BACK. The store is the one authority and the
    // mutator its one writer (`@kitchensink/sync`'s `outboxMutator.ts`); this state only mirrors it for render.
    const [log, setLog] = useState<OutboxLog>(EMPTY_OUTBOX);
    // Set when the server asked for a wait too long to sleep through inside a drain; the effect below re-drains.
    const [retryInMs, setRetryInMs] = useState<number | undefined>(undefined);
    // The ledger's count for the signed-in cook, and for whom it was read: a mirror, like `log`, never written back.
    const [unreadable, setUnreadable] = useState<{ readonly subject: string | undefined; readonly count: number }>({
        subject: undefined,
        count: 0,
    });
    const storeRef = useRef<OutboxStore>(store ?? createMemoryOutboxStore());
    const flushRef = useRef<() => Promise<void>>(async () => undefined);
    // ⛔ THE REPORTER IS READ THROUGH A REF, so the bus and the drain (made once) always report to the latest `onFault`.
    // Assigned in an effect, never in the render body (see `flushRef`).
    const onFaultRef = useRef<FaultReporter | undefined>(onFault);
    const [report] = useState((): FaultReporter => (error, context) => onFaultRef.current?.(error, context));
    // One bus and one session gate for the provider's life: created once by the initializer, never by a render.
    const [bus] = useState(() => createSettlementBus(report));
    const [sessions] = useState(createSessionGate);

    // ⛔ DECLARED FIRST, so the cook's session is open before the mount drain below asks for a drain under it, and
    // closed — by React running every cleanup of a change before any setup — before the next cook's opens.
    useEffect(() => {
        if (subject === undefined) {
            return undefined;
        }

        const endSession = sessions.begin(subject);
        let cancelled = false;
        const mutator = outboxMutatorFor(storeRef.current, subject);
        const unsubscribe = mutator.subscribe((next) => {
            if (!cancelled) {
                setLog(next);
            }
        });
        // ⛔ SUBSCRIBED BEFORE THE LOAD BELOW, and seeded from the ledger: the editor's draft store may have set drafts
        // aside before this effect ran, and the outbox's own load reports through the same ledger.
        const ledger = unreadableLedgerFor(storeRef.current, subject);

        const hearLedger = (count: number): void => {
            if (!cancelled) {
                setUnreadable({ subject, count });
            }
        };

        const unsubscribeLedger = ledger.subscribe(hearLedger, (error) => {
            report(error, { source: 'syncUnreadableLedger' });
        });

        hearLedger(ledger.count());

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
                // Nothing to show yet; `submit` reports its own storage failure, and the next drain (whose own
                // rejection is reported) re-reads.
            },
        );

        return () => {
            cancelled = true;
            endSession();
            unsubscribe();
            unsubscribeLedger();
        };
    }, [report, sessions, subject]);

    useEffect(() => {
        onFaultRef.current = onFault;
    }, [onFault]);

    const flush = useCallback(async (): Promise<void> => {
        // No signed-in subject means no queue to drain — and no key to read it under. A closure of a cook who has since
        // signed out asks for nothing: its pass would only take the place of a live one waiting in the lane.
        if (subject === undefined || !onlineManager.isOnline() || !sessions.isCurrent(subject)) {
            return;
        }

        const mutator = outboxMutatorFor(storeRef.current, subject);
        // ⛔ THE CLAIM AND THE ANNOUNCEMENT ASK WHETHER THIS COOK IS STILL SIGNED IN, because a drain outlives the
        // session it began in: its request on the wire answers after the cook changed. That answer still settles into
        // ITS cook's log (the journal is that cook's mutator), but the drain claims nothing more and announces nothing —
        // the listeners write into the query cache and drafts of whoever is signed in NOW. The records it did not claim
        // stay pending in that cook's outbox for their next session (ADR-0054 §4).
        const live = (): boolean => sessions.isCurrent(subject);
        // ⛔ EVERY STEP OF THE DRAIN IS ONE SMALL CHANGE THROUGH THE MUTATOR, addressed by sequence number, never a
        // write-back of the snapshot the drain loaded — so a record a `submit` appended meanwhile is never touched.
        const journal: DrainJournal = {
            claim: async (seq) => {
                if (!live()) {
                    return false;
                }

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

        const onSettled = (event: SyncSettlement): void => {
            if (live()) {
                bus.publish(event);
            }
        };

        // ⛔ ONE PASS, AND THE COOK'S LANE DECIDES WHEN IT RUNS (`drainLaneFor`). A trigger that lands while a pass is
        // running — a reconnect, a `submit`, this cook signing in again — is not dropped: the lane runs ITS pass once
        // the running one ends, with the sender and session current when it was asked for. Another cook's request on
        // the wire holds nothing here, because each cook's outbox has its own lane.
        await drainLaneFor(storeRef.current, subject).request(async () => {
            try {
                const current = await mutator.read();

                if (current.records.length === 0) {
                    return;
                }

                const result = await drain(current, send, {
                    journal,
                    onSettled,
                    onFault: (error, record) => {
                        report(error, { source: 'syncSender', ...record });
                    },
                });

                // ⛔ A STATED WAIT ENDS THIS PASS. The pause is stored with the log, so a drain started before it is over
                // sends nothing; the timer below drains again when it is. ⛔ Only for the cook signed in NOW: the timer
                // is the provider's one and serves them, while a drain that outlived its cook already wrote its pause into
                // that cook's log, and their next session's first drain re-arms it.
                if (result.retryAfterMs !== undefined && live()) {
                    setRetryInMs(result.retryAfterMs);
                }
            } catch (error) {
                report(error, { source: 'syncDrainPass' });

                // ⛔ A PASS MUST NOT REJECT, and this is a rejection handler rather than three. Every caller of `flush`
                // invokes it as `void flush()` — the mount drain, the `onlineManager` reconnect subscription, `submit`
                // and the retry timer.
                //
                // Swallowing is safe because the journal writes each step as it happens: a failed read leaves the outbox
                // intact, a failed claim happens BEFORE the request leaves, and a failed `settle` leaves the record
                // `sending`, which no drain re-sends and the next process start parks as an unknown outcome. Nothing the
                // server accepted is re-sent behind the cook's back.
                //
                // The failure goes to `onFault`, so a drain that fails repeatedly, or a `drainOrder` cycle (a
                // programming error, not a network one), reaches the app's error reporter instead of vanishing.
            }
        });
    }, [bus, report, send, sessions, subject]);

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

    const discard = useCallback(
        async (request: DiscardRequest): Promise<DiscardOutcome> => {
            if (subject === undefined) {
                throw new Error('sync: discard called with no signed-in subject');
            }

            let outcome: DiscardOutcome | undefined;

            // ⛔ ONE MUTATION: what the Discard does is decided from the log it changes, so neither a drain's claim nor
            // its settlement can come between the decision and the act.
            await outboxMutatorFor(storeRef.current, subject).mutate((current) => {
                const applied = applyDiscard(current, request);

                outcome = applied.outcome;

                return applied.log;
            });

            if (outcome === undefined) {
                throw new Error('sync: the outbox mutation did not run');
            }

            void flush();

            return outcome;
        },
        [flush, subject],
    );

    const value = useMemo<SyncQueue>(
        () => ({
            submit,
            submitExclusive,
            withdraw,
            discard,
            subscribe: bus.subscribe,
            resolutionOf: (ref) => log.resolutions[ref],
            pendingCount: log.records.length,
            failures: failuresOf(log),
            // Only the signed-in cook's own count: after a change of cook the mirror may still hold the last one's.
            unreadableCount: unreadable.subject === subject ? unreadable.count : 0,
        }),
        [bus, discard, log, subject, submit, submitExclusive, unreadable, withdraw],
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
