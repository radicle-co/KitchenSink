/**
 * @module @commise/features-recipes — native recipe photo manager (T067 building block, wireframe step 4;
 * w3/e4 per-file queue grid).
 *
 * The React Native leaf of `RecipePhotoManager` — same contract, RN
 * primitives. Owner ruling 2026-10-17: every photo tile carries ONE ⋯ menu button (44 pt, 48 dp on Android; a sheet of
 * `menuitem` rows, `photoMenu.ts`); a queue tile holds Remove in the same menu, and a failed, retryable one keeps a
 * visible Retry `Button`. Renders the confirmed photos MERGED with any in-flight queue items across a grid of 3 columns (4 from
 * 600 of the grid's own measured width, buildSpec §7.7), each queue cell carrying its own status badge (Queued / Uploading… / Upload failed, via
 * `accessibilityRole` + visible text — never colour alone) plus Retry (only where the queue reports the
 * failure as `retryable`) and Remove, and the caller-supplied `addControl` (the native picker button), hidden
 * at the photo cap. Presentational only.
 *
 * A failed cell's ACTIONS follow the queue's `retryable` discriminator, never `status === 'failed'`: retry
 * re-validates by design, so a client-rejected file (too large / wrong type) can never succeed on a
 * re-attempt — that cell offers Remove only, while a transport/server failure keeps both.
 *
 * REQ-014 (per-file "which photo failed and why"): the generic status badge already names WHICH photo
 * (its cell, its `fileName`-scoped Retry/Remove labels); a failed item's own `errorMessage` (client
 * validation — REQ-011/REQ-012 — or an upload failure, both surfaced by the caller through the same field)
 * renders as a second, distinct line naming WHY, whenever the caller supplies one — BELOW the tile, in flow (E6), never
 * over the image. With no photo and no queued file it shows the recipe's generated cover and says it stands in (A-010).
 */
