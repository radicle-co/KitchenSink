/**
 * `SyncProvider` — the composition that turns the pure sync domain into a running queue.
 *
 * ⛔ WRITTEN FROM THE SPECIFICATION, BEFORE THE IMPLEMENTATION EXISTS.
 *
 * The domain (`@kitchensink/sync`) knows nothing about React, TanStack or any service client. This is the
 * one place those meet, so it is the one place the interesting composition failures live.
 */
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    EMPTY_OUTBOX,
    appendIntent,
    appendToQuarantine,
    claimForSending,
    createMemoryOutboxStore,
    loadOutbox,
    outboxMutatorFor,
    quarantineKeyFor,
    saveOutbox,
    storeKeyFor,
    settle,
    type Intent,
    type OutboxStore,
    type SendResult,
} from '@kitchensink/sync';

import { SyncProvider, useSyncQueue, type SyncQueue } from '../syncProvider.js';

/** Surfaces the queue's own state as text, so assertions read what a component would see. */
function Probe(): ReactElement {
    const queue = useSyncQueue();

    return (
        <>
            <span>pending:{queue.pendingCount}</span>
            <span>failed:{queue.failures.length}</span>
            <span>unreadable:{queue.unreadableCount}</span>
        </>
    );
}

afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
});

describe('SyncProvider', () => {
    it('starts with an empty queue', () => {
        render(
            <SyncProvider subject="user_a" send={vi.fn()}>
                <Probe />
            </SyncProvider>,
        );

        expect(screen.getByText('pending:0')).toBeTruthy();
    });

    /**
     * ⛔ A WRITE RESOLVES WHILE OFFLINE — the owner's central requirement. The consumer awaits a promise and
     * gets an answer; it never learns that the network was absent.
     */
    it('⛔ resolves a submitted write while offline, without the caller knowing why', async () => {
        act(() => {
            onlineManager.setOnline(false);
        });

        let resolved: unknown;

        const Caller = (): ReactElement => {
            const queue = useSyncQueue();

            return (
                <button
                    type="button"
                    onClick={() => {
                        void queue
                            .submit({
                                entity: 'recipe',
                                intentKind: 'update',
                                localId: 'r1',
                                dependsOn: [],
                                payload: { title: 'edited' },
                            })
                            .then((value) => {
                                resolved = value;
                            });
                    }}
                >
                    save
                </button>
            );
        };

        const send = vi.fn();
        render(
            <SyncProvider subject="user_a" send={send}>
                <Caller />
            </SyncProvider>,
        );

        await act(async () => {
            screen.getByRole('button', { name: 'save' }).click();
        });

        await waitFor(() => expect(resolved).toBeDefined());
        // ⛔ NOT SENT: offline means queued, and the sender must not have been called at all.
        expect(send).not.toHaveBeenCalled();
    });

    /**
     * ⛔ RECONNECTING DRAINS WITHOUT THE COOK DOING ANYTHING. This is the property that makes offline "just a
     * delay" rather than a mode with its own recovery ritual.
     */
    it('⛔ drains automatically when connectivity returns', async () => {
        act(() => {
            onlineManager.setOnline(false);
        });

        const send = vi.fn(async () => ({ outcome: 'ok' as const, serverId: 'srv-1' }));

        const Caller = (): ReactElement => {
            const queue = useSyncQueue();

            return (
                <button
                    type="button"
                    onClick={() => {
                        void queue.submit({
                            entity: 'recipe',
                            intentKind: 'update',
                            localId: 'r1',
                            dependsOn: [],
                            payload: {},
                        });
                    }}
                >
                    save
                </button>
            );
        };

        render(
            <SyncProvider subject="user_a" send={send}>
                <Caller />
            </SyncProvider>,
        );
        await act(async () => {
            screen.getByRole('button', { name: 'save' }).click();
        });
        expect(send).not.toHaveBeenCalled();

        await act(async () => {
            onlineManager.setOnline(true);
        });

        await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    });

    /**
     * ⛔ DRAINS ON MOUNT, NOT ONLY ON RECONNECT — and this is the assertion the Maestro restart flow rests on.
     * `onlineManager.subscribe` fires on TRANSITIONS, so an app relaunched while already online with a
     * persisted outbox would never send it. Surviving a restart is the whole reason mobile persists, so a
     * queue that only drains on a connectivity edge would make that persistence pointless.
     */
    it('⛔ drains a queue restored from storage at mount, with no connectivity change', async () => {
        const send = vi.fn(async () => ({ outcome: 'ok' as const, serverId: 'srv-1' }));
        const store = createMemoryOutboxStore();
        await saveOutbox(store, 'user_a', {
            ...EMPTY_OUTBOX,
            records: [
                {
                    entity: 'recipe',
                    intentKind: 'update',
                    localId: 'r1',
                    dependsOn: [],
                    payload: {},
                    seq: 1,
                    state: 'pending',
                },
            ],
            nextSeq: 2,
        });

        render(
            <SyncProvider subject="user_a" send={send} store={store}>
                <Probe />
            </SyncProvider>,
        );

        await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    });

    /**
     * ⛔ A DRAIN REQUESTED DURING A DRAIN IS RE-ARMED, NOT DROPPED.
     *
     * ⚠️ THE FIRST VERSION OF THIS TEST COULD NOT OBSERVE THE THING IT NAMED, and review caught it by
     * deleting the re-arm and watching the suite stay green. Two reasons it was vacuous: it asserted
     * `calls.length >= 1`, which the preceding `waitFor(toHaveBeenCalledTimes(1))` had already made true; and
     * structurally, the first drain synced the only record and saved an empty log, so a re-armed drain had
     * nothing left to send even when it ran.
     *
     * So the store is SCRIPTED: it hands out a different record on the second read. The mount drain takes
     * `R1` and blocks in `send`; a connectivity flap arms the re-arm; releasing the send lets the re-armed
     * pass pick up `R2`. Two distinct sends is something only a working re-arm can produce.
     */
    it('⛔ re-runs the drain when one is requested while another is in flight', async () => {
        let release: (() => void) | undefined;
        const sent: string[] = [];
        const send = vi.fn(async (record: { readonly localId: string }) => {
            sent.push(record.localId);

            if (sent.length === 1) {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
            }

            return { outcome: 'ok' as const, serverId: `srv-${record.localId}` };
        });

        const record = (localId: string, seq: number) => ({
            entity: 'recipe' as const,
            intentKind: 'update' as const,
            localId,
            dependsOn: [],
            payload: {},
            seq,
            state: 'pending' as const,
        });
        // ⚠️ Keyed on OBSERVABLE STATE, not a read counter: the provider reads storage once to hydrate and
        // again to drain, so counting reads made the very first send pick up `R2`. "Has anything been sent
        // yet" is the fact that actually distinguishes the two passes.
        // ⚠️ Writes are ignored on purpose — the point is that a later read sees new work, which is what a
        // concurrent `submit` would have produced.
        const store = {
            getItem: async () =>
                JSON.stringify({
                    schemaVersion: 1,
                    nextSeq: 3,
                    resolutions: {},
                    records: [sent.length === 0 ? record('R1', 1) : record('R2', 2)],
                }),
            setItem: async () => undefined,
            removeItem: async () => undefined,
        };

        render(
            <SyncProvider subject="user_a" send={send as never} store={store}>
                <Probe />
            </SyncProvider>,
        );

        await waitFor(() => expect(sent).toStrictEqual(['R1']));

        await act(async () => {
            onlineManager.setOnline(false);
            onlineManager.setOnline(true);
        });

        await act(async () => {
            release?.();
        });

        // ⛔ TWO DISTINCT SENDS. Delete the re-arm and this stops at ['R1'].
        await waitFor(() => expect(sent).toStrictEqual(['R1', 'R2']));
    });

    /**
     * ⛔ A FAILURE REACHES THE SURFACE WITH ITS SCOPE, so the UI can render it next to the thing that failed
     * rather than as an anonymous banner. This is the owner's error-proximity requirement at the seam.
     */
    it('⛔ reports a failure with the item it belongs to', async () => {
        const send = vi.fn(async () => ({ outcome: 'failed' as const, status: 422 }));

        const Caller = (): ReactElement => {
            const queue = useSyncQueue();

            return (
                <button
                    type="button"
                    onClick={() => {
                        void queue.submit({
                            entity: 'ingredient',
                            intentKind: 'createFreeform',
                            localId: 'gochujang',
                            dependsOn: [],
                            payload: {},
                        });
                    }}
                >
                    save
                </button>
            );
        };

        render(
            <SyncProvider subject="user_a" send={send}>
                <Caller />
                <Probe />
            </SyncProvider>,
        );

        await act(async () => {
            screen.getByRole('button', { name: 'save' }).click();
        });

        await waitFor(() => expect(screen.getByText('failed:1')).toBeTruthy());
    });
    // ⛔ FOUND BY A MOUNT TEST ONE PACKAGE OVER, NOT BY REVIEW. A fake store with the wrong port shape made
    // `loadOutbox` reject, and the rejection surfaced as an UNHANDLED REJECTION — the mount read was
    // `void loadOutbox(…).then(…)` with no rejection handler at all. That is not a test-only artifact: web's
    // store is in-memory and cannot fail, but mobile's is AsyncStorage, which genuinely can. On React Native
    // an unhandled rejection is a redbox in dev and a silent kill of the effect in production.
    //
    // The contract asserted here is DELIBERATELY NARROW: the app must survive and keep accepting writes. It
    // does NOT claim the unread outbox is empty — a failed read followed by a successful save would clobber
    // whatever was on disk, and that is the same single-writer defect already recorded as OWED before the
    // first `submit` call site. Fixing the crash must not be mistaken for fixing the clobber.
    // ⚠️ WHERE THE RED ACTUALLY COMES FROM, stated because it is not the usual place. The rejection is
    // caught by VITEST'S RUN-LEVEL unhandled-rejection detection, which reports `Errors 2` and exits 1 while
    // every `it` still reports PASSED. So the binding signal is the runner's EXIT CODE, not an `expect` in
    // this block — verified both ways: exit 1 before the `.catch` in `syncProvider.tsx`, exit 0 after.
    // A first draft added a `window.addEventListener('unhandledrejection', …)` probe and asserted the
    // captured list was empty; it passed with the defect present, because the rejection never reached that
    // listener. That assertion was coverage theatre and was deleted rather than left in to look thorough.
    /**
     * ⛔ NO SUBJECT: MOUNTED, INERT, AND REFUSING. The provider owns this case so its CALLERS never gate the
     * mount — a conditional mount changes the element type at that tree position and remounts every feature
     * below it when the IdP resolves a user. It must not read storage under a placeholder key.
     */
    it('⛔ with NO subject: reads no storage, drains nothing, and refuses submit', async () => {
        const store = createMemoryOutboxStore();
        const getItem = vi.spyOn(store, 'getItem');
        const send = vi.fn();
        let outcome: unknown;

        const Caller = (): ReactElement => {
            const queue = useSyncQueue();

            return (
                <button
                    type="button"
                    onClick={() => {
                        void queue
                            .submit({
                                entity: 'recipe',
                                intentKind: 'update',
                                localId: 'r1',
                                dependsOn: [],
                                payload: {},
                            })
                            .then(
                                (value) => {
                                    outcome = value;
                                },
                                (error: unknown) => {
                                    outcome = error;
                                },
                            );
                    }}
                >
                    save
                </button>
            );
        };

        render(
            <SyncProvider subject={undefined} send={send} store={store}>
                <Caller />
                <Probe />
            </SyncProvider>,
        );

        await act(async () => {
            screen.getByRole('button', { name: 'save' }).click();
        });

        await waitFor(() => expect(outcome).toBeInstanceOf(Error));
        expect((outcome as Error).message).toContain('no signed-in subject');
        // Never keyed by a placeholder — a queue read under a constant is a cross-account read.
        expect(getItem).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(screen.getByText('pending:0')).toBeTruthy();
    });

    // ⚠️ AND THE TITLE NOW MATCHES THE BODY. A previous version was titled "…and still accepts writes" while
    // submitting nothing at all, so both of its assertions passed with the defect present. Adding the
    // `submit` disproved the title: `submit` REJECTS, because it loads the outbox before appending.
    //
    // ⛔ THAT REJECTION IS THE RIGHT ANSWER, AND THE TITLE CHANGED RATHER THAN THE CODE. This layer's promise
    // is that a write resolves when the NETWORK is absent — offline is a pause. A STORAGE failure is a
    // different fact: nothing durable happened, so resolving `{queued:true}` would tell the cook their edit
    // is safe when no disk holds it. That is the silent loss this whole layer exists to prevent, produced by
    // the layer itself. Refusing is the honest answer, and the app stays alive either way.
    //
    // ⚠️ OWED WITH THE SERIALIZED MUTATOR: no consumer can act on this refusal yet, because `submit` has no
    // call sites. When one lands it needs a surface for "we could not save this on your device" that is
    // distinct from "not synced yet" — the two mean different things to a cook.
    it('survives a store whose read REJECTS — refusing the write rather than falsely queueing it', async () => {
        // Typed as the port so a missing member is a COMPILE error, not a runtime surprise. An untyped
        // literal here was missing `removeItem` and only `tsc` caught it — the same way the mobile mount
        // test's fake was missing the whole `getItem`/`setItem` shape.
        const unreadable: OutboxStore = {
            getItem: vi.fn().mockRejectedValue(new Error('AsyncStorage unavailable')),
            setItem: vi.fn().mockResolvedValue(undefined),
            removeItem: vi.fn().mockResolvedValue(undefined),
        };
        let outcome: unknown;

        const Caller = (): ReactElement => {
            const queue = useSyncQueue();

            return (
                <button
                    type="button"
                    onClick={() => {
                        void queue
                            .submit({
                                entity: 'recipe',
                                intentKind: 'update',
                                localId: 'r1',
                                dependsOn: [],
                                payload: {},
                            })
                            .then(
                                (value) => {
                                    outcome = value;
                                },
                                (error: unknown) => {
                                    outcome = error;
                                },
                            );
                    }}
                >
                    save
                </button>
            );
        };

        render(
            <SyncProvider subject="user_a" send={vi.fn()} store={unreadable}>
                <Caller />
                <Probe />
            </SyncProvider>,
        );

        // The read was genuinely attempted, so the case under test is the one that ran.
        await waitFor(() => expect(unreadable.getItem).toHaveBeenCalled());

        await act(async () => {
            screen.getByRole('button', { name: 'save' }).click();
        });

        // Refused with the storage error, NOT resolved as queued. The subtree is still alive to show it.
        await waitFor(() => expect(outcome).toBeInstanceOf(Error));
        expect((outcome as Error).message).toBe('AsyncStorage unavailable');
        expect(screen.getByText(/pending:/)).toBeTruthy();
    });
});

