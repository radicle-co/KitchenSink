/**
 * The editor's device draft — a Memento of the form, behind the key/value port (blueprint A3, ADR-0057).
 *
 * Its persisted format is a one-way door: a release that cannot read what an older one wrote must not lose it, and
 * must not trust it. What is pinned here:
 *
 * - ⛔ ids and form values ONLY (owner ruling D7): no pending photo picks, no nutrition, nothing the server derives;
 * - ⛔ one key per user, versioned (`editor.draft.v1.{subject}`), so a second account on the device cannot reach it
 *   and a session-end clear is one `removeItem`;
 * - ⛔ unreadable bytes are quarantined under a key of their own before anything overwrites them;
 * - the draft follows the recipe from its local ref to the server id once the create resolves;
 * - the number kept is bounded, the oldest going first.
 */
import { describe, expect, it, vi } from 'vitest';

import { createMemoryOutboxStore } from '@kitchensink/sync';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import { seedLineKey } from '../../form/lineKey.js';
import type { RecipeFormValues } from '../../form/values.js';
import {
    MAX_KEPT_DRAFTS,
    createDraftStore,
    draftStoreFor,
    draftQuarantineKeyFor,
    draftStoreKeyFor,
    draftValuesSchema,
    toDraftValues,
    type DraftMemento,
    type DraftValues,
} from '../draftStore.js';

/** Compile-time identity of two types — `true` only when each is assignable to the other in every position. */
type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const LOCAL_REF = 'local:recipe:abc';

function memento(over: Partial<DraftMemento> = {}): DraftMemento {
    return {
        recipeRef: LOCAL_REF,
        baseVersion: null,
        values: toDraftValues(makeRecipeFormValues()),
        pendingRebinds: [],
        savedAt: '2026-10-08T12:00:00.000Z',
        ...over,
    };
}

describe('the persisted format', () => {
    /**
     * ⛔ THE SCHEMA PARSES EXACTLY THE FORM'S VALUES, minus the photo picks. A field added to `RecipeFormValues` and
     * not here fails `tsc`, so a draft can never silently drop it on reload.
     */
    it('⛔ parses exactly the form values minus photos (compile-time identity)', () => {
        const identical: Exact<ReturnType<typeof draftValuesSchema.parse>, DraftValues> = true;

        expect(identical).toBe(true);
    });

    it('⛔ keeps ids and form values only: the pending photo picks are not persisted', () => {
        const values: RecipeFormValues = makeRecipeFormValues({
            photos: [{ localId: 'p1', fileName: 'a.jpg', contentType: 'image/jpeg', fileSize: 10 }],
        });

        expect(toDraftValues(values)).not.toHaveProperty('photos');
    });

    it('⛔ namespaces the key by user and versions it', () => {
        expect(draftStoreKeyFor('user_a')).toBe('editor.draft.v1.user_a');
        expect(draftStoreKeyFor('user_a')).not.toBe(draftStoreKeyFor('user_b'));
    });
});

