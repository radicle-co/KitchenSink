/**
 * Per-file upload QUEUE layer (w3/e4) — a FIFO work queue (Producer/Consumer, drained one item at a time)
 * layered ABOVE the existing single-flight `useRecipePhotoUpload` hook, never reimplementing or
 * modifying it (Decorator/Adapter: this hook composes the unchanged `{ uploading, errorMessage, upload }`
 * contract, it does not alter it). The step-4 wireframe needs a 3-column grid where EACH file shows its own
 * status (queued / uploading / ok / failed) with a retry — but `useRecipePhotoUpload` is deliberately sized
 * for exactly one in-flight upload (its B24 single-flight guard is a HARD block, not a queue; see its module
 * doc). This hook reconciles the two: it holds an ARRAY of per-file items (a `useReducer` statechart, styled
 * after `hooks/ingredientResolver.model.ts`'s closed-`kind`-union convention) and drives the underlying
 * `upload` once per file, one at a time, so bytes still go over the wire single-flight while the grid can
 * show every file's own status.
 *
 * **How "sequential" is achieved.** One effect drives and AWAITS, using only this hook's own
 * `activeFileId`:
 *  - **"drive"** — whenever nothing is active (`activeFileId === null`), pick the earliest `queued` item,
 *    record it as active, `await uploader.upload(item.file)`, and dispatch the RESOLVED verdict. At most one
 *    file is in flight because `activeFileId` is set synchronously before the await.
 *  - **"drain"** — runs each owed `onUploaded` continuation from COMMITTED reducer state, exactly once.
 *
 * ⛔ IT DOES NOT COORDINATE OFF `uploader.uploading`. Effects gated on that flag silently require
 * `useRecipePhotoUpload` to flip it SYNCHRONOUSLY before its first internal `await` — an invariant nothing
 * enforces, living in a different hook, which a react-query mutation (status propagates asynchronously)
 * breaks: "settle" fires while `uploading` is still false, marking a photo `ok` that never uploaded. The
 * verdict is a VALUE the drive awaits, and a value has no edge to mis-time — so this hook has no opinion
 * about the other one's internals.
 *
 * **Post-commit continuations.** "settle" is also the single place a file's optional
 * {@link RecipePhotoQueueFile.onUploaded} continuation runs — exactly once, only on the `ok` arm, only while
 * the item is still in the queue. That makes "do X once this photo is durably the server's" expressible
 * without any leaf re-deriving per-file outcomes from `uploader` state (U6's cancel-safe Replace: the
 * original photo is deleted only after its replacement has confirmed).
 *
 * **`fileId` generation** is owned by this hook's own reducer — a monotonically-incrementing counter carried
 * in reducer state (not `Math.random`/`Date.now`, and not a ref: the counter is itself part of the pure
 * reducer's state transition, keeping the reducer the single source of truth for the queue's shape).
 *
 * **The 10-photo cap** (confirmed + active queue items, never exceeding `MAX_RECIPE_PHOTOS`) is
 * enforced in `enqueue` through the pure {@link admitPhotoBatch} policy: a batch is admitted WHOLE or refused
 * whole, and `enqueue` RETURNS that verdict. An `ok` item is treated as already folded into the caller's
 * `confirmedCount` (once a file lands, the confirmed-photos query refetch is the source of truth for it — see
 * `confirm → invalidateRecipeProjections` in `useRecipePhotoUpload`'s module doc), so only `queued`/`failed`
 * items (plus whichever one is currently the active upload) count against the remaining slots. A caller may
 * keep an `ok` item's row in `items` after it resolves (e.g. to show a final checkmark for one more render);
 * this hook never expires it on a timer — the grid leaf decides whether to keep rendering it or to prefer the
 * confirmed `photos` list once it refetches.
 *
 * ⛔ **Why a verdict and not a silent slice.** `enqueue` used to take what fit and drop the rest without a word,
 * on the premise that every caller would check capacity first. The edit container never did: a ten-file pick
 * with two slots left queued two, dropped eight, told the cook nothing, and leaked the eight object URLs the
 * container had already minted. The verdict is what lets a caller release what it minted and say how many fit.
 * It is computed in the `enqueue` wrapper, not the reducer, because `dispatch` cannot return a value.
 *
 * **What this hook does NOT do**: it does not call `confirm`/invalidate anything itself — every successful
 * upload already runs through `useRecipePhotoUpload`, which owns that single call site. It does not acquire
 * files (no DOM `<input>`, no `expo-image-picker`) — each platform's leaf stays responsible for turning a
 * user's pick into a {@link RecipePhotoQueueFile} and calling `enqueue`.
 *
 * **Client-side pre-validation (REQ-011/REQ-012), gated at admission, not at drive-time.** This hook is
 * also the ADMISSION CONTROL point for the pure {@link validatePhotoFile} guard: the ONLY two places a
 * stored item's status becomes `'queued'` — `enqueue` (new files) and `retry` (re-attempting a failed
 * file) — run the file through it first. A file that fails validation is admitted straight into `'failed'`
 * status, carrying the caller's localized {@link RecipePhotoValidationMessages} copy, and NEVER transitions
 * through `'queued'`/`'uploading'` — so "start next" never drives it into `uploader.upload`, and its bytes
 * are never transmitted. Re-validating on `retry` (not just `enqueue`) closes the same gate on a deliberate
 * re-attempt of an already-rejected file, so "validate before transmission" holds on every path a file can
 * reach the underlying single-flight hook — including the one arm ("start next"/"settle") this hook shares
 * with genuine (network/server) upload failures, which never needs to know validation exists at all.
 *
 * Because retry re-validates, a client-rejected file can NEVER succeed on a re-attempt — so every public item
 * carries a {@link RecipePhotoQueueItem.retryable} discriminator saying whether Retry is a real affordance at
 * all. Only a settled TRANSPORT failure is retryable; a validation rejection offers Remove and nothing else,
 * which is what the grid leaves render. That keeps "which failures can a retry fix?" a single fact owned here,
 * beside the admission gate that creates the distinction, rather than re-derived in each platform's leaf.
 */