/** A button that submits `intent` through the queue. */
function SubmitButton({ intent, label }: { readonly intent: Intent; readonly label: string }): ReactElement {
    const queue = useSyncQueue();

    return (
        <button
            type="button"
            onClick={() => {
                void queue.submit(intent);
            }}
        >
            {label}
        </button>
    );
}

const updateOf = (localId: string): Intent => ({
    entity: 'recipe',
    intentKind: 'update',
    localId,
    dependsOn: [],
    payload: { title: localId },
});

describe('SyncProvider — the serialized mutator', () => {
    /**
     * ⛔ THE CLOBBER, END TO END. A drain is on the wire with R1 when the cook saves R2. The old drain wrote back the
     * snapshot it loaded once R1 answered, which deleted R2 from storage while `pendingCount` still showed it — and
     * the re-armed drain then found nothing to send. R2 must reach the server.
     */
    it('⛔ sends a write submitted while a drain was on the wire', async () => {
        let release: (() => void) | undefined;
        const sent: string[] = [];
        const send = vi.fn(async (record: { readonly localId: string }): Promise<SendResult> => {
            sent.push(record.localId);

            if (record.localId === 'R1') {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
            }

            return { outcome: 'ok', serverId: `srv-${record.localId}` };
        });
        const store = createMemoryOutboxStore();

        render(
            <SyncProvider subject="user_a" send={send as never} store={store}>
                <SubmitButton intent={updateOf('R1')} label="save R1" />
                <SubmitButton intent={updateOf('R2')} label="save R2" />
                <Probe />
            </SyncProvider>,
        );

        await act(async () => {
            screen.getByRole('button', { name: 'save R1' }).click();
        });
        await waitFor(() => expect(sent).toStrictEqual(['R1']));

        await act(async () => {
            screen.getByRole('button', { name: 'save R2' }).click();
        });
        await act(async () => {
            release?.();
        });

        await waitFor(() => expect(sent).toStrictEqual(['R1', 'R2']));
        await waitFor(async () => expect((await loadOutbox(store, 'user_a')).records).toStrictEqual([]));
        await waitFor(() => expect(screen.getByText('pending:0')).toBeTruthy());
    });

    /**
     * ⛔ FAILURES ARE A PROJECTION OF THE STORED LOG, so a parked write is reported after a relaunch too — before any
     * drain runs, and without being re-sent (a terminal refusal will not change its answer).
     */
    it('⛔ reports a parked write restored from storage, without re-sending it', async () => {
        const store = createMemoryOutboxStore();
        await saveOutbox(
            store,
            'user_a',
            settle(appendIntent(EMPTY_OUTBOX, updateOf('r1')), { seq: 1, outcome: 'parked', status: 422 }),
        );
        const send = vi.fn();

        render(
            <SyncProvider subject="user_a" send={send} store={store}>
                <Probe />
            </SyncProvider>,
        );

        await waitFor(() => expect(screen.getByText('failed:1')).toBeTruthy());
        expect(screen.getByText('pending:1')).toBeTruthy();
        expect(send).not.toHaveBeenCalled();
    });
});

