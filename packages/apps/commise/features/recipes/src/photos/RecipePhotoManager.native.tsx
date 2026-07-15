/**
 * @module @commise/features-recipes — native recipe photo manager (T067 building block, wireframe step 4).
 *
 * The React Native leaf of {@link import('./RecipePhotoManager.js').RecipePhotoManager} — same contract, RN
 * primitives. Renders the photos with per-photo remove controls + busy/error affordances and the
 * caller-supplied `addControl` (the native picker button), hidden at the photo cap. Presentational only.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { palette } from '@commise/ui';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { photoMessages } from './messages.js';
import { isAtPhotoCap, MAX_RECIPE_PHOTOS, type RecipePhotoManagerProps } from './model.js';

export const RecipePhotoManager: FC<RecipePhotoManagerProps> = ({
    photos,
    onRemovePhoto,
    removingPhotoId,
    uploading,
    errorMessage,
    addControl,
}) => {
    const m = useMessages(photoMessages);
    const atCap = isAtPhotoCap(photos.length);

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

            {photos.length === 0 ? (
                <Text style={styles.muted}>{m.emptyBody}</Text>
            ) : (
                <View style={styles.grid}>
                    {photos.map((photo, index) => {
                        const removing = removingPhotoId === photo.id;

                        return (
                            <View key={photo.id} style={styles.photoWrap}>
                                <Image
                                    source={{ uri: photo.url }}
                                    accessibilityLabel={fillTemplate(m.photoAlt, { index: index + 1 })}
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
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    photoWrap: { position: 'relative', borderRadius: 12, overflow: 'hidden' },
    photo: { width: 104, height: 104 },
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
