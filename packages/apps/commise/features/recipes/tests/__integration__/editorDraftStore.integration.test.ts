/**
 * The editor's device draft composed from its real parts: a recipe read through the real wire mapping
 * (`toRecipeFormValues`), the draft store, and the web adapter over jsdom's real `sessionStorage` (owner ruling D7).
 * Nothing is mocked.
 *
 * The unit tier proves the store over an in-memory map. What only the composition shows:
 *
 * - the values the editor actually seeds from a recipe — every optional field the wire mapping fills — pass the
 *   draft's strict schema and come back identical after a "reload" (a new store over the same `sessionStorage`);
 * - what lands in `sessionStorage` is ids and form values only: no photo picks, no nutrition, no names of things the
 *   server derives beyond what the form itself holds;
 * - a real quota error from the browser's storage rejects the save rather than throwing, and loses no earlier draft.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { createWebStorageStore } from '@kitchensink/sync';

import { createDraftStore, draftStoreKeyFor, toDraftValues, type DraftMemento } from '../../src/editor/draftStore.js';
import { toRecipeFormValues } from '../../src/form/wire.js';

const SUBJECT = 'user_draft_integration';

/** The web adapter, resolving `sessionStorage` per call exactly as the app will. */
const sessionStore = () => createWebStorageStore(() => window.sessionStorage);

/** A memento of a recipe the server returned, seeded the way the editor seeds. */
function seeded(): DraftMemento {
    const detail = makeRecipeDetail({ currentVersion: 4, difficulty: 'medium', mealType: 'dinner' });
    const values = toRecipeFormValues(detail);

    return {
        recipeRef: detail.id,
        baseVersion: detail.currentVersion,
        values: toDraftValues({
            ...values,
            photos: [{ localId: 'p1', fileName: 'soup.jpg', contentType: 'image/jpeg', fileSize: 1024 }],
        }),
        pendingRebinds: [],
        savedAt: '2026-10-08T12:00:00.000Z',
    };
}

afterEach(() => {
    window.sessionStorage.clear();
});

describe('the editor draft in sessionStorage (integration)', () => {
    it('survives a reload: a new store over the same tab storage reads back exactly what the editor seeded', async () => {
        const memento = seeded();

        await createDraftStore(sessionStore(), SUBJECT).save(memento);
        const reloaded = await createDraftStore(sessionStore(), SUBJECT).load(memento.recipeRef);

        expect(reloaded).toStrictEqual(memento);
    });

    it('⛔ puts ids and form values only into the tab storage', async () => {
        await createDraftStore(sessionStore(), SUBJECT).save(seeded());

        const stored = window.sessionStorage.getItem(draftStoreKeyFor(SUBJECT)) ?? '';

        expect(stored).not.toContain('photos');
        expect(stored).not.toContain('soup.jpg');
        expect(stored).not.toContain('nutrition');
        expect(stored).not.toContain('calories');
    });

    it('⛔ rejects a save the browser refuses for quota, keeping the draft already there', async () => {
        const drafts = createDraftStore(sessionStore(), SUBJECT);
        const kept = seeded();
        await drafts.save(kept);
        const huge = {
            ...kept,
            recipeRef: 'srv-huge',
            values: { ...kept.values, description: 'x'.repeat(6 * 1024 * 1024) },
        };

        await expect(drafts.save(huge)).rejects.toThrow();

        expect(await drafts.load(kept.recipeRef)).toStrictEqual(kept);
    });
});