describe('SyncProvider — a wait the server asked for', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * ⛔ A LONG `Retry-After` IS HONOURED BY SCHEDULING, NOT BY SLEEPING IN THE DRAIN. The drain hands the wait back;
     * the provider drains again when it is over, with no connectivity change to prompt it.
     */
    it('⛔ drains again once the stated wait is over', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const send = vi
            .fn<() => Promise<SendResult>>()
            .mockResolvedValueOnce({ outcome: 'failed', status: 429, retryAfterSeconds: 60 })
            .mockResolvedValue({ outcome: 'ok', serverId: 'srv-1' });

        render(
            <SyncProvider subject="user_a" send={send as never}>
                <SubmitButton intent={updateOf('r1')} label="save" />
                <Probe />
            </SyncProvider>,
        );

        await act(async () => {
            screen.getByRole('button', { name: 'save' }).click();
        });
        await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(59_000);
        });
        expect(send).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(2_000);
        });
        await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.getByText('pending:0')).toBeTruthy());
    });

    /**
     * ⛔ THE WAIT HOLDS AGAINST EVERY TRIGGER. A checkpoint `submit` lands every few seconds while the editor is open;
     * if each one drained, the 429'd write would be re-sent long before the stated wait was over.
     */
    it('⛔ sends nothing before the stated wait is over, even when another write is submitted', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const send = vi
            .fn<() => Promise<SendResult>>()
            .mockResolvedValueOnce({ outcome: 'failed', status: 429, retryAfterSeconds: 60 })
            .mockResolvedValue({ outcome: 'ok', serverId: 'srv' });

        render(
            <SyncProvider subject="user_a" send={send as never}>
                <SubmitButton intent={updateOf('r1')} label="save r1" />
                <SubmitButton intent={updateOf('r2')} label="save r2" />
                <Probe />
            </SyncProvider>,
        );

        await act(async () => {
            screen.getByRole('button', { name: 'save r1' }).click();
        });
        await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5_000);
        });
        await act(async () => {
            screen.getByRole('button', { name: 'save r2' }).click();
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(50_000);
        });

        expect(send).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(6_000);
        });
        await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
        await waitFor(() => expect(screen.getByText('pending:0')).toBeTruthy());
    });
});

