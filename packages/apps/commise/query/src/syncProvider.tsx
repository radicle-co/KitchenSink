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
    appendIntent,
    createMemoryOutboxStore,
    drain,
    loadOutbox,
    saveOutbox,
    type Intent,
    type OutboxLog,
    type OutboxStore,
    type Sender,
    type SyncFailure,
} from '@kitchensink/sync';
import { onlineManager } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FC, type ReactNode } from 'react';

/** What a surface can see and do with the queue. */
export interface SyncQueue {
    /** Queue a write. Resolves whether or not the network is there. */
    readonly submit: (intent: Intent) => Promise<{ readonly queued: true }>;
    /** How many writes have not reached the server yet — the figure the notice reports. */
    readonly pendingCount: number;
    /** Failures, each carrying the item it belongs to so the UI can render it in place. */
    readonly failures: readonly SyncFailure[];
}

const NOT_MOUNTED: SyncQueue = {
    submit: async () => {
        throw new Error('sync: submit called with no SyncProvider mounted');
    },
    pendingCount: 0,
    failures: [],
};

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
    readonly send: Sender;
    /** The platform storage adapter. Defaults to the volatile web one. */
    readonly store?: OutboxStore;
    readonly children: ReactNode;
}

/** Runs the queue for the signed-in user. */
export const SyncProvider: FC<SyncProviderProps> = ({ subject, send, store, children }) => {
    const [log, setLog] = useState<OutboxLog>({ records: [] });
    const [failures, setFailures] = useState<readonly SyncFailure[]>([]);
    const storeRef = useRef<OutboxStore>(store ?? createMemoryOutboxStore());
    // ⚠️ A drain in flight must not be re-entered by a second trigger (a reconnect while already draining),
    // or the same record is sent twice — the one duplicate this design cannot blame on the network.
    const draining = useRef(false);
    // Set when a drain is requested while one is already running; consumed by that drain as it finishes.
    const needsDrain = useRef(false);
    const flushRef = useRef<() => Promise<void>>(async () => undefined);

    useEffect(() => {
        if (subject === undefined) {
            return undefined;
        }

        let cancelled = false;

        // ⛔ THE REJECTION HANDLER IS NOT OPTIONAL. This was `void loadOutbox(…).then(…)` with no second
        // argument, so a store whose read REJECTED produced an UNHANDLED REJECTION — a redbox in React
        // Native dev and a silently dead effect in production. Web's store is in-memory and cannot fail,
        // which is exactly why it went unnoticed; mobile's is AsyncStorage, which can.
        //
        // ⚠️ THIS FIXES THE CRASH, NOT THE CLOBBER. Starting from an empty log means a later `saveOutbox`
        // would overwrite whatever is really on disk — the same single-writer defect already recorded below
        // as OWED before the first `submit` call site, and it must be fixed there, in one place, rather than
        // patched here. Left deliberately: surviving is strictly better than crashing, and both states are
        // unreachable today.
        void loadOutbox(storeRef.current, subject).then(
            (loaded) => {
                if (!cancelled) {
                    setLog({ records: loaded.records });
                }
            },
            () => {
                // Nothing to show yet; the queue still accepts writes and the next drain re-reads.
            },
        );

        return () => {
            cancelled = true;
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

        // ⛔ A `do/while`, NOT A RE-ENTRANT CALL AFTER THE `try`. The first version consumed `needsDrain`
        // AFTER the try/finally, so the empty-log `break` below — and any throw from `drain` or
        // `saveOutbox` — skipped it entirely, leaving the flag latched `true` forever and the re-arm
        // unconsumed on every path except the happy one. That is the same "a request was dropped" defect the
        // re-arm exists to fix, surviving inside its own fix. Looping here covers every exit.
        try {
            do {
                needsDrain.current = false;

                const current = await loadOutbox(storeRef.current, subject);

                if (current.records.length === 0) {
                    break;
                }

                // ⚠️ OWED BEFORE THE FIRST `submit` CALL SITE: this writes back the snapshot loaded above, so a
                // record appended by a concurrent `submit` is CLOBBERED IN STORAGE while `setLog` keeps it in
                // `pendingCount` — a queued write silently lost from the durable store while the UI still counts
                // it. The cure is one serialized mutator with the store as sole writer and React state a pure
                // projection. Unreachable today (zero `submit` call sites) and deliberately not a 5pm change.
                const report = await drain({ records: current.records }, send);

                await saveOutbox(storeRef.current, subject, report.log);
                setLog(report.log);
                setFailures(report.failed);
            } while (needsDrain.current);
        } catch {
            // ⛔ `flush` MUST NOT REJECT, and this is a rejection handler rather than three. Every caller
            // invokes it as `void flush()` — the mount drain, the `onlineManager` reconnect subscription and
            // `submit` — so a throw from `loadOutbox`, `saveOutbox` or `drain` became an UNHANDLED REJECTION
            // at all three, which on React Native is a redbox in dev and a dead effect in production. Fixing
            // it at the three call sites would be the same handler copied three times, and a fourth caller
            // would reintroduce the bug.
            //
            // Swallowing is the CORRECT behaviour for this layer's model, not a shortcut: a drain that
            // cannot complete is a DELAY, and offline is already defined as a delay. The queue stays intact
            // on disk and the next trigger re-reads and retries.
            //
            // ⚠️ AN EARLIER VERSION OF THIS COMMENT CLAIMED "send-level failures do NOT come through here at
            // all", and review disproved it against code in the same commit: `recipeSender` threw for an
            // unsupported intent kind, which landed exactly here. That is why a sender must not throw for a
            // record it cannot send — `drain` does not wrap `send`, and `saveOutbox` runs only after `drain`
            // RETURNS, so a throw at record N discards the successful sends of 1..N-1 and the next drain
            // re-sends them. `recipeSender` now parks such a record instead. A refusal REACHED by a send is
            // reported as `report.failed`; only a sender that cannot run at all reaches this catch.
            //
            // ⚠️ OWED, AND THE THIRD CASE IS NOT LIKE THE OTHER TWO — do not read one rationale onto all of
            // them. A `loadOutbox` throw happens BEFORE anything is sent, so "intact on disk, retry later"
            // is exactly right. A `saveOutbox` throw happens AFTER a successful drain: the sends ALREADY
            // HAPPENED, disk still holds the pre-drain records, `setLog`/`setFailures` never run, and the
            // next trigger RE-SENDS work the server has already accepted. On mobile that is an ordinary
            // AsyncStorage-full failure, on the one platform that persists. Swallowing keeps the app alive
            // but does not make that case safe.
            //
            // ⚠️ ALSO OWED: a drain that fails REPEATEDLY is invisible to the user, and a `drainOrder` cycle
            // — a programming error, not a network one — is swallowed with everything else. All of it wants
            // an error channel on the context, and the post-drain save wants the serialized mutator noted
            // above: `submit`'s `{queued:true}`, the drain clobber and this re-send are ONE defect with one
            // cure, not three. They become reachable together the moment a `submit` call site lands.
        } finally {
            draining.current = false;
        }
    }, [send, subject]);

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

    const submit = useCallback(
        async (intent: Intent): Promise<{ readonly queued: true }> => {
            if (subject === undefined) {
                // ⛔ REFUSED, NOT QUEUED ANONYMOUSLY. An outbox namespaced by a placeholder is a
                // cross-account read the first time a second person signs in on one device, and a silently
                // dropped write is the failure this whole layer exists to prevent.
                throw new Error('sync: submit called with no signed-in subject');
            }

            const next = appendIntent(
                await loadOutbox(storeRef.current, subject).then((l) => ({ records: l.records })),
                intent,
            );

            await saveOutbox(storeRef.current, subject, next);
            setLog(next);
            void flush();

            return { queued: true };
        },
        [flush, subject],
    );

    return (
        <SyncQueueContext.Provider value={{ submit, pendingCount: log.records.length, failures }}>
            {children}
        </SyncQueueContext.Provider>
    );
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
