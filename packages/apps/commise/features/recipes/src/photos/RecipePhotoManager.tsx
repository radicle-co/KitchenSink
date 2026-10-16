/**
 * @module @commise/features-recipes — web recipe photo manager (T067 building block, wireframe step 4; w3/e4
 * per-file queue grid).
 *
 * Presentational: renders the recipe's confirmed photos MERGED with any in-flight queue items in a grid of 3 columns
 * (4 from 600 px of the grid's own container, buildSpec §7.7), each queue cell carrying its own status badge (Queued / Uploading… / Upload
 * failed, via role + text — never colour alone, WCAG 1.4.1) plus Retry (only where the queue reports the
 * failure as `retryable`) and Remove controls,
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
 * field) renders as a second, distinct line naming WHY, whenever the caller supplies one — BELOW the tile, on the page
 * background (E6), never over the image, where its contrast would depend on the photo.
 *
 * With no photo and no queued file it shows the recipe's own generated cover (when `coverPreview` is supplied) and says
 * that cover stands in until a photo is added (A-010).
 *
 * A failed cell's ACTIONS follow the queue's `retryable` discriminator, never `status === 'failed'`: the queue
 * re-validates on retry by design, so retrying a file the CLIENT rejected (too large / wrong type) re-runs the
 * same pure check on the same file and re-fails — Retry there is a dead affordance. Such a cell offers Remove
 * only (and still says WHY it failed); a transport/server failure keeps both.
 */