import { useMessages } from '@commise/i18n/react';
import { ActionMenu } from '@commise/ui/action-menu';
import { Button } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { RecipeCover } from '@commise/ui/recipe-cover';
import { useTheme } from '@commise/ui/theme';
import { Image } from 'expo-image';
import { useState, type FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { photoMessages } from './messages.js';
import { photoMenu } from './photoMenu.js';
import {
    isAtPhotoCap,
    isCoverPhoto,
    MAX_RECIPE_PHOTO_UPLOAD_MB,
    MAX_RECIPE_PHOTOS,
    photoGridColumns,
    uploadedCount,
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
    onMovePhoto,
    onReplacePhoto,
    reordering = false,
    addControl,
    coverPreview,
}) => {
    const m = useMessages(photoMessages);
    const { colors } = useTheme();
    // Chrome on a photo is the `photoChip` disc under an `ink` label (`darkTheme.md` §1, §3.4).
    const chip = { backgroundColor: colors.photoChip };
    const ink = { color: colors.ink };
    const pendingItems = visibleQueueItems(queueItems ?? []);
    const atCap = isAtPhotoCap(photos.length + pendingItems.length);
    const finished = uploadedCount(queueItems);
    // The grid's own width, once laid out (buildSpec §7.7: 3 columns below 600, 4 from 600). Not the window's: the
    // window is not the container, and until the first measure the grid holds the narrow reading.
    const [gridWidth, setGridWidth] = useState<number | undefined>(undefined);
    const cellWidth = CELL_WIDTH[photoGridColumns(gridWidth)];

    return (
        <View style={styles.container}>
            {/* The section name: an H3 in the `label` role, muted — the Details groups' heading (buildSpec §7.7). */}
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.inkMuted }]}>
                {m.heading}
            </Text>

            {/* WCAG 4.1.3, the web leaf's pair: both regions mounted EMPTY before anything uploads (Android speaks a
                CHANGE to a live region it already holds; iOS is handed an announcement by `LiveRegion`). The first
                carries its label as visible text (`LoadingNotice` doctrine, specSharedSystem.md §18); the second is
                spoken only, once per finished file. A failure keeps its own assertive alert. */}
            <LiveRegion politeness="polite" style={[styles.muted, { color: colors.inkMuted }]}>
                {uploading === true ? m.uploadingLabel : ''}
            </LiveRegion>
            <LiveRegion politeness="polite" visuallyHidden occurrence={finished}>
                {finished > 0 && uploading !== true ? m.uploadedLabel : ''}
            </LiveRegion>
            {errorMessage !== undefined ? (
                <Text
                    accessibilityRole="alert"
                    accessibilityLiveRegion="assertive"
                    style={[styles.error, { color: colors.dangerText }]}
                >
                    {errorMessage}
                </Text>
            ) : null}

            {photos.length === 0 && pendingItems.length === 0 ? (
                <View style={styles.empty}>
                    {/* The cover this recipe shows without a photo (buildSpec §7.7). */}
                    {coverPreview === undefined ? null : (
                        <View style={styles.coverPreview}>
                            <RecipeCover
                                recipeId={coverPreview.recipeId}
                                title={coverPreview.title}
                                {...(coverPreview.cuisine === undefined ? {} : { cuisine: coverPreview.cuisine })}
                                aspect="4:3"
                            />
                        </View>
                    )}
                    <Text style={[styles.muted, { color: colors.inkMuted }]}>{m.emptyBody}</Text>
                </View>
            ) : (
                <View style={styles.grid} onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}>
                    {photos.map((photo, index) => {
                        const removing = removingPhotoId === photo.id;
                        const isCover = isCoverPhoto(photos, photo.id);

                        return (
                            <View key={photo.id} style={[styles.cell, { width: cellWidth }]}>
                                <Image
                                    source={{ uri: photo.url }}
                                    accessibilityLabel={fillTemplate(m.photoAlt, { index: index + 1 })}
                                    cachePolicy="memory-disk"
                                    style={styles.photo}
                                />
                                {/* U6: cover status carried as TEXT (never colour alone); shown on the index-0 photo
                                    only, and only where the surface offers cover selection. It sits at the foot-left,
                                    clear of the menu button. */}
                                {onSetCover !== undefined && isCover ? (
                                    <Text
                                        style={[
                                            styles.coverBadge,
                                            { backgroundColor: colors.action, color: colors.onAction },
                                        ]}
                                    >
                                        {m.coverBadge}
                                    </Text>
                                ) : null}
                                {/* Owner ruling 2026-10-17: ONE ⋯ menu button per tile (44 pt, 48 dp on Android) holds
                                    every action, in a sheet. The cover is stated by the button's NAME (SC 4.1.2), as the
                                    radio it replaces stated it by `checked`. A removal in flight makes the button
                                    unavailable: it keeps the screen-reader cursor and opens nothing. */}
                                <View style={styles.menuButton}>
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
                                </View>
                                {removing ? (
                                    <Text accessibilityRole="text" style={[styles.removingBadge, chip, ink]}>
                                        {m.removing}
                                    </Text>
                                ) : null}
                            </View>
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
                            <View key={item.fileId} style={{ width: cellWidth }}>
                                {/* The FRAME holds the image and what is drawn on it. A failure's prose sits BELOW it
                                    (E6), in flow on the page background, so its contrast never depends on the photo. */}
                                <View style={styles.frame}>
                                    {item.previewUri !== undefined ? (
                                        <Image
                                            source={{ uri: item.previewUri }}
                                            accessibilityLabel={fillTemplate(m.queuePhotoAlt, {
                                                fileName: item.fileName,
                                            })}
                                            cachePolicy="memory-disk"
                                            style={styles.photo}
                                        />
                                    ) : (
                                        <View style={[styles.photo, { backgroundColor: colors.surfaceMuted }]} />
                                    )}
                                    <Text
                                        accessibilityRole={item.status === 'failed' ? 'alert' : 'text'}
                                        accessibilityLabel={statusWord}
                                        style={[
                                            styles.statusBadge,
                                            item.status === 'failed'
                                                ? { backgroundColor: colors.danger, color: colors.onAction }
                                                : [chip, ink],
                                        ]}
                                    >
                                        {statusWord}
                                    </Text>
                                    {/* ⛔ `queued` is offered a Remove too — see the web leaf's note. On the CREATE
                                    path every draft pick sits `queued` until the recipe exists, so without
                                    this the photo chosen before the first save was the ONE field of the
                                    editor a cook could not change their mind about. Offered only when wired: a
                                    container withholds removal by not wiring it. Remove is the ⋯ menu's one item
                                    here (2026-10-17). */}
                                    {(item.status === 'failed' || item.status === 'queued') &&
                                    onRemoveQueueItem !== undefined ? (
                                        <View style={styles.menuButton}>
                                            <ActionMenu
                                                appearance="disc"
                                                triggerLabel={fillTemplate(m.queueMenuTrigger, {
                                                    fileName: item.fileName,
                                                })}
                                                title={item.fileName}
                                                closeLabel={fillTemplate(m.queueMenuClose, { fileName: item.fileName })}
                                                items={[]}
                                                destructiveItem={{
                                                    id: 'remove',
                                                    label: m.remove,
                                                    onSelect: () => onRemoveQueueItem(item.fileId),
                                                }}
                                            />
                                        </View>
                                    ) : null}
                                    {/* Retry stays a VISIBLE button, not a menu item: it is the one recovery for the
                                    tile's headline state, so it is one tap at the design system's `Button` size
                                    (48 dp on Android). Only where it can plausibly succeed: the queue re-validates on
                                    retry, so a client-rejected file (too large / wrong type) would re-fail
                                    identically. See `retryable`. */}
                                    {item.status === 'failed' && item.retryable ? (
                                        <View style={styles.queueControls}>
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
                                        </View>
                                    ) : null}
                                </View>
                                {item.status === 'failed' && item.errorMessage !== undefined ? (
                                    <Text style={[styles.itemError, { color: colors.dangerText }]}>
                                        {item.errorMessage}
                                    </Text>
                                ) : null}
                            </View>
                        );
                    })}
                </View>
            )}

            {atCap ? (
                <Text style={[styles.muted, { color: colors.inkMuted }]}>
                    {fillTemplate(m.maxReached, { max: MAX_RECIPE_PHOTOS })}
                </Text>
            ) : (
                <>
                    <Text style={[styles.formatHint, { color: colors.inkMuted }]}>
                        {fillTemplate(m.formatHint, { maxMb: MAX_RECIPE_PHOTO_UPLOAD_MB })}
                    </Text>
                    {addControl}
                </>
            )}
        </View>
    );
};

