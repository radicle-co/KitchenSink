/**
 * @module @commise/features-recipes/__fixtures__ — a fake of the editor's write port (`EditorWritePort`, the app's
 * `SyncQueue` structurally): it records each call, and lets a test put a record on the wire, park it or answer it.
 * The settlement bus is the only way the editor learns anything, which is the contract this fake keeps.
 *
 * ⛔ THE LOG IS THE REAL ONE. Every port call and every test handle applies `@kitchensink/sync`'s own pure functions
 * (`appendExclusive`, `supersede`, `withdraw`, `applyDiscard`, `claimForSending`, `settle`) to a real `OutboxLog`, so
 * what the editor is told is what the outbox would do. A hand-copied model of those rules had already drifted (its
 * Discard ignored `concerns`).
 *
 * ⚠️ `failures` is re-projected from the log by every port call and by `park`/`sync`, but NOT by `claim`, the way the
 * app's projection trails a drain's claim until it re-renders: that gap is what lets a test put a record on the wire
 * while the editor still reads it as parked.
 *
 * The port half is checked against {@link EditorWritePort} with `satisfies`, so a change to the port fails here rather
 * than hiding behind a cast in every test that mounts the editor.
 */
import type { RecipeDetail } from '@kitchensink/recipe-core';
import {
    EMPTY_OUTBOX,
    appendExclusive,
    appendIntent,
    applyDiscard,
    claimForSending,
    settle,
    supersede,
    withdraw as withdrawRecord,
    type DiscardRequest,
    type Intent,
    type OutboxLog,
    type SettlementEvent,
} from '@kitchensink/sync';
import { vi } from 'vitest';

import type { EditorParkedWrite, EditorWriteAnswer, EditorWritePort } from '../hooks/useRecipeEditor.js';

type Settlement = SettlementEvent<EditorWriteAnswer>;

/**
 * Build a fake write port.
 *
 * @returns The port, with the test's handles: `claim`, `sync`, `park`, `parkEarlier`, `lastSeq`, `queued`, and what was
 *   submitted, withdrawn or discarded.
 */
export function makeFakeEditorWritePort() {
    const listeners = new Set<(event: Settlement) => void>();
    let log: OutboxLog = EMPTY_OUTBOX;
    /** The parked records, as the app projects them (`failuresOf`). Mutated in place: the port is spread below. */
    const failures: EditorParkedWrite[] = [];

    const submitted: Intent[] = [];
    const withdrawn: number[] = [];
    /** Every request handed to `discard`, in order. */
    const discarded: DiscardRequest[] = [];

    const project = (): void => {
        failures.splice(
            0,
            failures.length,
            ...log.records
                .filter((record) => record.state === 'parked')
                .map((record) => ({
                    seq: record.seq,
                    entity: record.entity,
                    intentKind: record.intentKind,
                    localId: record.localId,
                    ...(record.lastStatus === undefined ? {} : { status: record.lastStatus }),
                })),
        );
    };

    const apply = (next: OutboxLog): void => {
        log = next;
        project();
    };

    const announce = (event: Settlement): void => {
        for (const listener of [...listeners]) {
            listener(event);
        }
    };

    const writePort = {
        failures,
        submit: vi.fn(async (intent: Intent) => {
            submitted.push(intent);
            apply(supersede(log, intent));

            return { queued: true as const };
        }),
        submitExclusive: vi.fn(async (intent: Intent) => {
            const result = appendExclusive(log, intent);

            if (result.kind !== 'queued') {
                return result;
            }

            submitted.push(intent);
            apply(result.log);

            return { kind: 'queued' as const, seq: result.seq };
        }),
        withdraw: vi.fn(async (seq: number) => {
            withdrawn.push(seq);
            apply(withdrawRecord(log, seq));
        }),
        discard: vi.fn(async (request: DiscardRequest) => {
            discarded.push(request);

            const applied = applyDiscard(log, request);

            apply(applied.log);

            return applied.outcome;
        }),
        subscribe: (listener: (event: Settlement) => void) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
    } satisfies EditorWritePort;

    /** The record numbered `seq`, or a throw: a handle naming no record is a broken test. */
    const recordAt = (seq: number) => {
        const record = log.records.find((candidate) => candidate.seq === seq);

        if (record === undefined) {
            throw new Error(`no record ${String(seq)}`);
        }

        return record;
    };

    return {
        ...writePort,
        submitted,
        withdrawn,
        discarded,
        /** A drain claimed the record: it is on the wire. The projection is left as it was (see the module note). */
        claim: (seq: number) => {
            log = claimForSending(log, seq) ?? log;
        },
        /** The newest record's sequence number. */
        lastSeq: () => log.nextSeq - 1,
        /** What the outbox holds now, oldest first. */
        queued: () => log.records.map(({ seq: _seq, state: _state, lastStatus: _status, ...intent }) => intent),
        /** The state of the record numbered `seq`, or `undefined` once it has left the log. */
        stateOf: (seq: number) => log.records.find((record) => record.seq === seq)?.state,
        /** A record an earlier session parked: it is in the log before the editor mounts. Returns its number. */
        parkEarlier: (intent: Intent, status?: number): number => {
            const seq = log.nextSeq;

            apply(
                settle(appendIntent(log, intent), {
                    seq,
                    outcome: 'parked',
                    ...(status === undefined ? {} : { status }),
                }),
            );

            return seq;
        },
        /** The drain answered: synced. A record the log no longer holds (replaced or superseded) settles nothing. */
        sync: (seq: number, detail: RecipeDetail) => {
            const record = log.records.find((candidate) => candidate.seq === seq);

            apply(
                settle(log, {
                    seq,
                    outcome: 'synced',
                    serverId: detail.id,
                    ...(record?.produces === undefined ? {} : { produces: record.produces }),
                }),
            );
            announce({
                seq,
                entity: 'recipe',
                localId: record?.localId ?? '',
                intentKind: record?.intentKind ?? 'update',
                outcome: 'synced',
                serverId: detail.id,
                answer: { kind: 'recipeWritten', detail },
            });
        },
        /** The drain answered: parked. */
        park: (seq: number, status?: number, answer?: EditorWriteAnswer) => {
            const record = recordAt(seq);

            apply(settle(log, { seq, outcome: 'parked', ...(status === undefined ? {} : { status }) }));
            announce({
                seq,
                entity: 'recipe',
                localId: record.localId,
                intentKind: record.intentKind,
                outcome: 'parked',
                ...(status === undefined ? {} : { status }),
                ...(answer === undefined ? {} : { answer }),
            });
        },
    };
}