import { useEffect, useEffectEvent, useReducer, useState } from 'react';

import { admitPhotoBatch, remainingPhotoSlots, type RecipePhotoAdmission } from '../photos/model.js';
import { validatePhotoFile, type PhotoValidationErrorCode } from '../photos/photoValidation.js';
import type {
    RecipePhotoUploadFile,
    RecipePhotoUploadOutcome,
    UseRecipePhotoUploadResult,
} from './useRecipePhotoUpload.js';

/** A per-file item's lifecycle, as stored by the reducer. `uploading` is DERIVED (see {@link toPublicItems}). */
type StoredStatus = 'queued' | 'ok' | 'failed';

/** The status the grid renders for a queue item — `uploading` is synthesized from the active file id. */
export type RecipePhotoQueueStatus = StoredStatus | 'uploading';

/**
 * A file handed to {@link UseRecipePhotoUploadQueueResult.enqueue}. Extends the underlying single-flight
 * hook's own input shape with an optional caller-supplied preview source (a web object URL, a native asset
 * URI, …) so the grid can render a thumbnail for a queued/uploading/failed file before the server has
 * confirmed it — this hook never generates or revokes that URL itself (platform-specific, leaf-owned).
 */
export interface RecipePhotoQueueFile extends RecipePhotoUploadFile {
    /** A caller-supplied preview source for the grid thumbnail; not sent to the server. */
    readonly previewUri?: string;
    /**
     * Optional post-commit continuation (a Command carried ON the work item) invoked EXACTLY ONCE, and only
     * once this file's presign → PUT → confirm has fully succeeded — i.e. once the new photo is durably the
     * server's. It never runs for a file that failed (validation or transport), was withdrawn from the queue
     * before settling, or is still in flight; a `retry` that finally lands does run it.
     *
     * This is the seam U6's cancel-safe "Replace" is built on: a leaf enqueues the replacement carrying
     * `onUploaded: () => deletePhoto(originalId)`, so the original photo is removed only after its
     * replacement exists. A cancelled pick never enqueues anything, and a failed upload never commits — in
     * both cases the original survives untouched (the remove-then-add ordering it replaces lost the original
     * on a mere picker cancel).
     *
     * @sideEffect The caller's continuation typically runs a mutation; this hook invokes it from its settle
     *   effect and ignores any value it returns.
     */
    readonly onUploaded?: () => void;
}

