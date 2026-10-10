/**
 * @module @commise/features-recipes — native recipe photo manager (T067 building block, wireframe step 4;
 * w3/e4 per-file queue grid).
 *
 * The React Native leaf of `RecipePhotoManager` — same contract, RN
 * primitives. Renders the confirmed photos MERGED with any in-flight queue items across a fixed 3-column
 * grid, each queue cell carrying its own status badge (Queued / Uploading… / Upload failed, via
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
 * renders as a second, distinct line naming WHY, whenever the caller supplies one.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { useTheme } from '@commise/ui/theme';
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
    const { colors } = useTheme();
    // Chrome on a photo is the `photoChip` disc under an `ink` label (`darkTheme.md` §1, §3.4); a control off the
    // photo's chrome is `paper` under `ink`, as on web.
    const chip = { backgroundColor: colors.photoChip };
    const ink = { color: colors.ink };
    const pendingItems = visibleQueueItems(queueItems ?? []);
    const atCap = isAtPhotoCap(photos.length + pendingItems.length);

    return (
        <View style={styles.container}>
            <Text accessibilityRole="header" style={[styles.heading, ink]}>
                {m.heading}
            </Text>

            {/* The upload-in-flight affordance carries its label as VISIBLE text, not only as
                `accessibilityLabel`: an empty progressbar is a nameless, contentless shape a sighted viewer
                cannot distinguish from "wedged" (the `components/LoadingState` doctrine). */}
            {uploading === true ? (
                <View accessible accessibilityRole="progressbar" accessibilityLabel={m.uploadingLabel}>
                    <Text style={[styles.muted, { color: colors.inkMuted }]}>{m.uploadingLabel}</Text>
                </View>
            ) : null}
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
                <Text style={[styles.muted, { color: colors.inkMuted }]}>{m.emptyBody}</Text>
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
                                    <Text
                                        style={[
                                            styles.coverBadge,
                                            { backgroundColor: colors.action, color: colors.onAction },
                                        ]}
                                    >
                                        {m.coverBadge}
                                    </Text>
                                ) : null}
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={fillTemplate(m.removeLabel, { index: index + 1 })}
                                    // The `disabled` half already reaches the DOM (react-native-web derives
                                    // `aria-disabled` from the `disabled` PROP below); `busy` did not, because
                                    // RNW projects `accessibilityState` for nothing (#123). The "Removing…"
                                    // swap is sighted-only — the explicit `accessibilityLabel` above overrides
                                    // this control's text content for assistive tech — so `aria-busy` is the
                                    // ONLY channel distinguishing "working" from "unavailable". It is RN's own
                                    // first-class ALIAS for `accessibilityState.busy`, so it is device-correct
                                    // too; omitted when idle, since ARIA already defaults it to false.
                                    accessibilityState={{ busy: removing, disabled: removing }}
                                    aria-busy={removing || undefined}
                                    disabled={removing}
                                    onPress={() => onRemovePhoto(photo.id)}
                                    style={[styles.removeButton, chip, removing && styles.removeButtonBusy]}
                                >
                                    <Text style={[styles.removeLabel, ink]}>{removing ? m.removing : m.remove}</Text>
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
                                                style={[styles.coverControl, chip]}
                                            >
                                                <View
                                                    style={[
                                                        styles.radioDot,
                                                        { borderColor: colors.ink },
                                                        isCover && { backgroundColor: colors.selectedEdge },
                                                    ]}
                                                />
                                            </Pressable>
                                        ) : null}
                                        {onReplacePhoto !== undefined ? (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel={fillTemplate(m.replaceLabel, { index: index + 1 })}
                                                onPress={() => onReplacePhoto(photo.id)}
                                                style={[styles.replaceButton, { backgroundColor: colors.paper }]}
                                            >
                                                <Text style={[styles.replaceLabel, ink]}>{m.replace}</Text>
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
                                {item.status === 'failed' && item.errorMessage !== undefined ? (
                                    <Text style={[styles.itemError, { color: colors.dangerText }]}>
                                        {item.errorMessage}
                                    </Text>
                                ) : null}
                                {/* ⛔ `queued` is offered a Remove too — see the web leaf's note. On the CREATE
                                    path every draft pick sits `queued` until the recipe exists, so without
                                    this the photo chosen before the first save was the ONE field of the
                                    editor a cook could not change their mind about. */}
                                {item.status === 'failed' || item.status === 'queued' ? (
                                    <View style={styles.queueControls}>
                                        {/* Retry only where it can plausibly succeed — the queue
                                            re-validates on retry, so a client-rejected file (too large /
                                            wrong type) would re-fail identically. See `retryable`. */}
                                        {item.status === 'failed' && item.retryable ? (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel={fillTemplate(m.queueRetryLabel, {
                                                    fileName: item.fileName,
                                                })}
                                                onPress={() => onRetryQueueItem?.(item.fileId)}
                                                style={[styles.queueControlButton, { backgroundColor: colors.paper }]}
                                            >
                                                <Text style={[styles.queueControlLabel, ink]}>{m.queueRetry}</Text>
                                            </Pressable>
                                        ) : null}
                                        {/* Offered only when wired: a container withholds removal by not
                                            wiring it, and an unwired Remove would do nothing. */}
                                        {onRemoveQueueItem === undefined ? null : (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel={fillTemplate(m.queueRemoveLabel, {
                                                    fileName: item.fileName,
                                                })}
                                                onPress={() => onRemoveQueueItem(item.fileId)}
                                                style={[styles.queueControlButton, { backgroundColor: colors.paper }]}
                                            >
                                                <Text style={[styles.queueControlLabel, ink]}>{m.remove}</Text>
                                            </Pressable>
                                        )}
                                    </View>
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

const styles = StyleSheet.create({
    container: { gap: 12 },
    heading: { fontSize: 18, fontWeight: '600' },
    muted: { fontSize: 13 },
    formatHint: { fontSize: 11 },
    error: { fontSize: 13 },
    // Fixed 3-column grid (wireframe): each cell claims a third of the row, minus the inter-cell gap.
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    cell: { position: 'relative', width: '31%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
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
    itemError: {
        position: 'absolute',
        top: 30,
        left: 6,
        right: 6,
        fontSize: 10,
        textAlign: 'center',
    },
    queueControls: { position: 'absolute', bottom: 6, left: 6, right: 6, flexDirection: 'row', gap: 6 },
    queueControlButton: {
        flex: 1,
        alignItems: 'center',
        borderRadius: 999,
        paddingVertical: 4,
    },
    queueControlLabel: { fontSize: 11, fontWeight: '500' },
    removeButton: {
        position: 'absolute',
        top: 6,
        right: 6,
        borderRadius: 999,
        paddingVertical: 4,
        paddingHorizontal: 10,
    },
    removeButtonBusy: { opacity: 0.6 },
    removeLabel: { fontSize: 11, fontWeight: '500' },
    // U6 cover badge (top-left) — text on the solid `action` pill; distinct from the top-right remove button.
    coverBadge: {
        position: 'absolute',
        top: 6,
        left: 6,
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
        borderRadius: 999,
        padding: 6,
    },
    radioDot: {
        width: 12,
        height: 12,
        borderRadius: 999,
        borderWidth: 2,
    },
    replaceButton: {
        flex: 1,
        alignItems: 'center',
        borderRadius: 999,
        paddingVertical: 4,
    },
    replaceLabel: { fontSize: 11, fontWeight: '500' },
});
