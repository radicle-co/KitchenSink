/**
 * @module @commise/features-recipes — web recipe photo manager (T067 building block, wireframe step 4; w3/e4
 * per-file queue grid).
 *
 * Owner ruling 2026-10-17: every confirmed photo's tile carries ONE ⋯ menu button (`@commise/ui/action-menu`, the
 * `disc` look, 44 px) holding Set as cover, Move earlier, Move later, Replace and Remove (`photoMenu.ts`); a queue tile
 * holds Remove in the same menu, and a failed, retryable one keeps a visible Retry `Button`.
 *
 * Presentational: renders the recipe's confirmed photos MERGED with any in-flight queue items in a grid of 3 columns
 * (4 from 600 px of the grid's own container, buildSpec §7.7), each queue cell carrying its own status badge (Queued / Uploading… / Upload
 * failed, via role + text — never colour alone, WCAG 1.4.1) plus Retry (only where the queue reports the
 * failure as `retryable`) and a Remove menu,
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
import { ActionMenu } from '@commise/ui/action-menu';
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import { LiveRegion } from '@commise/ui/live-region';
import { RecipeCover } from '@commise/ui/recipe-cover';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { photoMessages } from './messages.js';
import { photoMenu } from './photoMenu.js';
import {
    isAtPhotoCap,
    isCoverPhoto,
    MAX_RECIPE_PHOTO_UPLOAD_MB,
    MAX_RECIPE_PHOTOS,
    visibleQueueItems,
    uploadedCount,
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
    onMovePhoto,
    onReplacePhoto,
    reordering = false,
    addControl,
    coverPreview,
}) => {
    const m = useMessages(photoMessages);
    const pendingItems = visibleQueueItems(queueItems ?? []);
    const atCap = isAtPhotoCap(photos.length + pendingItems.length);
    const finished = uploadedCount(queueItems);

    return (
        <section aria-label={m.heading} className="flex flex-col gap-3">
            {/* The section name is an H3 in the `label` role, muted — the Details groups' heading (buildSpec §7.7). */}
            <h3 className="text-label text-ink-muted">{m.heading}</h3>

            {/* WCAG 4.1.3: BOTH regions are mounted before there is anything to say, because a live region speaks at a
                change of its text and a node that mounts with its text in it is not reliably spoken. The first carries
                its label as visible CONTENT (the contextual caption, `LoadingNotice` doctrine, specSharedSystem.md
                §18); the second is spoken only, once per finished file. A failure keeps its own assertive alert. */}
            <LiveRegion politeness="polite" className="text-body-sm text-ink-muted">
                {uploading === true ? m.uploadingLabel : ''}
            </LiveRegion>
            <LiveRegion politeness="polite" visuallyHidden occurrence={finished}>
                {finished > 0 && uploading !== true ? m.uploadedLabel : ''}
            </LiveRegion>
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
                                    offers cover selection. It sits at the foot-left, clear of the menu button. */}
                                    {onSetCover !== undefined && isCover ? (
                                        <span className="absolute bottom-2 left-2 rounded-full bg-action px-2 py-1 text-caption font-semibold text-on-action">
                                            {m.coverBadge}
                                        </span>
                                    ) : null}
                                    {/* Owner ruling 2026-10-17: ONE ⋯ menu button per tile (a 44 px disc) holds every
                                    action. The cover is stated by the button's NAME (SC 4.1.2), as the radio it replaces
                                    stated it by `checked`. A removal in flight makes the button unavailable: it stays
                                    focusable (SC 2.4.3) and opens nothing. */}
                                    <div className="absolute right-1 top-1">
                                        <ActionMenu
                                            appearance="disc"
                                            triggerLabel={fillTemplate(isCover ? m.menuTriggerCover : m.menuTrigger, {
                                                index: index + 1,
                                            })}
                                            title={fillTemplate(m.menuTitle, { index: index + 1 })}
                                            closeLabel={fillTemplate(m.menuClose, { index: index + 1 })}
                                            unavailable={removing}
                                            {...photoMenu({
                                                copy: m,
                                                photoId: photo.id,
                                                index,
                                                count: photos.length,
                                                reordering,
                                                onRemovePhoto,
                                                ...(onSetCover === undefined ? {} : { onSetCover }),
                                                ...(onMovePhoto === undefined ? {} : { onMovePhoto }),
                                                ...(onReplacePhoto === undefined ? {} : { onReplacePhoto }),
                                            })}
                                        />
                                    </div>
                                    {removing ? (
                                        <span
                                            role="status"
                                            className="absolute inset-x-0 bottom-2 mx-2 rounded-full bg-photo-chip px-2 py-1 text-center text-caption font-medium text-ink"
                                        >
                                            {m.removing}
                                        </span>
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
                                    the editor that could not be changed. Offered only when wired: a container
                                    withholds removal by not wiring it, and an unwired Remove would do nothing.
                                    Remove is the ⋯ menu's one item here (2026-10-17). */}
                                        {(item.status === 'failed' || item.status === 'queued') &&
                                        onRemoveQueueItem !== undefined ? (
                                            <div className="absolute right-1 top-1">
                                                <ActionMenu
                                                    appearance="disc"
                                                    triggerLabel={fillTemplate(m.queueMenuTrigger, {
                                                        fileName: item.fileName,
                                                    })}
                                                    title={item.fileName}
                                                    closeLabel={fillTemplate(m.queueMenuClose, {
                                                        fileName: item.fileName,
                                                    })}
                                                    items={[]}
                                                    destructiveItem={{
                                                        id: 'remove',
                                                        label: m.remove,
                                                        onSelect: () => onRemoveQueueItem(item.fileId),
                                                    }}
                                                />
                                            </div>
                                        ) : null}
                                        {/* Retry stays a VISIBLE button, not a menu item: it is the one recovery for the
                                    tile's headline state, so it is one tap at the design system's `Button` size.
                                    Offered ONLY where it can plausibly succeed: the queue re-validates on retry by
                                    design, so a client-rejected file (too large / wrong type) would re-fail
                                    identically — a dead affordance. `retryable` is the queue's own discriminator. */}
                                        {item.status === 'failed' && item.retryable ? (
                                            <div className="relative w-full px-2">
                                                <Button
                                                    variant="secondary"
                                                    size="md"
                                                    icon="refreshCw"
                                                    width="fill"
                                                    accessibilityLabel={fillTemplate(m.queueRetryLabel, {
                                                        fileName: item.fileName,
                                                    })}
                                                    onPress={() => onRetryQueueItem?.(item.fileId)}
                                                >
                                                    {m.queueRetry}
                                                </Button>
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