/** One file's state as exposed to the grid. */
export interface RecipePhotoQueueItem {
    /** Stable id this hook assigned at enqueue time — the handle `retry`/`remove` take. */
    readonly fileId: number;
    /** The original file name, for the grid's accessible labeling. */
    readonly fileName: string;
    /** The caller-supplied preview source, if one was given at enqueue time. */
    readonly previewUri?: string;
    /** The file's current lifecycle status. */
    readonly status: RecipePhotoQueueStatus;
    /** The localized error from the most recent failed attempt; present only when `status` is `failed`. */
    readonly errorMessage?: string;
    /**
     * Whether a {@link UseRecipePhotoUploadQueueResult.retry} on this item could plausibly SUCCEED — the
     * discriminator a grid leaf gates its Retry control on (so Retry is never a dead affordance).
     *
     * `true` only for a TRANSPORT/server failure: the bytes reached (or tried to reach) the wire and the
     * attempt lost, so re-driving the same file is a genuinely different roll of the dice.
     *
     * `false` for everything else, and deliberately so in two distinct cases:
     *  - **Nothing to retry** — `queued` / `uploading` / `ok`.
     *  - **A CLIENT-VALIDATION rejection** (REQ-011 too large / REQ-012 wrong type). `retry` re-runs
     *    {@link validatePhotoFile} by design (see the module doc's admission-control note), and the file has
     *    not changed, so the identical pure check re-fails identically — the attempt can never succeed. The
     *    only meaningful action there is Remove, and the leaf must offer exactly that.
     */
    readonly retryable: boolean;
}

/**
 * The caller's own localized copy for the two {@link PhotoValidationErrorCode}s {@link validatePhotoFile}
 * can return — the i18n-agnostic contract this hook shares with `useRecipePhotoUpload`'s
 * `uploadErrorMessage` (see its module doc): this hook stores exactly the string the caller supplies, and
 * carries no strings of its own.
 */
export interface RecipePhotoValidationMessages {
    /** Shown when {@link validatePhotoFile} rejects a file as `'TOO_LARGE'` (REQ-011). */
    readonly tooLarge: string;
    /** Shown when {@link validatePhotoFile} rejects a file as `'BAD_TYPE'` (REQ-012). */
    readonly badType: string;
}

/** The state + actions {@link useRecipePhotoUploadQueue} exposes to a leaf. */
export interface UseRecipePhotoUploadQueueResult {
    /** Every queued/in-flight/settled file, in the order they were enqueued. */
    readonly items: readonly RecipePhotoQueueItem[];
    /**
     * Enqueue one or more newly-picked files, WHOLE or not at all. When the batch is larger than
     * {@link remaining}, nothing is queued and the verdict is `overCap` carrying how many would fit — the caller
     * releases anything it prepared for those files (a web object URL) and tells the cook. Each admitted file
     * then passes {@link validatePhotoFile} (REQ-011/REQ-012) BEFORE it becomes eligible for upload — a file
     * that fails validation is added straight into `failed` status with its localized reason, never `queued`.
     */
    readonly enqueue: (files: readonly RecipePhotoQueueFile[]) => RecipePhotoAdmission;
    /**
     * How many more files this queue would admit now: the cap, less the confirmed count, less every item still
     * holding a grid cell. The same number `enqueue` judges against — read it instead of re-deriving it.
     */
    readonly remaining: number;
    /**
     * Re-run exactly the file with this id — a no-op unless that file's status is currently `failed`.
     * Re-validates (not a bare status flip) before re-admitting, so a previously validation-rejected file
     * stays `failed` on retry rather than reaching the transport layer.
     */
    readonly retry: (fileId: number) => void;
    /** Drop the file with this id from the queue (any status). */
    readonly remove: (fileId: number) => void;
}

interface StoredItem {
    readonly fileId: number;
    readonly file: RecipePhotoQueueFile;
    readonly status: StoredStatus;
    readonly errorMessage?: string;
    /**
     * Set ONLY on the transport-failure transition (`fail`) — the sole failure mode a re-attempt can change.
     * Every other transition (`admit`, i.e. `enqueue`/`retry`, and `succeed`) leaves it absent, which is
     * projected as `retryable: false`. See {@link RecipePhotoQueueItem.retryable}.
     */
    readonly retryable?: true;
}

