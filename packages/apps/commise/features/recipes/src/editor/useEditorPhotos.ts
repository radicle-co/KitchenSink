'use client';

/**
 * The editor's photos: the ONE photo manager session for the whole editor, and the barrier between the editor's finish
 * (Publish, Save changes) or a leave and the photos it would lose (staff-ux SPECIFY, staff-architect BLUEPRINT,
 * 2026-11-10).
 *
 * Why it lives here and not in each app's uploader: every editor section is mounted for the editor's whole life, but
 * the editor's FINISH navigates away, and that unmounted the uploader with whatever was still queued or uploading — a
 * photo silently lost. Holding the session at the editor lets the finish wait for it, and lets a new recipe's picker
 * work before the recipe exists (owner ruling U33): a pick waits in the queue (`RecipePhotoQueueHold`) and uploads once
 * the first checkpoint gives the recipe an id, so there is no hand-off event to miss and nothing to flush.
 *
 * - **A pick asks for the create.** An accepted pick raises the `photoPicked` checkpoint; the policy creates a titled
 *   draft not yet on the server and does nothing else (`checkpointPolicy.ts`).
 * - **The finish waits** while a photo is at risk (`photoIsAtRisk`: queued, waiting, uploading, or failed in a way a
 *   retry can fix), and leaves once none is. A failure holds it until the cook retries or removes that photo, or
 *   chooses "Finish without the remaining photos". A file the device refused can never upload, so it holds nothing.
 * - **A leave asks** only when a photo would be lost; text never asks (Settled 24 — the device draft keeps it). A leave
 *   confirmed while a finish is held runs the finish: the recipe is saved, and one navigation is the finish's.
 *
 * @pattern Mediator — between the editor's exits and the photo queue
 * @pattern Barrier — the finish is released once every photo has settled, or the cook lets them go
 */
import { useEffect, useState } from 'react';

import { photoIsAtRisk } from '../photos/model.js';
import { validatePhotoFile } from '../photos/photoValidation.js';
import { useRecipePhotoManager, type UseRecipePhotoManagerResult } from '../hooks/useRecipePhotoManager.js';

/** What a held finish is waiting on: photos still uploading, or photos that failed and wait on the cook. */
type PhotoFinish = { readonly kind: 'uploading' } | { readonly kind: 'failed'; readonly count: number };

/** The ask before a leave that would lose photos. */
interface PhotoLeaveGuard {
    /** The ask is showing. */
    readonly open: boolean;
    /** Leave: at once when no photo would be lost, else after the cook confirms. */
    readonly request: (proceed: () => void) => void;
    /** "Leave without photos". */
    readonly confirm: () => void;
    /** "Stay". */
    readonly stay: () => void;
}

/** Options for {@link useEditorPhotos}. */
export interface UseEditorPhotosOptions {
    /** The recipe's server id, once it has one. */
    readonly recipeId: string | undefined;
    /** Whether the draft passes the floor a server write needs (`meetsDraftFloor`): the first checkpoint needs it. */
    readonly draftFloorMet: boolean;
    /** Whether the title is what is missing: the leave ask then says the photos wait for a title. */
    readonly titleMissing: boolean;
    /** Raise the editor's photo checkpoint (`useRecipeEditor`'s `checkpoint`). */
    readonly checkpoint: (trigger: 'photoPicked') => void;
}

/** What {@link useEditorPhotos} gives the editor. */
export interface EditorPhotos {
    /** The photo manager session the app's uploader draws; its `enqueuePicked` also asks for the photo checkpoint. */
    readonly manager: UseRecipePhotoManagerResult;
    /** Whether a photo would be lost by leaving now: one is not uploaded yet, and the cook has not let it go. */
    readonly atRisk: boolean;
    /** How many photos would be lost (the leave ask's count), whether or not the cook has let them go. */
    readonly atRiskCount: number;
    /** Whether the held photos wait for a title, the floor's missing part (the leave ask says so). */
    readonly waitingForTitle: boolean;
    /** Set while a finish is held for photos; `undefined` otherwise. */
    readonly finish: PhotoFinish | undefined;
    /** The held finish's one control asks for focus, because the control the cook pressed is gone (SC 2.4.3). */
    readonly finishFocusRequested: boolean;
    readonly onFinishFocusHandled: () => void;
    /** "Finish without the remaining photos": the held finish goes at once. */
    readonly finishWithout: () => void;
    readonly leave: PhotoLeaveGuard;
    /**
     * The editor finished (published, or its changes saved): run `go` (the navigation) once every photo has settled — at
     * once when none is pending.
     */
    readonly finishWhenSettled: (go: () => void) => void;
}

