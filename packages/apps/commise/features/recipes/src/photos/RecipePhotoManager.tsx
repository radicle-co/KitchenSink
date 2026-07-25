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
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { photoMessages } from './messages.js';
import { isAtPhotoCap, MAX_RECIPE_PHOTOS, visibleQueueItems, type RecipePhotoManagerProps } from './model.js';

export const RecipePhotoManager: FC<RecipePhotoManagerProps> = ({
    photos,
    onRemovePhoto,
    removingPhotoId,
    uploading,
    errorMessage,
    queueItems,
    onRetryQueueItem,
    onRemoveQueueItem,
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
                <ul className="grid grid-cols-3 gap-3">
                    {photos.map((photo, index) => {
                        const removing = removingPhotoId === photo.id;

                        return (
                            <li key={photo.id} className="relative overflow-hidden rounded-xl ring-1 ring-border">
                                <img
                                    src={photo.url}
                                    alt={fillTemplate(m.photoAlt, { index: index + 1 })}
                                    loading="lazy"
                                    decoding="async"
                                    className="aspect-square w-full object-cover"
                                />
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
                addControl
            )}
        </section>
    );
};