interface QueueState {
    readonly nextFileId: number;
    readonly items: readonly StoredItem[];
    /**
     * File ids whose `onUploaded` continuation is OWED but not yet run.
     *
     * ⛔ WHY THE REDUCER OWNS THIS. A continuation typically DELETES a confirmed photo (U6 Replace), so
     * firing it twice destroys the wrong image and firing it for a withdrawn file destroys one the cook
     * still has. An `item.status !== 'ok'` read in the effect is not safe: the verdict arrives on a resolved
     * promise, so that read is a STALE CLOSURE over the render that started the upload. Recording the debt
     * inside the same pure transition that marks the item `ok` makes exactly-once a reducer INVARIANT rather
     * than a timing argument: the debt can only be created by the transition that succeeds, and only once.
     */
    readonly owedContinuations: readonly number[];
}

const INITIAL_STATE: QueueState = { nextFileId: 1, items: [], owedContinuations: [] };

type QueueAction =
    | {
          readonly type: 'enqueue';
          readonly files: readonly RecipePhotoQueueFile[];
          readonly validationMessages: RecipePhotoValidationMessages;
      }
    | { readonly type: 'succeed'; readonly fileId: number }
    | { readonly type: 'fail'; readonly fileId: number; readonly errorMessage: string }
    | { readonly type: 'settle'; readonly fileId: number; readonly outcome: RecipePhotoUploadOutcome }
    | { readonly type: 'continuationRan'; readonly fileId: number }
    | { readonly type: 'retry'; readonly fileId: number; readonly validationMessages: RecipePhotoValidationMessages }
    | { readonly type: 'remove'; readonly fileId: number };

/** Map a {@link PhotoValidationErrorCode} to the caller's own localized copy for it. */
function validationErrorMessage(code: PhotoValidationErrorCode, messages: RecipePhotoValidationMessages): string {
    return code === 'TOO_LARGE' ? messages.tooLarge : messages.badType;
}

/**
 * Admit one file: run it through {@link validatePhotoFile} and produce the `StoredItem` it becomes — either
 * `'queued'` (eligible for "start next" to drive) or `'failed'` with the caller's localized validation copy
 * (never eligible — see the module doc's admission-control note). The ONLY constructor of a `'queued'`
 * item outside this function is the identity fall-through in `retry` for an already-valid re-check.
 */
function admit(
    fileId: number,
    file: RecipePhotoQueueFile,
    validationMessages: RecipePhotoValidationMessages,
): StoredItem {
    const validation = validatePhotoFile(file);

    return validation.ok
        ? { fileId, file, status: 'queued' }
        : { fileId, file, status: 'failed', errorMessage: validationErrorMessage(validation.code, validationMessages) };
}

/** Pure reducer for the queue's stored state. Exported for nothing beyond this module — kept file-local. */
function queueReducer(state: QueueState, action: QueueAction): QueueState {
    switch (action.type) {
        case 'enqueue': {
            if (action.files.length === 0) {
                return state;
            }

            let nextFileId = state.nextFileId;
            const added: StoredItem[] = action.files.map((file) => {
                const fileId = nextFileId;
                nextFileId += 1;

                return admit(fileId, file, action.validationMessages);
            });

            return { ...state, nextFileId, items: [...state.items, ...added] };
        }

        case 'succeed':
            return {
                ...state,
                items: state.items.map((item) =>
                    item.fileId === action.fileId ? { fileId: item.fileId, file: item.file, status: 'ok' } : item,
                ),
            };

        case 'settle': {
            // ⛔ ONE TRANSITION FOR THE WHOLE VERDICT, so the item's presence and its new status are decided
            // from COMMITTED state rather than from whatever the drive effect closed over.
            const present = state.items.find((item) => item.fileId === action.fileId);

            if (present === undefined) {
                // Withdrawn mid-flight: nothing to mark, and — critically — no continuation owed. The cook
                // removed the file, so a `DELETE` on its behalf would destroy a photo they still hold.
                return state;
            }

            if (action.outcome.status === 'busy') {
                // The uploader refused to START, which is ABSENCE, not an outcome. Leave the item `queued`
                // so the next commit re-drives it; marking it either way would be a lie about a file whose
                // bytes never moved.
                return state;
            }

            if (action.outcome.status === 'failed') {
                return queueReducer(state, {
                    type: 'fail',
                    fileId: action.fileId,
                    errorMessage: action.outcome.errorMessage,
                });
            }

            return {
                ...queueReducer(state, { type: 'succeed', fileId: action.fileId }),
                // Owed only when this transition is the one that marked it `ok` — an already-`ok` item
                // cannot owe a second continuation.
                owedContinuations:
                    present.status === 'ok' ? state.owedContinuations : [...state.owedContinuations, action.fileId],
            };
        }

        case 'continuationRan':
            return {
                ...state,
                owedContinuations: state.owedContinuations.filter((fileId) => fileId !== action.fileId),
            };
        case 'fail':
            return {
                ...state,
                items: state.items.map((item) =>
                    item.fileId === action.fileId
                        ? {
                              fileId: item.fileId,
                              file: item.file,
                              status: 'failed',
                              errorMessage: action.errorMessage,
                              // A transport/server loss — the ONE failure a re-attempt can genuinely change.
                              retryable: true,
                          }
                        : item,
                ),
            };
        case 'retry':
            // Re-runs the SAME admission check `enqueue` uses (not a bare status flip to 'queued'): the
            // file itself never changed since it was first rejected, so a validation-failed item retried
            // without re-checking would sail straight into 'queued' and get driven to the transport layer
            // by "start next" — the exact transmission REQ-011/REQ-012 require blocking. A genuinely
            // upload-failed item (network/server, not validation) always re-validates `ok` here, since only
            // an already-valid file could have reached 'uploading' in the first place.
            return {
                ...state,
                items: state.items.map((item) =>
                    item.fileId === action.fileId && item.status === 'failed'
                        ? admit(item.fileId, item.file, action.validationMessages)
                        : item,
                ),
            };
        case 'remove':
            return { ...state, items: state.items.filter((item) => item.fileId !== action.fileId) };
        default:
            return state;
    }
}