/**
 * The editor's photo session and its finish and leave barrier.
 *
 * @param options - The recipe's id, whether the draft has a title, and the editor's checkpoint.
 * @returns The session; see {@link EditorPhotos}.
 * @sideEffect Drives the photo upload queue, raises a checkpoint on a pick, and runs a held finish when photos settle.
 */
export function useEditorPhotos({
    recipeId,
    draftFloorMet,
    titleMissing,
    checkpoint,
}: UseEditorPhotosOptions): EditorPhotos {
    const manager = useRecipePhotoManager({
        recipeId: recipeId ?? null,
        holdWithoutId: draftFloorMet ? 'untilSaved' : 'untilTitled',
    });
    const unsettled = manager.queue.items.filter(photoIsAtRisk);
    const failedCount = unsettled.filter((item) => item.status === 'failed').length;
    // The cook let the unsent photos go ("Leave without photos", "Finish without…"): nothing is at risk any more.
    const [abandoned, setAbandoned] = useState(false);
    const atRisk = unsettled.length > 0 && !abandoned;
    // A finish waiting for its photos. Held as a value, not run from the upload's promise: the queue settles through its
    // reducer, and only a commit tells us it has.
    const [heldFinish, setHeldFinish] = useState<{ readonly go: () => void } | undefined>(undefined);
    const [finishFocusRequested, setFinishFocusRequested] = useState(false);
    const [leaveAsk, setLeaveAsk] = useState<{ readonly proceed: () => void } | undefined>(undefined);

    // The release. An EFFECT because the navigation it starts is outside React and must run after the commit that
    // settled the last photo (an upload's verdict, a Remove, or "Finish without"), never from a render. It runs once:
    // the held finish is cleared in the same pass.
    useEffect(() => {
        if (heldFinish !== undefined && !atRisk) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- the release is this effect's one job: it hands the finish to the navigator and forgets it, so it cannot run twice
            setHeldFinish(undefined);
            heldFinish.go();
        }
    }, [heldFinish, atRisk]);

    const enqueuePicked: UseRecipePhotoManagerResult['enqueuePicked'] = (files, intent) => {
        const admission = manager.enqueuePicked(files, intent);

        // A pick of files the device refuses has nothing to upload, so it asks for no create.
        if (admission.status === 'accepted' && files.some((file) => validatePhotoFile(file).ok)) {
            setAbandoned(false);
            checkpoint('photoPicked');
        }

        return admission;
    };

    const finishWhenSettled = (go: () => void): void => {
        if (!atRisk) {
            go();

            return;
        }

        setHeldFinish({ go });
        setFinishFocusRequested(true);
    };

    return {
        manager: { ...manager, enqueuePicked },
        atRisk,
        atRiskCount: unsettled.length,
        waitingForTitle: recipeId === undefined && titleMissing,
        finish:
            heldFinish === undefined
                ? undefined
                : failedCount > 0
                  ? { kind: 'failed', count: failedCount }
                  : { kind: 'uploading' },
        finishFocusRequested,
        onFinishFocusHandled: () => setFinishFocusRequested(false),
        finishWithout: () => setAbandoned(true),
        leave: {
            open: leaveAsk !== undefined,
            request: (proceed) => {
                if (!atRisk) {
                    proceed();

                    return;
                }

                setLeaveAsk({ proceed });
            },
            confirm: () => {
                setLeaveAsk(undefined);
                setAbandoned(true);

                // A held finish is released by the abandon above; running the leave too would navigate twice.
                if (heldFinish === undefined) {
                    leaveAsk?.proceed();
                }
            },
            stay: () => setLeaveAsk(undefined),
        },
        finishWhenSettled,
    };
}