describe('createDraftStore', () => {
    /**
     * ⛔ AN AMOUNT-LESS LINE IS A NORMAL DRAFT. The draft spells "no amount" as `NaN` (`toRecipeFormValues`, and every
     * fresh pick since F5), and JSON writes `NaN` as `null`. Read back through a bare `z.number()` that `null` failed the
     * strict parse, and the whole key — every draft the cook had — went to the quarantine on the next read.
     */
    it('⛔ round-trips a line that states no amount (NaN is written as null, and read back as NaN)', async () => {
        const drafts = createDraftStore(createMemoryOutboxStore(), 'user_a');
        const base = makeRecipeFormValues();
        const [first] = base.ingredients;

        if (first === undefined) {
            throw new Error('fixture has no ingredient');
        }

        const amountless = memento({
            values: toDraftValues({
                ...base,
                ingredients: [{ ...first, quantity: Number.NaN, quantityHigh: Number.NaN }],
            }),
        });

        await drafts.save(amountless);

        const loaded = await drafts.load(LOCAL_REF);

        expect(loaded?.values.ingredients[0]?.quantity).toBeNaN();
        expect(loaded?.values.ingredients[0]?.quantityHigh).toBeNaN();
        expect(loaded).toEqual(amountless);
    });

    it('round-trips a memento, and answers nothing for a recipe it holds no draft for', async () => {
        const drafts = createDraftStore(createMemoryOutboxStore(), 'user_a');

        await drafts.save(memento());

        expect(await drafts.load(LOCAL_REF)).toStrictEqual(memento());
        expect(await drafts.load('local:recipe:other')).toBeUndefined();
    });

    /**
     * ⛔ A LINE STATUS ONLY A RECIPE LINE HAS STILL ROUND-TRIPS. The catalog's five-member status vocabulary would read
     * `NEEDS_REVIEW` as unreadable and quarantine the whole draft.
     */
    it('⛔ round-trips a line the gate flagged for review', async () => {
        const drafts = createDraftStore(createMemoryOutboxStore(), 'user_a');
        const values = toDraftValues(makeRecipeFormValues());
        const flagged = memento({
            values: {
                ...values,
                ingredients: values.ingredients.map((line) => ({ ...line, resolutionStatus: 'NEEDS_REVIEW' })),
            },
        });

        await drafts.save(flagged);

        expect(await drafts.load(LOCAL_REF)).toStrictEqual(flagged);
    });

    it('⛔ cannot read another user’s drafts on the same device', async () => {
        const store = createMemoryOutboxStore();
        await createDraftStore(store, 'user_a').save(memento());

        expect(await createDraftStore(store, 'user_b').load(LOCAL_REF)).toBeUndefined();
    });

    it('⛔ keeps both of two saves made at once, for two recipes', async () => {
        const drafts = createDraftStore(createMemoryOutboxStore(), 'user_a');

        await Promise.all([drafts.save(memento()), drafts.save(memento({ recipeRef: 'srv-2', baseVersion: 3 }))]);

        expect(await drafts.load(LOCAL_REF)).toBeDefined();
        expect(await drafts.load('srv-2')).toBeDefined();
    });

    /**
     * REWRITTEN for slice 7: `rekey` became `adopt`, because an answer can land while the editor is closed (the outbox
     * drains after it), and the store — not the editor — is then the only thing that can record it.
     */
    it('adopts a create`s answer: the draft moves from its local ref to the server id, at the version returned', async () => {
        const drafts = createDraftStore(createMemoryOutboxStore(), 'user_a');
        await drafts.save(memento());

        await drafts.adopt(LOCAL_REF, { serverId: 'srv-1', version: 1 });

        expect(await drafts.load(LOCAL_REF)).toBeUndefined();
        expect(await drafts.load('srv-1')).toMatchObject({ recipeRef: 'srv-1', baseVersion: 1 });
    });

    it('adopts an update`s answer: the version moves up, and never down', async () => {
        const drafts = createDraftStore(createMemoryOutboxStore(), 'user_a');
        await drafts.save(memento({ recipeRef: 'srv-1', baseVersion: 4 }));

        await drafts.adopt('srv-1', { serverId: 'srv-1', version: 6 });
        expect(await drafts.load('srv-1')).toMatchObject({ baseVersion: 6 });

        // ⛔ A late answer for an older write cannot regress the token the next update will carry.
        await drafts.adopt('srv-1', { serverId: 'srv-1', version: 5 });
        expect(await drafts.load('srv-1')).toMatchObject({ baseVersion: 6 });
    });

    it('⛔ a save never lowers the version an answer already recorded (whichever writes last)', async () => {
        const drafts = createDraftStore(createMemoryOutboxStore(), 'user_a');
        await drafts.save(memento({ recipeRef: 'srv-1', baseVersion: 4 }));
        await drafts.adopt('srv-1', { serverId: 'srv-1', version: 6 });

        await drafts.save(memento({ recipeRef: 'srv-1', baseVersion: 4, savedAt: '2026-10-08T12:00:05.000Z' }));

        expect(await drafts.load('srv-1')).toMatchObject({ baseVersion: 6, savedAt: '2026-10-08T12:00:05.000Z' });
    });

    it('an answer for a recipe with no draft writes nothing (the cook discarded it)', async () => {
        const store = createMemoryOutboxStore();
        const drafts = createDraftStore(store, 'user_a');

        await drafts.adopt(LOCAL_REF, { serverId: 'srv-1', version: 1 });

        expect(await drafts.load('srv-1')).toBeUndefined();
        expect(await store.getItem(draftStoreKeyFor('user_a'))).toBeNull();
    });

    it('⛔ one store per user and port: two callers share one serial queue (draftStoreFor)', async () => {
        const store = createMemoryOutboxStore();

        expect(draftStoreFor(store, 'user_a')).toBe(draftStoreFor(store, 'user_a'));
        expect(draftStoreFor(store, 'user_a')).not.toBe(draftStoreFor(store, 'user_b'));
        expect(draftStoreFor(store, 'user_a')).not.toBe(draftStoreFor(createMemoryOutboxStore(), 'user_a'));
    });

    it('discards one draft and keeps the others', async () => {
        const drafts = createDraftStore(createMemoryOutboxStore(), 'user_a');
        await drafts.save(memento());
        await drafts.save(memento({ recipeRef: 'srv-2', baseVersion: 1 }));

        await drafts.discard(LOCAL_REF);

        expect(await drafts.load(LOCAL_REF)).toBeUndefined();
        expect(await drafts.load('srv-2')).toBeDefined();
    });

    /** ⛔ ADR-0054: a cook's device state ends with their session — the drafts and anything quarantined. */
    it('⛔ clears every draft and the quarantine for the user, and nothing of another user', async () => {
        const store = createMemoryOutboxStore();
        await store.setItem(draftQuarantineKeyFor('user_a'), '["old"]');
        await createDraftStore(store, 'user_a').save(memento());
        await createDraftStore(store, 'user_b').save(memento());

        await createDraftStore(store, 'user_a').clear();

        expect(await store.getItem(draftStoreKeyFor('user_a'))).toBeNull();
        expect(await store.getItem(draftQuarantineKeyFor('user_a'))).toBeNull();
        expect(await createDraftStore(store, 'user_b').load(LOCAL_REF)).toBeDefined();
    });

    it(`keeps at most ${String(MAX_KEPT_DRAFTS)} drafts, dropping the least recently saved`, async () => {
        const drafts = createDraftStore(createMemoryOutboxStore(), 'user_a');

        for (let index = 0; index <= MAX_KEPT_DRAFTS; index += 1) {
            const minute = String(index).padStart(2, '0');

            await drafts.save(
                memento({ recipeRef: `srv-${String(index)}`, savedAt: `2026-10-08T12:${minute}:00.000Z` }),
            );
        }

        expect(await drafts.load('srv-0')).toBeUndefined();
        expect(await drafts.load('srv-1')).toBeDefined();
        expect(await drafts.load(`srv-${String(MAX_KEPT_DRAFTS)}`)).toBeDefined();
    });

    it('rejects a save the store cannot write, and the next save still runs', async () => {
        const store = createMemoryOutboxStore();
        const drafts = createDraftStore(store, 'user_a');
        vi.spyOn(store, 'setItem').mockRejectedValueOnce(new Error('quota'));

        await expect(drafts.save(memento())).rejects.toThrow('quota');
        await drafts.save(memento({ recipeRef: 'srv-2', baseVersion: 1 }));

        expect(await drafts.load('srv-2')).toBeDefined();
    });
});