/** Project the reducer's stored items to the public shape, overriding the active file's status to `uploading`. */
function toPublicItems(items: readonly StoredItem[], activeFileId: number | null): readonly RecipePhotoQueueItem[] {
    return items.map((item) => {
        const active = item.fileId === activeFileId;
        const status: RecipePhotoQueueStatus = active ? 'uploading' : item.status;
        const previewUri = item.file.previewUri;
        const errorMessage = item.errorMessage;

        return {
            fileId: item.fileId,
            fileName: item.file.fileName,
            status,
            // Only a settled TRANSPORT failure is retryable. `active` is guarded explicitly so an item
            // re-driven by "start next" before its stored `retryable` flag clears cannot leak a Retry
            // control onto a row the grid is already showing as `uploading`.
            retryable: !active && item.status === 'failed' && item.retryable === true,
            ...(previewUri === undefined ? {} : { previewUri }),
            ...(errorMessage === undefined ? {} : { errorMessage }),
        };
    });
}

/**
 * The per-file photo upload queue, driving the existing single-flight `useRecipePhotoUpload` once per
 * file, sequentially.
 *
 * @param uploader - The `{ uploading, errorMessage, upload }` surface of a `useRecipePhotoUpload` instance
 *   THIS hook is the sole driver of — a leaf composing this hook must not call `uploader.upload` itself, or
 *   the two callers would race the single-flight guard unpredictably.
 * @param confirmedCount - How many photos the recipe already has confirmed server-side (the caller's live
 *   `photos.length`), read fresh on every `enqueue` call so the cap reflects the latest confirmed count.
 * @param validationMessages - The caller's own localized copy for the two ways {@link validatePhotoFile} can
 *   reject a file (REQ-011 `tooLarge`, REQ-012 `badType`) — see the module doc's admission-control note.
 * @returns The queue's items plus `enqueue`/`retry`/`remove`.
 */