import { BUSY_CONTROL_CLASS, busyControlProps } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import { RecipeCover } from '@commise/ui/recipe-cover';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
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
    coverPreview,
}) => {
    const m = useMessages(photoMessages);
    const pendingItems = visibleQueueItems(queueItems ?? []);
    const atCap = isAtPhotoCap(photos.length + pendingItems.length);

    return (
        <section aria-label={m.heading} className="flex flex-col gap-3">
            {/* The section name is an H3 in the `label` role, muted — the Details groups' heading (buildSpec §7.7). */}
            <h3 className="text-label text-ink-muted">{m.heading}</h3>

            {/* The upload-in-flight affordance carries its label as CONTENT, not only as `aria-label`: an empty
                `role="status"` paragraph is a zero-height node — nothing for a sighted viewer to see, and
                nothing for a screen reader to announce (a live region announces content CHANGES). Same
                doctrine as `LoadingNotice` (specSharedSystem.md §18): the contextual label doubles as the visible caption. */}
            {uploading === true ? (
                <p role="status" aria-label={m.uploadingLabel} className="text-body-sm text-ink-muted">
                    {m.uploadingLabel}
                </p>
            ) : null}
            {errorMessage !== undefined ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {errorMessage}
                </p>
            ) : null}

            {photos.length === 0 && pendingItems.length === 0 ? (
                <div className="flex flex-col gap-3">
                    {/* The cover this recipe shows without a photo (buildSpec §7.7): what the cook would otherwise
                        have to guess. Narrow, so it previews rather than dominates the section. */}
                    {coverPreview === undefined ? null : (
                        <div className="w-full max-w-xs">
                            <RecipeCover
                                recipeId={coverPreview.recipeId}
                                title={coverPreview.title}
                                {...(coverPreview.cuisine === undefined ? {} : { cuisine: coverPreview.cuisine })}
                                aspect="4:3"
                            />
                        </div>
                    )}
                    <p className="text-body-sm text-ink-muted">{m.emptyBody}</p>
                </div>
            ) : (
                /* 3 columns, 4 from 600 of the CONTAINER (§7.7): the editor sits beside a rail from 840 px, so the
                   viewport says nothing about the width the grid really has. Two-up below 480 until the per-tile ⋯
                   menu replaces the inline Cover, Remove and Replace controls: a tile under about 130 px cannot hold
                   the Cover badge and the Remove pill side by side. */
                <div className="@container">
                    <ul className="grid grid-cols-2 gap-3 @min-[480px]:grid-cols-3 @min-[600px]:grid-cols-4">
                        {photos.map((photo, index) => {
                            const removing = removingPhotoId === photo.id;
                            const isCover = isCoverPhoto(photos, photo.id);

                            return (
                                <li
                                    key={photo.id}
                                    className="relative overflow-hidden rounded-xl ring-1 ring-line-divider"
                                >
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
                                        <span className="absolute left-2 top-2 rounded-full bg-action px-2 py-1 text-caption font-semibold text-on-action">
                                            {m.coverBadge}
                                        </span>
                                    ) : null}
                                    <button
                                        type="button"
                                        aria-label={fillTemplate(m.removeLabel, { index: index + 1 })}
                                        {...busyControlProps({
                                            busy: removing,
                                            onClick: () => onRemovePhoto(photo.id),
                                        })}
                                        className={`absolute right-2 top-2 rounded-full bg-photo-chip px-3 py-1 text-caption font-medium text-ink transition hover:bg-danger hover:text-on-action ${BUSY_CONTROL_CLASS}`}
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
                                                <span className="rounded-full bg-photo-chip p-1.5">
                                                    {/* Accessible name via `aria-label` (the indexed setCoverLabel); the
                                                    visible "Cover" state is the badge above + the checked circle, so no
                                                    duplicate "Cover" text here. */}
                                                    <input
                                                        type="radio"
                                                        name="recipe-cover-photo"
                                                        className="block accent-selected-edge"
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
                                                    className="rounded-full bg-paper px-3 py-1 text-caption font-medium text-ink shadow-sm transition hover:bg-ink/6"
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
                                <li key={item.fileId} className="flex flex-col gap-1">
                                    {/* The FRAME holds the image and what is drawn on it. A failure's prose sits BELOW
                                    it (E6), on the page background, so its contrast never depends on the photo
                                    under it. */}
                                    <div className="relative flex aspect-square flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-surface-muted ring-1 ring-line-divider">
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
                                                item.status === 'failed'
                                                    ? 'bg-danger text-on-action'
                                                    : 'bg-photo-chip text-ink'
                                            }`}
                                        >
                                            {statusWord}
                                        </span>
                                        {/* ⛔ `queued` is offered a Remove too, not only `failed`. A file that has not
                                    started uploading is the one a cook is most likely to want back — and on
                                    the CREATE path every draft pick sits `queued` until the recipe exists, so
                                    without this the photo chosen before the first save was the ONE field of
                                    the editor that could not be changed. Retry stays `failed`-only: there is
                                    nothing to retry about a file that has not tried yet. */}
                                        {item.status === 'failed' || item.status === 'queued' ? (
                                            <div className="relative flex items-center gap-2">
                                                {/* Retry is offered ONLY where it can plausibly succeed. The queue
                                            re-validates on retry by design, so a client-rejected file (too
                                            large / wrong type) would re-fail identically — a dead affordance.
                                            `retryable` is the queue's own discriminator for that. */}
                                                {item.status === 'failed' && item.retryable ? (
                                                    <button
                                                        type="button"
                                                        aria-label={fillTemplate(m.queueRetryLabel, {
                                                            fileName: item.fileName,
                                                        })}
                                                        onClick={() => onRetryQueueItem?.(item.fileId)}
                                                        className="rounded-full bg-paper px-3 py-1 text-caption font-medium text-ink shadow-sm transition hover:bg-ink/6"
                                                    >
                                                        {m.queueRetry}
                                                    </button>
                                                ) : null}
                                                {/* Offered only when wired: a container withholds removal by not
                                            wiring it, and an unwired Remove would do nothing. */}
                                                {onRemoveQueueItem === undefined ? null : (
                                                    <button
                                                        type="button"
                                                        aria-label={fillTemplate(m.queueRemoveLabel, {
                                                            fileName: item.fileName,
                                                        })}
                                                        onClick={() => onRemoveQueueItem(item.fileId)}
                                                        className="rounded-full bg-paper px-3 py-1 text-caption font-medium text-ink shadow-sm transition hover:bg-ink/6"
                                                    >
                                                        {m.remove}
                                                    </button>
                                                )}
                                            </div>
                                        ) : null}
                                    </div>
                                    {item.status === 'failed' && item.errorMessage !== undefined ? (
                                        <p className="px-1 text-caption text-danger-text">{item.errorMessage}</p>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {atCap ? (
                <p className="text-body-sm text-ink-muted">{fillTemplate(m.maxReached, { max: MAX_RECIPE_PHOTOS })}</p>
            ) : (
                <>
                    <p className="text-caption text-ink-muted">
                        {fillTemplate(m.formatHint, { maxMb: MAX_RECIPE_PHOTO_UPLOAD_MB })}
                    </p>
                    {addControl}
                </>
            )}
        </section>
    );
};