/** Hands the test the queue a component would see. Assigned during render on purpose: a test-only window. */
function captureQueue(): { readonly current: () => SyncQueue; readonly Capture: () => ReactElement } {
    let queue: SyncQueue | undefined;

    return {
        current: () => {
            if (queue === undefined) {
                throw new Error('queue not captured');
            }

            return queue;
        },
        Capture: () => {
            queue = useSyncQueue();

            return <Probe />;
        },
    };
}

/**
 * The editor's lane (slice 7): one server write per recipe at a time, the answer delivered to whoever queued it by the
 * record's sequence number, and a parked record leaving only when the editor (on the cook's choice) withdraws it.
 */
describe('SyncProvider — the editor`s exclusive submit, replies and withdrawal', () => {
    it('queues an exclusive write, and reports a record on the wire instead of queueing beside it', async () => {
        let release: (() => void) | undefined;
        const send = vi.fn(
            async (): Promise<SendResult> =>
                new Promise((resolve) => {
                    release = () => resolve({ outcome: 'ok', serverId: 'r1' });
                }),
        );
        const { current, Capture } = captureQueue();

        render(
            <SyncProvider subject="user_a" send={send as never}>
                <Capture />
            </SyncProvider>,
        );

        let first: unknown;
        await act(async () => {
            first = await current().submitExclusive(updateOf('r1'));
        });
        await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

        let second: unknown;
        await act(async () => {
            second = await current().submitExclusive(updateOf('r1'));
        });

        expect(first).toStrictEqual({ kind: 'queued', seq: 1 });
        expect(second).toStrictEqual({ kind: 'inFlight', seq: 1 });

        await act(async () => {
            release?.();
        });
        await waitFor(() => expect(screen.getByText('pending:0')).toBeTruthy());
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('delivers each settlement, with the sender`s answer, to every subscriber until it unsubscribes', async () => {
        const answer = { kind: 'recipeWritten', detail: { id: 'r1', currentVersion: 4 } };
        const send = vi.fn(async (): Promise<SendResult> => ({ outcome: 'ok', serverId: 'r1', answer }));
        const { current, Capture } = captureQueue();
        const heard: unknown[] = [];

        render(
            <SyncProvider subject="user_a" send={send as never}>
                <Capture />
            </SyncProvider>,
        );

        const unsubscribe = current().subscribe((event) => heard.push(event));

        await act(async () => {
            await current().submitExclusive(updateOf('r1'));
        });
        await waitFor(() => expect(heard).toHaveLength(1));

        expect(heard[0]).toStrictEqual({
            seq: 1,
            entity: 'recipe',
            localId: 'r1',
            intentKind: 'update',
            outcome: 'synced',
            serverId: 'r1',
            answer,
        });

        unsubscribe();
        await act(async () => {
            await current().submitExclusive(updateOf('r1'));
        });
        await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
        expect(heard).toHaveLength(1);
    });

    it('⛔ a subscriber that throws neither aborts the drain nor hides the settlement from the others', async () => {
        const send = vi.fn(async (): Promise<SendResult> => ({ outcome: 'ok', serverId: 'r1' }));
        const { current, Capture } = captureQueue();
        const heard: unknown[] = [];

        render(
            <SyncProvider subject="user_a" send={send as never}>
                <Capture />
            </SyncProvider>,
        );

        current().subscribe(() => {
            throw new Error('listener bug');
        });
        current().subscribe((event) => heard.push(event));

        await act(async () => {
            await current().submitExclusive(updateOf('r1'));
            await current().submitExclusive(updateOf('r2'));
        });
        await waitFor(() => expect(heard).toHaveLength(2));
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('⛔ reports a subscriber that throws to onFault instead of swallowing it', async () => {
        const send = vi.fn(async (): Promise<SendResult> => ({ outcome: 'ok', serverId: 'r1' }));
        const onFault = vi.fn();
        const boom = new Error('listener bug');
        const { current, Capture } = captureQueue();

        render(
            <SyncProvider subject="user_a" send={send as never} onFault={onFault}>
                <Capture />
            </SyncProvider>,
        );

        current().subscribe(() => {
            throw boom;
        });

        await act(async () => {
            await current().submitExclusive(updateOf('r1'));
        });

        await waitFor(() => expect(onFault).toHaveBeenCalledWith(boom, { source: 'syncSettlementListener' }));
    });

    it('⛔ reports a sender that throws to onFault, naming the record, and still parks it', async () => {
        const boom = new Error('sender broke its contract');
        const send = vi.fn(async (): Promise<SendResult> => {
            throw boom;
        });
        const onFault = vi.fn();

        render(
            <SyncProvider subject="user_a" send={send as never} onFault={onFault}>
                <SubmitButton intent={updateOf('r1')} label="save" />
                <Probe />
            </SyncProvider>,
        );

        await act(async () => {
            screen.getByRole('button', { name: 'save' }).click();
        });

        await waitFor(() =>
            expect(onFault).toHaveBeenCalledWith(boom, {
                source: 'syncSender',
                entity: 'recipe',
                intentKind: 'update',
                localId: 'r1',
            }),
        );
        await waitFor(() => expect(screen.getByText('failed:1')).toBeTruthy());
    });

    it('⛔ reports a drain pass that rejects (an unreadable store) to onFault', async () => {
        const unreadable: OutboxStore = {
            getItem: vi.fn().mockRejectedValue(new Error('AsyncStorage unavailable')),
            setItem: vi.fn().mockResolvedValue(undefined),
            removeItem: vi.fn().mockResolvedValue(undefined),
        };
        const onFault = vi.fn();

        render(
            <SyncProvider subject="user_a" send={vi.fn()} store={unreadable} onFault={onFault}>
                <Probe />
            </SyncProvider>,
        );

        await waitFor(() =>
            expect(onFault).toHaveBeenCalledWith(expect.objectContaining({ message: 'AsyncStorage unavailable' }), {
                source: 'syncDrainPass',
            }),
        );
    });

    it('a parked write carries its sequence number, blocks the lane, and leaves when withdrawn', async () => {
        const send = vi.fn(async (): Promise<SendResult> => ({ outcome: 'failed', status: 409 }));
        const { current, Capture } = captureQueue();

        render(
            <SyncProvider subject="user_a" send={send as never}>
                <Capture />
            </SyncProvider>,
        );

        await act(async () => {
            await current().submitExclusive(updateOf('r1'));
        });
        await waitFor(() => expect(screen.getByText('failed:1')).toBeTruthy());

        expect(current().failures).toStrictEqual([
            { seq: 1, entity: 'recipe', intentKind: 'update', localId: 'r1', status: 409 },
        ]);

        let blocked: unknown;
        await act(async () => {
            blocked = await current().submitExclusive(updateOf('r1'));
        });
        expect(blocked).toStrictEqual({ kind: 'parked', seq: 1, status: 409 });

        await act(async () => {
            await current().withdraw(1);
        });
        await waitFor(() => expect(screen.getByText('failed:0')).toBeTruthy());
        expect(screen.getByText('pending:0')).toBeTruthy();
    });

    it('answers the server id a created ref resolved to', async () => {
        const send = vi.fn(async (): Promise<SendResult> => ({ outcome: 'ok', serverId: 'srv-9' }));
        const { current, Capture } = captureQueue();

        render(
            <SyncProvider subject="user_a" send={send as never}>
                <Capture />
            </SyncProvider>,
        );

        expect(current().resolutionOf('local:recipe:a')).toBeUndefined();

        await act(async () => {
            await current().submitExclusive({
                entity: 'recipe',
                intentKind: 'create',
                localId: 'local:recipe:a',
                produces: 'local:recipe:a',
                dependsOn: [],
                payload: {},
            });
        });

        await waitFor(() => expect(current().resolutionOf('local:recipe:a')).toBe('srv-9'));
    });

    /** Finding 1 of the 2026-10-10 review: a second create of a ref that already synced is refused, with the id. */
    it('⛔ refuses a second create of a ref already resolved, answering the server id, and sends nothing more', async () => {
        const send = vi.fn(async (): Promise<SendResult> => ({ outcome: 'ok', serverId: 'srv-9' }));
        const { current, Capture } = captureQueue();
        const create = {
            entity: 'recipe',
            intentKind: 'create',
            localId: 'local:recipe:a',
            produces: 'local:recipe:a',
            dependsOn: [],
            payload: {},
        } as const;

        render(
            <SyncProvider subject="user_a" send={send as never}>
                <Capture />
            </SyncProvider>,
        );

        await act(async () => {
            await current().submitExclusive(create);
        });
        await waitFor(() => expect(current().resolutionOf('local:recipe:a')).toBe('srv-9'));

        let again: unknown;
        await act(async () => {
            again = await current().submitExclusive(create);
        });

        expect(again).toStrictEqual({ kind: 'resolved', serverId: 'srv-9' });
        expect(screen.getByText('pending:0')).toBeTruthy();
        expect(send).toHaveBeenCalledTimes(1);
    });
});

/**
 * `SyncQueue.discard` — the cook's confirmed Discard as ONE change (`discardEntity`). The editor used to withdraw a
 * parked record and then submit the delete as two calls; a create that parked between them made the second throw
 * (`supersede` refuses a parked record), the rejection was swallowed, and the parked create was orphaned with no delete.
 */
describe('SyncProvider — discard', () => {
    const REF = 'local:recipe:r1';
    const deleteOf = (localId: string, dependsOn: readonly string[] = []): Intent => ({
        entity: 'recipe',
        intentKind: 'delete',
        localId,
        dependsOn,
        payload: { id: localId },
    });

    it('⛔ is one mutation: a parked update goes and the delete is queued in a single write to storage', async () => {
        const store = createMemoryOutboxStore();
        const parked = settle(appendIntent(EMPTY_OUTBOX, updateOf('rec_1')), {
            seq: 1,
            outcome: 'parked',
            status: 500,
        });

        await saveOutbox(store, 'user_a', parked);
        act(() => {
            onlineManager.setOnline(false);
        });

        const { current, Capture } = captureQueue();

        render(
            <SyncProvider subject="user_a" send={vi.fn() as never} store={store}>
                <Capture />
            </SyncProvider>,
        );
        await waitFor(() => expect(screen.getByText('failed:1')).toBeTruthy());

        const setItem = vi.spyOn(store, 'setItem');

        await act(async () => {
            await expect(current().discard({ kind: 'entity', intent: deleteOf('rec_1') })).resolves.toStrictEqual({
                kind: 'settled',
            });
        });

        expect(setItem).toHaveBeenCalledTimes(1);
        const stored = await loadOutbox(store, 'user_a');

        expect(stored.records.map((record) => [record.intentKind, record.state])).toStrictEqual([
            ['delete', 'pending'],
        ]);
    });

    it('⛔ when the create parked between the editor`s decision and discard, nothing rejects and the log ends empty', async () => {
        const send = vi.fn(async (): Promise<SendResult> => ({ outcome: 'failed' }));
        const { current, Capture } = captureQueue();

        render(
            <SyncProvider subject="user_a" send={send as never}>
                <Capture />
            </SyncProvider>,
        );

        await act(async () => {
            await current().submitExclusive({
                entity: 'recipe',
                intentKind: 'create',
                localId: REF,
                produces: REF,
                dependsOn: [],
                payload: {},
            });
        });
        await waitFor(() => expect(screen.getByText('failed:1')).toBeTruthy());

        // The create failed with no status, so it may exist on the server: withdrawing it answers `mayStand`
        // (`entityMayStand`, `outboxLog.ts`), and the editor decides what to tell the cook.
        await act(async () => {
            await expect(current().discard({ kind: 'entity', intent: deleteOf(REF, [REF]) })).resolves.toStrictEqual({
                kind: 'mayStand',
            });
        });

        await waitFor(() => expect(screen.getByText('pending:0')).toBeTruthy());
        expect(screen.getByText('failed:0')).toBeTruthy();
        expect(send).toHaveBeenCalledTimes(1);
    });

    /**
     * Owner ruling 2026-10-17, "Don't allow users to delete while saving": the queue tells a control whether the recipe
     * is on the wire (`entityInFlight`, the SAME predicate `applyDiscard` refuses by), and the Discard is refused.
     */
    it('⛔ a create on the wire: entityInFlight is true, the Discard is REFUSED, and a lost answer re-enables it', async () => {
        let answer: (result: SendResult) => void = () => undefined;
        const send = vi.fn(
            (): Promise<SendResult> =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        );
        const { current, Capture } = captureQueue();

        render(
            <SyncProvider subject="user_a" send={send as never}>
                <Capture />
            </SyncProvider>,
        );
        expect(current().entityInFlight('recipe', [REF])).toBe(false);

        await act(async () => {
            await current().submitExclusive({
                entity: 'recipe',
                intentKind: 'create',
                localId: REF,
                produces: REF,
                dependsOn: [],
                payload: {},
            });
        });
        await waitFor(() => expect(current().entityInFlight('recipe', [REF])).toBe(true));

        await act(async () => {
            await expect(current().discard({ kind: 'entity', intent: deleteOf(REF, [REF]) })).resolves.toStrictEqual({
                kind: 'refused',
                reason: 'writeInFlight',
            });
        });
        // Nothing was queued behind the create.
        expect(screen.getByText('pending:1')).toBeTruthy();

        // The reply is lost: an UNKNOWN outcome. The control must not stay disabled for ever.
        await act(async () => {
            answer({ outcome: 'failed' });
        });
        await waitFor(() => expect(current().entityInFlight('recipe', [REF])).toBe(false));
        expect(screen.getByText('failed:1')).toBeTruthy();
    });

    it('rejects with no signed-in subject, like the other writes', async () => {
        const { current, Capture } = captureQueue();

        render(
            <SyncProvider subject={undefined} send={vi.fn() as never}>
                <Capture />
            </SyncProvider>,
        );

        await expect(current().discard({ kind: 'entity', intent: deleteOf('rec_1') })).rejects.toThrow(
            /no signed-in subject/,
        );
    });

    /**
     * ⛔ A PUBLISHED RECIPE'S DISCARD IS DECIDED FROM THE LOG AS STORED WHEN ITS MUTATION RUNS (GATE round 3). The
     * editor plans from the failures it last rendered; a drain can claim the parked Save changes before the act (a `401`
     * resumes when the cook signs in). A withdrawal by number then threw and was swallowed, and the save landed while the
     * confirm said the recipe stays as it was.
     */
    async function mountWithParked(status: number) {
        const store = createMemoryOutboxStore();

        await saveOutbox(
            store,
            'user_a',
            settle(appendIntent(EMPTY_OUTBOX, updateOf('rec_1')), { seq: 1, outcome: 'parked', status }),
        );
        act(() => {
            onlineManager.setOnline(false);
        });

        const { current, Capture } = captureQueue();

        render(
            <SyncProvider subject="user_a" send={vi.fn() as never} store={store}>
                <Capture />
            </SyncProvider>,
        );
        await waitFor(() => expect(screen.getByText('failed:1')).toBeTruthy());

        return { store, current };
    }

    it('withdraws a parked write that is still parked, in one write to storage', async () => {
        const { store, current } = await mountWithParked(401);
        const setItem = vi.spyOn(store, 'setItem');

        await act(async () => {
            await expect(current().discard({ kind: 'parkedWrite', seq: 1 })).resolves.toStrictEqual({
                kind: 'settled',
            });
        });

        expect(setItem).toHaveBeenCalledTimes(1);
        expect((await loadOutbox(store, 'user_a')).records).toStrictEqual([]);
    });

    /**
     * Rewritten for the owner ruling 2026-10-17 ("Don't allow users to delete while saving"): a write a drain claimed
     * before the mutation is on the wire, so the Discard is REFUSED (it used to answer `mayStand` and the editor finished
     * the Discard anyway). It still changes nothing and does not reject.
     */
    it('⛔ refuses a Discard of a write a drain claimed before the mutation, changes nothing, and does not reject', async () => {
        const { store, current } = await mountWithParked(401);

        // The drain's claim lands in storage first, through the same serialized writer; the projection still says parked.
        await outboxMutatorFor(store, 'user_a').mutate((log) => claimForSending(log, 1) ?? log);
        expect(screen.getByText('failed:1')).toBeTruthy();

        await act(async () => {
            await expect(current().discard({ kind: 'parkedWrite', seq: 1 })).resolves.toStrictEqual({
                kind: 'refused',
                reason: 'writeInFlight',
            });
        });

        expect((await loadOutbox(store, 'user_a')).records.map((record) => record.state)).toStrictEqual(['sending']);
    });
});

/**
 * ⛔ A CHANGE OF COOK WHILE A REQUEST IS ON THE WIRE (ADR-0054 §4). Each cook's outbox is namespaced by their subject and
 * drains after that cook signs in. The provider used to keep ONE `draining` flag and ONE re-arm flag for every cook:
 * cook B's mount drain found A's drain running, set the re-arm and returned, and A's loop answered the re-arm by looping
 * again over A's outbox with A's sender. B's drain never ran, and A's loop went on sending A's records — and announcing
 * them to B's listeners, which write the answer into B's query cache and drafts — after A had signed out.
 *
 * Each cook gets their own sender, as both app roots build one per cook, so the assertions can tell which closure sent.
 */
describe('SyncProvider — a change of cook while a drain is on the wire', () => {
    type TestSender = (record: { readonly localId: string }) => Promise<SendResult>;

    /** Store `localIds` as pending updates in `subject`'s outbox. */
    const seed = async (store: OutboxStore, subject: string, localIds: readonly string[]): Promise<void> => {
        let log = EMPTY_OUTBOX;

        for (const localId of localIds) {
            log = appendIntent(log, updateOf(localId));
        }

        await saveOutbox(store, subject, log);
    };

    /** A sender that writes `{label}:{localId}` into `sent` and holds the records in `hold` on the wire until released. */
    const heldSender = (
        label: string,
        sent: string[],
        hold: readonly string[] = [],
    ): { readonly send: TestSender; readonly release: (localId: string) => void } => {
        const releases = new Map<string, () => void>();

        return {
            send: async (record) => {
                sent.push(`${label}:${record.localId}`);

                if (hold.includes(record.localId)) {
                    await new Promise<void>((resolve) => {
                        releases.set(record.localId, resolve);
                    });
                }

                return { outcome: 'ok', serverId: `srv-${record.localId}` };
            },
            release: (localId) => {
                releases.get(localId)?.();
            },
        };
    };

    /**
     * Let every queued promise and timer of the moment run: a second drain would have reached `send` by then. A negative
     * assertion after this is about what DID run, never a `waitFor` that a vacuous pass would satisfy.
     */
    const idle = async (): Promise<void> =>
        new Promise((resolve) => {
            setTimeout(resolve, 20);
        });

    /** The stored log, as `localId:state` per record. */
    const storedOf = async (store: OutboxStore, subject: string): Promise<readonly string[]> =>
        (await loadOutbox(store, subject)).records.map((record) => `${record.localId}:${record.state}`);

    /** The provider for `subject`, with a capture of its queue. */
    const providerFor = (
        subject: string | undefined,
        send: TestSender,
        store: OutboxStore,
        Capture: () => ReactElement,
    ): ReactElement => (
        <SyncProvider subject={subject} send={send as never} store={store}>
            <Capture />
        </SyncProvider>
    );

    it('⛔ A→B mid-drain: B drains at once, A`s request settles into A`s log, and nothing more of A`s is sent or heard', async () => {
        const store = createMemoryOutboxStore();
        await seed(store, 'cook_a', ['A1', 'A2']);
        await seed(store, 'cook_b', ['B1']);
        const sent: string[] = [];
        const a = heldSender('a', sent, ['A1']);
        const b = heldSender('b', sent);
        const { current, Capture } = captureQueue();
        const heard: string[] = [];

        const view = render(providerFor('cook_a', a.send, store, Capture));
        // The bus outlives the cook, as `RecipeWriteCacheObserver` and `useDraftAnswers` do: they stay mounted across it.
        current().subscribe((event) => heard.push(event.localId));
        await waitFor(() => expect(sent).toStrictEqual(['a:A1']));

        view.rerender(providerFor('cook_b', b.send, store, Capture));

        // ⛔ B's drain is not held behind A's request on the wire, and not swallowed by A's loop.
        await waitFor(() => expect(sent).toStrictEqual(['a:A1', 'b:B1']));
        await waitFor(async () => expect(await storedOf(store, 'cook_b')).toStrictEqual([]));

        await act(async () => {
            a.release('A1');
        });

        // A1 settled into A's own log — it is gone from it — and A2 waits there, pending, for A's next session.
        await waitFor(async () => expect(await storedOf(store, 'cook_a')).toStrictEqual(['A2:pending']));
        expect(sent).toStrictEqual(['a:A1', 'b:B1']);
        // ⛔ B's listeners heard B's settlement only: A's answer would be written into B's cache and drafts.
        expect(heard).toStrictEqual(['B1']);
    });

    it('⛔ A→B→A mid-drain: A`s drain resumes, one request at a time, and sends each record exactly once', async () => {
        const store = createMemoryOutboxStore();
        await seed(store, 'cook_a', ['A1', 'A2']);
        const sent: string[] = [];
        const first = heldSender('a', sent, ['A1']);
        const { Capture } = captureQueue();

        const view = render(providerFor('cook_a', first.send, store, Capture));
        await waitFor(() => expect(sent).toStrictEqual(['a:A1']));

        view.rerender(providerFor('cook_b', heldSender('b', sent).send, store, Capture));
        view.rerender(providerFor('cook_a', heldSender('a', sent).send, store, Capture));
        await act(async () => {
            await idle();
        });

        // ⛔ No second drain of A's outbox while A1 is on the wire: the order stays serial.
        expect(sent).toStrictEqual(['a:A1']);

        await act(async () => {
            first.release('A1');
        });

        await waitFor(async () => expect(await storedOf(store, 'cook_a')).toStrictEqual([]));
        expect(sent).toStrictEqual(['a:A1', 'a:A2']);
    });

    it('⛔ sign-out mid-drain: the request settles into A`s log unheard, nothing more is sent, and A`s next session drains the rest', async () => {
        const store = createMemoryOutboxStore();
        await seed(store, 'cook_a', ['A1', 'A2']);
        const sent: string[] = [];
        const a = heldSender('a', sent, ['A1']);
        const { current, Capture } = captureQueue();
        const heard: string[] = [];

        const view = render(providerFor('cook_a', a.send, store, Capture));
        current().subscribe((event) => heard.push(event.localId));
        await waitFor(() => expect(sent).toStrictEqual(['a:A1']));

        view.rerender(providerFor(undefined, heldSender('nobody', sent).send, store, Capture));
        await act(async () => {
            a.release('A1');
        });

        await waitFor(async () => expect(await storedOf(store, 'cook_a')).toStrictEqual(['A2:pending']));
        expect(sent).toStrictEqual(['a:A1']);
        // ⛔ Nobody is signed in: A's answer must not reach a cache the next cook will read.
        expect(heard).toStrictEqual([]);

        view.rerender(providerFor('cook_a', heldSender('a', sent).send, store, Capture));

        await waitFor(async () => expect(await storedOf(store, 'cook_a')).toStrictEqual([]));
        expect(sent).toStrictEqual(['a:A1', 'a:A2']);
        expect(heard).toStrictEqual(['A2']);
    });

    /**
     * ⛔ THE LANE BELONGS TO THE OUTBOX, NOT TO ONE MOUNT OF THE PROVIDER — the reason `outboxMutatorFor` is shared, one
     * level up. A provider remounted while its create is on the wire must not start a second drain of the same outbox:
     * that one would skip the update waiting on the create's id, end, and leave it stranded once the first drain — whose
     * mount has ended — stops claiming.
     */
    it('⛔ a remount mid-drain: the update waiting on the create on the wire is sent, once, after it', async () => {
        const store = createMemoryOutboxStore();
        const REF = 'local:recipe:new';
        await saveOutbox(
            store,
            'cook_a',
            appendIntent(
                appendIntent(EMPTY_OUTBOX, {
                    entity: 'recipe',
                    intentKind: 'create',
                    localId: REF,
                    produces: REF,
                    dependsOn: [],
                    payload: {},
                }),
                { entity: 'recipe', intentKind: 'update', localId: 'U1', dependsOn: [REF], payload: { id: REF } },
            ),
        );
        const sent: string[] = [];
        const a = heldSender('a', sent, [REF]);
        const { Capture } = captureQueue();

        const first = render(providerFor('cook_a', a.send, store, Capture));
        await waitFor(() => expect(sent).toStrictEqual([`a:${REF}`]));

        first.unmount();
        render(providerFor('cook_a', heldSender('again', sent).send, store, Capture));
        await act(async () => {
            await idle();
        });
        expect(sent).toStrictEqual([`a:${REF}`]);

        await act(async () => {
            a.release(REF);
        });

        await waitFor(async () => expect(await storedOf(store, 'cook_a')).toStrictEqual([]));
        expect(sent.filter((entry) => entry.endsWith(':U1'))).toHaveLength(1);
    });

    /**
     * ⛔ A STATED WAIT FROM A DRAIN THAT OUTLIVED ITS COOK IS NOT THE NEXT COOK'S. The provider keeps ONE retry timer, and
     * it serves whoever is signed in. Cook A's request answers 429 "wait ten minutes" after cook B signed in and B's own
     * 429 armed a one-minute timer. A's wait belongs in A's log, which already holds it (the journal writes it there); if
     * it also reached the timer, it would replace B's, and B's write would sit for ten minutes behind A's pause.
     *
     * Pure fake timers, no `waitFor`: every wait here is the server's stated one, and the jitter's 500 ms ceiling is under
     * both, so the times are exact.
     */
    describe('a stated wait', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        /** Run every promise and due timer of the moment, inside `act`. */
        const flush = async (ms = 0): Promise<void> => {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(ms);
            });
        };

        it('⛔ A→B: A`s late 429 does not replace B`s retry timer, and A`s next session waits out A`s own pause', async () => {
            vi.useFakeTimers();
            const store = createMemoryOutboxStore();
            await seed(store, 'cook_a', ['A1']);
            await seed(store, 'cook_b', ['B1']);
            let answerA: (result: SendResult) => void = () => undefined;
            const sendA = vi.fn<TestSender>(
                async () =>
                    new Promise<SendResult>((resolve) => {
                        answerA = resolve;
                    }),
            );
            const sendB = vi
                .fn<TestSender>()
                .mockResolvedValueOnce({ outcome: 'failed', status: 429, retryAfterSeconds: 60 })
                .mockResolvedValue({ outcome: 'ok', serverId: 'srv-B1' });
            const { Capture } = captureQueue();

            const view = render(providerFor('cook_a', sendA, store, Capture));
            await flush();
            expect(sendA).toHaveBeenCalledTimes(1);

            view.rerender(providerFor('cook_b', sendB, store, Capture));
            await flush();
            // B's own wait: one minute, past what a drain sleeps through, so the provider's timer keeps it.
            expect(sendB).toHaveBeenCalledTimes(1);
            expect((await loadOutbox(store, 'cook_b')).pausedUntil).toBe(Date.now() + 60_000);

            answerA({ outcome: 'failed', status: 429, retryAfterSeconds: 600 });
            await flush();
            // A's wait is written into A's log, where A's next session finds it.
            expect((await loadOutbox(store, 'cook_a')).pausedUntil).toBe(Date.now() + 600_000);

            await flush(60_000);

            // ⛔ B's minute is over, and B's write goes: A's ten minutes did not take B's timer.
            expect(sendB).toHaveBeenCalledTimes(2);
            expect(await storedOf(store, 'cook_b')).toStrictEqual([]);

            const sendAgain = vi.fn<TestSender>().mockResolvedValue({ outcome: 'ok', serverId: 'srv-A1' });

            view.rerender(providerFor('cook_a', sendAgain, store, Capture));
            await flush();
            await flush(539_000);
            // A's pause is A's to wait out, nine minutes of it still to go: nothing is sent before it ends.
            expect(sendAgain).not.toHaveBeenCalled();

            await flush(1_000);

            expect(sendAgain).toHaveBeenCalledTimes(1);
            expect(await storedOf(store, 'cook_a')).toStrictEqual([]);
        });
    });
});

/**
 * ⛔ `unreadableCount` IS THIS SESSION'S SET-ASIDES (`specSharedSystem.md` §17): the outbox's load and the editor's draft
 * store both report through `appendToQuarantine`, and the provider only mirrors the ledger. It is never a reading of
 * whether a quarantine key exists, because that key lives until sign-out.
 */
describe('SyncProvider — unreadableCount', () => {
    it('is zero for a clean load', () => {
        render(
            <SyncProvider subject="user_a" send={vi.fn()}>
                <Probe />
            </SyncProvider>,
        );

        expect(screen.getByText('unreadable:0')).toBeTruthy();
    });

    it('⛔ counts the outbox bytes the mount load set aside', async () => {
        const store = createMemoryOutboxStore();
        await store.setItem(storeKeyFor('user_a'), '{ not json');

        render(
            <SyncProvider subject="user_a" send={vi.fn()} store={store}>
                <Probe />
            </SyncProvider>,
        );

        await waitFor(() => {
            expect(screen.getByText('unreadable:1')).toBeTruthy();
        });
    });

    it('⛔ stays zero when only a quarantine key from an earlier launch is on the device', async () => {
        const store = createMemoryOutboxStore();
        await store.setItem(quarantineKeyFor('user_a'), JSON.stringify(['from an earlier launch']));

        render(
            <SyncProvider subject="user_a" send={vi.fn()} store={store}>
                <Probe />
            </SyncProvider>,
        );
        await act(async () => {
            await outboxMutatorFor(store, 'user_a').read();
        });

        expect(screen.getByText('unreadable:0')).toBeTruthy();
    });

    it('hears a set-aside that happens after mount, such as the editor opening on unreadable drafts', async () => {
        const store = createMemoryOutboxStore();

        render(
            <SyncProvider subject="user_a" send={vi.fn()} store={store}>
                <Probe />
            </SyncProvider>,
        );
        await act(async () => {
            await appendToQuarantine(store, 'user_a', 'editor.draft.quarantine.user_a', 'bytes');
        });

        expect(screen.getByText('unreadable:1')).toBeTruthy();
    });

    it('⛔ starts from a set-aside that happened before the provider mounted', async () => {
        const store = createMemoryOutboxStore();

        await appendToQuarantine(store, 'user_a', 'editor.draft.quarantine.user_a', 'bytes');
        render(
            <SyncProvider subject="user_a" send={vi.fn()} store={store}>
                <Probe />
            </SyncProvider>,
        );

        expect(screen.getByText('unreadable:1')).toBeTruthy();
    });

    it('⛔ shows none for another cook, or for no cook', async () => {
        const store = createMemoryOutboxStore();

        await appendToQuarantine(store, 'user_a', 'editor.draft.quarantine.user_a', 'bytes');
        const view = render(
            <SyncProvider subject="user_b" send={vi.fn()} store={store}>
                <Probe />
            </SyncProvider>,
        );
        expect(screen.getByText('unreadable:0')).toBeTruthy();

        view.rerender(
            <SyncProvider subject={undefined} send={vi.fn()} store={store}>
                <Probe />
            </SyncProvider>,
        );
        expect(screen.getByText('unreadable:0')).toBeTruthy();
    });

    it('drops to zero when the session-end clear resets the ledger', async () => {
        const store = createMemoryOutboxStore();
        await store.setItem(storeKeyFor('user_a'), '{ not json');

        render(
            <SyncProvider subject="user_a" send={vi.fn()} store={store}>
                <Probe />
            </SyncProvider>,
        );
        await waitFor(() => {
            expect(screen.getByText('unreadable:1')).toBeTruthy();
        });

        await act(async () => {
            await outboxMutatorFor(store, 'user_a').clear();
        });

        expect(screen.getByText('unreadable:0')).toBeTruthy();
    });
});
