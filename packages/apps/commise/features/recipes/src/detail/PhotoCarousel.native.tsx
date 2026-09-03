/**
 * @module @commise/features-recipes — native recipe-photo carousel + lightbox (W2 Task 2.2, D2).
 *
 * The React Native leaf of `PhotoCarousel`: a horizontal, paging
 * `ScrollView` of photo slides, a dot-indicator row (only when there is more than one photo), and a
 * full-screen `Modal` lightbox opened by tapping a slide. Same read model, same accessible names, and the
 * same branch behaviour as the web leaf so the two platforms can't drift.
 *
 * A `ScrollView` (not a `FlatList`) backs the strip: a recipe has at most `MAX_PHOTOS_PER_RECIPE` (≤10)
 * photos, so `FlatList` virtualization buys nothing here while complicating layout/testing — the simplest
 * correct paging container wins (KISS/YAGNI). The open slide is ephemeral local view state, not data.
 *
 * @pattern Adapter over React Native's paging `ScrollView` and `Modal` — the same read model and branch behaviour as
 *     the web leaf, expressed with platform primitives; the open slide is local view state.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import { Image } from 'expo-image';
import { useState, type FC } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';

/** Props for {@link PhotoCarousel} — the recipe's photos (display order) and the recipe title for alt text. */
export interface PhotoCarouselProps {
    readonly photos: readonly RecipePhoto[];
    readonly title: string;
}

export const PhotoCarousel: FC<PhotoCarouselProps> = ({ photos, title }) => {
    const { detail } = useMessages(recipeMessages);
    const { width } = useWindowDimensions();
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    if (photos.length === 0) {
        return null;
    }

    const altFor = (index: number): string => fillTemplate(detail.photoAlt, { title, index: index + 1 });
    const activePhoto = activeIndex !== null ? photos[activeIndex] : undefined;

    return (
        <View accessibilityLabel={detail.photosLabel} style={styles.container}>
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                {photos.map((photo, index) => (
                    <Pressable
                        key={photo.id}
                        accessibilityRole="button"
                        accessibilityLabel={fillTemplate(detail.photoOpen, { title, index: index + 1 })}
                        onPress={() => setActiveIndex(index)}
                        style={[styles.slide, { width }]}
                    >
                        <Image
                            source={{ uri: photo.url }}
                            accessibilityLabel={altFor(index)}
                            cachePolicy="memory-disk"
                            style={styles.image}
                        />
                    </Pressable>
                ))}
            </ScrollView>

            {photos.length > 1 && (
                <View accessibilityLabel={detail.photoDotsLabel} style={styles.dots}>
                    {photos.map((photo, index) => (
                        <View
                            key={photo.id}
                            accessibilityLabel={fillTemplate(detail.photoDot, { title, index: index + 1 })}
                            style={styles.dot}
                        />
                    ))}
                </View>
            )}

            {activePhoto !== undefined && activeIndex !== null && (
                <Modal visible transparent animationType="fade" onRequestClose={() => setActiveIndex(null)}>
                    <View style={styles.lightbox}>
                        <Image
                            source={{ uri: activePhoto.url }}
                            accessibilityLabel={altFor(activeIndex)}
                            contentFit="contain"
                            cachePolicy="memory-disk"
                            style={styles.lightboxImage}
                        />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={detail.lightboxClose}
                            onPress={() => setActiveIndex(null)}
                            style={styles.close}
                        >
                            <Text style={styles.closeLabel}>×</Text>
                        </Pressable>
                    </View>
                </Modal>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 8 },
    slide: { aspectRatio: 4 / 3, borderRadius: 16, overflow: 'hidden' },
    image: { width: '100%', height: '100%' },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.mist },
    lightbox: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' },
    lightboxImage: { width: '100%', height: '100%' },
    close: {
        position: 'absolute',
        top: 44,
        right: 16,
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.white,
    },
    closeLabel: { fontSize: 22, color: palette.charcoal },
});
