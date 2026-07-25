/**
 * Per-file upload QUEUE layer (w3/e4) — a FIFO work queue (Producer/Consumer, drained one item at a time)
 * layered ABOVE the existing single-flight {@link useRecipePhotoUpload} hook, never reimplementing or
 * modifying it (Decorator/Adapter: this hook composes the unchanged `{ uploading, errorMessage, upload }`
 * contract, it does not alter it). The step-4 wireframe needs a 3-column grid where EACH file shows its own
 * status (queued / uploading / ok / failed) with a retry — but `useRecipePhotoUpload` is deliberately sized
 * for exactly one in-flight upload (its B24 single-flight guard is a HARD block, not a queue; see its module
 * doc). This hook reconciles the two: it holds an ARRAY of per-file items (a `useReducer` statechart, styled
 * after `hooks/ingredientResolver.model.ts`'s closed-`kind`-union convention) and drives the underlying
 * `upload` once per file, one at a time, so bytes still go over the wire single-flight while the grid can
 * show every file's own status.
 *
 * **How "sequential" is achieved without touching the single-flight hook.** Two effects coordinate purely
 * off the CALLER-SUPPLIED `uploader.uploading`/`uploader.errorMessage` (the exact state
 * `useRecipePhotoUpload` already exposes) plus one local `activeFileId`:
 *  - **"start next"** — whenever nothing is active (`activeFileId === null`) and the uploader itself is
 *    idle (`!uploader.uploading`), pick the earliest `queued` item, record it as active, and call
 *    `uploader.upload(item.file)`. Because this only ever fires when the uploader is idle, it can never
 *    overlap the B24 guard — this hook is the uploader's ONLY caller once composed into a container, so the
 *    guard is never even exercised concurrently.
 *  - **"settle"** — whenever there IS an active file and the uploader has gone idle again
 *    (`activeFileId !== null && !uploader.uploading`), the just-finished attempt is resolved from
 *    `uploader.errorMessage` (present → `failed` with that message; absent → `ok`), and `activeFileId`
 *    clears. `useRecipePhotoUpload.upload()`'s own promise never rejects (it swallows every failure into its
 *    `errorMessage` state) — so this is the ONLY correct way to observe a per-file outcome without changing
 *    that hook's contract.
 * Because "start next" only fires once "settle" has cleared `activeFileId`, and both gate on the SAME
 * `uploader.uploading` flag the real hook flips synchronously before its first internal `await`, the two
 * effects can never race: at most one file is ever mid-flight, and the next never starts until the current
 * one has fully resolved.
 *
 * **`fileId` generation** is owned by this hook's own reducer — a monotonically-incrementing counter carried
 * in reducer state (not `Math.random`/`Date.now`, and not a ref: the counter is itself part of the pure
 * reducer's state transition, keeping the reducer the single source of truth for the queue's shape).
 *
 * **The 10-photo cap** (confirmed + active queue items, never exceeding {@link MAX_RECIPE_PHOTOS}) is
 * enforced in `enqueue`: an `ok` item is treated as already folded into the caller's `confirmedCount` (once
 * a file lands, the confirmed-photos query refetch is the source of truth for it — see `confirm →
 * invalidateRecipeProjections` in `useRecipePhotoUpload`'s module doc), so only `queued`/`failed` items (plus
 * whichever one is currently the active upload) count against the remaining slots. A caller may keep an `ok`
 * item's row in `items` after it resolves (e.g. to show a final checkmark for one more render); this hook
 * never expires it on a timer — the grid leaf decides whether to keep rendering it or to prefer the confirmed
 * `photos` list once it refetches.
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
 */
import { useEffect, useReducer, useState } from 'react';

import { MAX_RECIPE_PHOTOS } from '../photos/model.js';
import { validatePhotoFile, type PhotoValidationErrorCode } from '../photos/photoValidation.js';
import type { RecipePhotoUploadFile, UseRecipePhotoUploadResult } from './useRecipePhotoUpload.js';

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
}

