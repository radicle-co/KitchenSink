/**
 * @module @commise/features-recipes — web recipe photo manager (T067 building block, wireframe step 4; w3/e4
 * per-file queue grid).
 *
 * Presentational: renders the recipe's confirmed photos MERGED with any in-flight queue items in the
 * wireframed 3-column grid, each queue cell carrying its own status badge (Queued / Uploading… / Upload
 * failed, via role + text — never colour alone, WCAG 1.4.1) plus Retry (failed only) and Remove controls,
 * and renders the caller-supplied `addControl` (the web file input) below the grid — hidden once the recipe
 * is at the photo cap. The container owns image acquisition + the presign → PUT → confirm upload (via the
 * `useRecipePhotoUploadQueue` layer over the single-flight `useRecipePhotoUpload`).
 *
 * B7: every grid image is `loading="lazy"` plus `decoding="async"`, with an explicit `aspect-square` ratio
 * class, so a recipe with many photos does not eagerly paint the whole grid of full-size originals at once
 * (mirrors the detail view's `PhotoCarousel`, the other web surface painting these same originals).
 *
 * REQ-014 (per-file "which photo failed and why"): the generic `queueStatusFailed` badge already names
 * WHICH photo (its cell, its `fileName`-scoped Retry/Remove labels); a failed item's own `errorMessage`
 * (client validation — REQ-011/REQ-012 — or an upload failure, both surfaced by the caller through the same
 * field) renders as a second, distinct line naming WHY, whenever the caller supplies one.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { photoMessages } from './messages.js';
import {
    isAtPhotoCap,
    isCoverPhoto,
    MAX_RECIPE_PHOTO_UPLOAD_MB,
    MAX_RECIPE_PHOTOS,
    visibleQueueItems,
    type RecipePhotoManagerProps,
} from './model.js';

export const RecipePhotoManager: FC<RecipePhotoManagerProps> = ({
    photos,
    onRemovePhoto,
    removingPhotoId,
    uploading,
    errorMessage,
    queueItems,
    onRetryQueueItem,
    onRemoveQueueItem,
    onSetCover,
    onReplacePhoto,
    addControl,
}) => {
    const m = useMessages(photoMessages);
    const pendingItems = visibleQueueItems(queueItems ?? []);
    const atCap = isAtPhotoCap(photos.length + pendingItems.length);

    return (
        <section aria-label={m.heading} className="flex flex-col gap-3">
            <h3 className="font-display text-heading-md font-semibold text-charcoal">{m.heading}</h3>

            {uploading === true ? (
                <p role="status" aria-label={m.uploadingLabel} className="text-body-sm text-slate" />
            ) : null}
            {errorMessage !== undefined ? (
                <p role="alert" className="text-body-sm text-error">
                    {errorMessage}
                </p>
            ) : null}

            {photos.length === 0 && pendingItems.length === 0 ? (
                <p className="text-body-sm text-slate">{m.emptyBody}</p>
            ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {photos.map((photo, index) => {
                        const removing = removingPhotoId === photo.id;
                        const isCover = isCoverPhoto(photos, photo.id);

                        return (
                            <li key={photo.id} className="relative overflow-hidden rounded-xl ring-1 ring-border">
                                <img
                                    src={photo.url}
                                    alt={fillTemplate(m.photoAlt, { index: index + 1 })}
                                    loading="lazy"
                                    decoding="async"
                                    className="aspect-square w-full object-cover"
                                />
                                {/* U6: the cover status is text (never colour alone, WCAG 1.4.1); shown only on the
                                    index-0 photo the server resolves as `coverPhotoUrl`, and only where the surface
                                    offers cover selection. */}
                                {onSetCover !== undefined && isCover ? (
                                    <span className="absolute left-2 top-2 rounded-full bg-seafoam px-2 py-1 text-caption font-semibold text-white">
                                        {m.coverBadge}
                                    </span>
                                ) : null}
                                <button
                                    type="button"
                                    aria-label={fillTemplate(m.removeLabel, { index: index + 1 })}
                                    aria-busy={removing}
                                    disabled={removing}
                                    onClick={() => onRemovePhoto(photo.id)}
                                    className="absolute right-2 top-2 rounded-full bg-charcoal/70 px-3 py-1 text-caption font-medium text-white transition hover:bg-error disabled:opacity-60"
                                >
                                    {removing ? m.removing : m.remove}
                                </button>
                                {onSetCover !== undefined || onReplacePhoto !== undefined ? (
                                    <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2">
                                        {/* U6: single-select cover with RADIO semantics — native radios sharing one
                                            `name` form one group (exactly one checked = the current cover), keyboard-
                                            navigable and screen-reader-announced ("N of M"); each is named by its
                                            1-based index so every control is uniquely addressable. Fully controlled:
                                            the checked state derives from `isCoverPhoto`, so after the container's
                                            reorder + refetch reprojects `photos[0]`, the check follows. */}
                                        {onSetCover !== undefined ? (
                                            <span className="rounded-full bg-charcoal/70 p-1.5">
                                                {/* Accessible name via `aria-label` (the indexed setCoverLabel); the
                                                    visible "Cover" state is the badge above + the checked circle, so no
                                                    duplicate "Cover" text here. */}
                                                <input
                                                    type="radio"
                                                    name="recipe-cover-photo"
                                                    className="block accent-seafoam"
                                                    aria-label={fillTemplate(m.setCoverLabel, { index: index + 1 })}
                                                    checked={isCover}
                                                    onChange={() => onSetCover(photo.id)}
                                                />
                                            </span>
                                        ) : null}
                                        {onReplacePhoto !== undefined ? (
                                            <button
                                                type="button"
                                                aria-label={fillTemplate(m.replaceLabel, { index: index + 1 })}
                                                onClick={() => onReplacePhoto(photo.id)}
                                                className="rounded-full bg-white px-3 py-1 text-caption font-medium text-charcoal shadow-sm transition hover:bg-pearl"
                                            >
                                                {m.replace}
                                            </button>
                                        ) : null}
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                    {pendingItems.map((item) => {
                        const statusWord =
                            item.status === 'queued'
                                ? m.queueStatusQueued
                                : item.status === 'uploading'
                                  ? m.queueStatusUploading
                                  : m.queueStatusFailed;

                        return (
                            <li
                                key={item.fileId}
                                className="relative flex aspect-square flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-pearl ring-1 ring-border"
                            >
                                {item.previewUri !== undefined ? (
                                    <img
                                        src={item.previewUri}
                                        alt={fillTemplate(m.queuePhotoAlt, { fileName: item.fileName })}
                                        loading="lazy"
                                        decoding="async"
                                        className="absolute inset-0 h-full w-full object-cover"
                                    />
                                ) : null}
                                <span
                                    role={item.status === 'failed' ? 'alert' : 'status'}
                                    aria-label={statusWord}
                                    className={`relative rounded-full px-2 py-1 text-caption font-medium ${
                                        item.status === 'failed' ? 'bg-error text-white' : 'bg-charcoal/70 text-white'
                                    }`}
                                >
                                    {statusWord}
                                </span>
                                {item.status === 'failed' && item.errorMessage !== undefined ? (
                                    <p className="relative px-2 text-center text-caption text-error">
                                        {item.errorMessage}
                                    </p>
                                ) : null}
                                {item.status === 'failed' ? (
                                    <div className="relative flex items-center gap-2">
                                        <button
                                            type="button"
                                            aria-label={fillTemplate(m.queueRetryLabel, { fileName: item.fileName })}
                                            onClick={() => onRetryQueueItem?.(item.fileId)}
                                            className="rounded-full bg-white px-3 py-1 text-caption font-medium text-charcoal shadow-sm transition hover:bg-pearl"
                                        >
                                            {m.queueRetry}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={fillTemplate(m.queueRemoveLabel, { fileName: item.fileName })}
                                            onClick={() => onRemoveQueueItem?.(item.fileId)}
                                            className="rounded-full bg-white px-3 py-1 text-caption font-medium text-charcoal shadow-sm transition hover:bg-pearl"
                                        >
                                            {m.remove}
                                        </button>
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            )}

            {atCap ? (
                <p className="text-body-sm text-slate">{fillTemplate(m.maxReached, { max: MAX_RECIPE_PHOTOS })}</p>
            ) : (
                <>
                    <p className="text-caption text-slate">
                        {fillTemplate(m.formatHint, { maxMb: MAX_RECIPE_PHOTO_UPLOAD_MB })}
                    </p>
                    {addControl}
                </>
            )}
        </section>
    );
};
