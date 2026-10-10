/**
 * The device session's end, for both apps (ADR-0057, ADR-0054, owner D7/D18): what the device kept for one cook — their
 * editor drafts, their outbox journal, each with its quarantine, and the tab's cook marks — removed through each store's
 * ONE writer, and removed whenever the signed-in cook changes, not only on our own sign-out path.
 *
 * Written from three review findings (code-reviewer High 2 and Medium 6, staff-code-quality major): the clear ran only on
 * our sign-out command, so a sign-out in another tab, a Clerk expiry or revocation, or the UserButton left everything in
 * this tab; it called `removeItem` beside the outbox's write queue, so a queued change wrote the journal back; and each
 * app carried its own copy of it, which had drifted.
 */
import {
    appendIntent,
    createMemoryOutboxStore,
    loadOutbox,
    outboxMutatorFor,
    quarantineKeyFor,
    storeKeyFor,
    type OutboxStore,
} from '@kitchensink/sync';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import { cookMarksKey } from '../../detail/cookMarks.js';
import { draftQuarantineKeyFor, draftStoreFor, draftStoreKeyFor, toDraftValues } from '../../editor/draftStore.js';
import { endDeviceSession, useDeviceSessionScope } from '../deviceSession.js';

/** Seed everything the device keeps for a cook: a draft, a queued write, both quarantines, and a cook mark. */
async function seedCook(store: OutboxStore, subject: string): Promise<void> {
    await draftStoreFor(store, subject).save({
        recipeRef: 'local:recipe:a',
        baseVersion: null,
        values: toDraftValues(makeRecipeFormValues()),
        pendingRebinds: [],
        savedAt: '2026-10-09T12:00:00.000Z',
    });
    await outboxMutatorFor(store, subject).mutate((log) =>
        appendIntent(log, {
            entity: 'recipe',
            intentKind: 'create',
            localId: 'local:recipe:a',
            dependsOn: [],
            payload: {},
        }),
    );
    await store.setItem(draftQuarantineKeyFor(subject), JSON.stringify(['bad draft']));
    await store.setItem(quarantineKeyFor(subject), JSON.stringify(['bad outbox']));
    window.sessionStorage.setItem(cookMarksKey(subject, 'rec_1'), '{}');
}

/** Whether anything the device kept for `subject` is still there. */
async function keptFor(store: OutboxStore, subject: string): Promise<readonly string[]> {
    const keys = [
        draftStoreKeyFor(subject),
        draftQuarantineKeyFor(subject),
        storeKeyFor(subject),
        quarantineKeyFor(subject),
    ];
    const present = await Promise.all(keys.map(async (key) => ((await store.getItem(key)) === null ? [] : [key])));

    return present.flat();
}

/** Let the stores' serial queues run. */
async function flush(): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

afterEach(() => {
    window.sessionStorage.clear();
});

describe('endDeviceSession', () => {
    it('⛔ removes one cook`s drafts, outbox and both quarantines, and leaves another cook`s', async () => {
        const store = createMemoryOutboxStore();
        await seedCook(store, 'user_a');
        await seedCook(store, 'user_b');

        await endDeviceSession(store, 'user_a');

        expect(await keptFor(store, 'user_a')).toEqual([]);
        expect(await keptFor(store, 'user_b')).toHaveLength(4);
    });

    it('removes every cook mark in the tab (D18: whoever made them)', async () => {
        const store = createMemoryOutboxStore();
        window.sessionStorage.setItem(cookMarksKey('user_b', 'rec_2'), '{}');

        await endDeviceSession(store, undefined);

        expect(window.sessionStorage.length).toBe(0);
    });

    /** ⛔ THE CLEAR GOES THROUGH THE OUTBOX'S ONE WRITER: a change queued before it cannot write the journal back. */
    it('⛔ runs after an outbox change queued before it', async () => {
        const store = createMemoryOutboxStore();
        const queued = outboxMutatorFor(store, 'user_a').mutate((log) =>
            appendIntent(log, { entity: 'recipe', intentKind: 'update', localId: 'rec_1', dependsOn: [], payload: {} }),
        );

        await Promise.all([queued, endDeviceSession(store, 'user_a')]);

        expect((await loadOutbox(store, 'user_a')).records).toEqual([]);
        expect(await store.getItem(storeKeyFor('user_a'))).toBeNull();
    });
});

function Scope({ store, subject }: { readonly store: OutboxStore; readonly subject: string | null | undefined }) {
    useDeviceSessionScope(store, subject);

    return null;
}

describe('useDeviceSessionScope', () => {
    it.each([
        ['signs out', null],
        ['is replaced by another cook', 'user_b'],
    ] as const)('⛔ ends the previous cook`s device session when the cook %s', async (_case, next) => {
        const store = createMemoryOutboxStore();
        await seedCook(store, 'user_a');
        const view = render(<Scope store={store} subject="user_a" />);

        view.rerender(<Scope store={store} subject={next} />);
        await flush();

        expect(await keptFor(store, 'user_a')).toEqual([]);
    });

    /** Clerk reports `undefined` while it loads: that is not a sign-out, and the cook's unsent work must survive it. */
    it('⛔ keeps everything while the session is loading, and through a reload of the same cook', async () => {
        const store = createMemoryOutboxStore();
        await seedCook(store, 'user_a');
        const view = render(<Scope store={store} subject={undefined} />);

        view.rerender(<Scope store={store} subject="user_a" />);
        view.rerender(<Scope store={store} subject={undefined} />);
        view.rerender(<Scope store={store} subject="user_a" />);
        await flush();

        expect(await keptFor(store, 'user_a')).toHaveLength(4);
    });

    it('a cook signing in from signed out removes nothing', async () => {
        const store = createMemoryOutboxStore();
        await seedCook(store, 'user_a');
        const view = render(<Scope store={store} subject={null} />);

        view.rerender(<Scope store={store} subject="user_a" />);
        await flush();

        expect(await keptFor(store, 'user_a')).toHaveLength(4);
    });

    it('StrictMode`s replay at mount removes nothing', async () => {
        const store = createMemoryOutboxStore();
        await seedCook(store, 'user_a');

        render(
            <StrictMode>
                <Scope store={store} subject="user_a" />
            </StrictMode>,
        );
        await flush();

        expect(await keptFor(store, 'user_a')).toHaveLength(4);
    });
});
