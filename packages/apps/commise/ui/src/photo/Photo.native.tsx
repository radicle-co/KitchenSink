/**
 * @module @commise/ui/photo — the native design-system {@link Photo}: Tamagui's `styled()` over expo-image's `Image`, so a
 * photo is sized with tokens and variants and not a React Native `style` (ADR-0080). expo-image's own props pass through
 * by type and untouched: `source`, `contentFit`, `contentPosition`, `cachePolicy`, `accessibilityLabel` and the platform
 * pair that hides it from assistive tech (`accessibilityElementsHidden`, `importantForAccessibility`).
 *
 * `fill` makes the photo exactly as wide and as tall as its parent. A caller's own size prop still wins.
 *
 * Native only, like the text and the modal: the web leaves draw their photos through `<img>`.
 *
 * Presentational: props → JSX.
 *
 * @pattern Adapter over expo-image's Image — a disk-cached native image behind Tamagui's style system
 * @pattern Variant — the boolean `fill`, as a Tamagui variant, not a branch
 */
import { Image } from 'expo-image';
import { styled } from 'tamagui';

/** A photo. `fill` stretches it across its parent. */
export const Photo = styled(Image, {
    name: 'CommisePhoto',

    variants: {
        fill: {
            true: { width: '100%', height: '100%' },
        },
    } as const,
});
