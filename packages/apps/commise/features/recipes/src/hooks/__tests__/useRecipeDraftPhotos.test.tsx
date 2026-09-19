/**
 * The draft-photo seam (U33, owner ruling 2026-08-25) — photos behave like every other field: a pick is held in
 * the DRAFT until the recipe exists, and handed to the upload queue by an explicit `flush` the create mutation's
 * success issues.
 *
 * ⛔ **WHAT THIS EXISTS TO PREVENT.** Before U33, `RecipePhotoUploaderContainer` took a REQUIRED `recipeId`
 * and keyed every operation on it, so the create path could not show an uploader at all — it rendered "Save
 * this recipe first". So a pick is recorded in the DRAFT and handed to the queue once an id exists.
 *
 * ⛔ **The hand-off is an EVENT, not an effect.** It used to be an effect keyed on the id arriving, which needed
 * an idempotence set to survive re-runs and a `set-state-in-effect` suppression. The id arrives from our own
 * mutation after the cook presses Publish, so the success callback is where the hand-off belongs: it fires once
 * per success by construction. The suites below pin the three things the effect form got wrong or merely got
 * right by accident — a re-render never hands anything over, a descriptor with no bytes is never reported as
 * handed over, and a clear never overwrites a write that landed in the same batch.
 *
 * ⛔ **The BINARY never enters form state.** `recipeFormValuesEqual` (the discard guard) compares by
 * `JSON.stringify`, and a `Blob` serialises to `{}` — two different pending photos would compare EQUAL, so
 * swapping one for another would be reported as "no unsaved changes". The bytes live in this hook; only the
 * JSON-comparable descriptor is draft state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';

import type { RecipePhotoAdmission } from '../../photos/model.js';
import { type RecipeFormValues, defaultRecipeFormValues } from '../../form/values.js';
import { useRecipeDraftPhotos, type DraftPhotoFlush, type DraftPhotoPick } from '../useRecipeDraftPhotos.js';

afterEach(cleanup);

const pick = (name: string): DraftPhotoPick => ({
    blob: new Blob([name], { type: 'image/png' }),
    fileName: name,
    contentType: 'image/png',
    fileSize: 1,
});

/** An `enqueue` double that admits everything, the way the real queue does while slots remain. */
const acceptingEnqueue = () =>
    vi.fn((_files: readonly DraftPhotoFlush[]): RecipePhotoAdmission => ({ status: 'accepted' }));

interface HarnessProps {
    readonly enqueue: (files: readonly DraftPhotoFlush[]) => RecipePhotoAdmission;
    /** How many more photos the draft may take — the real cap arithmetic lives in the container. */
    readonly remaining?: number;
    /** The draft to start from — used to model a descriptor this hook holds no bytes for. */
    readonly initialValues?: RecipeFormValues;
}

/**
 * Owns the draft the way a real container does, and hands back the hook's surface beside the draft it drives.
 *
 * `setTitle` writes through the SAME updater setter the hook receives, so a test can land an unrelated field
 * edit in the same batch as a hook write and see whether either clobbers the other.
 */
function useHarness({ enqueue, remaining = 10, initialValues }: HarnessProps) {
    const [values, setValues] = useState<RecipeFormValues>(initialValues ?? defaultRecipeFormValues);

    const draftPhotos = useRecipeDraftPhotos({
        values,
        setValues,
        enqueue,
        capacity: { remaining, overCapMessage: 'Only {count} more.' },
    });

    return {
        ...draftPhotos,
        title: values.title,
        photos: values.photos,
        fileNames: values.photos.map((photo) => photo.fileName),
        setTitle: (title: string) => setValues((current) => ({ ...current, title })),
    };
}

const renderHarness = (props: HarnessProps) =>
    renderHook((current: HarnessProps) => useHarness(current), { initialProps: props });