/** One file's state as exposed to the grid. */
export interface RecipePhotoQueueItem {
    /** Stable id this hook assigned at enqueue time — the handle {@link retry}/{@link remove} take. */
    readonly fileId: number;
    /** The original file name, for the grid's accessible labeling. */
    readonly fileName: string;
    /** The caller-supplied preview source, if one was given at enqueue time. */
    readonly previewUri?: string;
    /** The file's current lifecycle status. */
    readonly status: RecipePhotoQueueStatus;
    /** The localized error from the most recent failed attempt; present only when `status` is `failed`. */
    readonly errorMessage?: string;
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
     * Enqueue one or more newly-picked files. Silently caps the accepted files at however many slots remain
     * under {@link MAX_RECIPE_PHOTOS} (confirmed photos + this queue's own active items) — a caller that
     * wants to surface "you can only add N more" should check that itself before calling (the cap here is a
     * defensive floor, not the primary UX signal). Each accepted file is admitted through
     * {@link validatePhotoFile} (REQ-011/REQ-012) BEFORE it ever becomes eligible for upload — a file that
     * fails validation is added straight into `failed` status with its localized reason, never `queued`.
     */
    readonly enqueue: (files: readonly RecipePhotoQueueFile[]) => void;
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
}

interface QueueState {
    readonly nextFileId: number;
    readonly items: readonly StoredItem[];
}

const INITIAL_STATE: QueueState = { nextFileId: 1, items: [] };

type QueueAction =
    | {
          readonly type: 'enqueue';
          readonly files: readonly RecipePhotoQueueFile[];
          readonly validationMessages: RecipePhotoValidationMessages;
      }
    | { readonly type: 'succeed'; readonly fileId: number }
    | { readonly type: 'fail'; readonly fileId: number; readonly errorMessage: string }
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

            return { nextFileId, items: [...state.items, ...added] };
        }

        case 'succeed':
            return {
                ...state,
                items: state.items.map((item) =>
                    item.fileId === action.fileId ? { fileId: item.fileId, file: item.file, status: 'ok' } : item,
                ),
            };
        case 'fail':
            return {
                ...state,
                items: state.items.map((item) =>
                    item.fileId === action.fileId
                        ? { fileId: item.fileId, file: item.file, status: 'failed', errorMessage: action.errorMessage }
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
        const status: RecipePhotoQueueStatus = item.fileId === activeFileId ? 'uploading' : item.status;
        const previewUri = item.file.previewUri;
        const errorMessage = item.errorMessage;

        return {
            fileId: item.fileId,
            fileName: item.file.fileName,
            status,
            ...(previewUri === undefined ? {} : { previewUri }),
            ...(errorMessage === undefined ? {} : { errorMessage }),
        };
    });
}

/**
 * The per-file photo upload queue, driving the existing single-flight {@link useRecipePhotoUpload} once per
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
    uploader: Pick<UseRecipePhotoUploadResult, 'uploading' | 'errorMessage' | 'upload'>,
    confirmedCount: number,
    validationMessages: RecipePhotoValidationMessages,
): UseRecipePhotoUploadQueueResult {
    const [state, dispatch] = useReducer(queueReducer, INITIAL_STATE);
    const [activeFileId, setActiveFileId] = useState<number | null>(null);

    // "start next": once idle (nothing active, the underlying hook itself not mid-flight), drive the
    // earliest queued item. Gating on `!uploader.uploading` means this can never call `upload` while a
    // previous call driven by THIS hook (or, degenerately, any other caller) is still in flight.
    useEffect(() => {
        if (activeFileId !== null || uploader.uploading) {
            return;
        }

        const next = state.items.find((item) => item.status === 'queued');

        if (next === undefined) {
            return;
        }

        setActiveFileId(next.fileId);
        void uploader.upload(next.file);
        // `uploader.upload` is intentionally NOT a dep: it is stable per recipeId (memoized by the underlying
        // hook), and this effect's own trigger is `state.items`/`activeFileId`/`uploader.uploading` — adding
        // an unstable caller-supplied function reference here would risk re-firing on unrelated re-renders.
    }, [state.items, activeFileId, uploader.uploading]);

    // "settle": once the active file's upload has gone idle again, resolve its outcome from the underlying
    // hook's OWN `errorMessage` — its `upload()` promise never rejects, so this is the only way to observe
    // per-file success/failure without changing that hook's contract.
    useEffect(() => {
        if (activeFileId === null || uploader.uploading) {
            return;
        }

        if (uploader.errorMessage !== undefined) {
            dispatch({ type: 'fail', fileId: activeFileId, errorMessage: uploader.errorMessage });
        } else {
            dispatch({ type: 'succeed', fileId: activeFileId });
        }

        setActiveFileId(null);
    }, [activeFileId, uploader.uploading, uploader.errorMessage]);

    const enqueue = (files: readonly RecipePhotoQueueFile[]): void => {
        const activeCount = state.items.filter((item) => item.status !== 'ok').length;
        const available = Math.max(0, MAX_RECIPE_PHOTOS - confirmedCount - activeCount);
        const accepted = files.slice(0, available);

        if (accepted.length > 0) {
            dispatch({ type: 'enqueue', files: accepted, validationMessages });
        }
    };

    const retry = (fileId: number): void => dispatch({ type: 'retry', fileId, validationMessages });
    const remove = (fileId: number): void => dispatch({ type: 'remove', fileId });

    return { items: toPublicItems(state.items, activeFileId), enqueue, retry, remove };
}
