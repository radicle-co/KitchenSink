/**
 * The draft-photo seam (U33, owner ruling 2026-08-25) — photos behave like every other field, and flush to
 * the upload queue the moment the recipe first has an id.
 *
 * ⛔ **WHAT THIS EXISTS TO PREVENT.** Before U33, `RecipePhotoUploaderContainer` took a REQUIRED `recipeId`
 * and keyed every operation on it, so the create path could not show an uploader at all — it rendered "Save
 * this recipe first". Moving that notice onto step 1 would have greeted every new recipe with a disabled
 * control. So a pick is recorded in the DRAFT and handed to the queue when an id appears.
 *
 * ⛔ **The flush rule is deliberately the SAME on create and edit.** On edit the id is already there, so the
 * flush is immediate; on create it fires when the create mutation returns. ONE rule, not two paths — which
 * is what makes "a photo chosen before the first save survives it" and "a photo chosen while editing uploads
 * now" the same tested behaviour rather than two.
 *
 * ⛔ **Enqueue is IDEMPOTENT BY LOCAL ID, and that is not belt-and-braces.** The effect clears the flushed
 * picks from the draft in the same tick it enqueues them, but a React state update is not synchronous:
 * StrictMode's deliberate double-invoke, and any re-render that lands before the clear applies, both re-run
 * the effect against the SAME `values.photos`. Without identity tracking that uploads the file twice — two
 * photos on the recipe, one of them a duplicate the cook never chose.
 *
 * ⛔ **The BINARY never enters form state.** `recipeFormValuesEqual` (the discard guard) compares by
 * `JSON.stringify`, and a `Blob` serialises to `{}` — two different pending photos would compare EQUAL, so
 * swapping one for another would be reported as "no unsaved changes". The bytes live in this hook; only the
 * JSON-comparable descriptor is draft state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useState, type FC } from 'react';

import { defaultRecipeFormValues, type RecipeFormValues } from '../../form/model.js';
import { useRecipeDraftPhotos, type DraftPhotoPick } from '../useRecipeDraftPhotos.js';

afterEach(cleanup);

const pick = (name: string): DraftPhotoPick => ({
    blob: new Blob(['x'], { type: 'image/png' }),
    fileName: name,
    contentType: 'image/png',
    fileSize: 1,
});

interface HarnessProps {
    readonly recipeId: string | null;
    readonly enqueue: (files: readonly unknown[]) => void;
    readonly onValues?: (values: RecipeFormValues) => void;
}

/** Exposes the hook's `addPhotos` while owning the draft the way a real container does. */
let addPhotos: (picks: readonly DraftPhotoPick[]) => void = () => undefined;
/** The hook's over-cap message, surfaced for assertion. */
let capError: string | undefined;
/** How many more photos the harness's draft may take — the real cap arithmetic lives in the container. */
let capacityRemaining = 10;

const Harness: FC<HarnessProps> = ({ recipeId, enqueue, onValues }) => {
    const [values, setValues] = useState<RecipeFormValues>(defaultRecipeFormValues);

    const draftPhotos = useRecipeDraftPhotos({
        recipeId,
        values,
        onChange: (next) => {
            onValues?.(next);
            setValues(next);
        },
        enqueue,
        capacity: { remaining: capacityRemaining, overCapMessage: 'Only {count} more.' },
    });

    capError = draftPhotos.capError;

    addPhotos = draftPhotos.addPhotos;

    return <p>{values.photos.map((photo) => photo.fileName).join(',')}</p>;
};

