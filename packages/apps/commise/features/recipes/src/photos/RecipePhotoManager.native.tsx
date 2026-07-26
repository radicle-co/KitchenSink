/**
 * @module @commise/features-recipes — native recipe photo manager (T067 building block, wireframe step 4;
 * w3/e4 per-file queue grid).
 *
 * The React Native leaf of {@link import('./RecipePhotoManager.js').RecipePhotoManager} — same contract, RN
 * primitives. Renders the confirmed photos MERGED with any in-flight queue items across a fixed 3-column
 * grid, each queue cell carrying its own status badge (Queued / Uploading… / Upload failed, via
 * `accessibilityRole` + visible text — never colour alone) plus Retry (failed only) and Remove, and the
 * caller-supplied `addControl` (the native picker button), hidden at the photo cap. Presentational only.
 *
 * REQ-014 (per-file "which photo failed and why"): the generic status badge already names WHICH photo
 * (its cell, its `fileName`-scoped Retry/Remove labels); a failed item's own `errorMessage` (client
 * validation — REQ-011/REQ-012 — or an upload failure, both surfaced by the caller through the same field)
 * renders as a second, distinct line naming WHY, whenever the caller supplies one.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { palette } from '@commise/ui';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
        <View accessibilityLabel={m.heading} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {m.heading}
            </Text>

            {uploading === true ? <View accessibilityRole="progressbar" accessibilityLabel={m.uploadingLabel} /> : null}
            {errorMessage !== undefined ? (
                <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>
                    {errorMessage}
                </Text>
            ) : null}

            {photos.length === 0 && pendingItems.length === 0 ? (
                <Text style={styles.muted}>{m.emptyBody}</Text>
            ) : (
                <View style={styles.grid}>
                    {photos.map((photo, index) => {
                        const removing = removingPhotoId === photo.id;
                        const isCover = isCoverPhoto(photos, photo.id);

                        return (
                            <View key={photo.id} style={styles.cell}>
                                <Image
                                    source={{ uri: photo.url }}
                                    accessibilityLabel={fillTemplate(m.photoAlt, { index: index + 1 })}
                                    cachePolicy="memory-disk"
                                    style={styles.photo}
                                />
                                {/* U6: cover status carried as TEXT (never colour alone); shown on the index-0 photo
                                    only, and only where the surface offers cover selection. */}
                                {onSetCover !== undefined && isCover ? (
                                    <Text style={styles.coverBadge}>{m.coverBadge}</Text>
                                ) : null}
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={fillTemplate(m.removeLabel, { index: index + 1 })}
                                    accessibilityState={{ busy: removing, disabled: removing }}
                                    disabled={removing}
                                    onPress={() => onRemovePhoto(photo.id)}
                                    style={[styles.removeButton, removing && styles.removeButtonBusy]}
                                >
                                    <Text style={styles.removeLabel}>{removing ? m.removing : m.remove}</Text>
                                </Pressable>
                                {onSetCover !== undefined || onReplacePhoto !== undefined ? (
                                    <View style={styles.photoControls}>
                                        {/* U6: single-select cover with RADIO semantics — `accessibilityRole="radio"`
                                            + `checked` state; exactly one is checked (the current cover). Named by its
                                            1-based index so every control is uniquely addressable. Fully controlled by
                                            `isCoverPhoto`, so the check follows the reprojected `photos[0]` after the
                                            container's reorder. */}
                                        {onSetCover !== undefined ? (
                                            <Pressable
                                                accessibilityRole="radio"
                                                accessibilityLabel={fillTemplate(m.setCoverLabel, { index: index + 1 })}
                                                // `accessibilityState` drives iOS VoiceOver / Android TalkBack;
                                                // `aria-checked` is what react-native-web emits to the DOM (RNW does
                                                // not forward `accessibilityState.checked`). Both name the SAME state.
                                                accessibilityState={{ checked: isCover }}
                                                aria-checked={isCover}
                                                onPress={() => onSetCover(photo.id)}
                                                style={styles.coverControl}
                                            >
                                                <View style={[styles.radioDot, isCover && styles.radioDotChecked]} />
                                            </Pressable>
                                        ) : null}
                                        {onReplacePhoto !== undefined ? (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel={fillTemplate(m.replaceLabel, { index: index + 1 })}
                                                onPress={() => onReplacePhoto(photo.id)}
                                                style={styles.replaceButton}
                                            >
                                                <Text style={styles.replaceLabel}>{m.replace}</Text>
                                            </Pressable>
                                        ) : null}
                                    </View>
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
                            <View key={item.fileId} style={styles.cell}>
                                {item.previewUri !== undefined ? (
                                    <Image
                                        source={{ uri: item.previewUri }}
                                        accessibilityLabel={fillTemplate(m.queuePhotoAlt, { fileName: item.fileName })}
                                        cachePolicy="memory-disk"
                                        style={styles.photo}
                                    />
                                ) : (
                                    <View style={[styles.photo, styles.placeholder]} />
                                )}
                                <Text
                                    accessibilityRole={item.status === 'failed' ? 'alert' : 'text'}
                                    accessibilityLabel={statusWord}
                                    style={[styles.statusBadge, item.status === 'failed' && styles.statusBadgeFailed]}
                                >
                                    {statusWord}
                                </Text>
                                {item.status === 'failed' && item.errorMessage !== undefined ? (
                                    <Text style={styles.itemError}>{item.errorMessage}</Text>
                                ) : null}
                                {item.status === 'failed' ? (
                                    <View style={styles.queueControls}>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={fillTemplate(m.queueRetryLabel, {
                                                fileName: item.fileName,
                                            })}
                                            onPress={() => onRetryQueueItem?.(item.fileId)}
                                            style={styles.queueControlButton}
                                        >
                                            <Text style={styles.queueControlLabel}>{m.queueRetry}</Text>
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={fillTemplate(m.queueRemoveLabel, {
                                                fileName: item.fileName,
                                            })}
                                            onPress={() => onRemoveQueueItem?.(item.fileId)}
                                            style={styles.queueControlButton}
                                        >
                                            <Text style={styles.queueControlLabel}>{m.remove}</Text>
                                        </Pressable>
                                    </View>
                                ) : null}
                            </View>
                        );
                    })}
                </View>
            )}

            {atCap ? (
                <Text style={styles.muted}>{fillTemplate(m.maxReached, { max: MAX_RECIPE_PHOTOS })}</Text>
            ) : (
                <>
                    <Text style={styles.formatHint}>
                        {fillTemplate(m.formatHint, { maxMb: MAX_RECIPE_PHOTO_UPLOAD_MB })}
                    </Text>
                    {addControl}
                </>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 12 },
    heading: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    muted: { fontSize: 13, color: palette.slate },
    formatHint: { fontSize: 11, color: palette.slate },
    error: { fontSize: 13, color: palette.error },
    // Fixed 3-column grid (wireframe): each cell claims a third of the row, minus the inter-cell gap.
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    cell: { position: 'relative', width: '31%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
    photo: { width: '100%', height: '100%' },
    placeholder: { backgroundColor: palette.pearl },
    statusBadge: {
        position: 'absolute',
        top: 6,
        left: 6,
        backgroundColor: 'rgba(45, 52, 54, 0.7)',
        color: palette.white,
        fontSize: 11,
        fontWeight: '500',
        borderRadius: 999,
        paddingVertical: 2,
        paddingHorizontal: 8,
    },
    statusBadgeFailed: { backgroundColor: palette.error },
    itemError: {
        position: 'absolute',
        top: 30,
        left: 6,
        right: 6,
        color: palette.white,
        fontSize: 10,
        textAlign: 'center',
    },
    queueControls: { position: 'absolute', bottom: 6, left: 6, right: 6, flexDirection: 'row', gap: 6 },
    queueControlButton: {
        flex: 1,
        alignItems: 'center',
        backgroundColor: palette.white,
        borderRadius: 999,
        paddingVertical: 4,
    },
    queueControlLabel: { color: palette.charcoal, fontSize: 11, fontWeight: '500' },
    removeButton: {
        position: 'absolute',
        top: 6,
        right: 6,
        backgroundColor: 'rgba(45, 52, 54, 0.7)',
        borderRadius: 999,
        paddingVertical: 4,
        paddingHorizontal: 10,
    },
    removeButtonBusy: { opacity: 0.6 },
    removeLabel: { color: palette.white, fontSize: 11, fontWeight: '500' },
    // U6 cover badge (top-left) — text on a solid seafoam pill; distinct from the top-right remove button.
    coverBadge: {
        position: 'absolute',
        top: 6,
        left: 6,
        backgroundColor: palette.seafoam,
        color: palette.white,
        fontSize: 11,
        fontWeight: '600',
        borderRadius: 999,
        paddingVertical: 2,
        paddingHorizontal: 8,
        overflow: 'hidden',
    },
    // U6 per-photo control bar (bottom): the cover radio (left) + the Replace button (right).
    photoControls: { position: 'absolute', bottom: 6, left: 6, right: 6, flexDirection: 'row', gap: 6 },
    coverControl: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(45, 52, 54, 0.7)',
        borderRadius: 999,
        padding: 6,
    },
    radioDot: {
        width: 12,
        height: 12,
        borderRadius: 999,
        borderWidth: 2,
        borderColor: palette.white,
    },
    radioDotChecked: { backgroundColor: palette.seafoam },
    replaceButton: {
        flex: 1,
        alignItems: 'center',
        backgroundColor: palette.white,
        borderRadius: 999,
        paddingVertical: 4,
    },
    replaceLabel: { color: palette.charcoal, fontSize: 11, fontWeight: '500' },
});
