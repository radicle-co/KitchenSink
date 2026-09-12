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

import { createMemoryOutboxStore, saveOutbox, type OutboxStore } from '@kitchensink/sync';

import { SyncProvider, useSyncQueue } from '../syncProvider.js';

/** Surfaces the queue's own state as text, so assertions read what a component would see. */
function Probe(): ReactElement {
    const queue = useSyncQueue();

    return (
        <>
            <span>pending:{queue.pendingCount}</span>
            <span>failed:{queue.failures.length}</span>
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
            records: [
                {
                    entity: 'recipe',
                    intentKind: 'update',
                    localId: 'r1',
                    dependsOn: [],
                    payload: {},
                    state: 'pending',
                },
            ],
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

        const record = (localId: string) => ({
            entity: 'recipe' as const,
            intentKind: 'update' as const,
            localId,
            dependsOn: [],
            payload: {},
            state: 'pending' as const,
        });
        // ⚠️ Keyed on OBSERVABLE STATE, not a read counter: the provider reads storage once to hydrate and
        // again to drain, so counting reads made the very first send pick up `R2`. "Has anything been sent
        // yet" is the fact that actually distinguishes the two passes.
        // ⚠️ Writes are ignored on purpose — the point is that a later read sees new work, which is what a
        // concurrent `submit` would have produced.
        const store = {
            getItem: async () =>
                JSON.stringify({ schemaVersion: 1, records: [record(sent.length === 0 ? 'R1' : 'R2')] }),
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