describe('useRecipeDraftPhotos — a pick before the recipe exists', () => {
    it('records the pick in the DRAFT rather than uploading it', () => {
        const enqueue = vi.fn();
        const { container } = render(<Harness recipeId={null} enqueue={enqueue} />);

        act(() => addPhotos([pick('a.png')]));

        expect(container.textContent).toBe('a.png');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('keeps several picks, in the order they were chosen', () => {
        const enqueue = vi.fn();
        const { container } = render(<Harness recipeId={null} enqueue={enqueue} />);

        act(() => addPhotos([pick('a.png')]));
        act(() => addPhotos([pick('b.png'), pick('c.png')]));

        expect(container.textContent).toBe('a.png,b.png,c.png');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('gives every pick a DISTINCT local id, so two files of the same name stay two files', () => {
        const enqueue = vi.fn();
        const seen: RecipeFormValues[] = [];

        render(<Harness recipeId={null} enqueue={enqueue} onValues={(v) => seen.push(v)} />);

        act(() => addPhotos([pick('same.png'), pick('same.png')]));

        const ids = (seen.at(-1)?.photos ?? []).map((photo) => photo.localId);

        expect(new Set(ids).size).toBe(2);
    });

    it('carries only JSON-comparable data into the draft — never the Blob', () => {
        // ⛔ The discard guard's `JSON.stringify` compare is only EXACT because every field is plain data.
        const enqueue = vi.fn();
        const seen: RecipeFormValues[] = [];

        render(<Harness recipeId={null} enqueue={enqueue} onValues={(v) => seen.push(v)} />);
        act(() => addPhotos([pick('a.png')]));

        const photo = seen.at(-1)?.photos[0];

        expect(Object.keys(photo ?? {}).sort()).toEqual(['contentType', 'fileName', 'fileSize', 'localId']);
        expect(JSON.parse(JSON.stringify(photo))).toEqual(photo);
    });
});

describe('useRecipeDraftPhotos — the flush, once the recipe has an id', () => {
    it('hands a pick straight to the queue when the recipe already exists (the edit path)', () => {
        const enqueue = vi.fn();
        render(<Harness recipeId="rec_1" enqueue={enqueue} />);

        act(() => addPhotos([pick('a.png')]));

        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue.mock.calls[0]?.[0]).toHaveLength(1);
    });

    it('CLEARS the flushed picks from the draft, so nothing is queued and pending at once', () => {
        const enqueue = vi.fn();
        const { container } = render(<Harness recipeId="rec_1" enqueue={enqueue} />);

        act(() => addPhotos([pick('a.png')]));

        expect(container.textContent).toBe('');
    });

    it('flushes picks made BEFORE the id arrived, the moment it arrives (the create path)', () => {
        const enqueue = vi.fn();
        const { rerender, container } = render(<Harness recipeId={null} enqueue={enqueue} />);

        act(() => addPhotos([pick('a.png'), pick('b.png')]));
        expect(enqueue).not.toHaveBeenCalled();

        rerender(<Harness recipeId="rec_1" enqueue={enqueue} />);

        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue.mock.calls[0]?.[0]).toHaveLength(2);
        expect(container.textContent).toBe('');
    });

    it('carries the file’s bytes and metadata to the queue, not just the descriptor', () => {
        const enqueue = vi.fn();
        render(<Harness recipeId="rec_1" enqueue={enqueue} />);

        act(() => addPhotos([pick('a.png')]));

        const file = (enqueue.mock.calls[0]?.[0] as readonly DraftPhotoPick[])[0];

        expect(file?.fileName).toBe('a.png');
        expect(file?.contentType).toBe('image/png');
        expect(file?.blob).toBeInstanceOf(Blob);
    });

    it('does nothing at all when there is nothing pending', () => {
        const enqueue = vi.fn();

        render(<Harness recipeId="rec_1" enqueue={enqueue} />);

        expect(enqueue).not.toHaveBeenCalled();
    });
});

/**
 * ⛔ THE mutation guard for this hook, and the reason it needs its OWN harness.
 *
 * The obvious version of this test — add a photo, re-render twice, assert one enqueue — PASSES against a
 * hook with no identity filter at all, because the first flush's `onChange` clears the draft and the effect's
 * `values.photos.length === 0` early return does the rest. It proves the early return works, not the guard.
 * (Verified by mutation: deleting the `flushed` filter left that version green, which is why it is gone.)
 *
 * What actually has to be survived is the effect re-running against the SAME NON-EMPTY `values.photos` —
 * the ordinary case, not the exception: a React state update is not a synchronous write, so StrictMode's
 * deliberate double-invoke and any re-render landing before the clear commits both do exactly this. This
 * harness therefore FREEZES the draft after the pick is registered: `onChange` is observed and discarded,
 * so the effect keeps seeing a photo the hook has already handed over. Without the identity filter the cook
 * gets a duplicate photo on their recipe.
 */
describe('useRecipeDraftPhotos — enqueue is idempotent by local id, not by the draft emptying', () => {
    let freeze = false;

    const FrozenHarness: FC<{
        readonly recipeId: string | null;
        readonly enqueue: (files: readonly unknown[]) => void;
    }> = ({ recipeId, enqueue }) => {
        const [values, setValues] = useState<RecipeFormValues>(defaultRecipeFormValues);

        const draftPhotos = useRecipeDraftPhotos({
            recipeId,
            values,
            onChange: (next) => {
                if (!freeze) {
                    setValues(next);
                }
            },
            enqueue,
            capacity: { remaining: 10, overCapMessage: 'Only {count} more.' },
        });

        addPhotos = draftPhotos.addPhotos;

        return <p>{values.photos.length}</p>;
    };

    it('enqueues a pending pick exactly ONCE while the draft still lists it', () => {
        const enqueue = vi.fn();

        freeze = false;
        const { rerender, container } = render(<FrozenHarness recipeId={null} enqueue={enqueue} />);

        // Registered while there is no recipe yet, so the bytes are held and nothing is enqueued.
        act(() => addPhotos([pick('a.png')]));
        expect(container.textContent).toBe('1');
        expect(enqueue).not.toHaveBeenCalled();

        // Now the id arrives, but the clear never lands — exactly the window a state update leaves open.
        freeze = true;
        rerender(<FrozenHarness recipeId="rec_1" enqueue={enqueue} />);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(container.textContent).toBe('1');

        rerender(<FrozenHarness recipeId="rec_1" enqueue={enqueue} />);
        rerender(<FrozenHarness recipeId="rec_1" enqueue={enqueue} />);

        expect(enqueue).toHaveBeenCalledTimes(1);
        freeze = false;
    });
});

/**
 * ⛔ THE CAP CAN BE BREACHED IN ONE PICK, AND THE BREACH WAS SILENT.
 *
 * The add control is hidden once the cap is reached, which bounds picks BETWEEN each other but not WITHIN
 * one: a `<input multiple>` lets a cook choose twelve files at once. Every descriptor was recorded, then
 * `useRecipePhotoUploadQueue.enqueue` accepted only what fit and DROPPED the rest — while the flush marked
 * all twelve handed over and cleared them from the draft. Two photos vanished: not uploaded, not queued, not
 * surfaced, and the create then navigated away as if everything had landed.
 *
 * The pick is now REFUSED WHOLE rather than truncated. Taking the first two of five and dropping three is the
 * same silent loss wearing a smaller number, and a cook who chose five wants to be told only two fit.
 */
describe('useRecipeDraftPhotos — a pick larger than the remaining capacity (U33)', () => {
    it('records NOTHING when the pick exceeds what is left, rather than truncating it', () => {
        const enqueue = vi.fn();

        capacityRemaining = 2;
        const { container } = render(<Harness recipeId={null} enqueue={enqueue} />);

        act(() => addPhotos([pick('a.png'), pick('b.png'), pick('c.png')]));

        expect(container.textContent).toBe('');
        expect(enqueue).not.toHaveBeenCalled();
        capacityRemaining = 10;
    });

    it('says how many would fit, so the refusal is actionable rather than mute', () => {
        const enqueue = vi.fn();

        capacityRemaining = 2;
        render(<Harness recipeId={null} enqueue={enqueue} />);

        act(() => addPhotos([pick('a.png'), pick('b.png'), pick('c.png')]));

        expect(capError).toBe('Only 2 more.');
        capacityRemaining = 10;
    });

    it('accepts a pick that exactly fills the remaining capacity', () => {
        // The boundary, in the accepting direction — a strict `>` and a `>=` differ by exactly this case.
        const enqueue = vi.fn();

        capacityRemaining = 2;
        const { container } = render(<Harness recipeId={null} enqueue={enqueue} />);

        act(() => addPhotos([pick('a.png'), pick('b.png')]));

        expect(container.textContent).toBe('a.png,b.png');
        expect(capError).toBeUndefined();
        capacityRemaining = 10;
    });

    it('clears a previous refusal once a pick is accepted', () => {
        const enqueue = vi.fn();

        capacityRemaining = 1;
        render(<Harness recipeId={null} enqueue={enqueue} />);

        act(() => addPhotos([pick('a.png'), pick('b.png')]));
        expect(capError).toBe('Only 1 more.');

        act(() => addPhotos([pick('c.png')]));
        expect(capError).toBeUndefined();
        capacityRemaining = 10;
    });

    it('refuses every pick once nothing is left', () => {
        const enqueue = vi.fn();

        capacityRemaining = 0;
        const { container } = render(<Harness recipeId={null} enqueue={enqueue} />);

        act(() => addPhotos([pick('a.png')]));

        expect(container.textContent).toBe('');
        expect(capError).toBe('Only 0 more.');
        capacityRemaining = 10;
    });
});