export function useRecipePhotoUploadQueue(
    // ⛔ ONLY `upload`. Reading `uploading` and `errorMessage` would couple the queue's scheduling to another
    // hook's internal timing. Narrowing the ask is the seam: display state (async-safe) and coordination (the
    // resolved verdict) are not the same wire.
    uploader: Pick<UseRecipePhotoUploadResult, 'upload'>,
    confirmedCount: number,
    validationMessages: RecipePhotoValidationMessages,
): UseRecipePhotoUploadQueueResult {
    const [state, dispatch] = useReducer(queueReducer, INITIAL_STATE);
    const [activeFileId, setActiveFileId] = useState<number | null>(null);

    // "drive": once nothing is active, start the earliest queued item and AWAIT ITS VERDICT.
    //
    // ⛔ IT DOES NOT READ `uploader.uploading`. Gating on that flag would require the underlying hook to flip
    // it synchronously before its first `await` — an invariant nothing enforces, which a react-query
    // implementation of that hook breaks (status propagates through the notify manager, asynchronously and
    // correctly), settling an attempt that has not started and marking a photo `ok` that never uploaded.
    // `activeFileId` is this hook's OWN synchronous state, so at most one file is in flight by
    // construction here rather than by agreement with another hook's internals.
    //
    // `uploader.upload` is reached through an Effect Event: the drive must use the CURRENT uploader, but a new
    // uploader reference is not a reason to drive — re-firing on it could start a second upload.
    const startUpload = useEffectEvent((file: RecipePhotoQueueFile) => uploader.upload(file));

    useEffect(() => {
        if (activeFileId !== null) {
            return;
        }

        const next = state.items.find((item) => item.status === 'queued');

        if (next === undefined) {
            return;
        }

        // ⛔ Set synchronously, in the effect, BEFORE the upload starts — `react-hooks/set-state-in-effect` flags it,
        // and it is deliberate. This effect IS the synchronisation with an external process (an upload), and the
        // active id is what makes that process single-flight: it must be recorded in the same tick the upload is
        // started, or the re-render a second enqueue causes would start another. The rule's premise, that the
        // value could be derived during render, does not hold for "which upload have I started".
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see the note above
        setActiveFileId(next.fileId);

        void (async () => {
            const outcome = await startUpload(next.file);

            // ⚠️ Dispatched unconditionally, including after unmount: React 18 makes a post-unmount state
            // update a silent no-op, so no mounted-flag is owed HERE. The continuation is the part that must
            // not run after unmount, and it is fired from the drain effect below for exactly that reason.
            dispatch({ type: 'settle', fileId: next.fileId, outcome });

            // ⛔ NOT CLEARED ON `busy`, AND THAT IS WHAT STOPS A SPIN. A `busy` verdict leaves the item
            // `queued` and the reducer state identical, so clearing the active id would re-fire this very
            // effect, pick the same file, and loop as fast as promises resolve. Holding the id instead
            // PAUSES the queue: whatever call currently owns the uploader's mutex releases it in its own
            // `finally` and dispatches its own settle, which clears the id and resumes driving. Since this
            // hook is the uploader's only caller and awaits every verdict, that is the only reachable way
            // to see `busy` at all.
            if (outcome.status !== 'busy') {
                setActiveFileId(null);
            }
        })();
        // ⛔ NO CLEANUP that cancels the in-flight settle. `state.items` is a dep, so a cleanup would fire
        // whenever the cook enqueues another file — cancelling a settle for an upload still in progress and
        // stranding it as permanently `uploading`. `startUpload` is an Effect Event and is never a dependency.
    }, [state.items, activeFileId]);

    // "drain": run each owed `onUploaded` continuation exactly once, from COMMITTED reducer state.
    //
    // ⛔ AN EFFECT, NOT THE PROMISE. A continuation typically DELETES a confirmed photo (U6 Replace), and an
    // effect cannot run on an unmounted component — so a confirm that lands while the surface is being torn
    // down leaves both photos, which is exactly what the previous shape did. Firing it from the awaited
    // promise instead would newly issue that DELETE from an unmounted component.
    useEffect(() => {
        for (const fileId of state.owedContinuations) {
            state.items.find((item) => item.fileId === fileId)?.file.onUploaded?.();
            dispatch({ type: 'continuationRan', fileId });
        }
    }, [state.owedContinuations, state.items]);

    const items = toPublicItems(state.items, activeFileId);
    const remaining = remainingPhotoSlots(confirmedCount, items);

    const enqueue = (files: readonly RecipePhotoQueueFile[]): RecipePhotoAdmission => {
        const admission = admitPhotoBatch(remaining, files.length);

        if (admission.status === 'accepted' && files.length > 0) {
            dispatch({ type: 'enqueue', files, validationMessages });
        }

        return admission;
    };

    const retry = (fileId: number): void => dispatch({ type: 'retry', fileId, validationMessages });
    const remove = (fileId: number): void => dispatch({ type: 'remove', fileId });

    return { items, remaining, enqueue, retry, remove };
}
