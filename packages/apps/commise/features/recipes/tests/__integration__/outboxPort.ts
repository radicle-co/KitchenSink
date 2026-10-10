/**
 * A REAL outbox for this package's integration tier, behind the editor's write port: the `@kitchensink/sync` mutator,
 * `appendExclusive`, `withdraw` and `drain`, over a memory store, sending through the real `RecipeServiceClient`.
 *
 * The app composes the same pieces in `@commise/query/sync` (`SyncProvider` + `recipeSender`); this package cannot
 * depend on the app layer, so the suite builds the composition it needs from the domain package. Only `fetch` behind
 * the client is a double. The drain runs as soon as a write is queued, the way the provider's `submit` flushes.
 */
import {
    appendExclusive,
    createMemoryOutboxStore,
    drain,
    outboxMutatorFor,
    settle,
    supersede,
    withdraw as withdrawRecord,
    type OutboxRecord,
    type SendResult,
    type SettlementEvent,
} from '@kitchensink/sync';
import {
    isRecipeServiceClientError,
    isVersionConflictError,
    type RecipeServiceClient,
} from '@kitchensink/recipe-service-client';

import type { EditorWriteAnswer, EditorWritePort } from '../../src/hooks/useRecipeEditor.js';

/**
 * Send one recipe record through the client, answering as the app's `recipeSender` does.
 *
 * @sideEffect Makes an HTTP call through `client`.
 */
async function send(client: RecipeServiceClient, record: OutboxRecord): Promise<SendResult<EditorWriteAnswer>> {
    const payload = record.payload as { readonly id?: string; readonly input?: unknown };

    try {
        if (record.intentKind === 'create') {
            const created = await client.createRecipe(payload.input as never);

            return { outcome: 'ok', serverId: created.id, answer: { kind: 'recipeWritten', detail: created } };
        }

        if (record.intentKind === 'update') {
            const updated = await client.updateRecipe(payload.id ?? record.localId, payload.input as never);

            return { outcome: 'ok', serverId: updated.id, answer: { kind: 'recipeWritten', detail: updated } };
        }

        await client.deleteRecipe(payload.id ?? record.localId);

        return { outcome: 'ok', serverId: payload.id ?? record.localId };
    } catch (error) {
        if (isVersionConflictError(error) && error.server !== undefined) {
            return {
                outcome: 'failed',
                status: 409,
                answer: {
                    kind: 'recipeConflict',
                    server: error.server,
                    ...(error.base === undefined ? {} : { base: error.base }),
                },
            };
        }

        // The status a refusal came with, as the app's `recipeSender` reports it: without it every refusal would read as
        // an unknown outcome.
        if (isRecipeServiceClientError(error) && typeof error.status === 'number') {
            return { outcome: 'failed', status: error.status };
        }

        return { outcome: 'failed' };
    }
}

/**
 * An editor write port over a real outbox.
 *
 * @param client - The recipe client the drain sends with.
 * @returns The port, `idle()` which resolves once every drain started so far has finished, and `records()`, what the
 *   journal holds now.
 */
export function makeOutboxPort(client: RecipeServiceClient): {
    readonly port: EditorWritePort;
    readonly idle: () => Promise<void>;
    readonly records: () => Promise<readonly OutboxRecord[]>;
} {
    const mutator = outboxMutatorFor(createMemoryOutboxStore(), 'user_cook');
    const listeners = new Set<(event: SettlementEvent<EditorWriteAnswer>) => void>();
    let draining: Promise<void> = Promise.resolve();
    let failures: EditorWritePort['failures'] = [];

    const flush = (): void => {
        draining = draining.then(async () => {
            const log = await mutator.read();

            await drain(log, (record) => send(client, record), {
                journal: {
                    claim: async () => true,
                    settle: async (settlement) => {
                        const next = await mutator.mutate((current) => settle(current, settlement));
                        failures = next.records
                            .filter((record) => record.state === 'parked')
                            .map((record) => ({
                                seq: record.seq,
                                entity: record.entity,
                                intentKind: record.intentKind,
                                localId: record.localId,
                                ...(record.lastStatus === undefined ? {} : { status: record.lastStatus }),
                            }));
                    },
                },
                onSettled: (event) => {
                    for (const listener of [...listeners]) {
                        listener(event);
                    }
                },
            });
        });
    };

    const port: EditorWritePort = {
        get failures() {
            return failures;
        },
        submit: async (intent) => {
            await mutator.mutate((current) => supersede(current, intent));
            flush();

            return { queued: true };
        },
        submitExclusive: async (intent) => {
            let outcome: Awaited<ReturnType<EditorWritePort['submitExclusive']>> | undefined;

            await mutator.mutate((current) => {
                const result = appendExclusive(current, intent);

                if (result.kind === 'queued') {
                    outcome = { kind: 'queued', seq: result.seq };

                    return result.log;
                }

                outcome = result;

                return current;
            });

            if (outcome === undefined) {
                throw new Error('the outbox mutation did not run');
            }

            if (outcome.kind === 'queued') {
                flush();
            }

            return outcome;
        },
        withdraw: async (seq) => {
            await mutator.mutate((current) => withdrawRecord(current, seq));
        },
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
    };

    return { port, idle: () => draining, records: async () => (await mutator.read()).records };
}