describe('unreadable drafts', () => {
    it.each([
        ['bytes that are not JSON', '{ not json'],
        ['a format this release does not write', JSON.stringify({ formatVersion: 2, drafts: {} })],
        [
            'a memento carrying a field the format does not have',
            JSON.stringify({
                formatVersion: 1,
                drafts: {
                    [LOCAL_REF]: { ...memento(), values: { ...memento().values, photos: [] } },
                },
            }),
        ],
    ])('⛔ quarantines %s: reads nothing, keeps the bytes, and saves on', async (_label, raw) => {
        const store = createMemoryOutboxStore();
        await store.setItem(draftStoreKeyFor('user_a'), raw);
        const drafts = createDraftStore(store, 'user_a');

        expect(await drafts.load(LOCAL_REF)).toBeUndefined();
        await drafts.save(memento({ recipeRef: 'srv-2', baseVersion: 1 }));

        expect(JSON.parse((await store.getItem(draftQuarantineKeyFor('user_a'))) ?? '[]')).toStrictEqual([raw]);
        expect(await drafts.load('srv-2')).toBeDefined();
    });

    it('reads a line key it did not mint as unreadable, rather than trusting it', async () => {
        const store = createMemoryOutboxStore();
        const values = toDraftValues(makeRecipeFormValues());
        const forged = { ...values, ingredients: [{ ...values.ingredients[0], key: 'not a key' }] };
        await store.setItem(
            draftStoreKeyFor('user_a'),
            JSON.stringify({ formatVersion: 1, drafts: { [LOCAL_REF]: { ...memento(), values: forged } } }),
        );

        expect(await createDraftStore(store, 'user_a').load(LOCAL_REF)).toBeUndefined();
        expect(values.ingredients[0]?.key).toBe(seedLineKey(1, 0));
    });
});
