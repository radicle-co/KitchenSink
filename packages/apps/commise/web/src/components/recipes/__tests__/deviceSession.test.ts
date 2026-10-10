// @vitest-environment jsdom
/**
 * The end of a cook's device session on web (ADR-0057, ADR-0054): their editor drafts leave the tab's session storage,
 * their outbox leaves its store, and nothing of another cook's is touched. Real `sessionStorage` (jsdom's), the real
 * draft store and the real outbox format.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { EMPTY_OUTBOX, appendIntent, loadOutbox, outboxMutatorFor, saveOutbox, storeKeyFor } from '@kitchensink/sync';

import { endDeviceSession, webDeviceStore } from '@/components/recipes/deviceSession';
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
        await saveOutbox(webDeviceStore, 'user_a', queued);
        await saveOutbox(webDeviceStore, 'user_b', queued);

        await endDeviceSession('user_a');

        expect(await editorDraftsFor('user_a')?.load('local:recipe:a')).toBeUndefined();
        expect((await loadOutbox(webDeviceStore, 'user_a')).records).toEqual([]);
        expect(await editorDraftsFor('user_b')?.load('local:recipe:b')).toBeDefined();
        expect((await loadOutbox(webDeviceStore, 'user_b')).records).toHaveLength(1);
    });

    it('keeps every cook`s drafts when nobody was signed in, and still removes the cook marks', async () => {
        await editorDraftsFor('user_a')?.save(memento('local:recipe:a'));
        window.sessionStorage.setItem('cook.v1..0a6c2f4e-8b1d-4c3a-9e2f-1d2c3b4a5f60', '{"lines":["a"],"step":null}');

        await endDeviceSession(undefined);

        expect(await editorDraftsFor('user_a')?.load('local:recipe:a')).toBeDefined();
        expect(window.sessionStorage.getItem('cook.v1..0a6c2f4e-8b1d-4c3a-9e2f-1d2c3b4a5f60')).toBeNull();
    });
});

/**
 * The web outbox journal lives as long as the draft it carries (finding 2 of the 2026-10-09 review; ADR-0057 §1). In
 * memory, a create on the wire died with a reload while its draft survived it, and the reopened editor sent the create
 * again: a second recipe. In the tab's session storage, a reload finds the record and the outbox's first read parks it
 * as an unknown outcome, so the cook decides; closing the tab ends both together.
 */
describe('the web outbox journal', () => {
    it('is kept in the tab`s session storage, beside the draft', async () => {
        const queued = appendIntent(EMPTY_OUTBOX, {
            entity: 'recipe',
            intentKind: 'create',
            localId: 'local:recipe:a',
            produces: 'local:recipe:a',
            dependsOn: [],
            payload: { input: { title: 'Soup' } },
        });

        await saveOutbox(webDeviceStore, 'user_a', queued);

        expect(Object.keys(window.sessionStorage)).toContain(storeKeyFor('user_a'));
        expect((await loadOutbox(webDeviceStore, 'user_a')).records).toHaveLength(1);
    });
});

/**
 * Duplicate Tab copies the tab's session storage, the journal included (staff-architect Blocking, code-reviewer Medium 7
 * of the 2026-10-09 review): both tabs would send the same pending create. The store asks the tab whether it holds a
 * copy, and jsdom has no Web Locks, which is the case where a reload cannot be told from a duplicate.
 */
describe('a duplicated tab', () => {
    it('⛔ without Web Locks, the first read of the journal parks its pending create, so the cook decides', async () => {
        const queued = appendIntent(EMPTY_OUTBOX, {
            entity: 'recipe',
            intentKind: 'create',
            localId: 'local:recipe:dup',
            produces: 'local:recipe:dup',
            dependsOn: [],
            payload: { input: { title: 'Soup' } },
        });
        await saveOutbox(webDeviceStore, 'user_dup', queued);

        const log = await outboxMutatorFor(webDeviceStore, 'user_dup').read();

        expect('locks' in navigator).toBe(false);
        expect(log.records.map((record) => record.state)).toStrictEqual(['parked']);
    });
});
