/**
 * The session ending while the editor is open on a titled, unsent new recipe: the two fixes of the 2026-10-09 review meet
 * here. The editor's unmount is a leave, so it runs the exit checkpoint (it writes the device draft and queues the
 * create); the device-session scope then clears the previous cook's stores. Both run in one commit — the editor's
 * cleanup first, the provider's effect after — so the clear must land LAST, or the checkpoint writes the signed-out
 * cook's draft and journal back to the device.
 *
 * Real draft store and real outbox mutator over one memory store, as an app composes them; the write port queues
 * through the mutator and never drains (the cook is offline), so the create stays in the journal until the clear.
 */
import { makeQuietFoodClient } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import {
    appendExclusive,
    appendIntent,
    createMemoryOutboxStore,
    outboxMutatorFor,
    quarantineKeyFor,
    storeKeyFor,
    type OutboxStore,
} from '@kitchensink/sync';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { draftQuarantineKeyFor, draftStoreFor, draftStoreKeyFor } from '../../editor/draftStore.js';
import { useRecipeEditorSession, type RecipeEditorSession } from '../../editor/useRecipeEditorSession.js';
import type { EditorWritePort } from '../../hooks/useRecipeEditor.js';
import { useDeviceSessionScope } from '../deviceSession.js';

/** The editor's write port over the real mutator, offline: it queues and never sends. */
function offlinePort(store: OutboxStore, subject: string): EditorWritePort {
    const mutator = outboxMutatorFor(store, subject);

    return {
        failures: [],
        submit: async (intent) => {
            await mutator.mutate((log) => appendIntent(log, intent));

            return { queued: true };
        },
        submitExclusive: async (intent) => {
            let queuedSeq = 0;

            await mutator.mutate((log) => {
                const result = appendExclusive(log, intent);

                if (result.kind !== 'queued') {
                    throw new Error(`unexpected ${result.kind}`);
                }

                queuedSeq = result.seq;

                return result.log;
            });

            return { kind: 'queued', seq: queuedSeq };
        },
        withdraw: async () => undefined,
        subscribe: () => () => undefined,
    };
}

function Editor(props: {
    readonly store: OutboxStore;
    readonly subject: string;
    readonly onSession: (session: RecipeEditorSession) => void;
}) {
    const { store, subject, onSession } = props;
    const session = useRecipeEditorSession({
        seed: {},
        locale: 'en',
        keep: 'tabSession',
        port: offlinePort(store, subject),
        drafts: draftStoreFor(store, subject),
        navigation: { finished: () => undefined, leftForRecipe: () => undefined, discarded: () => undefined },
        openPaste: false,
    });

    useEffect(() => {
        onSession(session);
    });

    return null;
}

/** As each app's composition root: the scope above, the editor only while a cook is signed in. */
function App(props: {
    readonly store: OutboxStore;
    readonly subject: string | null;
    readonly onSession: (session: RecipeEditorSession) => void;
}) {
    const { store, subject, onSession } = props;

    useDeviceSessionScope(store, subject);

    return subject === null ? null : <Editor store={store} subject={subject} onSession={onSession} />;
}

describe('the session ends while the editor holds a titled, unsent new recipe', () => {
    it('⛔ leaves no draft and no journal of the signed-out cook on the device', async () => {
        const store = createMemoryOutboxStore();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        let session: RecipeEditorSession | undefined;
        const tree = (subject: string | null) => (
            <QueryClientProvider client={queryClient}>
                <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
                    <FoodServiceProvider client={makeQuietFoodClient()} subject="user_cook">
                        <App
                            store={store}
                            subject={subject}
                            onSession={(next) => {
                                session = next;
                            }}
                        />
                    </FoodServiceProvider>
                </RecipeServiceProvider>
            </QueryClientProvider>
        );
        const view = render(tree('user_cook'));

        act(() => {
            session?.editor.setField('title', 'Soup');
        });
        // The cook made a checkpoint, so the device holds the draft and the journal holds the create.
        act(() => {
            session?.editor.checkpoint('sectionChange');
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(await store.getItem(storeKeyFor('user_cook'))).not.toBeNull();
        expect(await store.getItem(draftStoreKeyFor('user_cook'))).not.toBeNull();

        view.rerender(tree(null));
        await act(async () => {
            for (let turn = 0; turn < 5; turn += 1) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        });

        const kept = await Promise.all(
            [
                storeKeyFor('user_cook'),
                quarantineKeyFor('user_cook'),
                draftStoreKeyFor('user_cook'),
                draftQuarantineKeyFor('user_cook'),
            ].map((key) => store.getItem(key)),
        );

        expect(kept).toEqual([null, null, null, null]);
    });
});