/** A cell's share of the row at each column count: the gap between cells takes the rest. */
const CELL_WIDTH = { 3: '31%', 4: '23%' } as const;

const styles = StyleSheet.create({
    container: { gap: 12 },
    heading: nativeTokens.type.label,
    empty: { gap: 12 },
    coverPreview: { width: '100%', maxWidth: 320, borderRadius: 12, overflow: 'hidden' },
    muted: { fontSize: 13 },
    formatHint: { fontSize: 11 },
    error: { fontSize: 13 },
    // Each cell claims its share of the row (`CELL_WIDTH`), minus the inter-cell gap.
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    cell: { position: 'relative', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
    // A queue cell's image box: square like a photo cell, but it does not hold the failure's message.
    frame: { position: 'relative', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
    photo: { width: '100%', height: '100%' },
    statusBadge: {
        position: 'absolute',
        top: 6,
        left: 6,
        fontSize: 11,
        fontWeight: '500',
        borderRadius: 999,
        paddingVertical: 2,
        paddingHorizontal: 8,
    },
    itemError: { marginTop: 4, paddingHorizontal: 2, fontSize: 11 },
    queueControls: { position: 'absolute', bottom: 6, left: 6, right: 6 },
    // The tile's ⋯ menu button, top-right (`appearance="disc"`: 44 pt, 48 dp hit frame on Android).
    menuButton: { position: 'absolute', top: 2, right: 2 },
    removingBadge: {
        position: 'absolute',
        bottom: 6,
        left: 6,
        right: 6,
        textAlign: 'center',
        fontSize: 11,
        fontWeight: '500',
        borderRadius: 999,
        paddingVertical: 2,
        overflow: 'hidden',
    },
    // U6 cover badge (foot-left) — text on the solid `action` pill; clear of the top-right menu button.
    coverBadge: {
        position: 'absolute',
        bottom: 6,
        left: 6,
        fontSize: 11,
        fontWeight: '600',
        borderRadius: 999,
        paddingVertical: 2,
        paddingHorizontal: 8,
        overflow: 'hidden',
    },
});
