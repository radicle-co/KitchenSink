// @vitest-environment jsdom
/**
 * The end of a cook's device session on web (ADR-0057, ADR-0054): their editor drafts leave the tab's session storage,
 * their outbox leaves its store, and nothing of another cook's is touched. Real `sessionStorage` (jsdom's), the real
 * draft store and the real outbox format.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { EMPTY_OUTBOX, appendIntent, loadOutbox, saveOutbox } from '@kitchensink/sync';

import { endDeviceSession, webOutboxStore } from '@/components/recipes/deviceSession';
import { editorDraftsFor } from '@/components/recipes/editorDrafts';

afterEach(() => {
    window.sessionStorage.clear();
});

const memento = (recipeRef: string) => ({
    recipeRef,
    baseVersion: null,
    values: {
        title: 'Soup',
        description: '',
        cuisine: '',
        tags: [],
        dietaryFlags: [],
        servings: 2,
        prepTimeMinutes: 0,
        cookTimeMinutes: 0,
        visibility: 'public' as const,
        ingredients: [],
        steps: [],
    },
    pendingRebinds: [],
    savedAt: '2026-10-09T10:00:00.000Z',
});

describe('endDeviceSession', () => {
    it('removes the cook`s drafts and outbox, and keeps another cook`s', async () => {
        await editorDraftsFor('user_a')?.save(memento('local:recipe:a'));
        await editorDraftsFor('user_b')?.save(memento('local:recipe:b'));
        const queued = appendIntent(EMPTY_OUTBOX, {
            entity: 'recipe',
            intentKind: 'update',
            localId: 'r1',
            dependsOn: [],
            payload: {},
        });
        await saveOutbox(webOutboxStore, 'user_a', queued);
        await saveOutbox(webOutboxStore, 'user_b', queued);

        await endDeviceSession('user_a');

        expect(await editorDraftsFor('user_a')?.load('local:recipe:a')).toBeUndefined();
        expect((await loadOutbox(webOutboxStore, 'user_a')).records).toEqual([]);
        expect(await editorDraftsFor('user_b')?.load('local:recipe:b')).toBeDefined();
        expect((await loadOutbox(webOutboxStore, 'user_b')).records).toHaveLength(1);
    });

    it('keeps every cook`s drafts when nobody was signed in, and still removes the cook marks', async () => {
        await editorDraftsFor('user_a')?.save(memento('local:recipe:a'));
        window.sessionStorage.setItem('cook.v1..0a6c2f4e-8b1d-4c3a-9e2f-1d2c3b4a5f60', '{"lines":["a"],"step":null}');

        await endDeviceSession(undefined);

        expect(await editorDraftsFor('user_a')?.load('local:recipe:a')).toBeDefined();
        expect(window.sessionStorage.getItem('cook.v1..0a6c2f4e-8b1d-4c3a-9e2f-1d2c3b4a5f60')).toBeNull();
    });
});
