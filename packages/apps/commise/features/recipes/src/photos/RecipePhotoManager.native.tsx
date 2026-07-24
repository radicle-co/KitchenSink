/**
 * @module @commise/features-recipes — native recipe photo manager (T067 building block, wireframe step 4;
 * w3/e4 per-file queue grid).
 *
 * The React Native leaf of {@link import('./RecipePhotoManager.js').RecipePhotoManager} — same contract, RN
 * primitives. Renders the confirmed photos MERGED with any in-flight queue items across a fixed 3-column
 * grid, each queue cell carrying its own status badge (Queued / Uploading… / Upload failed, via
 * `accessibilityRole` + visible text — never colour alone) plus Retry (failed only) and Remove, and the
 * caller-supplied `addControl` (the native picker button), hidden at the photo cap. Presentational only.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { palette } from '@commise/ui';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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

                        return (
                            <View key={photo.id} style={styles.cell}>
                                <Image
                                    source={{ uri: photo.url }}
                                    accessibilityLabel={fillTemplate(m.photoAlt, { index: index + 1 })}
                                    cachePolicy="memory-disk"
                                    style={styles.photo}
                                />
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
                addControl
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 12 },
    heading: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    muted: { fontSize: 13, color: palette.slate },
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
});
