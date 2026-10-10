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
 * ⛔ A SLIDE IS THE STRIP'S WIDTH, FROM THE STRIP'S OWN LAYOUT (`docs/design/compactHeightLayout.md` §8). It used to be
 * the window's width inside a strip 32 dp and the side insets narrower, so `pagingEnabled` (which pages by the strip's
 * width) drifted by that much per slide, upright as well as sideways. The slides render once the container reports its
 * width; the strip sits below the fold, so the one-frame wait does not show. The box is `carouselBox`: 4:3 at that
 * width, capped at 40% of the window's height, and narrowed to keep 4:3, so a sideways phone shows a photo rather than
 * a slide taller than the screen. The strip is exactly one slide wide and centred.
 *
 * The lightbox is drawn edge to edge, and its photo and its 48 dp Close sit inside the safe area, so a side navigation
 * bar or a cutout never covers either.
 *
 * @pattern Adapter over React Native's paging `ScrollView` and `Modal` — the same read model and branch behaviour as
 *     the web leaf, expressed with platform primitives; the open slide is local view state.
 */
import { useMessages } from '@commise/i18n/react';
import { carouselBox } from '@commise/ui/layout';
import { Modal } from '@commise/ui/modal';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import { Image } from 'expo-image';
import { useState, type FC } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';

/** Props for {@link PhotoCarousel} — the recipe's photos (display order) and the recipe title for alt text. */
export interface PhotoCarouselProps {
    readonly photos: readonly RecipePhoto[];
    readonly title: string;
}

export const PhotoCarousel: FC<PhotoCarouselProps> = ({ photos, title }) => {
    const { detail } = useMessages(recipeMessages);
    const { height: windowHeight } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const [stripWidth, setStripWidth] = useState<number | null>(null);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    if (photos.length === 0) {
        return null;
    }

    const altFor = (index: number): string => fillTemplate(detail.photoAlt, { title, index: index + 1 });
    const activePhoto = activeIndex !== null ? photos[activeIndex] : undefined;
    const box = stripWidth === null ? null : carouselBox(stripWidth, windowHeight);

    return (
        <View
            collapsable={false}
            accessibilityLabel={detail.photosLabel}
            style={styles.container}
            onLayout={(event) => setStripWidth(event.nativeEvent.layout.width)}
        >
            {box !== null && (
                <ScrollView
                    horizontal
                    // One `scrollsToTop` per screen: the detail's own scroller keeps the iOS status-bar tap.
                    scrollsToTop={false}
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    style={[styles.strip, { width: box.width }]}
                >
                    {photos.map((photo, index) => (
                        <Pressable
                            key={photo.id}
                            accessibilityRole="button"
                            accessibilityLabel={fillTemplate(detail.photoOpen, { title, index: index + 1 })}
                            onPress={() => setActiveIndex(index)}
                            style={[styles.slide, { width: box.width, height: box.height }]}
                        >
                            <Image
                                source={{ uri: photo.url }}
                                accessibilityLabel={altFor(index)}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                style={styles.image}
                            />
                        </Pressable>
                    ))}
                </ScrollView>
            )}

            {photos.length > 1 && (
                <View collapsable={false} accessibilityLabel={detail.photoDotsLabel} style={styles.dots}>
                    {photos.map((photo, index) => (
                        <View
                            accessible
                            key={photo.id}
                            accessibilityLabel={fillTemplate(detail.photoDot, { title, index: index + 1 })}
                            style={[styles.dot, { backgroundColor: colors.lineDivider }]}
                        />
                    ))}
                </View>
            )}

            {activePhoto !== undefined && activeIndex !== null && (
                <Modal
                    visible
                    transparent
                    animationType="fade"
                    statusBarTranslucent
                    navigationBarTranslucent
                    onRequestClose={() => setActiveIndex(null)}
                >
                    <View style={[styles.lightbox, { backgroundColor: colors.scrim }]}>
                        {/* The photo inside the safe area: a side navigation bar or a cutout never covers it. */}
                        <View
                            style={[
                                styles.lightboxPhotoBox,
                                {
                                    paddingTop: insets.top,
                                    paddingRight: insets.right,
                                    paddingBottom: insets.bottom,
                                    paddingLeft: insets.left,
                                },
                            ]}
                        >
                            <Image
                                source={{ uri: activePhoto.url }}
                                accessibilityLabel={altFor(activeIndex)}
                                contentFit="contain"
                                cachePolicy="memory-disk"
                                style={styles.lightboxImage}
                            />
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={detail.lightboxClose}
                            onPress={() => setActiveIndex(null)}
                            style={[
                                styles.close,
                                { backgroundColor: colors.paper },
                                {
                                    top: insets.top + nativeTokens.spacing[2],
                                    right: insets.right + nativeTokens.spacing[2],
                                },
                            ]}
                        >
                            <Text aria-hidden style={[styles.closeLabel, { color: colors.ink }]}>
                                ×
                            </Text>
                        </Pressable>
                    </View>
                </Modal>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 8 },
    strip: { alignSelf: 'center' },
    slide: { borderRadius: 16, overflow: 'hidden' },
    image: { width: '100%', height: '100%' },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    lightbox: { flex: 1 },
    lightboxPhotoBox: { flex: 1 },
    lightboxImage: { width: '100%', height: '100%' },
    // 48 dp: Material's floor, the stricter of it and Apple's 44 pt, and the Sheet's Close.
    close: {
        position: 'absolute',
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeLabel: { fontSize: 24, lineHeight: 24 },
});
