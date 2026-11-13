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
 * HERO PAGING (`nativeBoards/buildLists.md` item 1): paging chevrons at the sides and dots that track the page. The page
 * is state: read from the strip's scroll offset and set directly when a chevron is pressed.
 *
 * @pattern Adapter over React Native's paging `ScrollView` and `Modal` — the same read model and branch behaviour as
 *     the web leaf, expressed with platform primitives; the open slide is local view state. The `ScrollView`'s handle
 *     is held in state through a callback ref, for `scrollTo`: an imperative call with no declarative form, which the
 *     chevrons need to page the strip.
 */
import { useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { carouselBox } from '@commise/ui/layout';
import { Modal } from '@commise/ui/modal';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { SurfaceToneScope } from '@commise/ui/surface-tone-scope';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import { Image } from 'expo-image';
import { useState, type FC } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fillTemplate } from '@commise/i18n';
import { recipeMessages } from '../messages.js';
import { pageAt } from './photoPaging.js';
import { PhotoDots } from './PhotoDots.native.js';
import { PhotoPagingChevrons } from './PhotoPagingChevrons.native.js';

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
    const [page, setPage] = useState(0);
    // The strip's handle, held in state through a callback ref (the shape `ScrollHost` uses): no ref object to read.
    const [strip, setStrip] = useState<ScrollView | null>(null);

    if (photos.length === 0) {
        return null;
    }

    const altFor = (index: number): string => fillTemplate(detail.photoAlt, { title, index: index + 1 });
    const activePhoto = activeIndex !== null ? photos[activeIndex] : undefined;
    const box = stripWidth === null ? null : carouselBox(stripWidth, windowHeight);

    const goTo = (next: number): void => {
        if (box === null) {
            return;
        }

        setPage(next);
        strip?.scrollTo({ x: next * box.width, animated: true });
    };

    return (
        <View
            collapsable={false}
            accessibilityLabel={detail.photosLabel}
            style={styles.container}
            onLayout={(event) => setStripWidth(event.nativeEvent.layout.width)}
        >
            {box !== null && (
                <PhotoPagingChevrons page={page} count={photos.length} title={title} onGo={goTo}>
                    <ScrollView
                        ref={setStrip}
                        keyboardShouldPersistTaps="handled"
                        horizontal
                        // One `scrollsToTop` per screen: the detail's own scroller keeps the iOS status-bar tap.
                        scrollsToTop={false}
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        // `onScroll`, not `onMomentumScrollEnd`: the page follows the swipe as it crosses a slide's midpoint, and
                        // follows the chevrons' own animated scroll too. iOS sends no scroll events without a throttle.
                        scrollEventThrottle={16}
                        onScroll={(event) =>
                            setPage(pageAt(event.nativeEvent.contentOffset.x, box.width, photos.length))
                        }
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
                </PhotoPagingChevrons>
            )}

            <PhotoDots photos={photos} title={title} page={page} />

            {activePhoto !== undefined && activeIndex !== null && (
                <Modal
                    visible
                    transparent
                    animationType="fade"
                    statusBarTranslucent
                    navigationBarTranslucent
                    onRequestClose={() => setActiveIndex(null)}
                >
                    // The lightbox has no surface of its own: the scrim is not one, and its close button is a floating
                    // control over a photo (`componentFixes.md` §10a). It states the canvas so that is a decision and
                    not an // accident of where the modal was opened from; native draws no focus ring, so the two-tone
                    ring is web's.
                    <SurfaceToneScope tone="canvas">
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
                                <Icon name="x" size={24} tone="ink" />
                            </Pressable>
                        </View>
                    </SurfaceToneScope>
                </Modal>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 8 },
    strip: { alignSelf: 'center' },
    slide: { borderRadius: nativeTokens.radius.lg, overflow: 'hidden' },
    image: { width: '100%', height: '100%' },
    lightbox: { flex: 1 },
    lightboxPhotoBox: { flex: 1 },
    lightboxImage: { width: '100%', height: '100%' },
    // 48 dp: Material's floor, the stricter of it and Apple's 44 pt, and the Sheet's Close.
    close: {
        position: 'absolute',
        width: 48,
        height: 48,
        borderRadius: nativeTokens.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