describe('useRecipeDraftPhotos — a pick before the recipe exists', () => {
    it('records the pick in the DRAFT rather than uploading it', () => {
        const enqueue = acceptingEnqueue();
        const { result } = renderHarness({ enqueue });

        act(() => result.current.addPhotos([pick('a.png')]));

        expect(result.current.fileNames).toEqual(['a.png']);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('keeps several picks, in the order they were chosen', () => {
        const { result } = renderHarness({ enqueue: acceptingEnqueue() });

        act(() => result.current.addPhotos([pick('a.png')]));
        act(() => result.current.addPhotos([pick('b.png'), pick('c.png')]));

        expect(result.current.fileNames).toEqual(['a.png', 'b.png', 'c.png']);
    });

    it('gives every pick a DISTINCT local id, so two files of the same name stay two files', () => {
        const { result } = renderHarness({ enqueue: acceptingEnqueue() });

        act(() => result.current.addPhotos([pick('same.png'), pick('same.png')]));

        expect(new Set(result.current.photos.map((photo) => photo.localId)).size).toBe(2);
    });

    it('carries only JSON-comparable data into the draft — never the Blob', () => {
        // ⛔ The discard guard's `JSON.stringify` compare is only EXACT because every field is plain data.
        const { result } = renderHarness({ enqueue: acceptingEnqueue() });

        act(() => result.current.addPhotos([pick('a.png')]));

        const photo = result.current.photos[0];

        expect(Object.keys(photo ?? {}).sort()).toEqual(['contentType', 'fileName', 'fileSize', 'localId']);
        expect(JSON.parse(JSON.stringify(photo))).toEqual(photo);
    });

    it('keeps a field edit that lands in the same batch as the pick', () => {
        // A whole-object write (`{ ...values, photos }`) from the render's snapshot overwrote any updater queued
        // beside it — the ingredient status poller writes exactly that way.
        const { result } = renderHarness({ enqueue: acceptingEnqueue() });

        act(() => {
            result.current.setTitle('Soup');
            result.current.addPhotos([pick('a.png')]);
        });

        expect(result.current.title).toBe('Soup');
        expect(result.current.fileNames).toEqual(['a.png']);
    });

    it('never hands a pick to the queue on its own, however often the draft re-renders', () => {
        // The effect form flushed whenever a render found an id and pending picks. Nothing but `flush` may.
        const enqueue = acceptingEnqueue();
        const { result, rerender } = renderHarness({ enqueue });

        act(() => result.current.addPhotos([pick('a.png')]));
        rerender({ enqueue });
        rerender({ enqueue });

        expect(enqueue).not.toHaveBeenCalled();
        expect(result.current.fileNames).toEqual(['a.png']);
    });
});

describe('useRecipeDraftPhotos — flush, once the recipe exists', () => {
    it('hands every held pick to the queue, with its bytes, in the order chosen', () => {
        const enqueue = acceptingEnqueue();
        const a = pick('a.png');
        const b = pick('b.png');
        const { result } = renderHarness({ enqueue });

        act(() => result.current.addPhotos([a, b]));
        act(() => {
            result.current.flush();
        });

        // ⚠️ ANTI-VACUITY: assert the call exists before reading its payload, or an optional-chained read passes
        // on a hook that enqueued nothing.
        expect(enqueue).toHaveBeenCalledTimes(1);
        const files = enqueue.mock.calls[0]![0];

        expect(files.map((file) => file.fileName)).toEqual(['a.png', 'b.png']);
        expect(files.map((file) => file.blob)).toEqual([a.blob, b.blob]);
    });

    it('clears the handed-over picks from the draft, so nothing is queued and pending at once', () => {
        const { result } = renderHarness({ enqueue: acceptingEnqueue() });

        act(() => result.current.addPhotos([pick('a.png')]));
        act(() => {
            result.current.flush();
        });

        expect(result.current.fileNames).toEqual([]);
    });

    it('hands a pick over ONCE — a second flush enqueues nothing more', () => {
        const enqueue = acceptingEnqueue();
        const { result } = renderHarness({ enqueue });

        act(() => result.current.addPhotos([pick('a.png')]));
        act(() => {
            result.current.flush();
        });
        act(() => {
            result.current.flush();
        });

        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('does not enqueue a pick the cook removed before the flush', () => {
        const enqueue = acceptingEnqueue();
        const { result } = renderHarness({ enqueue });

        act(() => result.current.addPhotos([pick('keep.png'), pick('drop.png')]));
        act(() => result.current.removePhoto(result.current.photos[1]!.localId));
        act(() => {
            result.current.flush();
        });

        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue.mock.calls[0]![0].map((file) => file.fileName)).toEqual(['keep.png']);
    });

    it('calls nothing and reports accepted when nothing is held', () => {
        const enqueue = acceptingEnqueue();
        const { result } = renderHarness({ enqueue });
        let admission: RecipePhotoAdmission | undefined;

        act(() => {
            admission = result.current.flush();
        });

        expect(enqueue).not.toHaveBeenCalled();
        expect(admission).toEqual({ status: 'accepted' });
    });

    it('keeps a descriptor it holds no bytes for in the draft, rather than reporting it handed over', () => {
        // A descriptor with no stored pick (a restored draft) cannot be uploaded. The effect form marked it
        // flushed and deleted it from the draft without ever enqueueing it — a photo lost with no trace.
        const enqueue = acceptingEnqueue();
        const orphan = { localId: 'restored-1', fileName: 'restored.png', contentType: 'image/png', fileSize: 1 };
        const { result } = renderHarness({
            enqueue,
            initialValues: { ...defaultRecipeFormValues(), photos: [orphan] },
        });

        act(() => {
            result.current.flush();
        });

        expect(enqueue).not.toHaveBeenCalled();
        expect(result.current.fileNames).toEqual(['restored.png']);
    });

    it('keeps a field edit that lands in the same batch as the clear', () => {
        const { result } = renderHarness({ enqueue: acceptingEnqueue() });

        act(() => result.current.addPhotos([pick('a.png')]));
        act(() => {
            result.current.setTitle('Soup');
            result.current.flush();
        });

        expect(result.current.title).toBe('Soup');
        expect(result.current.fileNames).toEqual([]);
    });
});

/**
 * ⛔ A FLUSH THE QUEUE REFUSES MUST NOT CLEAR THE DRAFT.
 *
 * The queue admits a batch whole or refuses it whole and says which. The draft's own capacity check makes a
 * refusal at flush time a race rather than a normal path, but that holds only while two separately computed
 * numbers agree, so the flush reads the verdict instead of trusting the agreement. Refused files stay in the
 * draft, visible and removable, with the cap message beside them.
 */
describe('useRecipeDraftPhotos — a flush the queue refuses', () => {
    it('keeps the refused picks in the draft, says how many would fit, and returns the refusal', () => {
        const enqueue = vi.fn((_files: readonly DraftPhotoFlush[]): RecipePhotoAdmission => ({
            status: 'overCap',
            remaining: 1,
        }));
        const { result } = renderHarness({ enqueue });
        let admission: RecipePhotoAdmission | undefined;

        act(() => result.current.addPhotos([pick('a.png'), pick('b.png')]));
        act(() => {
            admission = result.current.flush();
        });

        expect(admission).toEqual({ status: 'overCap', remaining: 1 });
        expect(result.current.fileNames).toEqual(['a.png', 'b.png']);
        expect(result.current.capError).toBe('Only 1 more.');
    });

    it('hands the same picks over on a later flush the queue admits, clearing the refusal', () => {
        let verdict: RecipePhotoAdmission = { status: 'overCap', remaining: 1 };
        const enqueue = vi.fn((_files: readonly DraftPhotoFlush[]): RecipePhotoAdmission => verdict);
        const { result } = renderHarness({ enqueue });

        act(() => result.current.addPhotos([pick('a.png'), pick('b.png')]));
        act(() => {
            result.current.flush();
        });
        verdict = { status: 'accepted' };
        act(() => {
            result.current.flush();
        });

        expect(result.current.fileNames).toEqual([]);
        expect(result.current.capError).toBeUndefined();
        expect(enqueue.mock.calls.at(-1)![0].map((file) => file.fileName)).toEqual(['a.png', 'b.png']);
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
        const { result } = renderHarness({ enqueue: acceptingEnqueue(), remaining: 2 });

        act(() => result.current.addPhotos([pick('a.png'), pick('b.png'), pick('c.png')]));

        expect(result.current.fileNames).toEqual([]);
    });

    it('says how many would fit, so the refusal is actionable rather than mute', () => {
        const { result } = renderHarness({ enqueue: acceptingEnqueue(), remaining: 2 });

        act(() => result.current.addPhotos([pick('a.png'), pick('b.png'), pick('c.png')]));

        expect(result.current.capError).toBe('Only 2 more.');
    });

    it('accepts a pick that exactly fills the remaining capacity', () => {
        // The boundary, in the accepting direction — a strict `>` and a `>=` differ by exactly this case.
        const { result } = renderHarness({ enqueue: acceptingEnqueue(), remaining: 2 });

        act(() => result.current.addPhotos([pick('a.png'), pick('b.png')]));

        expect(result.current.fileNames).toEqual(['a.png', 'b.png']);
        expect(result.current.capError).toBeUndefined();
    });

    it('clears a previous refusal once a pick is accepted', () => {
        const { result } = renderHarness({ enqueue: acceptingEnqueue(), remaining: 1 });

        act(() => result.current.addPhotos([pick('a.png'), pick('b.png')]));
        expect(result.current.capError).toBe('Only 1 more.');

        act(() => result.current.addPhotos([pick('c.png')]));
        expect(result.current.capError).toBeUndefined();
    });

    it('refuses every pick once nothing is left', () => {
        const { result } = renderHarness({ enqueue: acceptingEnqueue(), remaining: 0 });

        act(() => result.current.addPhotos([pick('a.png')]));

        expect(result.current.fileNames).toEqual([]);
        expect(result.current.capError).toBe('Only 0 more.');
    });
});
