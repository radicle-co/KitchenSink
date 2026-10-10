/**
 * @module @commise/features-recipes/__fixtures__ — a fake of the editor's write port (`EditorWritePort`, the app's
 * `SyncQueue` structurally): it records each submit, and lets a test put a record on the wire, park it or answer it.
 * The settlement bus is the only way the editor learns anything, which is the contract this fake keeps.
 *
 * The port half is checked against {@link EditorWritePort} with `satisfies`, so a change to the port fails here rather
 * than hiding behind a cast in every test that mounts the editor.
 */
import type { RecipeDetail } from '@kitchensink/recipe-core';
import type { Intent, SettlementEvent } from '@kitchensink/sync';
import { vi } from 'vitest';

import type { EditorWriteAnswer, EditorWritePort } from '../hooks/useRecipeEditor.js';

type Settlement = SettlementEvent<EditorWriteAnswer>;

/**
 * Build a fake write port.
 *
 * @returns The port, with the test's handles: `claim`, `sync`, `park`, `lastSeq`, and what was submitted or withdrawn.
 */
export function makeFakeEditorWritePort() {
    const listeners = new Set<(event: Settlement) => void>();
    const records = new Map<
        number,
        { readonly intent: Intent; state: 'pending' | 'sending' | 'parked'; status?: number }
    >();
    let nextSeq = 1;
    const failures: {
        seq: number;
        entity: 'recipe';
        intentKind: Intent['intentKind'];
        localId: string;
        status?: number;
    }[] = [];

    const submitted: Intent[] = [];
    const withdrawn: number[] = [];

    const writePort = {
        failures,
        submit: vi.fn(async (intent: Intent) => {
            submitted.push(intent);

            return { queued: true as const };
        }),
        submitExclusive: vi.fn(async (intent: Intent) => {
            const same = [...records.entries()].find(
                ([, record]) => record.intent.entity === intent.entity && record.intent.localId === intent.localId,
            );

            if (same !== undefined && same[1].state === 'sending') {
                return { kind: 'inFlight' as const, seq: same[0] };
            }

            if (same !== undefined && same[1].state === 'parked') {
                return {
                    kind: 'parked' as const,
                    seq: same[0],
                    ...(same[1].status === undefined ? {} : { status: same[1].status }),
                };
            }

            if (same !== undefined) {
                records.delete(same[0]);
            }

            const seq = nextSeq;
            nextSeq += 1;
            records.set(seq, { intent, state: 'pending' });
            submitted.push(intent);

            return { kind: 'queued' as const, seq };
        }),
        withdraw: vi.fn(async (seq: number) => {
            withdrawn.push(seq);
            records.delete(seq);
            failures.splice(
                failures.findIndex((failure) => failure.seq === seq),
                1,
            );
        }),
        subscribe: (listener: (event: Settlement) => void) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
    } satisfies EditorWritePort;

    return {
        ...writePort,
        submitted,
        withdrawn,
        /** The drain claimed the newest record. */
        claim: (seq: number) => {
            const record = records.get(seq);

            if (record !== undefined) {
                record.state = 'sending';
            }
        },
        /** The newest record's sequence number. */
        lastSeq: () => nextSeq - 1,
        /** The drain answered: synced. */
        sync: (seq: number, detail: RecipeDetail) => {
            const record = records.get(seq);
            records.delete(seq);
            const event: Settlement = {
                seq,
                entity: 'recipe',
                localId: record?.intent.localId ?? '',
                intentKind: record?.intent.intentKind ?? 'update',
                outcome: 'synced',
                serverId: detail.id,
                answer: { kind: 'recipeWritten', detail },
            };

            for (const listener of [...listeners]) {
                listener(event);
            }
        },
        /** The drain answered: parked. */
        park: (seq: number, status?: number, answer?: EditorWriteAnswer) => {
            const record = records.get(seq);

            if (record === undefined) {
                throw new Error(`no record ${String(seq)}`);
            }

            record.state = 'parked';
            record.status = status;
            failures.push({
                seq,
                entity: 'recipe',
                intentKind: record.intent.intentKind,
                localId: record.intent.localId,
                ...(status === undefined ? {} : { status }),
            });
            const event: Settlement = {
                seq,
                entity: 'recipe',
                localId: record.intent.localId,
                intentKind: record.intent.intentKind,
                outcome: 'parked',
                ...(status === undefined ? {} : { status }),
                ...(answer === undefined ? {} : { answer }),
            };

            for (const listener of [...listeners]) {
                listener(event);
            }
        },
    };
}
